/**
 * Database layer — uses Node's built-in SQLite (node:sqlite).
 * No npm packages needed. The database is a single file: data/noor.db
 */
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "noor.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

// Foreign keys are off by default in SQLite; turn them on so deleting an
// order also removes its items.
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
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
`);

/** Seed the catalogue the first time the app runs. */
function seedProducts() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM products").get();
  if (n > 0) return;

  const rows = [
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

  const insert = db.prepare(`
    INSERT INTO products (name, category, price, description, stock, featured, tone1, tone2)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) insert.run(...r);
  console.log(`   seeded ${rows.length} products`);
}

module.exports = { db, seedProducts, DB_FILE };
