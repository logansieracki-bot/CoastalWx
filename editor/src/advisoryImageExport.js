// Composites a single system's shareable "advisory card": a stat-card-
// dominant portrait image (name/category/wind/pressure/etc., canvas-drawn)
// with an inset map (track, cone, and that system's own annotations,
// tightly auto-framed -- not the forecaster's own current pan/zoom) below
// it, modeled on NHC's own advisory graphics. Replaces exportSvgAsPng as
// the Download Image button's implementation in both main.js files --
// exportSvgAsPng itself stays, just no longer wired to that button (see
// imageExport.js's own comment on why it's still worth keeping standalone).
//
// The map portion reuses the exact renderer factories the live map uses,
// pointed at a temporary, off-screen-but-DOM-attached SVG (detached-from-
// layout elements still need real DOM connection for getComputedStyle/
// getBoundingClientRect, which imageExport.js's rasterizeSvgToImage
// depends on -- position:fixed far off-canvas, not display:none) built and
// torn down for just this one export. First use of that pattern in this
// codebase; the 4 renderers used here were confirmed to hold no live/
// global state (svg at construction, all data fresh at render()) so this
// is safe.
import { boundsForPoints, fitBoundsToAspect } from './geo.js';
import { createMapRenderer } from './mapRenderer.js';
import { createTrackConeRenderer } from './trackConeRenderer.js';
import { createAnnotationRenderer } from './annotationRenderer.js';
import { createPointRenderer } from './pointRenderer.js';
import { rasterizeSvgToImage, downloadCanvasAsPng } from './imageExport.js';
import { buildStatCardData } from './stormStats.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_STACK = 'ui-sans-serif, system-ui, sans-serif'; // mirrors imageExport.js's own EXPORT_FONT_STACK -- not exported from there, small enough to duplicate per this app's existing per-file-duplication convention (see forecastPoints.js/systems.js's averageRadius for precedent).

// Card chrome colors -- this app has no light theme to account for (see
// public/styles.css's --bg-deep/--text/--text-muted), so these are the
// same fixed values rather than a theme param threaded through.
const CARD_BG = '#0a1628';
const TEXT = '#eef3f9';
const TEXT_MUTED = '#8fa2ba';

