const BASE = '/api';
const STORAGE_KEY = 'noreastercaster:systems';
const ANNOTATIONS_STORAGE_KEY = 'noreastercaster:annotations';
const FORECAST_POINTS_STORAGE_KEY = 'noreastercaster:forecastPoints';

// --- remote backend (real server + database) ---

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function pointsToWire(points) { return points.map((p) => [p.lon, p.lat]); }
function pointsFromWire(pairs) { return pairs.map(([lon, lat]) => ({ lon, lat })); }
function annotationFromWire(a) { return { ...a, points: pointsFromWire(a.points) }; }

const remote = {
  listSystems: () => request('/systems'),
  createSystem: (data) => request('/systems', { method: 'POST', body: JSON.stringify(data) }),
  updateSystem: (id, data) => request(`/systems/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSystem: (id) => request(`/systems/${id}`, { method: 'DELETE' }),

  listAnnotations: async () => (await request('/annotations')).map(annotationFromWire),
  createAnnotation: async (systemId, { type, points }) =>
    annotationFromWire(await request(`/systems/${systemId}/annotations`, {
      method: 'POST', body: JSON.stringify({ type, points: pointsToWire(points) }),
    })),
  updateAnnotation: async (id, { points }) =>
    annotationFromWire(await request(`/annotations/${id}`, {
      method: 'PATCH', body: JSON.stringify({ points: pointsToWire(points) }),
    })),
  deleteAnnotation: (id) => request(`/annotations/${id}`, { method: 'DELETE' }),

  listForecastPoints: () => request('/forecast-points'),
  createForecastPoint: (systemId, data) => request(`/systems/${systemId}/forecast-points`, { method: 'POST', body: JSON.stringify(data) }),
  updateForecastPoint: (id, data) => request(`/forecast-points/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteForecastPoint: (id) => request(`/forecast-points/${id}`, { method: 'DELETE' }),
};

// --- local fallback (browser localStorage, no server available) ---
// Mirrors server/src/systems.js's shape and season/sequence logic exactly,
// so the rest of the app doesn't care which backend is actually in use.

function currentSeason(date = new Date()) {
  const y = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? y : y - 1;
}

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeAll(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function readAllAnnotations() {
  try {
    return JSON.parse(localStorage.getItem(ANNOTATIONS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeAllAnnotations(rows) {
  localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(rows));
}

function annotationToApi(row) {
  return { id: row.id, systemId: row.systemId, type: row.type, points: row.points, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function readAllForecastPoints() {
  try {
    return JSON.parse(localStorage.getItem(FORECAST_POINTS_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeAllForecastPoints(rows) {
  localStorage.setItem(FORECAST_POINTS_STORAGE_KEY, JSON.stringify(rows));
}

function forecastPointToApi(row) {
  return {
    id: row.id, systemId: row.systemId, sequence: row.sequence,
    lon: row.lon, lat: row.lat, hour: row.hour,
    windMph: row.windMph ?? null, spreadMi: row.spreadMi ?? 0,
    hourMode: row.hourMode ?? 'auto', hourOverride: row.hourOverride ?? null,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function stageLabel(stage) {
  return stage === 'invest' ? 'Invest' : 'Disturbance';
}

// Mirrors server/src/systems.js's averageRadius exactly -- a single
// representative gale radius for intensityScore's formula, derived from
// whichever quadrants have been set via the wind field drag handles, or
// null until at least one has been.
function averageRadius(ne, se, sw, nw) {
  const quadrants = [ne, se, sw, nw];
  if (quadrants.every((v) => v == null)) return null;
  return quadrants.reduce((sum, v) => sum + (v ?? 0), 0) / 4;
}

function toApi(row) {
  return {
    id: row.id,
    season: row.season,
    seasonLabel: `${row.season}-${String((row.season + 1) % 100).padStart(2, '0')}`,
    sequenceNumber: row.sequenceNumber,
    displayName: row.name || `${stageLabel(row.stage)} ${row.sequenceNumber}`,
    name: row.name ?? null,
    stage: row.stage ?? 'disturbance',
    lat: row.lat,
    lon: row.lon,
    formationProbability2dayPct: row.formationProbability2dayPct ?? null,
    formationProbability5dayPct: row.formationProbability5dayPct ?? null,
    formationProbability10dayPct: row.formationProbability10dayPct ?? null,
    pressureMb: row.pressureMb ?? null,
    windMph: row.windMph ?? null,
    gustMph: row.gustMph ?? null,
    galeRadiusNeMi: row.galeRadiusNeMi ?? null,
    galeRadiusSeMi: row.galeRadiusSeMi ?? null,
    galeRadiusSwMi: row.galeRadiusSwMi ?? null,
    galeRadiusNwMi: row.galeRadiusNwMi ?? null,
    hurricaneForceRadiusNeMi: row.hurricaneForceRadiusNeMi ?? null,
    hurricaneForceRadiusSeMi: row.hurricaneForceRadiusSeMi ?? null,
    hurricaneForceRadiusSwMi: row.hurricaneForceRadiusSwMi ?? null,
    hurricaneForceRadiusNwMi: row.hurricaneForceRadiusNwMi ?? null,
    galeRadiusMi: averageRadius(row.galeRadiusNeMi, row.galeRadiusSeMi, row.galeRadiusSwMi, row.galeRadiusNwMi),
    formed: !!row.formed,
    classified: !!row.classified,
    forecastInterval: row.forecastInterval ?? 12,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const local = {
  async listSystems() {
    return readAll().sort((a, b) => b.season - a.season || a.sequenceNumber - b.sequenceNumber).map(toApi);
  },
  async createSystem({ lat, lon, formationProbability2dayPct, formationProbability5dayPct, formationProbability10dayPct }) {
    const rows = readAll();
    const season = currentSeason();
    const sequenceNumber = Math.max(0, ...rows.filter((r) => r.season === season).map((r) => r.sequenceNumber)) + 1;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), season, sequenceNumber, name: null,
      stage: 'disturbance',
      lat, lon,
      formationProbability2dayPct: formationProbability2dayPct ?? null,
      formationProbability5dayPct: formationProbability5dayPct ?? null,
      formationProbability10dayPct: formationProbability10dayPct ?? null,
      pressureMb: null, windMph: null, gustMph: null,
      galeRadiusNeMi: null, galeRadiusSeMi: null, galeRadiusSwMi: null, galeRadiusNwMi: null,
      hurricaneForceRadiusNeMi: null, hurricaneForceRadiusSeMi: null, hurricaneForceRadiusSwMi: null, hurricaneForceRadiusNwMi: null,
      formed: false, classified: false, forecastInterval: 12,
      createdAt: now, updatedAt: now,
    };
    writeAll([...rows, row]);
    return toApi(row);
  },
  async updateSystem(id, patch) {
    const rows = readAll();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('not_found');
    rows[idx] = { ...rows[idx], ...patch, updatedAt: new Date().toISOString() };
    writeAll(rows);
    return toApi(rows[idx]);
  },
  async deleteSystem(id) {
    writeAll(readAll().filter((r) => r.id !== id));
    // Cascade, mirroring the server's ON DELETE CASCADE -- otherwise
    // localStorage mode leaks orphaned annotations/forecast points on every
    // system delete.
    writeAllAnnotations(readAllAnnotations().filter((r) => r.systemId !== id));
    writeAllForecastPoints(readAllForecastPoints().filter((r) => r.systemId !== id));
  },

  async listAnnotations() {
    return readAllAnnotations().map(annotationToApi);
  },
  async createAnnotation(systemId, { type, points }) {
    const rows = readAllAnnotations();
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), systemId, type, points, createdAt: now, updatedAt: now };
    writeAllAnnotations([...rows, row]);
    return annotationToApi(row);
  },
  async updateAnnotation(id, { points }) {
    const rows = readAllAnnotations();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('not_found');
    rows[idx] = { ...rows[idx], points, updatedAt: new Date().toISOString() };
    writeAllAnnotations(rows);
    return annotationToApi(rows[idx]);
  },
  async deleteAnnotation(id) {
    writeAllAnnotations(readAllAnnotations().filter((r) => r.id !== id));
  },

  async listForecastPoints() {
    return readAllForecastPoints().map(forecastPointToApi);
  },
  async createForecastPoint(systemId, { lon, lat, hour, windMph, spreadMi, hourMode }) {
    const rows = readAllForecastPoints();
    const sequence = Math.max(0, ...rows.filter((r) => r.systemId === systemId).map((r) => r.sequence)) + 1;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), systemId, sequence, lon, lat, hour,
      windMph: windMph ?? null, spreadMi: spreadMi ?? 0,
      hourMode: ['auto', 'manual', 'override'].includes(hourMode) ? hourMode : 'auto', hourOverride: null,
      createdAt: now, updatedAt: now,
    };
    writeAllForecastPoints([...rows, row]);
    return forecastPointToApi(row);
  },
  async updateForecastPoint(id, patch) {
    const rows = readAllForecastPoints();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('not_found');
    rows[idx] = { ...rows[idx], ...patch, updatedAt: new Date().toISOString() };
    writeAllForecastPoints(rows);
    return forecastPointToApi(rows[idx]);
  },
  async deleteForecastPoint(id) {
    writeAllForecastPoints(readAllForecastPoints().filter((r) => r.id !== id));
  },
};

// --- pick a backend once, at startup ---

let backend = null;
export async function detectBackend() {
  if (backend) return backend;
  try {
    const res = await fetch(`${BASE}/systems`, { headers: { Accept: 'application/json' } });
    backend = res.ok ? 'remote' : 'local';
  } catch {
    backend = 'local';
  }
  return backend;
}

function impl() {
  return backend === 'remote' ? remote : local;
}

export const api = {
  listSystems: (...args) => impl().listSystems(...args),
  createSystem: (...args) => impl().createSystem(...args),
  updateSystem: (...args) => impl().updateSystem(...args),
  deleteSystem: (...args) => impl().deleteSystem(...args),
  listAnnotations: (...args) => impl().listAnnotations(...args),
  createAnnotation: (...args) => impl().createAnnotation(...args),
  updateAnnotation: (...args) => impl().updateAnnotation(...args),
  deleteAnnotation: (...args) => impl().deleteAnnotation(...args),
  listForecastPoints: (...args) => impl().listForecastPoints(...args),
  createForecastPoint: (...args) => impl().createForecastPoint(...args),
  updateForecastPoint: (...args) => impl().updateForecastPoint(...args),
  deleteForecastPoint: (...args) => impl().deleteForecastPoint(...args),
  isLocalOnly: () => backend === 'local',
};
