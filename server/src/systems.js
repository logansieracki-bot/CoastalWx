import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { requireRole, ROLES } from './auth.js';
import { assignStormName } from './stormNames.js';

// Nor'easter seasons run winter-to-winter (e.g. "2025-26"), not calendar year.
function currentSeason(date = new Date()) {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 6 ? y : y - 1; // Jul+ starts the next season
  return startYear;
}

function nextSequenceNumber(season) {
  const row = db.prepare('SELECT MAX(sequence_number) AS maxSeq FROM systems WHERE season = ?').get(season);
  return (row.maxSeq ?? 0) + 1;
}

function stageLabel(stage) {
  return stage === 'invest' ? 'Invest' : 'Disturbance';
}

// A single representative gale radius for intensityScore's formula
// (unchanged, still takes one number): the average of whichever quadrants
// have been set via the wind field drag handles, or null until at least
// one has -- same "not yet filled in" signal the plain number field used
// to give before it was replaced by the quadrant system.
function averageRadius(ne, se, sw, nw) {
  const quadrants = [ne, se, sw, nw];
  if (quadrants.every((v) => v == null)) return null;
  return quadrants.reduce((sum, v) => sum + (v ?? 0), 0) / 4;
}

export function toApi(row) {
  return {
    id: row.id,
    season: row.season,
    seasonLabel: `${row.season}-${String((row.season + 1) % 100).padStart(2, '0')}`,
    sequenceNumber: row.sequence_number,
    displayName: row.name || `${stageLabel(row.stage)} ${row.sequence_number}`,
    name: row.name,
    stage: row.stage,
    lat: row.lat,
    lon: row.lon,
    formationProbability2dayPct: row.formation_probability_2day_pct,
    formationProbability5dayPct: row.formation_probability_5day_pct,
    formationProbability10dayPct: row.formation_probability_10day_pct,
    pressureMb: row.pressure_mb,
    windMph: row.wind_mph,
    gustMph: row.gust_mph,
    galeRadiusNeMi: row.gale_radius_ne_mi,
    galeRadiusSeMi: row.gale_radius_se_mi,
    galeRadiusSwMi: row.gale_radius_sw_mi,
    galeRadiusNwMi: row.gale_radius_nw_mi,
    hurricaneForceRadiusNeMi: row.hurricane_force_radius_ne_mi,
    hurricaneForceRadiusSeMi: row.hurricane_force_radius_se_mi,
    hurricaneForceRadiusSwMi: row.hurricane_force_radius_sw_mi,
    hurricaneForceRadiusNwMi: row.hurricane_force_radius_nw_mi,
    galeRadiusMi: averageRadius(row.gale_radius_ne_mi, row.gale_radius_se_mi, row.gale_radius_sw_mi, row.gale_radius_nw_mi),
    formed: !!row.formed,
    classified: !!row.classified,
    forecastInterval: row.forecast_interval,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const systemsRouter = Router();

systemsRouter.get('/systems', (req, res) => {
  const rows = db.prepare('SELECT * FROM systems ORDER BY season DESC, sequence_number ASC').all();
  res.json(rows.map(toApi));
});

systemsRouter.get('/systems/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(toApi(row));
});

systemsRouter.post('/systems', requireRole(...ROLES), (req, res) => {
  const { lat, lon, formationProbability2dayPct, formationProbability5dayPct, formationProbability10dayPct } = req.body ?? {};
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'lat and lon are required numbers' });
  }
  const season = currentSeason();
  const sequenceNumber = nextSequenceNumber(season);
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO systems (id, season, sequence_number, lat, lon, formation_probability_2day_pct, formation_probability_5day_pct, formation_probability_10day_pct, formed, classified, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(id, season, sequenceNumber, lat, lon, formationProbability2dayPct ?? null, formationProbability5dayPct ?? null, formationProbability10dayPct ?? null, now, now);

  const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(id);
  res.status(201).json(toApi(row));
});

const PATCHABLE_FIELDS = {
  lat: 'lat',
  lon: 'lon',
  stage: 'stage',
  formationProbability2dayPct: 'formation_probability_2day_pct',
  formationProbability5dayPct: 'formation_probability_5day_pct',
  formationProbability10dayPct: 'formation_probability_10day_pct',
  pressureMb: 'pressure_mb',
  windMph: 'wind_mph',
  gustMph: 'gust_mph',
  galeRadiusNeMi: 'gale_radius_ne_mi',
  galeRadiusSeMi: 'gale_radius_se_mi',
  galeRadiusSwMi: 'gale_radius_sw_mi',
  galeRadiusNwMi: 'gale_radius_nw_mi',
  hurricaneForceRadiusNeMi: 'hurricane_force_radius_ne_mi',
  hurricaneForceRadiusSeMi: 'hurricane_force_radius_se_mi',
  hurricaneForceRadiusSwMi: 'hurricane_force_radius_sw_mi',
  hurricaneForceRadiusNwMi: 'hurricane_force_radius_nw_mi',
  formed: 'formed',
  classified: 'classified',
  name: 'name',
  forecastInterval: 'forecast_interval',
};

systemsRouter.patch('/systems/:id', requireRole(...ROLES), (req, res) => {
  const existing = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // This one route covers both routine data entry (wind/pressure/
  // probabilities/wind field, open to all 4 roles) and the two bigger
  // lifecycle decisions -- Investigate (stage -> invest) and Classify
  // (classified -> true) -- which a Junior Forecaster can't trigger.
  const body = req.body ?? {};
  const becomingClassified = Object.prototype.hasOwnProperty.call(body, 'classified') && body.classified && !existing.classified;
  const triggersBigDecision =
    (Object.prototype.hasOwnProperty.call(body, 'stage') && body.stage !== existing.stage) || becomingClassified;
  if (triggersBigDecision && req.user.role === 'junior_forecaster') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const updates = [];
  const values = [];
  for (const [apiKey, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, apiKey)) {
      let value = req.body[apiKey];
      if (column === 'formed' || column === 'classified') value = value ? 1 : 0;
      updates.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no updatable fields provided' });

  // A system gets the next unused storm name for its season automatically
  // the moment it's classified -- naming rides on that milestone rather
  // than being a separate step. Only if it isn't already named (e.g. by a
  // future manual override) and PATCHABLE_FIELDS's loop above didn't
  // already set one in this same request.
  if (becomingClassified && !existing.name && !Object.prototype.hasOwnProperty.call(body, 'name')) {
    const assignedName = assignStormName(existing.season, existing.id);
    if (assignedName) {
      updates.push('name = ?');
      values.push(assignedName);
    }
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE systems SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(req.params.id);
  res.json(toApi(row));
});

systemsRouter.delete('/systems/:id', requireRole('owner', 'admin', 'forecaster'), (req, res) => {
  const result = db.prepare('DELETE FROM systems WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});
