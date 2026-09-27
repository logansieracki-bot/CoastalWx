import { Router } from 'express';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.js';

const SESSION_COOKIE = 'nec_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, absolute -- no sliding renewal

export const ROLES = ['owner', 'admin', 'forecaster', 'junior_forecaster'];

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

// Exported for the bootstrap script (server/scripts/create-user.js), which
// needs to hash a password before any account/session machinery exists.
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHashHex) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// The DB only ever stores this hash, never the raw session token -- the
// token itself (256 bits of random entropy, nothing to brute-force) lives
// only in the browser's cookie.
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// req.cookies isn't populated without the separate cookie-parser
// middleware, and validity here comes from a DB lookup rather than a
// signature, so there's nothing cookie-parser would add -- just this.
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function userToApi(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, hashToken(token), now.toISOString(), expiresAt.toISOString(), now.toISOString());
  return token;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

// Looks up the session row for this request's cookie (pruning it first if
// expired) and returns the owning user row, or null if there's no valid
// session -- "not logged in" is a normal outcome here, not an error.
function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    return null;
  }
  db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), session.id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) ?? null;
}

// Synchronous, matching how DatabaseSync is used everywhere else in this
// codebase. 401 with no session at all, 403 if it exists but the role
// isn't allowed -- callers can tell "log in" apart from "not permitted."
export function requireRole(...roles) {
  return (req, res, next) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'login_required' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'forbidden' });
    req.user = user;
    next();
  };
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(normalizeUsername(username));
  // Same generic failure whether the username doesn't exist or the
  // password is wrong -- never reveal which usernames exist.
  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = createSession(row.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ user: userToApi(row) });
});

authRouter.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
});

// 200 with {user: null} rather than 401 -- "not logged in" is an expected
// state for a startup probe, the same way detectBackend() treats "no
// backend" as a normal branch rather than an error.
authRouter.get('/me', (req, res) => {
  const user = userFromRequest(req);
  res.json({ user: user ? userToApi(user) : null });
});

authRouter.get('/users', requireRole('owner', 'admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  res.json(rows.map(userToApi));
});

authRouter.post('/users', requireRole('owner', 'admin'), (req, res) => {
  const { username, password, displayName, role } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'username and a password of 8+ characters are required' });
  }
  const normalized = normalizeUsername(username);
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(normalized)) {
    return res.status(409).json({ error: 'username_taken' });
  }

  // An Admin can create accounts but only Owner can hand out a role above
  // the default -- promotion/demotion afterward is Owner-only too (PATCH
  // below).
  const resolvedRole = req.user.role === 'owner' && ROLES.includes(role) ? role : 'junior_forecaster';

  const { hash, salt } = hashPassword(password);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, normalized, (displayName || username).trim(), hash, salt, resolvedRole, now, now);

  res.status(201).json(userToApi(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

authRouter.patch('/users/:id', requireRole('owner'), (req, res) => {
  const { role } = req.body ?? {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'invalid role' });
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, new Date().toISOString(), req.params.id);
  res.json(userToApi(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)));
});
