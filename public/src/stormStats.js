// Derived stats for the Ongoing Storm Analysis page's per-system panel
// (see the "TROPICAL STORM HANNA"-style reference card): minimum central
// pressure and position formatting. Pure computation, no DOM -- takes the
// same `entries` shape history.js's own historyEntriesFor() already
// produces ([{system, issuedAt}], oldest first), so every call site just
// passes that straight through.
import { formatLat, formatLon } from '../editor/src/discussionText.js';

export function formatPosition(lat, lon) {
  return `${formatLat(lat)} ${formatLon(lon)}`;
}

export function computeMinPressure(entries) {
  const values = entries.map(({ system }) => system.pressureMb).filter((v) => v != null);
  return values.length ? Math.min(...values) : null;
}