const CARD_WIDTH = 640;
const CARD_HEIGHT = 820;
const MARGIN = 24;
const ROW_HEIGHT = 28;
const FOOTER_HEIGHT = 32;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function text(ctx, str, x, y, { font, color, align = 'left', baseline = 'alphabetic' }) {
  ctx.font = `${font} ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

// Builds and tears down the temporary off-screen SVG, drives the 4 live-
// map renderer factories against it (scoped to just this one system -- no
// watch zones, wind-field envelopes, or live-pulse animation, same
// deliberate restriction as the rest of this card), and rasterizes it.
async function rasterizeMapInset({ system, trackPoints, annotations, geography, width, height }) {
  // The off-screen positioning goes on a wrapper <div>, never on the <svg>
  // itself -- `cloneNode(true)` (inside rasterizeSvgToImage's
  // cloneWithInlinedStyles) copies the SVG's own inline `style` attribute
  // verbatim, and `position: fixed; left: -99999px` baked into the
  // serialized SVG's root element shifts its entire rendered content off
  // its own canvas once it's reloaded as a standalone image -- confirmed
  // directly (a plain red test rect rasterized solid background-colored/
  // invisible with that styling on the <svg> itself, correctly red once
  // moved to a wrapper). The <svg> only ever gets a harmless width/height.
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-99999px';
  wrapper.style.top = '-99999px';
  document.body.append(wrapper);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  wrapper.append(svg);

  try {
    const mapRenderer = createMapRenderer(svg, geography);
    const trackConeRenderer = createTrackConeRenderer(svg);
    const annotationRenderer = createAnnotationRenderer(svg);
    const pointRenderer = createPointRenderer(svg);

    const aspect = width / height;
    const bounds = fitBoundsToAspect(boundsForPoints(trackPoints, { lon: system.lon, lat: system.lat }), aspect);

    mapRenderer.render({ bounds, width, height, showGrid: true });
    trackConeRenderer.render({ points: trackPoints, selectedForecastPointId: null, bounds, width, height });
    // `annotations` is deliberately this system's own shapes/arrows
    // regardless of classification status, not main.js's own
    // visibleAnnotations() (which hides them once classified, since the
    // live map treats the forecast track as superseding them there) --
    // the card should show "track on it and shape too" together, per the
    // user's own request for this feature.
    annotationRenderer.render({ annotations, selectedAnnotationId: null, draft: null, systems: [system], bounds, width, height });
    pointRenderer.render({ systems: [system], selectedId: null, bounds, width, height });

    return await rasterizeSvgToImage(svg, width, height);
  } finally {
    wrapper.remove();
  }
}

export async function exportAdvisoryImage({
  system, trackPoints, annotations, advisory, geography,
  backgroundColor = '#ffffff', fileName = 'coastalwx-advisory.png', scale = 2,
}) {
  const data = buildStatCardData(system, advisory);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale); // everything below is written in CARD_WIDTH x CARD_HEIGHT logical pixels

  ctx.fillStyle = CARD_BG;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const contentWidth = CARD_WIDTH - MARGIN * 2;

  // Header: category/probability-colored band with the system's name.
  const headerH = 100;
  roundRectPath(ctx, MARGIN, MARGIN, contentWidth, headerH, 14);
  ctx.fillStyle = data.color;
  ctx.fill();
  text(ctx, data.kind.toUpperCase(), MARGIN + 18, MARGIN + 34, { font: '700 11px', color: data.textColor, baseline: 'middle' });
  text(ctx, data.name, MARGIN + 18, MARGIN + 68, { font: '800 26px', color: data.textColor, baseline: 'middle' });

  // Hero stats: wind + category symbol (or development chance), side by side.
  const heroY = MARGIN + headerH + 14;
  const heroH = 76;
  const heroMidX = MARGIN + contentWidth / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(heroMidX, heroY + 10);
  ctx.lineTo(heroMidX, heroY + heroH - 10);
  ctx.stroke();

  const windValue = data.windMph != null ? String(Math.round(data.windMph)) : '—';
  const windLabel = data.windMph != null ? 'Max wind (mph)' : 'Max wind';
  text(ctx, windValue, MARGIN + 24, heroY + 32, { font: '800 32px', color: TEXT, baseline: 'alphabetic' });
  text(ctx, windLabel, MARGIN + 24, heroY + 56, { font: '700 10px', color: TEXT_MUTED, baseline: 'alphabetic' });

  text(ctx, data.secondValue, heroMidX + 24, heroY + 32, { font: '800 32px', color: TEXT, baseline: 'alphabetic' });
  text(ctx, data.secondLabel, heroMidX + 24, heroY + 56, { font: '700 10px', color: TEXT_MUTED, baseline: 'alphabetic' });

  // Derived rows (position, central pressure, last fix/updated, next advisory).
  let rowY = heroY + heroH + 16;
  for (const row of data.rows) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.moveTo(MARGIN, rowY + ROW_HEIGHT - 2);
    ctx.lineTo(MARGIN + contentWidth, rowY + ROW_HEIGHT - 2);
    ctx.stroke();
    text(ctx, row.label.toUpperCase(), MARGIN, rowY + ROW_HEIGHT / 2, { font: '700 9.5px', color: TEXT_MUTED, baseline: 'middle' });
    text(ctx, row.value, MARGIN + contentWidth, rowY + ROW_HEIGHT / 2, { font: '700 12px', color: TEXT, align: 'right', baseline: 'middle' });
    rowY += ROW_HEIGHT;
  }

  // Map inset: fills the rest of the card down to the footer.
  const mapY = rowY + 12;
  const mapH = CARD_HEIGHT - MARGIN - FOOTER_HEIGHT - mapY;
  const mapImage = await rasterizeMapInset({
    system, trackPoints, annotations, geography,
    width: Math.round(contentWidth), height: Math.round(mapH),
  });
  ctx.save();
  roundRectPath(ctx, MARGIN, mapY, contentWidth, mapH, 14);
  ctx.clip();
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(MARGIN, mapY, contentWidth, mapH);
  ctx.drawImage(mapImage, MARGIN, mapY, contentWidth, mapH);
  ctx.restore();

  // Footer: small attribution + generation date, same spirit as an NHC
  // graphic's own issuance stamp.
  text(ctx, `CoastalWx · ${new Date().toLocaleDateString()}`, CARD_WIDTH / 2, CARD_HEIGHT - 14, {
    font: '600 10.5px', color: TEXT_MUTED, align: 'center', baseline: 'middle',
  });

  await downloadCanvasAsPng(canvas, fileName);
}
