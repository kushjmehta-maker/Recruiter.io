const User = require('../models/User');
const { passesKeywordFilter } = require('../services/relevance-scorer');
const logger = require('../utils/logger');

let cachedFilter = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load aggregated filter criteria from all registered users.
 * Caches for 5 minutes to avoid repeated DB queries during a crawl.
 */
async function getCrawlFilter() {
  if (cachedFilter && (Date.now() - cacheTime) < CACHE_TTL) {
    return cachedFilter;
  }

  const users = await User.find({ resumeText: { $ne: '' } }).lean();

  if (users.length === 0) {
    // No users registered yet — store everything
    cachedFilter = { hasUsers: false, targetRoles: [], locations: [] };
    cacheTime = Date.now();
    return cachedFilter;
  }

  // Aggregate all target roles across users
  const targetRoles = [...new Set(users.flatMap((u) => u.targetRoles || []))];

  // Aggregate all preferred locations across users (empty = no location filter)
  const locations = [...new Set(users.flatMap((u) => u.preferredLocations || []))];

  cachedFilter = { hasUsers: true, targetRoles, locations };
  cacheTime = Date.now();

  logger.info(`[CrawlFilter] Loaded filter: ${targetRoles.length} roles, ${locations.length} locations from ${users.length} users`);
  return cachedFilter;
}

/**
 * Check if a job should be stored based on aggregated user preferences.
 * @param {string} title - Job title
 * @param {string} location - Job location string
 * @returns {boolean}
 */
async function shouldStoreJob(title, location) {
  const filter = await getCrawlFilter();

  // No users registered — store everything (so first user gets jobs)
  if (!filter.hasUsers) return true;

  // Check role match against any user's target roles
  if (!passesKeywordFilter(title, filter.targetRoles)) {
    return false;
  }

  // Check location match (if any user has location preferences)
  if (filter.locations.length > 0 && location) {
    const locRegex = new RegExp(filter.locations.join('|'), 'i');
    if (!locRegex.test(location)) {
      return false;
    }
  }

  return true;
}

/**
 * Clear the cached filter (call when user preferences change).
 */
function clearCrawlFilterCache() {
  cachedFilter = null;
  cacheTime = 0;
}

module.exports = { shouldStoreJob, getCrawlFilter, clearCrawlFilterCache };
