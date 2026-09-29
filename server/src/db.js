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

// ON DELETE CASCADE here means "delete this row," not "clear the
// reference" -- deleting a named system removes its storm_names row
// entirely, which is what keeps the name permanently unavailable rather
// than freeing it back up for reuse (assignStormName only ever considers
// rows that still exist).
db.exec(`
  CREATE TABLE IF NOT EXISTS storm_names (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    name TEXT NOT NULL,
    used_by_system_id TEXT REFERENCES systems(id) ON DELETE CASCADE,
    UNIQUE (season, sequence)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS advisories (
    id TEXT PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    headline TEXT,
    discussion TEXT,
    snapshot_json TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    issued_by_user_id TEXT NOT NULL REFERENCES users(id)
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_advisories_system_id ON advisories(system_id)');

// A lightweight, automatic position/intensity log -- one row captured every
// time a system's lat/lon is PATCHed, for every stage (disturbance, invest,
// classified alike), unlike advisories.snapshot_json above which only ever
// exists for classified systems that a forecaster has explicitly published.
// This is what lets an Invest (or even a plain Disturbance) build up a real
// track/wind history over time instead of the ongoing-analysis page only
// ever being able to show its current live position. Same snapshot_json
// shape as advisories (a full systems.toApi() record) so both sources can
// feed the same rendering code on the client.
db.exec(`
  CREATE TABLE IF NOT EXISTS system_position_log (
    id TEXT PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_system_position_log_system_id ON system_position_log(system_id)');

// --- Additive migrations -- columns added after each table's initial
// CREATE TABLE above. CREATE TABLE IF NOT EXISTS is a no-op against an
// existing database file, so anyone with data from before these columns
// existed needs them added in place instead.
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Live, editable forecaster discussion for a disturbance/invest, shown in
// an on-map callout while selected -- distinct from advisories.discussion
// above, which is a per-advisory immutable snapshot for classified systems.
addColumnIfMissing('systems', 'discussion', 'TEXT');
addColumnIfMissing('systems', 'discussion_by_user_id', 'TEXT REFERENCES users(id)');

// Manual per-point annotation for the FORECAST POSITIONS AND MAX WINDS text
// product: null, 'over_water', 'inland', or 'dissipated' (validated in
// forecastPoints.js, not via a CHECK constraint, to keep this ALTER TABLE
// simple against existing databases).
addColumnIfMissing('forecast_points', 'status', 'TEXT');
