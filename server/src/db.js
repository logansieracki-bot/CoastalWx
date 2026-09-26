import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.NOREASTERCASTER_DB || join(DATA_DIR, 'noreastercaster.db');

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
    formation_probability_pct INTEGER,
    pressure_mb REAL,
    wind_mph REAL,
    formed INTEGER NOT NULL DEFAULT 0,
    classified INTEGER NOT NULL DEFAULT 0,
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
