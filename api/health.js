/**
 * Diagnostics for a deployment that will not start: GET /api/health
 * Reports what is configured without ever revealing the token itself.
 */
module.exports = async (req, res) => {
  const report = {
    ok: false,
    node: process.version,
    serverless: Boolean(process.env.VERCEL),
    env: {
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL
        ? `set (host: ${String(process.env.TURSO_DATABASE_URL).replace(/^libsql:\/\//, "").split("/")[0]})`
        : "MISSING",
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN
        ? `set (${process.env.TURSO_AUTH_TOKEN.length} chars)`
        : "MISSING",
      ADMIN_EMAIL: process.env.ADMIN_EMAIL ? "set" : "not set (using default)",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? "set" : "not set (using default)",
    },
  };

  try {
    const { db } = require("../lib/db");
    const result = await db.execute("SELECT 1 AS ok");
    report.database = `reachable (${JSON.stringify(result.rows[0])})`;

    const products = await db.execute("SELECT COUNT(*) AS n FROM products");
    report.products = Number(products.rows[0].n);
    report.ok = true;
  } catch (err) {
    report.database = "FAILED";
    report.detail = err.message;
  }

  res.statusCode = report.ok ? 200 : 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(report, null, 2));
};
