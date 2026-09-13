/**
 * API route handlers.
 *
 * Every handler receives a `ctx` object and either returns the data to send
 * as JSON, or throws an HttpError. Prices and stock are always read from the
 * database — values coming from the browser are never trusted.
 */
const crypto = require("node:crypto");
const { db } = require("./db");
const auth = require("./auth");

const SHIPPING_FEE = 250;
const FREE_SHIPPING_OVER = 5000;
const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------- validation */

function str(value, field, { min = 1, max = 500 } = {}) {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < min) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long`);
  return v;
}

function email(value) {
  const v = str(value, "Email", { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, "Enter a valid email address");
  return v;
}

function phone(value) {
  const v = str(value, "Phone number", { max: 30 });
  if (!/^[\d+\-\s()]{7,}$/.test(v)) throw new HttpError(400, "Enter a valid phone number");
  return v;
}

function intVal(value, field, { min = 0, max = 10_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  if (n < min || n > max) throw new HttpError(400, `${field} is out of range`);
  return n;
}

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, "Please log in to continue");
  return ctx.user;
}

function requireAdmin(ctx) {
  const user = requireUser(ctx);
  if (!user.isAdmin) throw new HttpError(403, "Admin access only");
  return user;
}

/* ---------------------------------------------------------------- catalog */

const SORTS = {
  newest: "created_at DESC, id DESC",
  "price-asc": "price ASC",
  "price-desc": "price DESC",
  name: "name ASC",
};

function listProducts(ctx) {
  const { category, q, sort } = ctx.query;
  const where = ["active = 1"];
  const params = [];

  if (category && category !== "all") {
    where.push("category = ?");
    params.push(category);
  }
  if (q && q.trim()) {
    where.push("(name LIKE ? OR description LIKE ? OR category LIKE ?)");
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }

  const orderBy = SORTS[sort] || SORTS.newest;
  const rows = db
    .prepare(`SELECT * FROM products WHERE ${where.join(" AND ")} ORDER BY ${orderBy}`)
    .all(...params);

  return { products: rows.map(publicProduct) };
}

function publicProduct(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    description: p.description,
    stock: p.stock,
    featured: p.featured === 1,
    tone1: p.tone1,
    tone2: p.tone2,
  };
}

function getProduct(ctx) {
  const row = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").get(ctx.params.id);
  if (!row) throw new HttpError(404, "Product not found");
  return { product: publicProduct(row) };
}

function listCategories() {
  const rows = db
    .prepare(
      `SELECT category AS slug, COUNT(*) AS count
         FROM products WHERE active = 1
        GROUP BY category ORDER BY category`
    )
    .all();
  return { categories: rows };
}

/* ------------------------------------------------------------------- auth */

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, isAdmin: u.isAdmin ?? u.is_admin === 1 };
}

function signup(ctx) {
  const name = str(ctx.body.name, "Name", { max: 80 });
  const mail = email(ctx.body.email);
  const tel = ctx.body.phone ? phone(ctx.body.phone) : "";
  const password = String(ctx.body.password || "");
  if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters");

  const taken = db.prepare("SELECT id FROM users WHERE email = ?").get(mail);
  if (taken) throw new HttpError(409, "An account with this email already exists");

  const info = db
    .prepare("INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)")
    .run(name, mail, tel, auth.hashPassword(password));

  const id = Number(info.lastInsertRowid);
  const { token, expires } = auth.createSession(id);
  ctx.setCookie(auth.sessionCookie(token, expires));
  return { user: { id, name, email: mail, phone: tel, isAdmin: false } };
}

function login(ctx) {
  const mail = email(ctx.body.email);
  const password = String(ctx.body.password || "");

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(mail);
  if (!row || !auth.verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, "Email or password is incorrect");
  }

  const { token, expires } = auth.createSession(row.id);
  ctx.setCookie(auth.sessionCookie(token, expires));
  return { user: publicUser(row) };
}

function logout(ctx) {
  auth.destroySession(auth.parseCookies(ctx.req)[auth.COOKIE_NAME]);
  ctx.setCookie(auth.clearCookie());
  return { ok: true };
}

function me(ctx) {
  return { user: ctx.user };
}

/* ------------------------------------------------------------------ cart */

/**
 * Price a cart against the database. Returns the priced lines plus any
 * problems (removed products, not enough stock) so the UI can explain them.
 *
 * While browsing, quantities are quietly trimmed to what is in stock. When an
 * order is actually being placed we pass `strict` so the customer is told
 * instead of silently receiving fewer pieces than they asked for.
 */
function priceCart(items, { strict = false } = {}) {
  if (!Array.isArray(items)) throw new HttpError(400, "Cart is invalid");

  const lines = [];
  const issues = [];
  let subtotal = 0;

  for (const raw of items.slice(0, 50)) {
    const id = intVal(raw.id, "Product id");
    const qty = intVal(raw.qty, "Quantity", { min: 1, max: 99 });
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(id);

    if (!p || p.active !== 1) {
      issues.push({ id, reason: "This product is no longer available" });
      continue;
    }
    if (p.stock < 1) {
      issues.push({ id, name: p.name, reason: `${p.name} is out of stock` });
      continue;
    }

    const finalQty = Math.min(qty, p.stock);
    if (finalQty < qty) {
      issues.push({ id, name: p.name, reason: `Only ${p.stock} left of ${p.name}` });
    }

    subtotal += p.price * finalQty;
    lines.push({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      qty: finalQty,
      lineTotal: p.price * finalQty,
      stock: p.stock,
      tone1: p.tone1,
      tone2: p.tone2,
    });
  }

  if (strict && issues.length) throw new HttpError(409, issues[0].reason);

  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;
  return {
    lines,
    issues,
    subtotal,
    shipping,
    total: subtotal + shipping,
    freeShippingOver: FREE_SHIPPING_OVER,
  };
}

function validateCart(ctx) {
  return priceCart(ctx.body.items);
}

/* ---------------------------------------------------------------- orders */

function createOrder(ctx) {
  const name = str(ctx.body.name, "Name", { max: 80 });
  const mail = email(ctx.body.email);
  const tel = phone(ctx.body.phone);
  const address = str(ctx.body.address, "Address", { max: 300 });
  const city = str(ctx.body.city, "City", { max: 80 });
  const notes = ctx.body.notes ? str(ctx.body.notes, "Notes", { min: 0, max: 500 }) : "";

  const priced = priceCart(ctx.body.items, { strict: true });
  if (!priced.lines.length) throw new HttpError(400, "Your cart is empty");

  db.exec("BEGIN");
  try {
    // Reserve stock first — the guard in the WHERE clause makes it impossible
    // to sell more than we have, even if two orders arrive at once.
    for (const line of priced.lines) {
      const res = db
        .prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
        .run(line.qty, line.id, line.qty);
      if (res.changes !== 1) throw new HttpError(409, `${line.name} just went out of stock`);
    }

    const tmp = `TMP-${crypto.randomUUID()}`;
    const info = db
      .prepare(
        `INSERT INTO orders (order_no, user_id, name, email, phone, address, city, notes,
                             subtotal, shipping, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(tmp, ctx.user ? ctx.user.id : null, name, mail, tel, address, city, notes,
           priced.subtotal, priced.shipping, priced.total);

    const orderId = Number(info.lastInsertRowid);
    const orderNo = `NF-${1000 + orderId}`;
    db.prepare("UPDATE orders SET order_no = ? WHERE id = ?").run(orderNo, orderId);

    const addItem = db.prepare(
      "INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)"
    );
    for (const line of priced.lines) addItem.run(orderId, line.id, line.name, line.price, line.qty);

    db.exec("COMMIT");
    return { order: { orderNo, total: priced.total, items: priced.lines.length } };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function orderWithItems(order) {
  const items = db
    .prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?")
    .all(order.id);
  return { ...order, items };
}

function myOrders(ctx) {
  const user = requireUser(ctx);
  const rows = db
    .prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC")
    .all(user.id);
  return { orders: rows.map(orderWithItems) };
}

function trackOrder(ctx) {
  const orderNo = str(ctx.query.orderNo, "Order number", { max: 40 }).toUpperCase();
  const tel = str(ctx.query.phone, "Phone number", { max: 30 });

  const row = db.prepare("SELECT * FROM orders WHERE UPPER(order_no) = ?").get(orderNo);
  // Require the phone number too, so an order number alone does not expose
  // somebody's address.
  if (!row || row.phone.replace(/\D/g, "") !== tel.replace(/\D/g, "")) {
    throw new HttpError(404, "No order found with that order number and phone number");
  }
  return { order: orderWithItems(row) };
}

/* -------------------------------------------------------------- messages */

function createMessage(ctx) {
  const name = str(ctx.body.name, "Name", { max: 80 });
  const mail = email(ctx.body.email);
  const message = str(ctx.body.message, "Message", { max: 2000 });
  db.prepare("INSERT INTO messages (name, email, message) VALUES (?, ?, ?)").run(name, mail, message);
  return { ok: true };
}

/* ----------------------------------------------------------------- admin */

function adminStats(ctx) {
  requireAdmin(ctx);
  const one = (sql) => Object.values(db.prepare(sql).get())[0];
  return {
    stats: {
      orders: one("SELECT COUNT(*) FROM orders"),
      pending: one("SELECT COUNT(*) FROM orders WHERE status = 'pending'"),
      revenue: one("SELECT IFNULL(SUM(total),0) FROM orders WHERE status != 'cancelled'"),
      products: one("SELECT COUNT(*) FROM products WHERE active = 1"),
      lowStock: one("SELECT COUNT(*) FROM products WHERE active = 1 AND stock <= 3"),
      unread: one("SELECT COUNT(*) FROM messages WHERE is_read = 0"),
      customers: one("SELECT COUNT(*) FROM users WHERE is_admin = 0"),
    },
  };
}

function adminProducts(ctx) {
  requireAdmin(ctx);
  const rows = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
  return { products: rows };
}

function readProductBody(body) {
  return {
    name: str(body.name, "Name", { max: 120 }),
    category: str(body.category, "Category", { max: 40 }).toLowerCase(),
    price: intVal(body.price, "Price", { min: 1 }),
    description: body.description ? str(body.description, "Description", { min: 0, max: 1000 }) : "",
    stock: intVal(body.stock ?? 0, "Stock", { min: 0, max: 100000 }),
    featured: body.featured ? 1 : 0,
    tone1: /^#[0-9a-f]{6}$/i.test(body.tone1 || "") ? body.tone1 : "#eee2d7",
    tone2: /^#[0-9a-f]{6}$/i.test(body.tone2 || "") ? body.tone2 : "#d7c1b2",
    active: body.active === false ? 0 : 1,
  };
}

function adminCreateProduct(ctx) {
  requireAdmin(ctx);
  const p = readProductBody(ctx.body);
  const info = db
    .prepare(
      `INSERT INTO products (name, category, price, description, stock, featured, tone1, tone2, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(p.name, p.category, p.price, p.description, p.stock, p.featured, p.tone1, p.tone2, p.active);
  return { id: Number(info.lastInsertRowid) };
}

function adminUpdateProduct(ctx) {
  requireAdmin(ctx);
  const id = intVal(ctx.params.id, "Product id");
  const exists = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!exists) throw new HttpError(404, "Product not found");

  const p = readProductBody(ctx.body);
  db.prepare(
    `UPDATE products SET name=?, category=?, price=?, description=?, stock=?,
                         featured=?, tone1=?, tone2=?, active=?
     WHERE id=?`
  ).run(p.name, p.category, p.price, p.description, p.stock, p.featured, p.tone1, p.tone2, p.active, id);
  return { ok: true };
}

function adminDeleteProduct(ctx) {
  requireAdmin(ctx);
  const id = intVal(ctx.params.id, "Product id");
  // Soft delete: past orders still need the product row for their history.
  const res = db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(id);
  if (res.changes !== 1) throw new HttpError(404, "Product not found");
  return { ok: true };
}

function adminOrders(ctx) {
  requireAdmin(ctx);
  const rows = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
  return { orders: rows.map(orderWithItems), statuses: ORDER_STATUSES };
}

function adminUpdateOrder(ctx) {
  requireAdmin(ctx);
  const id = intVal(ctx.params.id, "Order id");
  const status = str(ctx.body.status, "Status", { max: 20 }).toLowerCase();
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, "Unknown order status");

  const res = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  if (res.changes !== 1) throw new HttpError(404, "Order not found");
  return { ok: true };
}

function adminMessages(ctx) {
  requireAdmin(ctx);
  return { messages: db.prepare("SELECT * FROM messages ORDER BY id DESC").all() };
}

function adminReadMessage(ctx) {
  requireAdmin(ctx);
  const id = intVal(ctx.params.id, "Message id");
  db.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").run(id);
  return { ok: true };
}

/* ---------------------------------------------------------------- routes */

const routes = [
  ["GET", "/api/products", listProducts],
  ["GET", "/api/products/:id", getProduct],
  ["GET", "/api/categories", listCategories],

  ["POST", "/api/auth/signup", signup],
  ["POST", "/api/auth/login", login],
  ["POST", "/api/auth/logout", logout],
  ["GET", "/api/auth/me", me],

  ["POST", "/api/cart/validate", validateCart],

  ["POST", "/api/orders", createOrder],
  ["GET", "/api/orders/mine", myOrders],
  ["GET", "/api/orders/track", trackOrder],

  ["POST", "/api/messages", createMessage],

  ["GET", "/api/admin/stats", adminStats],
  ["GET", "/api/admin/products", adminProducts],
  ["POST", "/api/admin/products", adminCreateProduct],
  ["PUT", "/api/admin/products/:id", adminUpdateProduct],
  ["DELETE", "/api/admin/products/:id", adminDeleteProduct],
  ["GET", "/api/admin/orders", adminOrders],
  ["PATCH", "/api/admin/orders/:id", adminUpdateOrder],
  ["GET", "/api/admin/messages", adminMessages],
  ["PATCH", "/api/admin/messages/:id", adminReadMessage],
];

module.exports = { routes, HttpError, SHIPPING_FEE, FREE_SHIPPING_OVER };
