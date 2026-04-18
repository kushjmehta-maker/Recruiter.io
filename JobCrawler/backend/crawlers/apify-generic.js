const { ApifyClient } = require('apify-client');
const Job = require('../models/Job');
const { htmlToText } = require('../utils/html-to-text');
const { shouldStoreJob } = require('../utils/crawl-filter');
const logger = require('../utils/logger');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Generic page function for Apify web scraper that extracts job listings
const GENERIC_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { request, log, $ } = context;
  const jobs = [];

  // Try common job listing selectors
  const selectors = [
    'a[href*="/job/"]',
    'a[href*="/jobs/"]',
    'a[href*="/position/"]',
    'a[href*="/opening/"]',
    '.job-listing a',
    '.job-card a',
    '.careers-listing a',
    '[data-job-id]',
    '.job-title a',
    '.position-title a',
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => {
      const $el = $(el);
      const title = $el.text().trim() || $el.attr('title') || '';
      const url = $el.attr('href') || '';
      if (title && url && title.length > 3) {
        jobs.push({
          title,
          url: url.startsWith('http') ? url : new URL(url, request.loadedUrl).href,
          location: $el.closest('[class*=job], [class*=position], tr, li').find('[class*=location], [class*=loc]').text().trim() || '',
        });
      }
    });
    if (jobs.length > 0) break;
  }

  return jobs;
}`;

/**
 * Crawl a custom career portal using Apify web scraper.
 * @param {string} companyKey
 * @param {object} config - { displayName, url, apifyConfig }
 * @returns {{ newJobs: number, updatedJobs: number }}
 */
async function crawlApifyGeneric(companyKey, config) {
  const { displayName, apifyConfig } = config;

  if (!apifyConfig?.startUrl) {
    logger.warn(`[Apify] No startUrl configured for ${displayName}`);
    return { newJobs: 0, updatedJobs: 0 };
  }

  logger.info(`[Apify] Crawling ${displayName} via web scraper`);

  // JS-heavy sites that need Puppeteer instead of Cheerio
  const PUPPETEER_SITES = new Set([
    'netflix', 'meta', 'flipkart', 'cred', 'meesho', 'swiggy', 'phonepe',
    'databricks', 'hubspot', 'uber',
  ]);

  try {
    const usePuppeteer = PUPPETEER_SITES.has(companyKey);
    const actorId = usePuppeteer ? 'apify/puppeteer-scraper' : 'apify/cheerio-scraper';
    logger.info(`[Apify] Using ${usePuppeteer ? 'Puppeteer' : 'Cheerio'} for ${displayName}`);

    const run = await client.actor(actorId).call({
      startUrls: [{ url: apifyConfig.startUrl }],
      pageFunction: GENERIC_PAGE_FUNCTION,
      maxCrawlDepth: 1,
      maxPagesPerCrawl: 10,
      proxyConfiguration: { useApifyProxy: true },
      ...(usePuppeteer && { waitUntil: 'networkidle2', preNavigationHooks: '[]' }),
    }, {
      waitSecs: 180,
    });

    // Fetch results from dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    // Flatten — page function may return arrays
    const jobs = items.flat().filter((j) => j.title && j.url);
    logger.info(`[Apify] ${displayName}: extracted ${jobs.length} jobs`);

    // Differential crawling: batch-load known externalIds
    const knownJobs = await Job.find(
      { company: companyKey },
      { externalId: 1 }
    ).lean();
    const knownIds = new Set(knownJobs.map((j) => j.externalId));

    let newJobs = 0;
    let updatedJobs = 0;
    const newJobIds = [];

    for (const job of jobs) {
      // Generate a stable external ID from URL
      const externalId = Buffer.from(job.url).toString('base64').slice(0, 64);

      if (knownIds.has(externalId)) {
        updatedJobs++;
        continue;
      }

      // Filter: only store jobs matching user preferences (role + location)
      if (!(await shouldStoreJob(job.title, job.location || ''))) {
        continue;
      }

      try {
        const created = await Job.create({
          externalId,
          company: companyKey,
          companyDisplayName: displayName,
          atsType: 'custom',
          title: job.title,
          description: job.description || '',
          descriptionHtml: '',
          location: job.location || '',
          url: job.url,
          postedAt: new Date(),
          discoveredAt: new Date(),
          isActive: true,
          metadata: {
            department: job.department || '',
          },
        });
        newJobs++;
        newJobIds.push(created._id);
      } catch (err) {
        if (err.code !== 11000) {
          logger.error(`[Apify] Error saving job for ${displayName}`, { error: err.message });
        }
      }
    }

    logger.info(`[Apify] ${displayName}: ${newJobs} new, ${updatedJobs} updated`);
    return { newJobs, updatedJobs, newJobIds };
  } catch (err) {
    logger.error(`[Apify] Failed to crawl ${displayName}`, { error: err.message });
    throw err;
  }
}

module.exports = { crawlApifyGeneric };
