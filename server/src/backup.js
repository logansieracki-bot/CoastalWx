import { dirname, join } from 'node:path';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { db, DB_PATH } from './db.js';

const BACKUP_DIR = join(dirname(DB_PATH), 'backups');
const MAX_SNAPSHOTS = 14;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'noreastercaster-';

// A consistent, compacted point-in-time copy -- not a raw file copy, which
// could capture a torn write mid-transaction. Protects against logical
// mistakes (a bad PATCH/DELETE, a bug) with same-volume history; it does
// NOT protect against losing the volume itself -- that's a separate,
// larger decision (Railway's own volume backups, or Litestream) if ever
// needed.
export function takeSnapshot() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(BACKUP_DIR, `${PREFIX}${stamp}.db`);
  db.exec(`VACUUM INTO '${path}'`);
  prune();
  return path;
}

function prune() {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    .sort(); // ISO timestamps in the filename sort chronologically as plain strings
  const excess = files.length - MAX_SNAPSHOTS;
  for (let i = 0; i < excess; i++) {
    unlinkSync(join(BACKUP_DIR, files[i]));
  }
}

export function startBackupSchedule() {
  takeSnapshot(); // one at startup too, so even a short-lived deploy gets one
  const timer = setInterval(takeSnapshot, INTERVAL_MS);
  timer.unref?.(); // a periodic backup shouldn't be the reason the process stays alive
  return timer;
}
