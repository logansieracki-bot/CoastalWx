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
    forecast_interval INTEGER NOT NULL DEFAULT 12 CHECK (forecast_interval IN (3, 6, 12, 24)),
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

// A hazard alert for a freeform zone a forecaster draws (same [lon,lat]
// pair wire shape as annotations.points) -- NHC-style Watches/Warnings,
// not restricted to the coast (NHC's own current practice extends
// tropical watches/warnings well inland for wind threat). `product` is
// deliberately not CHECK-constrained -- validated server-side against a
// fixed allowlist instead (see watches.js), since widening a CHECK
// constraint later means a full table rebuild (see
// migrateForecastIntervalCheck below for what that costs). `level` is a
// stable enough binary to CHECK directly. Escalating/de-escalating is a
// PATCH that flips `level` on the same row -- id and created_at persist
// across the change, so a watch's history stays one continuous record.
db.exec(`
  CREATE TABLE IF NOT EXISTS watches (
    id TEXT PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    product TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('watch', 'warning')),
    points TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_watches_system_id ON watches(system_id)');

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

// A prepared advisory that hasn't published yet -- the forecaster wrote it
// now but wants it to go out unattended at a future time (e.g. an early-
// morning slot they won't be at a computer for). scheduledAdvisoryRunner.js
// polls for due rows and turns each into a real `advisories` row at the
// moment it actually fires, snapshotting the system's state then (not now),
// then deletes this row either way -- published or not, it's consumed.
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_advisories (
    id TEXT PRIMARY KEY,
    system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    headline TEXT,
    discussion TEXT,
    scheduled_for TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id)
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_scheduled_advisories_system_id ON scheduled_advisories(system_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_scheduled_advisories_scheduled_for ON scheduled_advisories(scheduled_for)');

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

// Retired: was a live, directly-editable forecaster discussion for a
// disturbance/invest, but that let a forecaster's saved-not-yet-published
// draft leak straight onto the public page. Superseded by
// advisories.discussion (a per-advisory immutable snapshot, now used at
// every stage, not just classified) -- see systems.js's toApi/
// PATCHABLE_FIELDS, neither of which reference these columns anymore. Left
// in place rather than dropped (some existing rows may still carry old
// values) since nothing reads them anymore either way.
addColumnIfMissing('systems', 'discussion', 'TEXT');
addColumnIfMissing('systems', 'discussion_by_user_id', 'TEXT REFERENCES users(id)');

// Manual per-point annotation for the FORECAST POSITIONS AND MAX WINDS text
// product: null, 'over_water', 'inland', or 'dissipated' (validated in
// forecastPoints.js, not via a CHECK constraint, to keep this ALTER TABLE
// simple against existing databases).
addColumnIfMissing('forecast_points', 'status', 'TEXT');

// The forecaster's drafted pressure/wind/gust/formation-probability
// values (see systems.js's ADVISORY_SETTABLE_FIELDS), staged as JSON until
// scheduledAdvisoryRunner.js actually fires this row -- kept separate from
// headline/discussion (plain columns already above) since it's a flexible
// subset of system fields rather than its own fixed shape.
addColumnIfMissing('scheduled_advisories', 'pending_fields_json', 'TEXT');

// Soft delete -- NULL (the universal state before this column existed)
// means active; a timestamp means archived. The "Delete" button in the
// editor now archives instead of running a hard DELETE, so a storm's
// advisories/forecast points/annotations/watches/position log (every one
// of which cascades off systems.id) survive and stay visible on the
// public Past Storm Analysis page instead of being destroyed outright.
// Doesn't change storm-naming behavior: storm_names.used_by_system_id
// keeps pointing at the (now-archived, still-existing) system row either
// way, so assignStormName still never reassigns a retired name.
addColumnIfMissing('systems', 'archived_at', 'TEXT');

// Per-forecast-point gale-force wind field, same NE/SE/SW/NW quadrant shape
// as systems' own (see systems.js's four gale_radius_*_mi columns) but
// gale-only (no hurricane-force pair) and PATCH-only, never set at point
// creation -- see forecastPoints.js's PATCHABLE_FIELDS. Feeds the point's
// own intensity symbol (constants.js's pointIntensityScore), not the
// cone's geometry (still driven by spread_mi alone).
addColumnIfMissing('forecast_points', 'gale_radius_ne_mi', 'REAL');
addColumnIfMissing('forecast_points', 'gale_radius_se_mi', 'REAL');
addColumnIfMissing('forecast_points', 'gale_radius_sw_mi', 'REAL');
addColumnIfMissing('forecast_points', 'gale_radius_nw_mi', 'REAL');

// Widens forecast_interval's CHECK to also allow 3 (alongside the existing
// 6/12/24), for NHC-style 3-hourly intermediate advisories/cone spacing
// during an active, fast-moving, or near-landfall situation. Unlike the
// column additions above, SQLite has no ALTER TABLE for CHECK constraints
// -- the only sanctioned way to change one is the "rebuild" dance: copy
// into a new table with the wider constraint, drop the old one, rename.
// Guarded by reading the table's own stored CREATE TABLE text, so this is
// a no-op on every startup after the first time it actually runs.
function migrateForecastIntervalCheck() {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'systems'`).get();
  if (!row || row.sql.includes('forecast_interval IN (3, 6, 12, 24)')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE systems_new (
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
        forecast_interval INTEGER NOT NULL DEFAULT 12 CHECK (forecast_interval IN (3, 6, 12, 24)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        discussion TEXT,
        discussion_by_user_id TEXT REFERENCES users(id)
      )
    `);
    db.exec(`
      INSERT INTO systems_new (
        id, season, sequence_number, name, lat, lon, stage,
        formation_probability_2day_pct, formation_probability_5day_pct, formation_probability_10day_pct,
        pressure_mb, wind_mph, gust_mph,
        gale_radius_ne_mi, gale_radius_se_mi, gale_radius_sw_mi, gale_radius_nw_mi,
        hurricane_force_radius_ne_mi, hurricane_force_radius_se_mi, hurricane_force_radius_sw_mi, hurricane_force_radius_nw_mi,
        formed, classified, forecast_interval, created_at, updated_at,
        discussion, discussion_by_user_id
      )
      SELECT
        id, season, sequence_number, name, lat, lon, stage,
        formation_probability_2day_pct, formation_probability_5day_pct, formation_probability_10day_pct,
        pressure_mb, wind_mph, gust_mph,
        gale_radius_ne_mi, gale_radius_se_mi, gale_radius_sw_mi, gale_radius_nw_mi,
        hurricane_force_radius_ne_mi, hurricane_force_radius_se_mi, hurricane_force_radius_sw_mi, hurricane_force_radius_nw_mi,
        formed, classified, forecast_interval, created_at, updated_at,
        discussion, discussion_by_user_id
      FROM systems
    `);
    db.exec('DROP TABLE systems');
    db.exec('ALTER TABLE systems_new RENAME TO systems');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateForecastIntervalCheck();

// Widens watches.level's CHECK to also allow 'advisory' (a third,
// lower-severity tier below 'watch' -- see constants.js's
// WATCH_LEVEL_LABELS for the full severity ordering), via the same
// rebuild dance as migrateForecastIntervalCheck above -- SQLite still has
// no ALTER TABLE for CHECK constraints. Also recreates
// idx_watches_system_id, which the DROP TABLE below takes with it.
function migrateWatchLevelCheck() {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'watches'`).get();
  if (!row || row.sql.includes(`level IN ('watch', 'advisory', 'warning')`)) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE watches_new (
        id TEXT PRIMARY KEY,
        system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
        product TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('watch', 'advisory', 'warning')),
        points TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO watches_new (id, system_id, product, level, points, created_at, updated_at)
      SELECT id, system_id, product, level, points, created_at, updated_at
      FROM watches
    `);
    db.exec('DROP TABLE watches');
    db.exec('ALTER TABLE watches_new RENAME TO watches');
    db.exec('CREATE INDEX IF NOT EXISTS idx_watches_system_id ON watches(system_id)');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateWatchLevelCheck();
