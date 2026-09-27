// Bootstrap script -- the only way to create the very first account, since
// POST /api/users requires already being logged in as Owner/Admin. Run
// this directly against the real database (locally: `node
// server/scripts/create-user.js ...`; on the live Railway deployment:
// `railway ssh -- node server/scripts/create-user.js ...`, NOT `railway
// run`, which executes locally against Railway's env vars rather than
// inside the actual container with the real mounted volume).
//
// The password is hashed immediately and is never written to a file,
// commit, or log in plain text -- only the resulting hash+salt are stored.
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { hashPassword, ROLES } from '../src/auth.js';

const [username, password, displayName, role] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node server/scripts/create-user.js <username> <password> [display name] [role]');
  console.error(`  role defaults to "owner" if omitted. Valid roles: ${ROLES.join(', ')}`);
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
if (role && !ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Valid roles: ${ROLES.join(', ')}`);
  process.exit(1);
}

const normalized = username.trim().toLowerCase();
if (db.prepare('SELECT id FROM users WHERE username = ?').get(normalized)) {
  console.error(`A user "${normalized}" already exists.`);
  process.exit(1);
}

const { hash, salt } = hashPassword(password);
const id = randomUUID();
const now = new Date().toISOString();
db.prepare(`
  INSERT INTO users (id, username, display_name, password_hash, password_salt, role, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(id, normalized, (displayName || username).trim(), hash, salt, role || 'owner', now, now);

console.log(`Created user "${normalized}" (${role || 'owner'}). The password was hashed on creation and is not stored or logged anywhere.`);
