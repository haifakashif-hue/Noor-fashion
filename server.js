/**
 * Noor Fashion — local development server.
 *
 * The request handling itself lives in lib/handler.js, which is shared with
 * the Vercel function in api/. This file only exists to listen on a port.
 *
 *   npm start                 → http://localhost:4000
 *   PORT=5000 npm start       → http://localhost:5000
 */
const http = require("node:http");

const { handler, boot } = require("./lib/handler");
const { DB_FILE } = require("./lib/db");

const PORT = Number(process.env.PORT) || 4000;

const server = http.createServer(handler);

console.log("Noor Fashion — starting up");
console.log(`   database: ${DB_FILE}`);

boot()
  .then(() => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\n  Shop   →  http://localhost:${PORT}`);
      console.log(`  Admin  →  http://localhost:${PORT}/admin.html\n`);
    });
  })
  .catch((err) => {
    console.error("\n✖ Could not start — the database could not be opened.\n");
    console.error(err.message || err);
    process.exit(1);
  });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n✖ Port ${PORT} is already being used by another program.`);
    console.error(`  Try a different one:  PORT=5000 npm start\n`);
    process.exit(1);
  }
  throw err;
});
