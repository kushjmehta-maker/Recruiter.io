/**
 * Sanitize request inputs to prevent NoSQL injection.
 * Strips any keys starting with $ from query params and body.
 */
function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    clean[key] = typeof value === 'object' ? sanitize(value) : value;
  }
  return clean;
}

function sanitizeInput(req, res, next) {
  if (req.query) req.query = sanitize(req.query);
  if (req.body && typeof req.body === 'object') req.body = sanitize(req.body);
  next();
}

module.exports = { sanitizeInput };
