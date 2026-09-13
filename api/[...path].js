/**
 * Vercel serverless entry point. Everything under /api/ arrives here; the
 * static pages in public/ are served by Vercel itself.
 */
const { handler } = require("../lib/handler");

module.exports = handler;
