# Noor Fashion

A small e-commerce website for a modest-wear brand: a storefront, customer
accounts, a checkout that records real orders, and an admin panel.

The database is **libSQL** (SQLite). Locally it is just a file on disk; in
production it is a hosted [Turso](https://turso.tech) database. The same code
runs in both places — only two environment variables change.

---

## Running it locally

Needs **Node.js 18 or newer**.

```bash
npm install
npm start
```

Then open:

| | |
|---|---|
| Shop | http://localhost:4000 |
| Admin panel | http://localhost:4000/admin.html |

The first start creates `data/noor.db`, fills it with 12 sample products, and
creates the admin account.

To use a different port: `PORT=5000 npm start`
While editing, `npm run dev` restarts on file changes.

### Admin login

```
admin@noorfashion.pk / admin123
```

Change this before anyone else can reach the site — see the environment
variables below.

---

## Deploying to Vercel

The app is already shaped for Vercel: `public/` is served as static files and
everything under `/api/` runs as one serverless function
(`api/[...path].js`).

**A serverless function has no disk it can write to, so it cannot use a local
SQLite file.** You need a hosted database. Turso is SQLite, so no queries
change.

### 1. Create the Turso database

```bash
curl -sSfL https://get.tur.so/install.sh | bash   # install the CLI
turso auth signup                                  # or: turso auth login
turso db create noor-fashion

turso db show noor-fashion --url                   # -> libsql://...
turso db tokens create noor-fashion                # -> the auth token
```

### 2. Add the environment variables in Vercel

Project → **Settings → Environment Variables**. Add all four for
*Production*, *Preview* and *Development*:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | the `libsql://…` URL from step 1 |
| `TURSO_AUTH_TOKEN` | the token from step 1 |
| `ADMIN_EMAIL` | the email you want to log in to the admin panel with |
| `ADMIN_PASSWORD` | a long password you choose |

### 3. Redeploy

Push to `main`, or hit **Redeploy** in Vercel. On the first request the app
creates its tables, adds the sample products, and creates the admin account
from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

> If `TURSO_DATABASE_URL` is missing, the app falls back to a local file — on
> Vercel that fails with `FUNCTION_INVOCATION_FAILED`, because the filesystem
> is read-only. A crash right after deploying almost always means the
> environment variables are not set.

---

## What it does

**For customers**

- Browse products, filter by category, search, and sort by price or name
- See stock levels — low-stock warnings and sold-out pieces
- Add to cart; the cart survives a page refresh
- Create an account and log in
- Checkout form that records a real order (Cash on Delivery)
- Free delivery over Rs. 5,000, otherwise Rs. 250
- "My orders" for logged-in customers
- Track any order with its order number plus the phone number used
- Contact form that saves messages for the shop owner
- Optional "Order on WhatsApp" button

**For the shop owner (admin panel)**

- Dashboard: orders, revenue, pending orders, low stock, unread messages
- Add, edit and remove products, including stock and the colour shades used
  for each product's placeholder image
- See every order with the customer's contact and delivery details
- Move an order through pending → confirmed → shipped → delivered / cancelled
- Read contact-form messages

---

## Project structure

```
server.js            local dev server — only listens on a port
api/[...path].js     the same app as a Vercel serverless function
lib/handler.js       routing, static files, request handling
lib/db.js            database connection, schema and sample products
lib/auth.js          password hashing and login sessions
lib/api.js           all API endpoints
public/              everything the browser loads
  index.html           the shop
  script.js            shop logic
  style.css            shared styles
  admin.html           admin panel
  admin.js             admin logic
  admin.css            admin-only styles
scripts/reset-db.js  deletes the local database
data/noor.db         the local database (created on first run, never committed)
```

Only files inside `public/` are served to the browser, so the database and the
server code are never reachable over HTTP.

---

## How the important parts work

**Prices and stock are decided by the server, never by the browser.** The cart
in the browser only stores product ids and quantities. Every time the cart
changes, the page asks the server to price it (`POST /api/cart/validate`), and
the order endpoint prices it again before saving. Editing prices in devtools
changes nothing.

**Stock cannot go negative.** Orders are written inside a transaction, and each
item is reserved with `UPDATE products SET stock = stock - ? WHERE id = ? AND
stock >= ?`. If that does not match a row, the whole order is rolled back.

**Passwords** are hashed with scrypt and a per-user random salt — the plain
password is never stored. Logging in creates a session token stored in an
HttpOnly cookie, which also gets the `Secure` flag in production.

**Removing a product** hides it rather than deleting it, so past orders keep
their history.

---

## Resetting the local data

```bash
npm run reset-db
npm start
```

This deletes `data/noor.db` and rebuilds it with the sample products. It does
not touch the Turso database — for that, use `turso db shell`.

---

## Still to do before taking real orders

1. Put your real WhatsApp number in `public/script.js` (`WHATSAPP_NUMBER`) if
   you want that button to work.
2. Replace the coloured placeholder blocks with real product photos.
3. Add rate limiting on login and checkout.
4. Use a real payment gateway if you want online payments — this project only
   handles Cash on Delivery.

Never put API keys or database tokens in files under `public/` — the browser
downloads everything in that folder. They belong in environment variables.
