// Drag-to-resize handle for the selected forecast point's cone spread
// (uncertainty radius, in miles) -- an alternative to typing a number in
// the sidebar. Adapted from an old prototype's spreadEditor.js: a dashed
// ring at the current radius, a guide line, and a handle at its end.
// The handle is always drawn due east of the point (not following the
// mouse's actual angle) -- it's a plain distance control, not a
// directional one, matching the source exactly.
import { spreadEllipseAtSample } from './trackGeometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function screenUnit(bounds, width, height) {
  return Math.max(
    (bounds.east - bounds.west) / Math.max(1, width),
    (bounds.north - bounds.south) / Math.max(1, height)
  );
}

export function createSpreadEditor(svg) {
  const layer = el('g', { id: 'spread-editor-layer' });
  svg.append(layer);

  // `point` is the selected forecast point's raw record ({id, lon, lat,
  // spreadMi, ...}), or null/undefined when nothing eligible is selected
  // (no system selected, no point selected, or the current/hour-0 marker
  // -- that one never appears in the forecastPoints array to begin with).
  function render({ point, bounds, width, height }) {
    layer.replaceChildren();
    if (!point || !bounds) return;

    const { rx, ry } = spreadEllipseAtSample({ lon: point.lon, lat: point.lat, spread: point.spreadMi });
    const unit = screenUnit(bounds, width, height);
    const handleRx = Math.max(rx, unit * 14);
    const handleRadius = unit * 6.5;

    if (point.spreadMi > 0) {
      layer.append(el('ellipse', { class: 'spread-ring', cx: point.lon, cy: -point.lat, rx, ry }));
    }
    layer.append(el('line', {
      class: 'spread-guide',
      x1: point.lon, y1: -point.lat, x2: point.lon + handleRx, y2: -point.lat,
    }));
    // No data-forecast-point-id here (unlike the marker dot) -- it would
    // also match the forecast-point hit-test in main.js's pointer handling,
    // since that looks for the same attribute name. Only one spread handle
    // is ever rendered at a time anyway (for the selected point), so the
    // gesture handler just reads selectedForecastPointId directly.
    layer.append(el('circle', {
      class: 'spread-handle',
      'data-spread-handle': 'true',
      cx: point.lon + handleRx, cy: -point.lat, r: handleRadius,
    }));
  }

  return { render, layer };
}
