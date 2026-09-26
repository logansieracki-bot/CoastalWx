// Centripetal Catmull-Rom spline through a list of {lon, lat} points.
// Adapted from the same technique used for the old cyclone editor's track
// smoothing, but generic (no longitude-unwrap, no scalar-field interpolation --
// this project's shapes/arrows are small and local, not ocean-spanning tracks).

function chordT(t, p, q) {
  const dx = q.lon - p.lon;
  const dy = q.lat - p.lat;
  const d = Math.sqrt(dx * dx + dy * dy);
  return t + Math.sqrt(d); // centripetal parameterization (alpha = 0.5)
}

function lerpPoint(a, b, t) {
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
}

function mirror(anchor, other) {
  return { lon: 2 * anchor.lon - other.lon, lat: 2 * anchor.lat - other.lat };
}

function catmullRomPoint(p0, p1, p2, p3, u) {
  const t0 = 0;
  const t1 = chordT(t0, p0, p1);
  const t2 = chordT(t1, p1, p2);
  const t3 = chordT(t2, p2, p3);

  if (t1 === t0 || t2 === t1 || t3 === t2) return lerpPoint(p1, p2, u); // duplicate-point fallback

  const t = t1 + u * (t2 - t1);

  const a1 = lerpPoint(p0, p1, (t - t0) / (t1 - t0));
  const a2 = lerpPoint(p1, p2, (t - t1) / (t2 - t1));
  const a3 = lerpPoint(p2, p3, (t - t2) / (t3 - t2));

  const b1 = lerpPoint(a1, a2, (t - t0) / (t2 - t0));
  const b2 = lerpPoint(a2, a3, (t - t1) / (t3 - t1));

  return lerpPoint(b1, b2, (t - t1) / (t2 - t1));
}

// Open path (arrows). points.length >= 2. Virtual endpoints are mirror-
// extrapolated so the curve still bends naturally at the first/last segment.
// Always ends on the exact final input point, so an arrowhead anchors
// precisely where the user clicked, not on an interpolated approximation.
export function smoothPath(points, samplesPerSegment = 16) {
  const n = points.length;
  if (n < 2) return points.slice();
  const result = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = i === 0 ? mirror(p1, p2) : points[i - 1];
    const p3 = i === n - 2 ? mirror(p2, p1) : points[i + 2];
    for (let s = 0; s < samplesPerSegment; s++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }
  result.push(points[n - 1]);
  return result;
}

// Closed loop (shapes). points.length >= 3. Neighbor lookups wrap around
// instead of mirror-extrapolating, so the curve closes smoothly through the
// seam. Returns a ring WITHOUT repeating the first point at the end --
// callers close it with SVG "Z", same convention mapRenderer.js already uses.
export function smoothClosedPath(points, samplesPerSegment = 16) {
  const n = points.length;
  if (n < 3) return points.slice();
  const result = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }
  return result;
}
