import { smoothPath, smoothClosedPath } from './smoothPath.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
function appendFill(layer, { points, type, cssPrefix, dataAttrs, unit, samplesPerSegment = 16 }) {
  if (points.length < 2) return; // nothing to draw yet (a draft with just one point placed)

  if (type === 'shape') {
    if (points.length < 3) {
      // Not closeable yet -- show an open live preview so the line still
      // "connects them live as you go" before the loop is closed. Separate
      // CSS class (not just an inline fill override) since a CSS class rule
      // always wins over an element's own presentation attribute.
      const smoothed = smoothPath(points, samplesPerSegment);
      layer.append(el('path', { class: `${cssPrefix}-shape-preview`, d: openPathD(smoothed), ...dataAttrs }));
      return;
    }
    const smoothed = smoothClosedPath(points, samplesPerSegment);
    layer.append(el('path', { class: `${cssPrefix}-shape-fill`, d: closedPathD(smoothed), ...dataAttrs }));
    return;
  }

  // arrow
  const smoothed = smoothPath(points, samplesPerSegment);
  const d = openPathD(smoothed);
  layer.append(el('path', { class: `${cssPrefix}-arrow-hit`, d, ...dataAttrs }));
  layer.append(el('path', { class: `${cssPrefix}-arrow-line`, d, ...dataAttrs }));
  const tip = smoothed[smoothed.length - 1];
  const prev = smoothed[Math.max(0, smoothed.length - 2)];
  const head = arrowheadPoints(tip, prev, unit * 10);
  layer.append(el('polygon', { class: `${cssPrefix}-arrowhead`, points: head.map(token).join(' '), ...dataAttrs }));
}

function appendHandles(layer, { id, points, unit }) {
  const r = unit * 6;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    layer.append(el('circle', {
      class: 'annotation-vertex-handle',
      'data-annotation-id': id,
      'data-vertex-index': i,
      cx: p.lon, cy: -p.lat, r,
    }));
  }
}

export function createAnnotationRenderer(svg) {
  const fillLayer = el('g', { id: 'annotation-fill-layer' });
  const handleLayer = el('g', { id: 'annotation-handle-layer' });
  svg.append(fillLayer, handleLayer);

  function render({ annotations, selectedAnnotationId, draft, bounds, width, height }) {
    fillLayer.replaceChildren();
    handleLayer.replaceChildren();
    const unit = screenUnit(bounds, width, height);

    for (const ann of annotations) {
      appendFill(fillLayer, {
        points: ann.points, type: ann.type, cssPrefix: 'annotation', unit,
        dataAttrs: { 'data-annotation-id': ann.id },
      });
      if (ann.id !== selectedAnnotationId) continue; // fill above always renders; only handles are gated
      appendHandles(handleLayer, { id: ann.id, points: ann.points, unit });
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
