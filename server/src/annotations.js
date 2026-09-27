import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole, ROLES } from './auth.js';

function isValidPoints(points) {
  return Array.isArray(points) && points.length >= 2 &&
    points.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number');
}

function toApi(row) {
  return {
    id: row.id,
    systemId: row.system_id,
    type: row.type,
    points: JSON.parse(row.points),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const annotationsRouter = Router();

// All annotations, every system -- the client eager-loads this once so every
// system's shapes/arrows can render simultaneously when nothing is selected.
annotationsRouter.get('/annotations', (req, res) => {
  const rows = db.prepare('SELECT * FROM annotations ORDER BY created_at ASC').all();
  res.json(rows.map(toApi));
});

annotationsRouter.post('/systems/:systemId/annotations', requireRole(...ROLES), (req, res) => {
  const system = db.prepare('SELECT id FROM systems WHERE id = ?').get(req.params.systemId);
  if (!system) return res.status(404).json({ error: 'system not found' });

  const { type, points } = req.body ?? {};
  if (type !== 'shape' && type !== 'arrow') {
    return res.status(400).json({ error: "type must be 'shape' or 'arrow'" });
  }
  if (!isValidPoints(points)) {
    return res.status(400).json({ error: 'points must be an array of at least 2 [lon, lat] pairs' });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO annotations (id, system_id, type, points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.params.systemId, type, JSON.stringify(points), now, now);

  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id);
  res.status(201).json(toApi(row));
});

annotationsRouter.patch('/annotations/:id', requireRole(...ROLES), (req, res) => {
  const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { points } = req.body ?? {};
  if (!isValidPoints(points)) {
    return res.status(400).json({ error: 'points must be an array of at least 2 [lon, lat] pairs' });
  }

  db.prepare('UPDATE annotations SET points = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(points), new Date().toISOString(), req.params.id);

  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.id);
  res.json(toApi(row));
});

annotationsRouter.delete('/annotations/:id', requireRole(...ROLES), (req, res) => {
  const result = db.prepare('DELETE FROM annotations WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});
