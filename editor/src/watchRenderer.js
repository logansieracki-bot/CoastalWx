// Renders confirmed watch/warning zones as colored polygons on the map.
// Deliberately simpler than annotationRenderer.js: a watch is always a
// closed zone (no "arrow" variant), colored by its own product+level (not
// an owning system's color), and has no vertex-handle reshaping in this
// first cut -- delete and redraw covers that for now. While a new zone is
// actively being drawn, its live preview is already covered by the shared
// drawingSession/draft path annotationRenderer.js renders (see
// editor/src/main.js) -- that path is agnostic to what the in-progress
// shape will become, so nothing here needs to duplicate it.
//
// Two zones of the same geometry type (see watchGeometryType) overlapping
// on the same system get a distinct treatment instead of just stacking --
// 'lane'-type zones (coastal_flood/storm_surge) render as one fill plus
// outline-only additional zones so none hide each other; 'stripe'-type
// zones (the other 4 products) render a diagonal two-color pattern over
// their actual overlap region. A lane zone overlapping a stripe zone just
// stacks as normal -- cross-category blending was never asked for, and
// the geometry split exists specifically because the two don't mix.

import { smoothClosedPath } from './smoothPath.js';
import { watchColor, watchGeometryType } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

function token(p) { return `${p.lon},${-p.lat}`; }

function closedPathD(points) {
  if (!points.length) return '';
  return `M${token(points[0])}` + points.slice(1).map((p) => `L${token(p)}`).join('') + 'Z';
}

// Axis-aligned bounding box overlap -- a cheap, deliberately approximate
// stand-in for real polygon intersection (this codebase has no such
// utility, and watch zones are simple hand-drawn blobs, not concave or
// far-flung shapes, so a bounding-box test tracks real visual overlap
// closely in practice). Good enough to decide "does this lane zone need
// the outline treatment," not meant for anything geometrically precise.
function boundsOf(points) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

function boundsOverlap(a, b) {
  return a.minLon < b.maxLon && a.maxLon > b.minLon && a.minLat < b.maxLat && a.maxLat > b.minLat;
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

  // Holds the per-pair stripe <pattern>s and their <clipPath>s -- rebuilt
  // alongside the zone layer on every render (stale defs from a watch
  // that no longer exists are otherwise never cleaned up).
  const defs = el('defs');
  svg.append(defs);

  function render({ watches }) {
    layer.replaceChildren();
    defs.replaceChildren();
    if (!watches || !watches.length) return;

    const valid = watches.filter((w) => w.points.length >= 3); // nothing to close yet otherwise
    const laneWatches = valid.filter((w) => watchGeometryType(w.product) === 'lane');
    const stripeWatches = valid.filter((w) => watchGeometryType(w.product) === 'stripe');

    // Lane-type: a zone that doesn't overlap anything already placed
    // renders as a normal fill, same as a single standalone zone always
    // has. A zone whose bounds DO overlap an earlier one renders outline-
    // only instead, so the two stay individually visible rather than the
    // later one just covering the earlier one's fill. Processed oldest-
    // first so, within a mutually-overlapping cluster, the first-drawn
    // zone is the one that keeps its fill. A deliberate simplification of
    // "parallel offset lanes" -- this codebase has no offset-polyline
    // utility, and the original design (from a prior project) was never
    // specified beyond "so overlapping ones stay visible" -- not a
    // literal reconstruction. (stroke-width is left to styles.css's own
    // fixed .watch-zone-fill rule, not set here -- a CSS rule always wins
    // over a same-property presentation attribute, so setting one here
    // would just be silently ignored.)
    const placedLaneBounds = [];
    for (const watch of laneWatches.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const bounds = boundsOf(watch.points);
      const overlapsExisting = placedLaneBounds.some((b) => boundsOverlap(bounds, b));
      placedLaneBounds.push(bounds);
      const color = watchColor(watch.product, watch.level);
      const smoothed = smoothClosedPath(watch.points, 16);
      layer.append(el('path', {
        class: 'watch-zone-fill',
        d: closedPathD(smoothed),
        fill: overlapsExisting ? 'none' : color,
        stroke: color,
        'data-watch-id': watch.id,
        'data-system-id': watch.systemId,
      }));
    }

    // Stripe-type: each zone gets its own normal flat fill first...
    const smoothedById = new Map();
    for (const watch of stripeWatches) {
      const color = watchColor(watch.product, watch.level);
      const smoothed = smoothClosedPath(watch.points, 16);
      smoothedById.set(watch.id, smoothed);
      layer.append(el('path', {
        class: 'watch-zone-fill',
        d: closedPathD(smoothed),
        fill: color,
        stroke: color,
        'data-watch-id': watch.id,
        'data-system-id': watch.systemId,
      }));
    }
    // ...then every unique pair gets a diagonal-stripe overlay on top,
    // clipped to their actual overlap. SVG clip-paths nest (a child's
    // visible region is its own clip intersected with every ancestor's,
    // and #watch-layer is already clipped to land), so a non-overlapping
    // pair just naturally clips to nothing -- no manual polygon-
    // intersection math needed, overlap detection falls out of this same
    // generic pairwise loop for free.
    for (let i = 0; i < stripeWatches.length; i++) {
      for (let j = i + 1; j < stripeWatches.length; j++) {
        const a = stripeWatches[i];
        const b = stripeWatches[j];
        const patternId = `watch-stripe-${a.id}-${b.id}`;
        const clipId = `watch-clip-${b.id}-${a.id}`;
        // objectBoundingBox (not userSpaceOnUse) so the stripe tile scales
        // with each zone's own size rather than with the map's current
        // viewBox -- this SVG's coordinate system is raw lon/lat degrees
        // (see mapRenderer.js's render()), which pan/zoom rescales
        // constantly, so a fixed-degree tile would look wildly different
        // sized depending on current zoom.
        defs.append(el('pattern', {
          id: patternId, patternUnits: 'objectBoundingBox', patternContentUnits: 'objectBoundingBox',
          width: 0.18, height: 0.18, patternTransform: 'rotate(45)',
        }, [
          el('rect', { width: 0.09, height: 0.18, fill: watchColor(a.product, a.level) }),
          el('rect', { x: 0.09, width: 0.09, height: 0.18, fill: watchColor(b.product, b.level) }),
        ]));
        defs.append(el('clipPath', { id: clipId }, [
          el('path', { d: closedPathD(smoothedById.get(b.id)) }),
        ]));
        layer.append(el('path', {
          class: 'watch-zone-stripe-overlay',
          d: closedPathD(smoothedById.get(a.id)),
          fill: `url(#${patternId})`,
          'clip-path': `url(#${clipId})`,
          'data-watch-id': `${a.id}+${b.id}`,
        }));
      }
    }
  }

  return { render };
}
