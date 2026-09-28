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

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function appendEnvelope(layer, snap, radii, cssClass, delayMs) {
  const d = windEnvelopePathData({ lon: snap.lon, lat: snap.lat }, radii);
  if (!d) return;
  const path = el('path', { class: `wind-history-envelope ${cssClass}`, d });
  if (!reduceMotion()) {
    path.style.animation = 'history-fade-in .6s ease-out both';
    path.style.animationDelay = `${delayMs}ms`;
  }
  layer.append(path);
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
    // Both fade in staggered along the same oldest-to-newest order the
    // track draws in, so switching tabs still reads as one story.
    snapshots.forEach((snap, i) => appendEnvelope(layer, snap, snap.galeRadii, 'wind-history-envelope-gale', i * 70));
    snapshots.forEach((snap, i) => appendEnvelope(layer, snap, snap.hfwRadii, 'wind-history-envelope-hfw', i * 70));
  }

  return { render };
}
