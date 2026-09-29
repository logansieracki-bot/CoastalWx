// Derived stats for the Ongoing Storm Analysis page's per-system panel
// (see the "TROPICAL STORM HANNA"-style reference card): movement
// (compass direction + speed between the two most recent track fixes),
// Storm ACE, minimum central pressure, and position formatting. Pure
// computation, no DOM -- takes the same `entries` shape history.js's own
// historyEntriesFor() already produces ([{system, issuedAt}], oldest
// first), so every call site just passes that straight through.
import { formatLat, formatLon } from '../editor/src/discussionText.js';

const EARTH_RADIUS_MILES = 3958.7613; // matches editor/src/windFieldGeometry.js's own constant

export function formatPosition(lat, lon) {
  return `${formatLat(lat)} ${formatLon(lon)}`;
}

function toRad(deg) { return (deg * Math.PI) / 180; }
function toDeg(rad) { return (rad * 180) / Math.PI; }

// Great-circle initial bearing + distance from point a to point b -- the
// inverse of editor/src/windFieldGeometry.js's destinationPoint (which
// goes center+bearing+distance -> point); this app never needed the
// inverse until now.
function bearingAndDistance(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;

  const dLat = toRad(b.lat - a.lat);
  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLon2 = Math.sin(dLon / 2);
  const h = sinDLat2 ** 2 + Math.cos(lat1) * Math.cos(lat2) * sinDLon2 ** 2;
  const distanceMiles = 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));

  return { bearing, distanceMiles };
}

const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function compassFromBearing(bearing) {
  return COMPASS_POINTS[Math.round(bearing / 22.5) % 16];
}

// Movement between the two most recent entries -- null if there's only
// one entry (nothing to compare against) or the two are timestamped
// identically (a zero time delta would divide-by-zero into an infinite
// speed).
export function computeMovement(entries) {
  if (entries.length < 2) return null;
  const a = entries[entries.length - 2];
  const b = entries[entries.length - 1];
  const hoursApart = (new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()) / 3600000;
  if (!(hoursApart > 0)) return null;
  const { bearing, distanceMiles } = bearingAndDistance(a.system, b.system);
  return { compass: compassFromBearing(bearing), speedMph: distanceMiles / hoursApart };
}

// Storm ACE (Accumulated Cyclone Energy): sum of (Vmax in knots)^2 x 1e-4
// over every observation at or above 34kt -- the standard meteorological
// formula, which is inherently knot-based (there's no MPH-native
// version); this app's own explicit MPH-only rule is about what's ever
// *displayed*, and only the resulting unitless ACE index is shown here,
// never a raw knots figure. Real ACE sums over 6-hourly synoptic
// observations; this app's advisories/position-log entries aren't
// necessarily spaced exactly 6 hours apart, so treating each entry as one
// observation is a simplification, not a rigorous reproduction.
const ACE_THRESHOLD_KT = 34;
const MPH_PER_KT = 1.15078;

export function computeAce(entries) {
  let total = 0;
  for (const { system } of entries) {
    if (system.windMph == null) continue;
    const kt = system.windMph / MPH_PER_KT;
    if (kt < ACE_THRESHOLD_KT) continue;
    total += kt ** 2 * 1e-4;
  }
  return total;
}

export function computeMinPressure(entries) {
  const values = entries.map(({ system }) => system.pressureMb).filter((v) => v != null);
  return values.length ? Math.min(...values) : null;
}
