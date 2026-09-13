/**
 * Delete the database so the next start rebuilds it with fresh sample data.
 *   npm run reset-db
 */
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "data");
let removed = 0;

for (const file of ["noor.db", "noor.db-wal", "noor.db-shm"]) {
  const full = path.join(dataDir, file);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
    removed++;
  }
}

console.log(
  removed
    ? "Database deleted. Run `npm start` to create a fresh one with sample products."
    : "No database found — nothing to delete."
);
