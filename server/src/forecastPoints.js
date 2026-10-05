import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole, ROLES } from './auth.js';

function nextSequence(systemId) {
  const row = db.prepare('SELECT MAX(sequence) AS maxSeq FROM forecast_points WHERE system_id = ?').get(systemId);
  return (row.maxSeq ?? 0) + 1;
}

// Mirrors systems.js's averageRadius exactly -- a single representative
// gale radius for pointIntensityScore's formula, derived from whichever
// quadrants have been set via the point's own wind field drag handles, or
// null until at least one has been.
function averageRadius(ne, se, sw, nw) {
  const quadrants = [ne, se, sw, nw];
  if (quadrants.every((v) => v == null)) return null;
  return quadrants.reduce((sum, v) => sum + (v ?? 0), 0) / 4;
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
    status: row.status,
    galeRadiusNeMi: row.gale_radius_ne_mi,
    galeRadiusSeMi: row.gale_radius_se_mi,
    galeRadiusSwMi: row.gale_radius_sw_mi,
    galeRadiusNwMi: row.gale_radius_nw_mi,
    galeRadiusMi: averageRadius(row.gale_radius_ne_mi, row.gale_radius_se_mi, row.gale_radius_sw_mi, row.gale_radius_nw_mi),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const forecastPointsRouter = Router();

// All forecast points, every LIVE system -- the client eager-loads this
// once, same rationale as GET /annotations (every system's track/cone can
// render simultaneously when nothing is selected). Joined against systems
// to exclude an archived system's own rows -- see GET /annotations' own
// comment for why this matters (orphaned rows outliving their deleted
// system otherwise).
forecastPointsRouter.get('/forecast-points', (req, res) => {
  const rows = db.prepare(`
    SELECT forecast_points.* FROM forecast_points
    JOIN systems ON systems.id = forecast_points.system_id
    WHERE systems.archived_at IS NULL
    ORDER BY forecast_points.system_id ASC, forecast_points.sequence ASC
  `).all();
  res.json(rows.map(toApi));
});

forecastPointsRouter.post('/systems/:systemId/forecast-points', requireRole(...ROLES), (req, res) => {
  const system = db.prepare('SELECT id, classified FROM systems WHERE id = ?').get(req.params.systemId);
  if (!system) return res.status(404).json({ error: 'system not found' });
  // A forecast point only makes sense once classified -- a cone/track is
  // the classified-stage replacement for a Disturbance/Invest's shapes
  // (see editor/src/main.js's renderSelectedPanel). The editor UI only
  // disables its "Add Forecast Point" button for this; enforcing it here
  // too closes the gap that let one reach an unclassified system at all.
  if (!system.classified) return res.status(409).json({ error: 'system_not_classified' });

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
  status: 'status',
  galeRadiusNeMi: 'gale_radius_ne_mi',
  galeRadiusSeMi: 'gale_radius_se_mi',
  galeRadiusSwMi: 'gale_radius_sw_mi',
  galeRadiusNwMi: 'gale_radius_nw_mi',
};

// Not a DB CHECK constraint (see db.js's migration comment) -- validated
// here instead, same spirit as hourMode's allow-list above in POST.
const POINT_STATUSES = ['over_water', 'inland', 'dissipated'];

forecastPointsRouter.patch('/forecast-points/:id', requireRole(...ROLES), (req, res) => {
  const existing = db.prepare('SELECT * FROM forecast_points WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'status')) {
    const { status } = req.body;
    if (status !== null && !POINT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be null or one of: ${POINT_STATUSES.join(', ')}` });
    }
  }

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
