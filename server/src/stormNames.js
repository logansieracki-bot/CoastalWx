import { randomUUID } from 'node:crypto';
import { db } from './db.js';

// A starting placeholder list, one name per season -- skips Q/U/X/Y/Z,
// matching this app's NHC-styled naming conventions elsewhere (see
// gale/hfw wind thresholds). Stored in the database rather than hardcoded
// so it's editable later without a code change; this is a placeholder
// seed, not a curated list.
const DEFAULT_NAMES = [
  'Ashford', 'Brennick', 'Corwin', 'Devlin', 'Elowen', 'Fenwick', 'Greer',
  'Harlan', 'Isolde', 'Jasper', 'Kestrel', 'Lindqvist', 'Marlowe', 'Nyland',
  'Osric', 'Perrin', 'Rowan', 'Sable', 'Tamsin', 'Vesper', 'Wrenfield',
];

function ensureSeasonSeeded(season) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM storm_names WHERE season = ?').get(season);
  if (n > 0) return;
  const insert = db.prepare(`
    INSERT INTO storm_names (id, season, sequence, name, used_by_system_id)
    VALUES (?, ?, ?, ?, NULL)
  `);
  DEFAULT_NAMES.forEach((name, i) => insert.run(randomUUID(), season, i + 1, name));
}

// Claims and returns the next unused name for a season (seeding that
// season's list on first use), or null once every name in the season's
// list has already been assigned -- the system is left unnamed rather
// than this throwing, since running out of names shouldn't block
// classifying a system.
export function assignStormName(season, systemId) {
  ensureSeasonSeeded(season);
  const row = db.prepare(`
    SELECT * FROM storm_names WHERE season = ? AND used_by_system_id IS NULL ORDER BY sequence ASC LIMIT 1
  `).get(season);
  if (!row) return null;
  db.prepare('UPDATE storm_names SET used_by_system_id = ? WHERE id = ?').run(systemId, row.id);
  return row.name;
}
