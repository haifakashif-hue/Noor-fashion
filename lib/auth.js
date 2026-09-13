/**
 * Authentication — password hashing and session cookies.
 * Uses node:crypto only; the database calls are async because the database
 * may be remote (Turso) in production.
 */
const crypto = require("node:crypto");
const { get, run } = require("./db");

const COOKIE_NAME = "noor_session";
const SESSION_DAYS = 7;

/* ---------------------------------------------------------------- passwords */

/** Hash a password with scrypt and a fresh random salt. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** Compare a password to a stored hash without leaking timing information. */
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/* ----------------------------------------------------------------- sessions */

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
    token,
    userId,
    expires.toISOString(),
  ]);
  return { token, expires };
}

async function destroySession(token) {
  if (token) await run("DELETE FROM sessions WHERE token = ?", [token]);
}

/** Remove expired sessions so the table does not grow forever. */
async function purgeExpiredSessions() {
  await run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Return the logged-in user for this request, or null. */
async function getUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;

  const row = await get(
    `SELECT u.id, u.name, u.email, u.phone, u.is_admin, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    [token]
  );
  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    await destroySession(token);
    return null;
  }
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    isAdmin: Number(row.is_admin) === 1,
  };
}

function sessionCookie(token, expires) {
  // Secure is added in production so the cookie only travels over HTTPS.
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? " Secure;" : "";
  return (
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; ` +
    `Expires=${expires.toUTCString()}`
  );
}

function clearCookie() {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? " Secure;" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

/* -------------------------------------------------------------- admin seed */

/**
 * Make sure an admin account exists. The password comes from ADMIN_PASSWORD
 * if set, otherwise a development default that the README tells you to change.
 */
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@noorfashion.pk";
  const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) return;

  const password = process.env.ADMIN_PASSWORD || "admin123";
  await run(
    `INSERT INTO users (name, email, phone, password_hash, is_admin)
     VALUES (?, ?, ?, ?, 1)`,
    ["Store Admin", email, "", hashPassword(password)]
  );
  console.log(`   admin account: ${email}${process.env.ADMIN_PASSWORD ? "" : ` / ${password}`}`);
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  purgeExpiredSessions,
  getUser,
  sessionCookie,
  clearCookie,
  parseCookies,
  seedAdmin,
};
