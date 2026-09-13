/**
 * Vercel serverless entry point. Everything under /api/ arrives here; the
 * static pages in public/ are served by Vercel itself.
 *
 * The app is loaded inside the handler rather than at the top of the file so
 * that a start-up problem (a missing database URL, a module that will not
 * load) comes back as a readable JSON error instead of an opaque
 * FUNCTION_INVOCATION_FAILED page.
 */
let handler = null;
let loadError = null;

try {
  ({ handler } = require("../lib/handler"));
} catch (err) {
  loadError = err;
}

module.exports = (req, res) => {
  if (loadError) {
    console.error("Start-up failed:", loadError);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify({
        error: "The server could not start",
        detail: loadError.message,
      })
    );
  }
  return handler(req, res);
};
