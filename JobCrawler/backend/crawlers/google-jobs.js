const { ApifyClient } = require('apify-client');
const Job = require('../models/Job');
const User = require('../models/User');
const { shouldStoreJob } = require('../utils/crawl-filter');
const { companies } = require('../config/companies');
const logger = require('../utils/logger');
const {
  GOOGLE_JOBS_PAGES_PER_QUERY,
  GOOGLE_JOBS_DATE_POSTED,
  GOOGLE_JOBS_DELAY_BETWEEN_QUERIES_MS,
} = require('../config/constants');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const GOOGLE_JOBS_ACTOR = 'orgupdate/google-jobs-scraper';

// Normalize company names for matching against our configured companies
// e.g., "Google LLC" → "google", "Meta Platforms, Inc." → "meta"
const COMPANY_NAME_ALIASES = {
  'google llc': 'google',
  'google inc': 'google',
  'alphabet': 'google',
  'microsoft corporation': 'microsoft',
  'amazon.com': 'amazon',
  'amazon web services': 'amazon',
  'aws': 'amazon',
  'apple inc': 'apple',
  'meta platforms': 'meta',
  'facebook': 'meta',
  'netflix inc': 'netflix',
  'nvidia corporation': 'nvidia',
  'adobe inc': 'adobe',
  'adobe systems': 'adobe',
  'salesforce inc': 'salesforce',
  'salesforce.com': 'salesforce',
  'intel corporation': 'intel',
  'paypal holdings': 'paypal',
  'uber technologies': 'uber',
  'stripe inc': 'stripe',
  'cloudflare inc': 'cloudflare',
  'twilio inc': 'twilio',
  'atlassian corporation': 'atlassian',
  'zoom video communications': 'zoom',
  'snowflake inc': 'snowflake',
  'databricks inc': 'databricks',
  'intuit inc': 'intuit',
  'hubspot inc': 'hubspot',
  'broadcom inc': 'vmware',
  'flipkart internet': 'flipkart',
  'swiggy': 'swiggy',
  'zomato limited': 'zomato',
  'phonepe': 'phonepe',
  'razorpay': 'razorpay',
};

// Set of configured company keys — used to match and prefer our tracked companies
const configuredCompanyKeys = new Set(Object.keys(companies));

// Build a reverse lookup: display name → company key for quick matching
const displayNameToKey = {};
for (const [key, config] of Object.entries(companies)) {
  displayNameToKey[config.displayName.toLowerCase()] = key;
}

/**
 * Normalize a company name from Google Jobs to a lowercase key.
 * Returns the matched config key if found, otherwise a sanitized name.
 */
