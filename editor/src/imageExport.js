// Exports an SVG map to a downloadable PNG. Shared by both the editor and
// the public page (same relative-import convention every other shared
// renderer here already uses, so it survives the GitHub Pages path-
// prefixed deployment too).
//
// The map's fills/strokes/fonts mostly come from CSS classes, not
// presentation attributes (see annotationRenderer.js's own comment on
// why annotation color specifically has to be inline) -- serializing a
// plain clone standalone would lose all of that. This walks the live
// SVG and a clone in lockstep, copying each element's actual computed
// value for a fixed set of properties onto the clone as inline style,
// so the serialized SVG renders identically once it's on its own.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Exactly the properties this app's stylesheets use to paint the map
// (see editor/styles.css's .land/.point-x-outline/.forecast-cone/etc.
// rules) -- not every CSS property, so this stays fast and doesn't drag
// in layout properties that mean nothing on a standalone SVG anyway.
const INLINE_PROPERTIES = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-size', 'font-weight', 'text-anchor', 'paint-order', 'vector-effect',
];

// Inter is never embedded or linked anywhere in this app (no @font-face,
// no stylesheet link, no vendored font file) -- it only renders today
// because it happens to be installed locally. An <img>-loaded standalone
// SVG can't rely on that, so every cloned text element gets a safe,
// always-available fallback instead of whatever Inter-first stack the
// live page resolved.
const EXPORT_FONT_STACK = 'ui-sans-serif, system-ui, sans-serif';

function inlineComputedStyle(original, clone) {
  const computed = getComputedStyle(original);
  for (const prop of INLINE_PROPERTIES) {
    const value = computed.getPropertyValue(prop);
    if (value) clone.style.setProperty(prop, value);
  }
  clone.style.setProperty('font-family', EXPORT_FONT_STACK);
}

// Exported so advisoryImageExport.js can reuse this same style-inlining
// pass on its own temporary, off-screen SVG -- that SVG is never the live
// `#map` element, but the same "classes won't survive serialization"
// problem applies to any detached clone equally.
export function cloneWithInlinedStyles(svgEl) {
  const clone = svgEl.cloneNode(true);
  inlineComputedStyle(svgEl, clone);
  const originals = svgEl.querySelectorAll('*');
  const clones = clone.querySelectorAll('*');
  for (let i = 0; i < originals.length; i++) {
    inlineComputedStyle(originals[i], clones[i]);
  }
  return clone;
}

// Rasterizes `svgEl` at `width`x`height` CSS pixels into a loaded <img>,
// via the same inline-styles-then-serialize-then-load approach
// exportSvgAsPng always used internally -- extracted so
// advisoryImageExport.js can rasterize its own temporary SVG without
// duplicating this (object-URL lifecycle included: the SVG blob URL is
// always revoked before this resolves or rejects, win or lose).
export async function rasterizeSvgToImage(svgEl, width, height) {
  const clone = cloneWithInlinedStyles(svgEl);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const svgUrl = URL.createObjectURL(new Blob(
    [new XMLSerializer().serializeToString(clone)],
    { type: 'image/svg+xml;charset=utf-8' }
  ));
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to rasterize the map.'));
      img.src = svgUrl;
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// Encodes `canvas` as a PNG and triggers a browser download -- extracted
// so advisoryImageExport.js can download its own composited canvas (map
// inset + stat card) through the same tested path exportSvgAsPng already
// used internally.
export async function downloadCanvasAsPng(canvas, fileName) {
  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode PNG.'))), 'image/png');
  });
  const pngUrl = URL.createObjectURL(pngBlob);
  try {
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(pngUrl);
  }
}

// Renders `svgEl` (the live #map) to a PNG and triggers a browser
// download. `backgroundColor` should be the calling page's own water
// color (its CSS custom property's resolved value) -- the SVG itself
// paints no background at all (that comes from the surrounding
// .map-wrap/.map-pane div in CSS), so without this the exported PNG
// would have a transparent hole over every bit of open water.
export async function exportSvgAsPng(svgEl, { fileName = 'coastalwx-map.png', backgroundColor = '#ffffff', scale = 2 } = {}) {
  const rect = svgEl.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width === 0 || height === 0) throw new Error('Map has no rendered size yet.');

  const image = await rasterizeSvgToImage(svgEl, width, height);

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  await downloadCanvasAsPng(canvas, fileName);
}
