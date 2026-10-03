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
// Every zone always renders its own normal flat fill in its own true
// geometry and color. For every PAIR of a system's zones that overlap
// (any products, any levels -- not scoped to a product subset), the
// higher-severity one (warning > watch > advisory) is "dominant" and the
// lower one is the "accent": a diagonal two-color stripe pattern of both
// zones' colors is drawn on top, clipped to just the overlap region, so
// a viewer reads the area as "mainly the dominant hazard, but this part
// also has the accent one" -- matching real NHC graphics (e.g. a
// "Hurricane Watch & Tropical Storm Warning" combo swatch rendered as a
// hatch in the official cone product's own legend), not an arbitrary
// 50/50 blend with no sense of which hazard matters more there.

import { smoothClosedPath } from './smoothPath.js';
import { watchColor, watchLevelRank } from './constants.js';

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

    // Every zone's own normal flat fill first.
    const smoothedById = new Map();
    for (const watch of valid) {
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
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const x = valid[i];
        const y = valid[j];
        // Higher severity is dominant; equal levels (e.g. two Watch-level
        // zones) tie-break on createdAt, older wins -- deterministic
        // either way, and which one "wins" for a tie barely matters
        // visually since the pattern shows both colors regardless.
        const rankX = watchLevelRank(x.level);
        const rankY = watchLevelRank(y.level);
        const xIsDominant = rankX !== rankY ? rankX > rankY : x.createdAt.localeCompare(y.createdAt) <= 0;
        const dominant = xIsDominant ? x : y;
        const accent = xIsDominant ? y : x;

        const patternId = `watch-stripe-${dominant.id}-${accent.id}`;
        const clipId = `watch-clip-${accent.id}-${dominant.id}`;
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
          el('rect', { width: 0.09, height: 0.18, fill: watchColor(dominant.product, dominant.level) }),
          el('rect', { x: 0.09, width: 0.09, height: 0.18, fill: watchColor(accent.product, accent.level) }),
        ]));
        defs.append(el('clipPath', { id: clipId }, [
          el('path', { d: closedPathD(smoothedById.get(accent.id)) }),
        ]));
        layer.append(el('path', {
          class: 'watch-zone-stripe-overlay',
          d: closedPathD(smoothedById.get(dominant.id)),
          fill: `url(#${patternId})`,
          'clip-path': `url(#${clipId})`,
          'data-watch-id': `${dominant.id}+${accent.id}`,
        }));
      }
    }
  }

  return { render };
}
