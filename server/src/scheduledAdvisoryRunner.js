import { db } from './db.js';
import { publishAdvisory } from './advisories.js';

const POLL_INTERVAL_MS = 30 * 1000; // plenty precise for a publish schedule, cheap to poll

// Publishes any scheduled advisory whose time has arrived, snapshotting the
// system's state at the moment it actually fires -- not whatever it was
// when the forecaster first scheduled it (same "true to what was known at
// publish time" rule the immediate Publish Advisory button follows, just
// triggered by a clock instead of a click). Each due row is deleted
// regardless of outcome, so a system deleted before its scheduled time
// (already handled by ON DELETE CASCADE in the common case) never leaves a
// zombie row retried forever.
function runDueScheduledAdvisories() {
  const due = db.prepare('SELECT * FROM scheduled_advisories WHERE scheduled_for <= ?').all(new Date().toISOString());
  for (const row of due) {
    const system = db.prepare('SELECT * FROM systems WHERE id = ?').get(row.system_id);
    db.prepare('DELETE FROM scheduled_advisories WHERE id = ?').run(row.id);
    if (!system) continue;
    const fields = row.pending_fields_json ? JSON.parse(row.pending_fields_json) : undefined;
    publishAdvisory(system, { headline: row.headline, discussion: row.discussion, issuedByUserId: row.created_by_user_id, fields });
  }
}

export function startScheduledAdvisoryRunner() {
  runDueScheduledAdvisories(); // catch up on anything that came due while the server was offline
  const timer = setInterval(runDueScheduledAdvisories, POLL_INTERVAL_MS);
  timer.unref?.(); // shouldn't be the reason the process stays alive
  return timer;
}
