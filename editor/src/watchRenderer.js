// Renders confirmed watch/warning zones as colored polygons on the map.
// Deliberately simpler than annotationRenderer.js: a watch is always a
// closed zone (no "arrow" variant), colored by its own severity level
// (not an owning system's color), and has no vertex-handle reshaping in
// this first cut -- delete and redraw covers that for now. While a new
// zone is actively being drawn, its live preview is already covered by
// the shared drawingSession/draft path annotationRenderer.js renders
// (see editor/src/main.js) -- that path is agnostic to what the
// in-progress shape will become, so nothing here needs to duplicate it.

import { smoothClosedPath } from './smoothPath.js';
import { watchColor } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function token(p) { return `${p.lon},${-p.lat}`; }

function closedPathD(points) {
  if (!points.length) return '';
  return `M${token(points[0])}` + points.slice(1).map((p) => `L${token(p)}`).join('') + 'Z';
}

export function createWatchRenderer(svg) {
  const layer = el('g', { id: 'watch-layer' });
  // Clips the whole layer to land -- a zone can be drawn freely over water
  // (handled entirely by the generic drawingSession/draft preview this
  // file's own header comment describes, which is unaffected), but once
  // it's a real rendered watch it should only ever show on land, matching
  // NHC's own watch/warning graphics. References mapRenderer.js's "land-
  // clip" clipPath (built once there, from the same land geometry this
  // map already draws) -- both editor and public share that exact module
  // (see this file's own import story: createWatchRenderer is imported
  // directly by public/src/main.js), so one definition covers both pages.
  layer.setAttribute('clip-path', 'url(#land-clip)');
  svg.append(layer);

  function render({ watches }) {
    layer.replaceChildren();
    if (!watches || !watches.length) return;

    for (const watch of watches) {
      if (watch.points.length < 3) continue; // nothing to close yet
      const color = watchColor(watch.product, watch.level);
      const smoothed = smoothClosedPath(watch.points, 16);
      layer.append(el('path', {
        class: 'watch-zone-fill',
        d: closedPathD(smoothed),
        fill: color,
        stroke: color,
        'data-watch-id': watch.id,
        'data-system-id': watch.systemId,
      }));
    }
  }

  return { render };
}
