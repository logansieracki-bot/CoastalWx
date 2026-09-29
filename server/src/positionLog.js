// Read-only API for the automatic position log systems.js's PATCH handler
// writes to (see db.js's system_position_log table comment for why this
// exists separately from advisories). No POST/PATCH/DELETE here -- rows
// are only ever written as a side effect of moving a system, never
// directly by a client.
import { Router } from 'express';
import { db } from './db.js';

function toApi(row) {
  return {
    id: row.id,
    systemId: row.system_id,
    snapshot: JSON.parse(row.snapshot_json),
    recordedAt: row.recorded_at,
  };
}

export const positionLogRouter = Router();

// All systems' logs, eager-loaded -- same rationale as GET /advisories and
// GET /annotations: the client filters by system id itself, and this app
// has never had enough rows across all of these tables combined for that
// to matter.
positionLogRouter.get('/position-log', (req, res) => {
  const rows = db.prepare('SELECT * FROM system_position_log ORDER BY recorded_at ASC').all();
  res.json(rows.map(toApi));
});
