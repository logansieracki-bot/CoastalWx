import { randomUUID } from 'node:crypto';
import { db } from './db.js';

// Skips Q/U/X/Y/Z, matching NHC's own Atlantic convention (too few common
// names start with these) and this app's naming conventions elsewhere
// (see gale/hfw wind thresholds). LETTERS fixes the alphabetical hand-out
// order within a season; NAME_POOL is a candidate list per letter -- each
// new season draws ONE random name per letter (see pickSeasonName below),
// so the actual list varies season to season while assignment still goes
// strictly A-to-W within any given season. These are placeholder/invented
// names, not a curated list -- edit the pool for real ones.
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'W'];

const NAME_POOL = {
  A: ['Ashford', 'Alderin', 'Averil', 'Anson', 'Aurelio'],
  B: ['Brennick', 'Bellamy', 'Barrow', 'Bexley', 'Briony'],
  C: ['Corwin', 'Cassian', 'Coraline', 'Callister', 'Cordelia'],
  D: ['Devlin', 'Delphine', 'Dashiell', 'Darrow', 'Della'],
  E: ['Elowen', 'Emrys', 'Esme', 'Ellery', 'Endora'],
  F: ['Fenwick', 'Farran', 'Faye', 'Faolan', 'Fenella'],
  G: ['Greer', 'Galen', 'Gwyneth', 'Garrick', 'Giselle'],
  H: ['Harlan', 'Hollis', 'Halcyon', 'Hadwin', 'Helena'],
  I: ['Isolde', 'Idris', 'Ingrid', 'Ignatius', 'Imara'],
  J: ['Jasper', 'Juniper', 'Jorah', 'Jessamine', 'Jarrett'],
  K: ['Kestrel', 'Kaelin', 'Keziah', 'Kellan', 'Kenna'],
  L: ['Lindqvist', 'Lucianne', 'Lachlan', 'Lysander', 'Larkin'],
  M: ['Marlowe', 'Mireille', 'Merrick', 'Marisol', 'Maddox'],
  N: ['Nyland', 'Noelani', 'Nash', 'Nerida', 'Nadine'],
  O: ['Osric', 'Odalys', 'Orin', 'Ottoline', 'Osgood'],
  P: ['Perrin', 'Persephone', 'Pryce', 'Philippa', 'Peregrine'],
  R: ['Rowan', 'Reyna', 'Roscoe', 'Romily', 'Renata'],
  S: ['Sable', 'Soren', 'Seraphina', 'Sylas', 'Senna'],
  T: ['Tamsin', 'Thorne', 'Tobias', 'Torin', 'Theodora'],
  V: ['Vesper', 'Valentin', 'Verity', 'Vance', 'Viviane'],
  W: ['Wrenfield', 'Winslow', 'Wilhelmina', 'Warrick', 'Wynne'],
};

export function pickSeasonName(letter) {
  const pool = NAME_POOL[letter];
  return pool[Math.floor(Math.random() * pool.length)];
}

function ensureSeasonSeeded(season) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM storm_names WHERE season = ?').get(season);
  if (n > 0) return;
  const insert = db.prepare(`
    INSERT INTO storm_names (id, season, sequence, name, used_by_system_id)
    VALUES (?, ?, ?, ?, NULL)
  `);
  LETTERS.forEach((letter, i) => insert.run(randomUUID(), season, i + 1, pickSeasonName(letter)));
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
