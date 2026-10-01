// One-time repair for season 2026's storm_names table: sequences 1-10
// (letters A-J) and 13 (M) were permanently lost when early test/dev
// storms were hard-deleted, before the archived_at soft-delete fix
// existed (see server/src/systems.js's DELETE /systems/:id and
// db.js's archived_at migration comment). Backfills sequences 2-10 and
// 13 (B through J, and M) with freshly-drawn random names so this
// season's naming can continue through the full alphabet instead of
// permanently skipping those letters -- deliberately leaves sequence 1
// (A) out: the deleted storm's own name (Anson) is gone for good, and
// per the decision behind this script, A stays retired for this season
// specifically rather than being replaced by a new A name. Idempotent --
// safe to run more than once, skips any sequence that already has a row.
//
// Run locally: node server/scripts/backfill-storm-names-2026.js
// Run on the live Railway deployment: railway ssh -- node server/scripts/backfill-storm-names-2026.js
// (NOT `railway run`, which executes locally against Railway's env vars
// rather than inside the actual container with the real mounted volume
// -- same caveat create-user.js's own header documents.)
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { pickSeasonName } from '../src/stormNames.js';

const SEASON = 2026;
const MISSING = [
  [2, 'B'], [3, 'C'], [4, 'D'], [5, 'E'], [6, 'F'],
  [7, 'G'], [8, 'H'], [9, 'I'], [10, 'J'], [13, 'M'],
];

const exists = db.prepare('SELECT 1 FROM storm_names WHERE season = ? AND sequence = ?');
const insert = db.prepare(`
  INSERT INTO storm_names (id, season, sequence, name, used_by_system_id)
  VALUES (?, ?, ?, ?, NULL)
`);

let inserted = 0;
for (const [sequence, letter] of MISSING) {
  if (exists.get(SEASON, sequence)) continue;
  const name = pickSeasonName(letter);
  insert.run(randomUUID(), SEASON, sequence, name);
  console.log(`Backfilled sequence ${sequence} (${letter}): ${name}`);
  inserted++;
}
console.log(inserted ? `Done -- inserted ${inserted} row(s).` : 'Nothing to do -- all target sequences already exist.');
