import { smoothPath, smoothClosedPath } from './smoothPath.js';
import { PROBABILITY_COLORS, systemColor } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function screenUnit(bounds, width, height) {
  const lonPerPx = (bounds.east - bounds.west) / Math.max(1, width);
  const latPerPx = (bounds.north - bounds.south) / Math.max(1, height);
  return Math.max(lonPerPx, latPerPx);
}

function token(p) { return `${p.lon},${-p.lat}`; }

function openPathD(points) {
  if (points.length === 0) return '';
  return `M${token(points[0])}` + points.slice(1).map((p) => `L${token(p)}`).join('');
}

function closedPathD(points) {
  return points.length ? `${openPathD(points)}Z` : '';
}

function arrowheadPoints(tip, prev, size) {
  const dx = tip.lon - prev.lon;
  const dy = tip.lat - prev.lat;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const back = { lon: tip.lon - ux * size * 2.2, lat: tip.lat - uy * size * 2.2 };
  const left = { lon: back.lon + px * size * 1.1, lat: back.lat + py * size * 1.1 };
  const right = { lon: back.lon - px * size * 1.1, lat: back.lat - py * size * 1.1 };
  return [tip, left, right];
}

// Draws the finished (or in-progress "draft") portion of one shape/arrow --
// the smoothed fill/line path, plus an arrowhead for arrows. Never draws
// vertex handles; that's the caller's job, gated on selection.
//
// `color`, when given, is the owning system's probability color: it's
// applied via presentation attributes (not a CSS class) so each annotation
// can have its own color. The non-draft CSS classes deliberately omit
// fill/stroke so these inline values always win -- a CSS class rule would
// otherwise override an element's own presentation attribute. Draft
// annotations (color undefined) keep their fixed CSS-driven color, which
// stays visually distinct from any system's real color while drawing.
function appendFill(layer, { points, type, cssPrefix, dataAttrs, unit, color, samplesPerSegment = 16 }) {
  if (points.length < 2) return; // nothing to draw yet (a draft with just one point placed)

  if (type === 'shape') {
    if (points.length < 3) {
      // Not closeable yet -- show an open live preview so the line still
      // "connects them live as you go" before the loop is closed. Separate
      // CSS class (not just an inline fill override) since a CSS class rule
      // always wins over an element's own presentation attribute.
      const smoothed = smoothPath(points, samplesPerSegment);
      const attrs = { class: `${cssPrefix}-shape-preview`, d: openPathD(smoothed), ...dataAttrs };
      if (color) attrs.stroke = color;
      layer.append(el('path', attrs));
      return;
    }
    const smoothed = smoothClosedPath(points, samplesPerSegment);
    const attrs = { class: `${cssPrefix}-shape-fill`, d: closedPathD(smoothed), ...dataAttrs };
    if (color) { attrs.fill = hexToRgba(color, 0.22); attrs.stroke = color; }
    layer.append(el('path', attrs));
    return;
  }

  // arrow
  const smoothed = smoothPath(points, samplesPerSegment);
  const d = openPathD(smoothed);
  layer.append(el('path', { class: `${cssPrefix}-arrow-hit`, d, ...dataAttrs }));
  const lineAttrs = { class: `${cssPrefix}-arrow-line`, d, ...dataAttrs };
  if (color) lineAttrs.stroke = color;
  layer.append(el('path', lineAttrs));
  const tip = smoothed[smoothed.length - 1];
  const prev = smoothed[Math.max(0, smoothed.length - 2)];
  const head = arrowheadPoints(tip, prev, unit * 10);
  const headAttrs = { class: `${cssPrefix}-arrowhead`, points: head.map(token).join(' '), ...dataAttrs };
  if (color) headAttrs.fill = color;
  layer.append(el('polygon', headAttrs));
}

function appendHandles(layer, { id, points, unit, color }) {
  const r = unit * 6;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const attrs = {
      class: 'annotation-vertex-handle',
      'data-annotation-id': id,
      'data-vertex-index': i,
      cx: p.lon, cy: -p.lat, r,
    };
    if (color) attrs.stroke = color;
    layer.append(el('circle', attrs));
  }
}

export function createAnnotationRenderer(svg) {
  const fillLayer = el('g', { id: 'annotation-fill-layer' });
  const handleLayer = el('g', { id: 'annotation-handle-layer' });
  svg.append(fillLayer, handleLayer);

  function render({ annotations, selectedAnnotationId, draft, systems, bounds, width, height }) {
    fillLayer.replaceChildren();
    handleLayer.replaceChildren();
    const unit = screenUnit(bounds, width, height);
    const systemsById = new Map((systems ?? []).map((s) => [s.id, s]));

    for (const ann of annotations) {
      const owner = systemsById.get(ann.systemId);
      const color = owner ? systemColor(owner) : PROBABILITY_COLORS.none;
      appendFill(fillLayer, {
        points: ann.points, type: ann.type, cssPrefix: 'annotation', unit, color,
        // data-system-id (alongside data-annotation-id) is what lets the
        // public page's click handler select the owning system straight
        // off a shape/arrow -- the only clickable representation a
        // not-yet-Formed disturbance has there, per pointRenderer.js's
        // hideUnformed. The editor's own gesture handling still checks
        // data-annotation-id first, so this is a no-op for its own
        // drag/select-the-annotation behavior.
        dataAttrs: { 'data-annotation-id': ann.id, 'data-system-id': ann.systemId },
      });
      if (ann.id !== selectedAnnotationId) continue; // fill above always renders; only handles are gated
      appendHandles(handleLayer, { id: ann.id, points: ann.points, unit, color });
    }

    if (draft) {
      appendFill(fillLayer, {
        points: draft.points, type: draft.type, cssPrefix: 'annotation-draft', unit,
        dataAttrs: {},
      });
      // Draft handles always show (there's nothing else to select while drawing it).
      const r = unit * 6;
      draft.points.forEach((p, i) => {
        handleLayer.append(el('circle', {
          class: `annotation-vertex-handle annotation-draft-handle${i === 0 && draft.type === 'shape' ? ' annotation-draft-handle--origin' : ''}`,
          'data-draft-vertex-index': i,
          cx: p.lon, cy: -p.lat, r,
        }));
      });
    }
  }

  return { render };
}
