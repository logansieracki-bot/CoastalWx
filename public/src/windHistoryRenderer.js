// Draws the "wind history" swath: every advisory's own gale/hurricane-
// force wind envelope, stacked at low opacity. Reuses
// windFieldRenderer.js's windEnvelopePathData() verbatim (same quadrant
// math the live map's wind-field editor uses) -- an advisory's snapshot
// already carries the same NE/SE/SW/NW radii fields a live system does,
// so no new geometry was needed, just applying it once per advisory
// instead of once for the current position. Where many advisories'
// envelopes overlap (the core of the track) the stacked opacity reads
// solid; where only a few reach, it fades out -- the same "how wide did
// it get, and where" story the reference site's own wind-history swath
// tells, just built from low-opacity overlap instead of a pre-merged
// polygon union.
import { windEnvelopePathData } from '../editor/src/windFieldRenderer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export function createWindHistoryRenderer(svg) {
  const layer = el('g', { id: 'wind-history-layer' });
  svg.append(layer);

  // `snapshots`: [{lon, lat, galeRadii: {ne,se,sw,nw}, hfwRadii: {ne,se,sw,nw}}]
  function render({ snapshots }) {
    layer.replaceChildren();
    if (!snapshots || !snapshots.length) return;

    // Gale-force swath first (wider, lighter) so the hurricane-force swath
    // (narrower, stronger) reads as clearly nested inside it, same layering
    // the live map's own wind-field renderer uses for the two thresholds.
    for (const snap of snapshots) {
      const d = windEnvelopePathData({ lon: snap.lon, lat: snap.lat }, snap.galeRadii);
      if (d) layer.append(el('path', { class: 'wind-history-envelope wind-history-envelope-gale', d }));
    }
    for (const snap of snapshots) {
      const d = windEnvelopePathData({ lon: snap.lon, lat: snap.lat }, snap.hfwRadii);
      if (d) layer.append(el('path', { class: 'wind-history-envelope wind-history-envelope-hfw', d }));
    }
  }

  return { render };
}
