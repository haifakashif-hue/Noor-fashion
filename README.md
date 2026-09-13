# Noor Fashion

A small e-commerce website for a modest-wear brand: a storefront, customer
accounts, a checkout that records real orders, and an admin panel — all backed
by a local SQLite database.

**There are no npm packages to install.** The server uses only what ships with
Node, including Node's built-in SQLite.

---

## Running it

You need **Node.js 22.5 or newer** (`node -v` to check).

```bash
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

While editing, `npm run dev` restarts the server automatically on file changes.

### Admin login

```
admin@noorfashion.pk / admin123
```

Change this before anyone else can reach the site. Set your own values the
first time you start the app (before the database is created):

```bash
ADMIN_EMAIL=you@yourshop.pk ADMIN_PASSWORD='a-long-password' npm start
```

If the database already exists, delete it first with `npm run reset-db`.

---

## What it does

**For customers**

- Browse products, filter by category, search, and sort by price or name
- See stock levels — low stock warnings and sold-out pieces
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
server.js          HTTP server, routing, static files
lib/db.js          database schema and the sample products
lib/auth.js        password hashing and login sessions
lib/api.js         all API endpoints
public/            everything the browser loads
  index.html         the shop
  script.js          shop logic
  style.css          shared styles
  admin.html         admin panel
  admin.js           admin logic
  admin.css          admin-only styles
scripts/reset-db.js  wipes the database
data/noor.db       the database itself (created on first run)
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

**Stock cannot go negative.** Orders are written inside a database transaction,
and each item is reserved with `UPDATE products SET stock = stock - ? WHERE id
= ? AND stock >= ?`. If that does not match a row, the whole order is rolled
back.

**Passwords** are hashed with scrypt and a per-user random salt — the plain
password is never stored. Logging in creates a session token stored in an
HttpOnly cookie.

**Removing a product** hides it rather than deleting it, so past orders keep
their history.

---

## Resetting the data

```bash
npm run reset-db
npm start
```

This deletes `data/noor.db` and rebuilds it with the sample products.

---

## Before putting this online

This runs on `localhost` and is built for learning. To take it live you would
need to:

1. Put your real WhatsApp number in `public/script.js` (`WHATSAPP_NUMBER`) if
   you want that button to work.
2. Change the admin email and password.
3. Replace the coloured placeholder blocks with real product photos.
4. Serve it over HTTPS, and add the `Secure` flag to the session cookie in
   `lib/auth.js`.
5. Add rate limiting on login and checkout.
6. Use a real payment gateway if you want online payments — this project only
   handles Cash on Delivery.
7. Back up `data/noor.db`; it holds every order and customer account.

Never put API keys, database passwords, or other secrets in files under
`public/` — the browser downloads everything in that folder.
