/**
 * The request handler, shared by both ways of running this app:
 *   - server.js        local development, a normal Node server
 *   - api/[...path].js Vercel, as a serverless function
 */
const fs = require("node:fs");
const path = require("node:path");

const { ready } = require("./db");
const { getUser, purgeExpiredSessions, seedAdmin } = require("./auth");
const { routes, HttpError } = require("./api");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MAX_BODY = 100 * 1024; // 100 KB is plenty for a cart or a form

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/* --------------------------------------------------------------- start-up */

/**
 * Create the tables and the admin account once. On a serverless platform the
 * container can be recycled at any time, so every request waits on this — it
 * only does real work the first time.
 */
let bootPromise = null;
function boot() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await ready();
      await seedAdmin();
      await purgeExpiredSessions();
    })().catch((err) => {
      bootPromise = null; // let the next request try again
      throw err;
    });
  }
  return bootPromise;
}

/* ---------------------------------------------------------------- helpers */

function sendJson(res, status, data, cookies = []) {
  const body = JSON.stringify(data);
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  // Some platforms parse the body for us before the handler runs.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      if (!req.body) return Promise.resolve({});
      try {
        return Promise.resolve(JSON.parse(req.body));
      } catch {
        return Promise.reject(new HttpError(400, "Request body is not valid JSON"));
      }
    }
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Match a pathname against the route table. Literal routes win over `:params`. */
function matchRoute(method, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  let fallback = null;

  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const patternParts = pattern.split("/").filter(Boolean);
    if (patternParts.length !== parts.length) continue;

    const params = {};
    let ok = true;
    let hasParam = false;

    for (let i = 0; i < patternParts.length; i++) {
      const seg = patternParts[i];
      if (seg.startsWith(":")) {
        hasParam = true;
        params[seg.slice(1)] = decodeURIComponent(parts[i]);
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }

    if (!ok) continue;
    if (!hasParam) return { handler, params };
    if (!fallback) fallback = { handler, params };
  }
  return fallback;
}

/* ----------------------------------------------------------------- static */

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, rel);

  // Never serve anything outside public/ — blocks ../../ traversal.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<h1 style="font-family:system-ui;padding:40px">404 — page not found</h1><p style="font-family:system-ui;padding:0 40px"><a href="/">Back to the shop</a></p>');
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------------------------------------------------------- handler */

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

  const cookies = [];
  try {
    await boot();

    const route = matchRoute(req.method, pathname);
    if (!route) throw new HttpError(404, "Unknown API endpoint");

    const ctx = {
      req,
      res,
      params: route.params,
      query: Object.fromEntries(url.searchParams),
      body: ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {},
      user: await getUser(req),
      setCookie: (c) => cookies.push(c),
    };

    const data = await route.handler(ctx);
    sendJson(res, 200, data, cookies);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message }, cookies);
    } else {
      console.error(`✖ ${req.method} ${pathname}`, err);
      sendJson(res, 500, { error: "Something went wrong on the server" });
    }
  }
}

module.exports = { handler, boot };
