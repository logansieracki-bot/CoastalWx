// Draws the wind history as one continuous swath -- like the real NHC
// "Tropical Storm and Hurricane Force Wind Swaths" product -- rather than
// a shape sitting at each recorded point. The track only ever gives a
// handful of snapshots (one per advisory or logged position), each with
// its own wind radii; a real swath needs the radius to grow and shrink
// SMOOTHLY along the whole track, not jump at each snapshot and leave
// gaps between widely-spaced ones. So every consecutive pair of
// snapshots is densely subdivided, interpolating both the center
// position and the per-quadrant radii at each substep, with a small
// wind-envelope ring (the same quadrant geometry windFieldRenderer.js
// already draws for the live map's current position) built at every one.
// Rendered as many fully-opaque, identically-colored rings tightly
// packed along the track, the stack reads as one seamless band -- the
// practical equivalent of a true polygon union without needing one.
import { buildWindEnvelope } from '../editor/src/windFieldGeometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EARTH_RADIUS_MILES = 3958.7613; // matches windFieldGeometry.js's own constant

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function toRad(deg) { return (deg * Math.PI) / 180; }

function haversineMiles(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpRadii(a, b, t) {
  return {
    ne: lerp(Number(a?.ne) || 0, Number(b?.ne) || 0, t),
    se: lerp(Number(a?.se) || 0, Number(b?.se) || 0, t),
    sw: lerp(Number(a?.sw) || 0, Number(b?.sw) || 0, t),
    nw: lerp(Number(a?.nw) || 0, Number(b?.nw) || 0, t),
  };
}

function hasAnyRadius(radii) {
  return ['ne', 'se', 'sw', 'nw'].some((q) => (Number(radii?.[q]) || 0) > 0);
}

function ringPath(points) {
  if (!points.length) return '';
  return `M${points.map((p) => `${p.lon},${-p.lat}`).join('L')}Z`;
}

// Targets roughly one interpolated ring every 15 miles of travel --
// comfortably smaller than any real gale/hurricane-force radius, so
// consecutive rings always physically overlap and the swath never shows
// a gap, however far apart (in time or distance) the real snapshots are.
const MILES_PER_SUBSTEP = 15;
const MIN_SUBSTEPS = 6;
const MAX_SUBSTEPS = 60;
const RING_SAMPLES = 28;

function buildSwathRings(snapshots, radiiKey) {
  const rings = [];
  if (snapshots.length === 1) {
    const snap = snapshots[0];
    if (hasAnyRadius(snap[radiiKey])) {
      rings.push(buildWindEnvelope({ lon: snap.lon, lat: snap.lat }, snap[radiiKey], RING_SAMPLES));
    }
    return rings;
  }
  for (let i = 0; i < snapshots.length - 1; i++) {
    const a = snapshots[i];
    const b = snapshots[i + 1];
    const distanceMiles = haversineMiles(a, b);
    const substeps = Math.min(MAX_SUBSTEPS, Math.max(MIN_SUBSTEPS, Math.ceil(distanceMiles / MILES_PER_SUBSTEP)));
    const stepCount = substeps + (i === snapshots.length - 2 ? 1 : 0); // include the final endpoint once, on the last segment only
    for (let s = 0; s < stepCount; s++) {
      const t = s / substeps;
      const center = { lon: lerp(a.lon, b.lon, t), lat: lerp(a.lat, b.lat, t) };
      const radii = lerpRadii(a[radiiKey], b[radiiKey], t);
      if (!hasAnyRadius(radii)) continue;
      rings.push(buildWindEnvelope(center, radii, RING_SAMPLES));
    }
  }
  return rings;
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function createWindHistoryRenderer(svg) {
  const layer = el('g', { id: 'wind-history-layer' });
  // Gale (wider, lighter) laid down first so the hurricane-force swath
  // (narrower, stronger) reads as nested inside it, same layering the
  // live map's own wind-field renderer uses for the two thresholds.
  const galeLayer = el('g', { class: 'wind-history-envelope-gale' });
  const hfwLayer = el('g', { class: 'wind-history-envelope-hfw' });
  layer.append(galeLayer, hfwLayer);
  svg.append(layer);

  function renderRings(group, rings) {
    group.replaceChildren();
    for (const ring of rings) {
      const d = ringPath(ring);
      if (d) group.append(el('path', { d }));
    }
    group.style.animation = rings.length && !reduceMotion() ? 'history-fade-in .6s ease-out both' : '';
  }

  // `snapshots`: [{lon, lat, galeRadii: {ne,se,sw,nw}, hfwRadii: {ne,se,sw,nw}}], oldest first.
  function render({ snapshots }) {
    if (!snapshots || !snapshots.length) {
      galeLayer.replaceChildren();
      hfwLayer.replaceChildren();
      return;
    }
    renderRings(galeLayer, buildSwathRings(snapshots, 'galeRadii'));
    renderRings(hfwLayer, buildSwathRings(snapshots, 'hfwRadii'));
  }

  return { render };
}
