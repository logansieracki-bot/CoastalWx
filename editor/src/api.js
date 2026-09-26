const BASE = '/api';
const STORAGE_KEY = 'noreastercaster:systems';

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

const remote = {
  listSystems: () => request('/systems'),
  createSystem: (data) => request('/systems', { method: 'POST', body: JSON.stringify(data) }),
  updateSystem: (id, data) => request(`/systems/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSystem: (id) => request(`/systems/${id}`, { method: 'DELETE' }),
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
    formationProbabilityPct: row.formationProbabilityPct ?? null,
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
  async createSystem({ lat, lon, formationProbabilityPct }) {
    const rows = readAll();
    const season = currentSeason();
    const sequenceNumber = Math.max(0, ...rows.filter((r) => r.season === season).map((r) => r.sequenceNumber)) + 1;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), season, sequenceNumber, name: null,
      lat, lon, formationProbabilityPct: formationProbabilityPct ?? null,
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
  isLocalOnly: () => backend === 'local',
};
