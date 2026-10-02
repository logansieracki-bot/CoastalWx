import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole } from './auth.js';

// Kept in sync by hand with the identical list in editor/src/main.js's
// renderWatchesSection -- same "duplicate the tiny allowlist per file"
// convention this app already uses for forecastPoints.js's POINT_STATUSES
// (validated here, independently hardcoded in the editor's own <select>).
const WATCH_PRODUCTS = ['coastal_flood', 'storm_surge', 'high_wind', 'winter_storm', 'blizzard', 'gale'];
const WATCH_LEVELS = ['advisory', 'watch', 'warning'];

function isValidPoints(points) {
  return Array.isArray(points) && points.length >= 2 &&
    points.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number');
}

export function toApi(row) {
  return {
    id: row.id,
    systemId: row.system_id,
    product: row.product,
    level: row.level,
    points: JSON.parse(row.points),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const watchesRouter = Router();

// All watches, every LIVE system -- same eager-load rationale as GET
// /annotations and GET /forecast-points (and the same join to exclude an
// archived system's own rows -- see GET /annotations' own comment for
// why). Left public (no requireRole), same as every other GET here, even
// though only the editor actually calls this one today -- the public
// page gets its watches from each advisory's own snapshot instead
// (public/src/main.js's publicViewFor), never this live endpoint.
watchesRouter.get('/watches', (req, res) => {
  const rows = db.prepare(`
    SELECT watches.* FROM watches
    JOIN systems ON systems.id = watches.system_id
    WHERE systems.archived_at IS NULL
    ORDER BY watches.created_at ASC
  `).all();
  res.json(rows.map(toApi));
});

// A watch/warning is a public-safety-significant action, closer in
// weight to Publish Advisory/Investigate/Classify than to routine data
// entry -- gated the same way (Forecaster role or higher), not the
// lighter "any of the 4 roles" annotations/forecast points use.
watchesRouter.post('/systems/:systemId/watches', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const system = db.prepare('SELECT id FROM systems WHERE id = ?').get(req.params.systemId);
  if (!system) return res.status(404).json({ error: 'system not found' });

  const { product, level, points } = req.body ?? {};
  if (!WATCH_PRODUCTS.includes(product)) {
    return res.status(400).json({ error: `product must be one of: ${WATCH_PRODUCTS.join(', ')}` });
  }
  if (!WATCH_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${WATCH_LEVELS.join(', ')}` });
  }
  if (!isValidPoints(points)) {
    return res.status(400).json({ error: 'points must be an array of at least 2 [lon, lat] pairs' });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO watches (id, system_id, product, level, points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.systemId, product, level, JSON.stringify(points), now, now);

  const row = db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
  res.status(201).json(toApi(row));
});

// Escalating watch -> warning (or de-escalating back) is just a normal
// PATCH changing `level` on this same row -- id and created_at persist
// across the change, so the zone's identity and history stay continuous
// rather than becoming a new, unrelated record.
watchesRouter.patch('/watches/:id', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const existing = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body ?? {};
  const updates = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(body, 'product')) {
    if (!WATCH_PRODUCTS.includes(body.product)) {
      return res.status(400).json({ error: `product must be one of: ${WATCH_PRODUCTS.join(', ')}` });
    }
    updates.push('product = ?');
    values.push(body.product);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'level')) {
    if (!WATCH_LEVELS.includes(body.level)) {
      return res.status(400).json({ error: `level must be one of: ${WATCH_LEVELS.join(', ')}` });
    }
    updates.push('level = ?');
    values.push(body.level);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'points')) {
    if (!isValidPoints(body.points)) {
      return res.status(400).json({ error: 'points must be an array of at least 2 [lon, lat] pairs' });
    }
    updates.push('points = ?');
    values.push(JSON.stringify(body.points));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'no updatable fields provided' });

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE watches SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM watches WHERE id = ?').get(req.params.id);
  res.json(toApi(row));
});

// Hard delete, same reasoning as annotations: once published, a
// discontinued watch's history already lives on inside whatever
// advisory snapshot captured it -- nothing is actually lost.
watchesRouter.delete('/watches/:id', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const result = db.prepare('DELETE FROM watches WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});
