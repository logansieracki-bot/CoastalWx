// Quadrant-based wind field envelope math: given a center point and a
// radius per quadrant (NE/SE/SW/NW, in miles), builds a smoothed closed
// polygon connecting them. Adapted verbatim from an old prototype's
// windFieldGeometry.js -- this file is fully generic (no tropical-vs-
// extratropical domain assumptions at all), so no adaptation was needed
// beyond the port itself.
const EARTH_RADIUS_MILES = 3958.7613;

function toRad(deg) { return (deg * Math.PI) / 180; }
function toDeg(rad) { return (rad * 180) / Math.PI; }
function normalizeBearing(value) { return ((Number(value) % 360) + 360) % 360; }
function normalizeLongitude(lon) { return (((lon + 180) % 360) + 360) % 360 - 180; }
function radiusValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function destinationPoint(center, bearingDeg, miles) {
  const distance = Math.max(0, Number(miles) || 0) / EARTH_RADIUS_MILES;
  const bearing = toRad(normalizeBearing(bearingDeg));
  const lat1 = toRad(Number(center.lat));
  const lon1 = toRad(Number(center.lon));
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(distance);
  const cosDistance = Math.cos(distance);

  const lat2 = Math.asin(sinLat1 * cosDistance + cosLat1 * sinDistance * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinDistance * cosLat1,
    cosDistance - sinLat1 * Math.sin(lat2)
  );

  return { lon: normalizeLongitude(toDeg(lon2)), lat: toDeg(lat2) };
}

// Eased interpolation between quadrant radii, so the envelope reads as a
// smooth closed curve rather than a diamond with hard corners at the four
// quadrant bearings (45/135/225/315).
export function radiusForBearing(radii, bearingDeg) {
  const centers = [
    { bearing: 45, radius: radiusValue(radii?.ne) },
    { bearing: 135, radius: radiusValue(radii?.se) },
    { bearing: 225, radius: radiusValue(radii?.sw) },
    { bearing: 315, radius: radiusValue(radii?.nw) },
    { bearing: 405, radius: radiusValue(radii?.ne) },
  ];

  let bearing = normalizeBearing(bearingDeg);
  if (bearing < 45) bearing += 360;

  for (let i = 0; i < centers.length - 1; i++) {
    const start = centers[i];
    const end = centers[i + 1];
    if (bearing >= start.bearing && bearing <= end.bearing) {
      const t = (bearing - start.bearing) / (end.bearing - start.bearing);
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
      return start.radius + (end.radius - start.radius) * eased;
    }
  }
  return centers[0].radius;
}

export function buildWindEnvelope(center, radii, samples = 96) {
  const count = Math.max(16, Math.floor(Number(samples) || 96));
  const points = [];
  for (let i = 0; i < count; i++) {
    const bearing = (i * 360) / count;
    const radius = radiusForBearing(radii, bearing);
    points.push(destinationPoint(center, bearing, radius));
  }
  return points;
}
