/**
 * Database layer — libSQL client.
 *
 * Locally this opens a plain SQLite file (data/noor.db). In production it
 * talks to Turso over the network. Same code either way; the only difference
 * is the TURSO_DATABASE_URL / TURSO_AUTH_TOKEN environment variables.
 *
 * Everything here is async because a hosted database is a network call.
 */
const path = require("node:path");
const fs = require("node:fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const LOCAL_FILE = path.join(DATA_DIR, "noor.db");

const url = process.env.TURSO_DATABASE_URL || `file:${LOCAL_FILE}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const isFile = url.startsWith("file:");
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Fail with a sentence somebody can act on, rather than an EROFS deep in a
// library, when the deployment has no database configured.
if (isFile && isServerless) {
  throw new Error(
    "TURSO_DATABASE_URL is not set. A serverless deployment cannot use a local " +
      "SQLite file because the filesystem is read-only. Set TURSO_DATABASE_URL " +
      "and TURSO_AUTH_TOKEN in the project's environment variables."
  );
}

// Only a local file database needs a folder to live in.
if (isFile) fs.mkdirSync(DATA_DIR, { recursive: true });

// The default entry point of @libsql/client loads a native .node binding,
// which does not survive being bundled into a serverless function. For a
// remote database the pure-JavaScript HTTP client does everything we need.
const { createClient } = isFile
  ? require("@libsql/client")
  : require("@libsql/client/web");

const db = createClient({ url, authToken });

/* ------------------------------------------------------------- tiny helpers */

/** Run a query and return every row. */
async function all(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

/** Run a query and return the first row, or null. */
async function get(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] ?? null;
}

/** Run a statement and report what it changed. */
async function run(sql, args = []) {
  const result = await db.execute({ sql, args });
  return {
    changes: Number(result.rowsAffected ?? 0),
    lastInsertRowid:
      result.lastInsertRowid == null ? null : Number(result.lastInsertRowid),
  };
}

/* -------------------------------------------------------------------- schema */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  stock       INTEGER NOT NULL DEFAULT 0,
  featured    INTEGER NOT NULL DEFAULT 0,
  tone1       TEXT NOT NULL DEFAULT '#eee2d7',
  tone2       TEXT NOT NULL DEFAULT '#d7c1b2',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no    TEXT NOT NULL UNIQUE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL,
  address     TEXT NOT NULL,
  city        TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  subtotal    INTEGER NOT NULL,
  shipping    INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`;

const SAMPLE_PRODUCTS = [
  ["Ivory Grace Abaya", "abaya", 4500, "A flowing everyday abaya with a clean, elegant silhouette.", 12, 1, "#eee2d7", "#d7c1b2"],
  ["Mocha Everyday Abaya", "abaya", 5200, "A sophisticated neutral abaya designed for effortless styling.", 8, 1, "#e8e3dd", "#b9aaa0"],
  ["Pearl Embroidered Kurti", "kurti", 3200, "A graceful kurti with subtle detailing for festive and everyday wear.", 15, 1, "#d9d2c8", "#a69a8d"],
  ["Soft Bloom Hijab", "hijab", 1200, "A lightweight, comfortable hijab available for easy everyday styling.", 30, 1, "#efe6dc", "#c6aa96"],
  ["Midnight Classic Abaya", "abaya", 4900, "A timeless black abaya with a polished minimal finish.", 6, 0, "#d8d2cc", "#8d8177"],
  ["Rose Dust Kurti", "kurti", 3500, "A soft-toned kurti with a feminine, modern cut.", 10, 0, "#f0e2dd", "#caa99f"],
  ["Sand Silk Hijab", "hijab", 1400, "Smooth, elegant fabric that drapes beautifully.", 25, 0, "#f2e9dc", "#d3bb98"],
  ["Noor Signature Abaya", "abaya", 6500, "A premium statement piece from the Noor signature collection.", 4, 0, "#e4dcd3", "#9c8878"],
  ["Almond Wrap Shawl", "shawl", 2800, "A cosy wrap shawl that layers beautifully over any outfit.", 14, 0, "#ece3d8", "#bfa58e"],
  ["Olive Linen Kurti", "kurti", 3900, "Breathable linen in a soft olive tone for warm afternoons.", 9, 0, "#e6e6da", "#a3a68c"],
  ["Pearl Chiffon Hijab", "hijab", 1600, "A soft chiffon finish with a gentle pearl sheen.", 22, 0, "#f5efe6", "#ddc9b4"],
  ["Cocoa Formal Abaya", "abaya", 7200, "A richly tailored abaya for weddings and formal evenings.", 3, 0, "#ded3c9", "#8b7261"],
];

async function seedProducts() {
  const row = await get("SELECT COUNT(*) AS n FROM products");
  if (Number(row.n) > 0) return;

  await db.batch(
    SAMPLE_PRODUCTS.map((p) => ({
      sql: `INSERT INTO products (name, category, price, description, stock, featured, tone1, tone2)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: p,
    })),
    "write"
  );
  console.log(`   seeded ${SAMPLE_PRODUCTS.length} products`);
}

/**
 * Create the tables and sample data. Safe to call on every request — the work
 * happens once and every later call waits on the same promise, which is what
 * a serverless cold start needs.
 */
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await db.executeMultiple(SCHEMA);
      await seedProducts();
    })().catch((err) => {
      readyPromise = null; // let the next request retry instead of failing forever
      throw err;
    });
  }
  return readyPromise;
}

module.exports = { db, all, get, run, ready, DB_FILE: url };
