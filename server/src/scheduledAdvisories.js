import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole, ROLES } from './auth.js';
import { ADVISORY_SETTABLE_FIELDS } from './systems.js';

function displayNameForUserId(userId) {
  if (!userId) return null;
  const row = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
  return row ? row.display_name : null;
}

// Picks out only the advisory-settable subset of a request body (same
// allowlist applySystemFields itself uses) to store as this row's staged
// draft -- so an arbitrary request body can never smuggle other fields in.
function extractPendingFields(body) {
  const out = {};
  for (const apiKey of Object.keys(ADVISORY_SETTABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body ?? {}, apiKey)) out[apiKey] = body[apiKey];
  }
  return out;
}

function toApi(row) {
  return {
    id: row.id,
    systemId: row.system_id,
    headline: row.headline,
    discussion: row.discussion,
    pendingFields: row.pending_fields_json ? JSON.parse(row.pending_fields_json) : {},
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: displayNameForUserId(row.created_by_user_id),
  };
}

export const scheduledAdvisoriesRouter = Router();

// Unlike GET /advisories, this is never public -- it's draft/unpublished
// prose, only meant for the forecaster tool. Any of the 4 roles can view
// it (routine visibility, same as the other list endpoints), just not an
// anonymous visitor.
scheduledAdvisoriesRouter.get('/scheduled-advisories', requireRole(...ROLES), (req, res) => {
  const rows = db.prepare('SELECT * FROM scheduled_advisories ORDER BY scheduled_for ASC').all();
  res.json(rows.map(toApi));
});

scheduledAdvisoriesRouter.post('/systems/:systemId/scheduled-advisories', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const system = db.prepare('SELECT id FROM systems WHERE id = ?').get(req.params.systemId);
  if (!system) return res.status(404).json({ error: 'system not found' });

  const { headline, discussion, scheduledFor } = req.body ?? {};
  const scheduledMs = scheduledFor ? new Date(scheduledFor).getTime() : NaN;
  if (!Number.isFinite(scheduledMs)) return res.status(400).json({ error: 'scheduledFor must be a valid date/time' });
  if (scheduledMs <= Date.now()) return res.status(400).json({ error: 'scheduledFor must be in the future' });

  const pendingFieldsJson = JSON.stringify(extractPendingFields(req.body));
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO scheduled_advisories (id, system_id, headline, discussion, pending_fields_json, scheduled_for, created_at, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.systemId, headline ?? null, discussion ?? null, pendingFieldsJson, new Date(scheduledMs).toISOString(), now, req.user.id);

  res.status(201).json(toApi(db.prepare('SELECT * FROM scheduled_advisories WHERE id = ?').get(id)));
});

// Cancel is unconditional (no time-window restriction like advisories'
// emergency-cancel) -- nothing has published yet, so there's no "undo"
// window to enforce, only a delete.
scheduledAdvisoriesRouter.delete('/scheduled-advisories/:id', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const result = db.prepare('DELETE FROM scheduled_advisories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});
