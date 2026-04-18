const logger = require('../utils/logger');

const API_KEY = process.env.API_KEY;

/**
 * API key authentication middleware.
 * Expects header: x-api-key: <key>
 * Skips auth for health check endpoint.
 */
function apiKeyAuth(req, res, next) {
  // Skip auth for health check
  if (req.path === '/api/health') return next();

  if (!API_KEY) {
    logger.warn('[Auth] API_KEY not set — running without authentication');
    return next();
  }

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
}

module.exports = { apiKeyAuth };
