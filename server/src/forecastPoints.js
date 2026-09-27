import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole, ROLES } from './auth.js';

function nextSequence(systemId) {
  const row = db.prepare('SELECT MAX(sequence) AS maxSeq FROM forecast_points WHERE system_id = ?').get(systemId);
  return (row.maxSeq ?? 0) + 1;
}

export function toApi(row) {
  return {
    id: row.id,
    systemId: row.system_id,
    sequence: row.sequence,
    lon: row.lon,
    lat: row.lat,
    hour: row.hour,
    windMph: row.wind_mph,
    spreadMi: row.spread_mi,
    hourMode: row.hour_mode,
    hourOverride: row.hour_override,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const forecastPointsRouter = Router();

// All forecast points, every system -- the client eager-loads this once,
// same rationale as GET /annotations (every system's track/cone can render
// simultaneously when nothing is selected).
forecastPointsRouter.get('/forecast-points', (req, res) => {
  const rows = db.prepare('SELECT * FROM forecast_points ORDER BY system_id ASC, sequence ASC').all();
  res.json(rows.map(toApi));
});

forecastPointsRouter.post('/systems/:systemId/forecast-points', requireRole(...ROLES), (req, res) => {
  const system = db.prepare('SELECT id FROM systems WHERE id = ?').get(req.params.systemId);
  if (!system) return res.status(404).json({ error: 'system not found' });

  const { lon, lat, hour, windMph, spreadMi, hourMode } = req.body ?? {};
  if (typeof lon !== 'number' || typeof lat !== 'number' || typeof hour !== 'number') {
    return res.status(400).json({ error: 'lon, lat, and hour are required numbers' });
  }

  const id = randomUUID();
  const sequence = nextSequence(req.params.systemId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO forecast_points (id, system_id, sequence, lon, lat, hour, wind_mph, spread_mi, hour_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.systemId, sequence, lon, lat, hour, windMph ?? null, spreadMi ?? 0, ['auto', 'manual', 'override'].includes(hourMode) ? hourMode : 'auto', now, now);

  const row = db.prepare('SELECT * FROM forecast_points WHERE id = ?').get(id);
  res.status(201).json(toApi(row));
});

const PATCHABLE_FIELDS = {
  lon: 'lon',
  lat: 'lat',
  hour: 'hour',
  windMph: 'wind_mph',
  spreadMi: 'spread_mi',
  hourMode: 'hour_mode',
  hourOverride: 'hour_override',
};

forecastPointsRouter.patch('/forecast-points/:id', requireRole(...ROLES), (req, res) => {
  const existing = db.prepare('SELECT * FROM forecast_points WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const updates = [];
  const values = [];
  for (const [apiKey, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, apiKey)) {
      updates.push(`${column} = ?`);
      values.push(req.body[apiKey]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no updatable fields provided' });

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE forecast_points SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM forecast_points WHERE id = ?').get(req.params.id);
  res.json(toApi(row));
});

forecastPointsRouter.delete('/forecast-points/:id', requireRole(...ROLES), (req, res) => {
  const result = db.prepare('DELETE FROM forecast_points WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});