function normalizeCompanyName(rawName) {
  if (!rawName) return 'unknown';
  const lower = rawName.toLowerCase().trim();

  // Check aliases first
  for (const [alias, key] of Object.entries(COMPANY_NAME_ALIASES)) {
    if (lower.includes(alias)) return key;
  }

  // Check exact display name match
  if (displayNameToKey[lower]) return displayNameToKey[lower];

  // Check if it directly matches a configured company key
  const sanitized = lower.replace(/[^a-z0-9]/g, '');
  for (const key of configuredCompanyKeys) {
    if (sanitized.includes(key) || key.includes(sanitized)) return key;
  }

  // New company not in our config — generate a clean key
  return lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Build search queries from aggregated user preferences.
 * Generates (role × location) combinations, deduped and capped.
 */
async function buildSearchQueries() {
  const users = await User.find({ resumeText: { $ne: '' } }).lean();

  if (users.length === 0) {
    // Default searches if no users yet
    return [{ includeKeyword: 'software engineer', locationName: 'India' }];
  }

  const targetRoles = [...new Set(users.flatMap((u) => u.targetRoles || []))];
  const locations = [...new Set(users.flatMap((u) => u.preferredLocations || []))];

  // If no locations specified, use a broad default
  const searchLocations = locations.length > 0 ? locations : ['India'];

  const queries = [];
  const seen = new Set();

  for (const role of targetRoles) {
    for (const location of searchLocations) {
      const key = `${role.toLowerCase()}|${location.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      queries.push({
        includeKeyword: role,
        locationName: location,
      });
    }
  }

  // Cap to avoid excessive API calls
  const MAX_QUERIES = 10;
  if (queries.length > MAX_QUERIES) {
    logger.info(`[GoogleJobs] Capping queries from ${queries.length} to ${MAX_QUERIES}`);
    return queries.slice(0, MAX_QUERIES);
  }

  return queries;
}

/**
 * Run a single Google Jobs search via the Apify actor.
 * @param {object} query - { includeKeyword, locationName, countryName? }
 * @returns {Array} Raw job results from the actor
 */
async function runGoogleJobsSearch(query) {
  const input = {
    includeKeyword: query.includeKeyword,
    locationName: query.locationName || '',
    countryName: query.countryName || 'india',
    datePosted: GOOGLE_JOBS_DATE_POSTED,
    pagesToFetch: GOOGLE_JOBS_PAGES_PER_QUERY,
  };

  logger.info(`[GoogleJobs] Searching: "${input.includeKeyword}" in "${input.locationName}" (${input.datePosted})`);

  const run = await client.actor(GOOGLE_JOBS_ACTOR).call(input, {
    waitSecs: 120,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items || [];
}

/**
 * Process raw Google Jobs results and store new jobs.
 * Accepts all companies — configured ones get matched to existing keys,
 * others are stored with generated keys for discovery.
 * @param {Array} rawJobs - Raw results from Google Jobs actor
 * @returns {{ newJobs: number, updatedJobs: number, newJobIds: Array, skippedFilter: number }}
 */
async function processGoogleJobsResults(rawJobs) {
  let newJobs = 0;
  let updatedJobs = 0;
  let skippedFilter = 0;
  const newJobIds = [];

  // Batch-load known Google Jobs external IDs for dedup
  const knownGoogleJobs = await Job.find(
    { atsType: 'google-jobs' },
    { externalId: 1, company: 1 }
  ).lean();
  const knownIds = new Set(knownGoogleJobs.map((j) => `${j.company}:${j.externalId}`));

  for (const raw of rawJobs) {
    // Map fields from Google Jobs output to our format
    // The actor output uses both camelCase and snake_case depending on version
    const title = raw.job_title || raw.jobTitle || '';
    const companyName = raw.company_name || raw.companyName || '';
    const location = raw.location || '';
    const url = raw.URL || raw.jobUrl || raw.url || '';
    const salary = raw.salary || '';
    const postedVia = raw.posted_via || raw.postedVia || '';
    const dateStr = raw.date || raw.postedDate || '';
    const description = raw.description || '';
    const jobType = raw.job_type || raw.jobType || '';

    if (!title || !url) continue;

    // Normalize company name to a key
    const companyKey = normalizeCompanyName(companyName);

    // Generate stable external ID from URL
    const externalId = Buffer.from(url).toString('base64').slice(0, 64);
    const dedupKey = `${companyKey}:${externalId}`;

    if (knownIds.has(dedupKey)) {
      updatedJobs++;
      continue;
    }

    // Apply user preference filter (role + location)
    if (!(await shouldStoreJob(title, location))) {
      skippedFilter++;
      continue;
    }

    // Parse posted date
    let postedAt = null;
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        postedAt = parsed;
      }
    }

    // Use the configured display name for known companies, raw name for new ones
    const displayName = (configuredCompanyKeys.has(companyKey) && companies[companyKey]?.displayName)
      || companyName || companyKey;

    try {
      const created = await Job.create({
        externalId,
        company: companyKey,
        companyDisplayName: displayName,
        atsType: 'google-jobs',
        title,
        description,
        descriptionHtml: '',
        location,
        url,
        postedAt: postedAt || new Date(),
        discoveredAt: new Date(),
        isActive: true,
        metadata: {
          department: '',
          workplaceType: jobType || '',
          seniorityLevel: '',
          reqId: '',
          postedVia: postedVia || '',
          salary: salary || '',
        },
      });
      newJobs++;
      newJobIds.push(created._id);
      knownIds.add(dedupKey); // Prevent in-batch duplicates
    } catch (err) {
      if (err.code !== 11000) {
        // Not a duplicate error
        logger.error(`[GoogleJobs] Error saving job: ${title} at ${displayName}`, { error: err.message });
      }
    }
  }

  return { newJobs, updatedJobs, newJobIds, skippedFilter };
}

/**
 * Main entry: run the Google Jobs discovery crawl.
 * Builds queries from user preferences, runs searches, stores results.
 * @returns {{ newJobs: number, updatedJobs: number, newJobIds: Array }}
 */
async function crawlGoogleJobs() {
  logger.info('[GoogleJobs] Starting Google Jobs discovery crawl');

  const queries = await buildSearchQueries();
  logger.info(`[GoogleJobs] Generated ${queries.length} search queries`);

  let totalNew = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const allNewJobIds = [];

  for (const query of queries) {
    try {
      const rawJobs = await runGoogleJobsSearch(query);
      logger.info(`[GoogleJobs] "${query.includeKeyword}" in "${query.locationName}": ${rawJobs.length} results`);

      if (rawJobs.length === 0) continue;

      const result = await processGoogleJobsResults(rawJobs);
      totalNew += result.newJobs;
      totalUpdated += result.updatedJobs;
      totalSkipped += result.skippedFilter;
      allNewJobIds.push(...result.newJobIds);

      // Delay between queries to avoid rate limiting
      if (GOOGLE_JOBS_DELAY_BETWEEN_QUERIES_MS > 0) {
        await new Promise((r) => setTimeout(r, GOOGLE_JOBS_DELAY_BETWEEN_QUERIES_MS));
      }
    } catch (err) {
      logger.error(`[GoogleJobs] Search failed for "${query.includeKeyword}" in "${query.locationName}"`, {
        error: err.message,
      });
      // Continue with other queries — don't let one failure kill the whole crawl
    }
  }

  logger.info(
    `[GoogleJobs] Complete: ${totalNew} new, ${totalUpdated} existing, ${totalSkipped} skipped (filtered by role/location)`
  );

  return { newJobs: totalNew, updatedJobs: totalUpdated, newJobIds: allNewJobIds };
}

module.exports = { crawlGoogleJobs, buildSearchQueries, normalizeCompanyName };
