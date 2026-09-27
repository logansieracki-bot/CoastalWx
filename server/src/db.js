import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.NOREASTERCASTER_DB || join(DATA_DIR, 'noreastercaster.db');

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS systems (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    sequence_number INTEGER NOT NULL,
    name TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    stage TEXT NOT NULL DEFAULT 'disturbance' CHECK (stage IN ('disturbance', 'invest')),
    formation_probability_2day_pct INTEGER,
    formation_probability_5day_pct INTEGER,
    formation_probability_10day_pct INTEGER,
    pressure_mb REAL,
    wind_mph REAL,
    gust_mph REAL,
    gale_radius_ne_mi REAL,
    gale_radius_se_mi REAL,
    gale_radius_sw_mi REAL,
    gale_radius_nw_mi REAL,
    hurricane_force_radius_ne_mi REAL,
    hurricane_force_radius_se_mi REAL,
    hurricane_force_radius_sw_mi REAL,
    hurricane_force_radius_nw_mi REAL,
    formed INTEGER NOT NULL DEFAULT 0,
    classified INTEGER NOT NULL DEFAULT 0,
    forecast_interval INTEGER NOT NULL DEFAULT 12 CHECK (forecast_interval IN (6, 12, 24)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('shape', 'arrow')),
    points TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_annotations_system_id ON annotations(system_id)');

db.exec(`
  CREATE TABLE IF NOT EXISTS forecast_points (
    id TEXT PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    lon REAL NOT NULL,
    lat REAL NOT NULL,
    hour INTEGER NOT NULL,
    wind_mph REAL,
    spread_mi REAL NOT NULL DEFAULT 0,
    hour_mode TEXT NOT NULL DEFAULT 'auto' CHECK (hour_mode IN ('auto', 'manual', 'override')),
    hour_override INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_forecast_points_system_id ON forecast_points(system_id)');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'forecaster', 'junior_forecaster')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
