// Draws a system's full advisory history as a track: a line through every
// published advisory's snapshotted position, with a dot at each one
// colored by that advisory's own intensity category (not the system's
// current one) -- so the color itself tells the strengthening/weakening
// story over time, the same way NHC's own best-track plots do. Points are
// passed in pre-computed (see history.js's pointsForSystem) since scoring
// a snapshot uses the same intensityScore() the live map uses, just
// applied to old data instead of current.
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// Mirrors editor/src/pointRenderer.js's screenUnit -- 1 unit = 1 CSS pixel
// worth of geographic span, so markers stay a fixed on-screen size
// regardless of the chart's own bounds/zoom.
function screenUnit(bounds, width, height) {
  const lonPerPx = (bounds.east - bounds.west) / Math.max(1, width);
  const latPerPx = (bounds.north - bounds.south) / Math.max(1, height);
  return Math.max(lonPerPx, latPerPx);
}

export function createTrackHistoryRenderer(svg) {
  const layer = el('g', { id: 'track-history-layer' });
  svg.append(layer);

  // `points`: [{lon, lat, color, label}], oldest first.
  function render({ points, bounds, width, height }) {
    layer.replaceChildren();
    if (!points.length || !bounds) return;

    const unit = screenUnit(bounds, width, height);

    if (points.length >= 2) {
      const d = `M${points.map((p) => `${p.lon},${-p.lat}`).join(' L')}`;
      layer.append(el('path', { class: 'track-history-line', d }));
    }

    points.forEach((p, i) => {
      const isLast = i === points.length - 1;
      const r = unit * (isLast ? 8.5 : 5.5);
      layer.append(el('circle', {
        class: `track-history-dot${isLast ? ' track-history-dot--current' : ''}`,
        cx: p.lon, cy: -p.lat, r, fill: p.color,
      }));
    });
  }

  return { render };
}
