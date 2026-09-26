const BASE = '/api';
const STORAGE_KEY = 'noreastercaster:systems';
const ANNOTATIONS_STORAGE_KEY = 'noreastercaster:annotations';

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

function toApi(row) {
  return {
    id: row.id,
    season: row.season,
    seasonLabel: `${row.season}-${String((row.season + 1) % 100).padStart(2, '0')}`,
    sequenceNumber: row.sequenceNumber,
    displayName: row.name || `Disturbance ${row.sequenceNumber}`,
    name: row.name ?? null,
    lat: row.lat,
    lon: row.lon,
    formationProbability2dayPct: row.formationProbability2dayPct ?? null,
    formationProbability5dayPct: row.formationProbability5dayPct ?? null,
    formationProbability10dayPct: row.formationProbability10dayPct ?? null,
    pressureMb: row.pressureMb ?? null,
    windMph: row.windMph ?? null,
    formed: !!row.formed,
    classified: !!row.classified,
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
      lat, lon,
      formationProbability2dayPct: formationProbability2dayPct ?? null,
      formationProbability5dayPct: formationProbability5dayPct ?? null,
      formationProbability10dayPct: formationProbability10dayPct ?? null,
      pressureMb: null, windMph: null, formed: false, classified: false,
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
    // localStorage mode leaks orphaned annotations on every system delete.
    writeAllAnnotations(readAllAnnotations().filter((r) => r.systemId !== id));
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
  isLocalOnly: () => backend === 'local',
};
