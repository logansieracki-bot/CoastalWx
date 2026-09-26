// Forecast-track / cone-of-uncertainty geometry: dense centripetal
// Catmull-Rom resampling of a track, carrying spread (cone radius, miles)
// and hour (forecast lead time) along for the ride at each sample.
//
// Deliberately a separate module from smoothPath.js rather than a
// generalization of it -- that file's own comment already draws this
// boundary ("no scalar-field interpolation -- this project's shapes/arrows
// are small and local, not ocean-spanning tracks"). A track needs
// spread/hour interpolated alongside position; shapes/arrows never do.
//
// Adapted from an old prototype of this same idea. That prototype also had
// a tangent-offset ribbon-polygon cone builder and a half-plane track-split
// approach, both fully implemented and unit-tested there but dead code --
// its own shipped renderer used the simpler technique kept here: sample
// the track densely, turn each sample into a spread-sized disk, and let
// the renderer union the disks via an SVG mask. That needs positions and
// per-sample spread/hour only, not tangents, so this file is intentionally
// smaller than what it was adapted from.
import { MILES_PER_DEGREE_LAT } from './constants.js';

function chordT(t, p, q) {
  const dx = q.lon - p.lon;
  const dy = q.lat - p.lat;
  return t + Math.sqrt(Math.sqrt(dx * dx + dy * dy));
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpPoint(a, b, t) {
  return { lon: lerp(a.lon, b.lon, t), lat: lerp(a.lat, b.lat, t) };
}

function mirror(anchor, other) {
  return { lon: 2 * anchor.lon - other.lon, lat: 2 * anchor.lat - other.lat };
}

function catmullRomPoint(p0, p1, p2, p3, u) {
  const t0 = 0;
  const t1 = chordT(t0, p0, p1);
  const t2 = chordT(t1, p1, p2);
  const t3 = chordT(t2, p2, p3);

  if (t1 === t0 || t2 === t1 || t3 === t2) return lerpPoint(p1, p2, u);

  const t = t1 + u * (t2 - t1);

  const a1 = lerpPoint(p0, p1, (t - t0) / (t1 - t0));
  const a2 = lerpPoint(p1, p2, (t - t1) / (t2 - t1));
  const a3 = lerpPoint(p2, p3, (t - t2) / (t3 - t2));

  const b1 = lerpPoint(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerpPoint(a2, a3, (t - t1) / (t3 - t1));

  return lerpPoint(b1, b2, (t - t1) / (t2 - t1));
}

// Dense resample of a track (points: [{lon, lat, hour, spread}, ...],
// ordered by hour ascending, at least 1 entry). hour/spread are linearly
// interpolated per segment using the same local parameter fed to the
// position curve -- a plain local lerp, not re-parameterized to the
// curve's true arc length, matching what this was adapted from.
export function sampleTrack(points, samplesPerSegment = 24) {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) {
    const p = points[0];
    return [{ lon: p.lon, lat: p.lat, hour: Number(p.hour) || 0, spread: Math.max(0, Number(p.spread) || 0) }];
  }

  const result = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = i === 0 ? mirror(p1, p2) : points[i - 1];
    const p3 = i === n - 2 ? mirror(p2, p1) : points[i + 2];
    for (let s = 0; s < samplesPerSegment; s++) {
      const u = s / samplesPerSegment;
      const pos = catmullRomPoint(p0, p1, p2, p3, u);
      result.push({
        lon: pos.lon,
        lat: pos.lat,
        hour: lerp(Number(p1.hour) || 0, Number(p2.hour) || 0, u),
        spread: lerp(Math.max(0, Number(p1.spread) || 0), Math.max(0, Number(p2.spread) || 0), u),
      });
    }
  }
  const last = points[n - 1];
  result.push({ lon: last.lon, lat: last.lat, hour: Number(last.hour) || 0, spread: Math.max(0, Number(last.spread) || 0) });
  return result;
}

// Does the forecast extend past the given split hour (default 72h/day-3)?
// Gates whether a Day 4-5 continuation should render at all.
export function hasLatePeriod(points, splitHour = 72) {
  return (points || []).some((p) => (Number(p.hour) || 0) > splitHour + 1e-9);
}

// One sample's spread (miles) as a lon/lat ellipse: a true circle of that
// many miles looks like an ellipse in equirectangular projection, since a
// mile of longitude shrinks with cos(latitude).
export function spreadEllipseAtSample(sample) {
  const spread = Math.max(0, Number(sample?.spread) || 0);
  const lat = Number(sample?.lat) || 0;
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return {
    cx: Number(sample?.lon) || 0,
    cy: -lat,
    rx: spread / (MILES_PER_DEGREE_LAT * cosLat),
    ry: spread / MILES_PER_DEGREE_LAT,
  };
}

// Sample the track and turn every sample into a disk, optionally restricted
// to an hour range -- used to build the separate "early" (<=72h) disk set
// for the Day 1-3 / Day 4-5 split.
export function buildConeDisks(points, samplesPerSegment = 32, range = {}) {
  const minHour = range.minHour ?? -Infinity;
  const maxHour = range.maxHour ?? Infinity;
  return sampleTrack(points, samplesPerSegment)
    .filter((sample) => sample.hour >= minHour - 1e-9 && sample.hour <= maxHour + 1e-9)
    .map(spreadEllipseAtSample);
}

// Haversine great-circle distance in statute miles.
export function milesBetween(a, b) {
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
