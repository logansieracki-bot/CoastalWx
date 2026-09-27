import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole } from './auth.js';
import { toApi as systemToApi } from './systems.js';
import { toApi as forecastPointToApi } from './forecastPoints.js';

const CANCEL_WINDOW_MS = 60 * 60 * 1000; // 1 hour, matching the plan's emergency-cancel window

function toApi(row) {
  const issuedAtMs = new Date(row.issued_at).getTime();
  return {
    id: row.id,
    systemId: row.system_id,
    number: row.number,
    headline: row.headline,
    discussion: row.discussion,
    snapshot: JSON.parse(row.snapshot_json),
    issuedAt: row.issued_at,
    issuedByUserId: row.issued_by_user_id,
    cancelable: Date.now() < issuedAtMs + CANCEL_WINDOW_MS,
  };
}

export const advisoriesRouter = Router();

// All advisories, every system -- same eager-load rationale as GET
// /annotations and GET /forecast-points. Left public (no requireRole),
// same as every other GET in this app -- the public read-only page (a
// later phase) reads this too.
advisoriesRouter.get('/advisories', (req, res) => {
  const rows = db.prepare('SELECT * FROM advisories ORDER BY issued_at ASC').all();
  res.json(rows.map(toApi));
});

advisoriesRouter.post('/systems/:systemId/advisories', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const system = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.systemId);
  if (!system) return res.status(404).json({ error: 'system not found' });
  if (!system.classified) return res.status(409).json({ error: 'system must be classified before publishing an advisory' });

  const { headline, discussion } = req.body ?? {};
  // The immutable historical record: the system's full current data plus
  // its whole forecast track, as one JSON blob -- stays true to what was
  // known at publish time even as the live system keeps changing after.
  const forecastPoints = db.prepare('SELECT * FROM forecast_points WHERE system_id = ? ORDER BY sequence ASC').all(system.id);
  const snapshot = { system: systemToApi(system), forecastPoints: forecastPoints.map(forecastPointToApi) };

  const { maxN } = db.prepare('SELECT MAX(number) AS maxN FROM advisories WHERE system_id = ?').get(system.id);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO advisories (id, system_id, number, headline, discussion, snapshot_json, issued_at, issued_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, system.id, (maxN ?? 0) + 1, headline ?? null, discussion ?? null, JSON.stringify(snapshot), now, req.user.id);

  res.status(201).json(toApi(db.prepare('SELECT * FROM advisories WHERE id = ?').get(id)));
});

// Emergency cancel -- a full hard delete, not a retraction marker, and
// only within an hour of publishing. Enforced here server-side (not just
// a client-side hidden button) so the window is a real rule, not just UI.
advisoriesRouter.delete('/advisories/:id', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const row = db.prepare('SELECT * FROM advisories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (Date.now() >= new Date(row.issued_at).getTime() + CANCEL_WINDOW_MS) {
    return res.status(409).json({ error: 'cancel_window_expired' });
  }
  db.prepare('DELETE FROM advisories WHERE id = ?').run(req.params.id);
  res.status(204).end();
});
