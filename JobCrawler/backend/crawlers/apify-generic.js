const { ApifyClient } = require('apify-client');
const Job = require('../models/Job');
const { htmlToText } = require('../utils/html-to-text');
const { shouldStoreJob } = require('../utils/crawl-filter');
const logger = require('../utils/logger');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// ═══════════════════════════════════════════
// CHEERIO page functions (use jQuery-like $ API)
// Used for server-rendered sites
// ═══════════════════════════════════════════

const GENERIC_CHEERIO_FN = `
async function pageFunction(context) {
  const { request, log, $ } = context;
  const jobs = [];
  const selectors = [
    'a[href*="/job/"]', 'a[href*="/jobs/"]', 'a[href*="/position/"]',
    'a[href*="/opening/"]', '.job-listing a', '.job-card a',
    '.careers-listing a', '[data-job-id]', '.job-title a', '.position-title a',
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

// ═══════════════════════════════════════════
// PUPPETEER page functions (use page.evaluate with native DOM)
// Used for JS-rendered SPAs
// ═══════════════════════════════════════════

const GENERIC_PUPPETEER_FN = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 3000));
  const jobs = await page.evaluate((loadedUrl) => {
    const results = [];
    const selectors = [
      'a[href*="/job/"]', 'a[href*="/jobs/"]', 'a[href*="/position/"]',
      'a[href*="/opening/"]', '.job-listing a', '.job-card a',
      '.careers-listing a', '[data-job-id] a', '.job-title a', '.position-title a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const title = (el.textContent || '').trim().split('\\n')[0].trim();
        const url = el.href || el.getAttribute('href') || '';
        if (title && url && title.length > 3) {
          const card = el.closest('[class*=job], [class*=position], tr, li, [class*=card]');
          const locEl = card ? card.querySelector('[class*=location], [class*=loc]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  }, request.loadedUrl);
  return jobs;
}`;

// ═══════════════════════════════════════════
// Company-specific PUPPETEER page functions
// These target the actual DOM structure of each site
// ═══════════════════════════════════════════

const COMPANY_PUPPETEER_FUNCTIONS = {
  microsoft: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 8000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    // Microsoft job links contain /job/ followed by a job ID
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      if (!url || seen.has(url)) return;
      if (!url.match(/\\/job\\/\\d+/)) return;
      seen.add(url);
      let title = '';
      let location = '';
      // Try link text
      title = el.textContent.trim().split('\\n')[0].trim();
      // Walk up to find container with more info
      const card = el.closest('li') || el.parentElement?.parentElement;
      if (card) {
        if (title.length < 5) {
          const headings = card.querySelectorAll('h2, h3, h4');
          if (headings.length > 0) title = headings[0].textContent.trim();
        }
        // Look for location-like text (contains city/country names or commas)
        const allText = Array.from(card.querySelectorAll('span, p, div'))
          .map(e => e.textContent.trim())
          .filter(t => t.length > 2 && t.length < 100 && t !== title);
        const locText = allText.find(t => t.includes(',') || t.match(/India|Bangalore|Hyderabad|Mumbai|Delhi|Pune|Remote/i));
        if (locText) location = locText;
      }
      if (title && title.length > 3) {
        results.push({ title, url, location });
      }
    });
    return results;
  });
  return jobs;
}`,

  google: `
async function pageFunction(context) {
  const { request, page, log } = context;
  // Google careers is a heavy SPA with obfuscated class names — wait for full render
  await new Promise(r => setTimeout(r, 8000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    // Strategy: find ALL links on the page and filter by job-related URL patterns
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      // Google job links contain /jobs/results/ with a job ID parameter
      if (!url || seen.has(url)) return;
      const isJobLink = url.includes('/jobs/results/') && url.includes('jid=') ||
                        url.match(/\\/jobs\\/results\\/\\d+/) ||
                        url.includes('/about/careers/applications/jobs/results/') && url !== window.location.href;
      if (!isJobLink) return;
      seen.add(url);
      // Walk up the DOM to find the job card container and extract title/location
      let title = '';
      let location = '';
      let container = el;
      // Try the link text first
      title = el.textContent.trim().split('\\n')[0].trim();
      // If the link text is too short or generic, look at the parent container
      if (title.length < 5) {
        const parent = el.closest('li') || el.parentElement?.parentElement;
        if (parent) {
          const texts = Array.from(parent.querySelectorAll('*'))
            .map(e => e.textContent.trim())
            .filter(t => t.length > 5 && t.length < 200);
          if (texts.length > 0) title = texts[0];
          if (texts.length > 1) location = texts[texts.length - 1];
        }
      }
      if (title && title.length > 3) {
        results.push({ title, url, location });
      }
    });
    return results;
  });
  return jobs;
}`,

  amazon: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      '.job-tile a[href*="/jobs/"]',
      'a[href*="/en/jobs/"]',
      '[data-job-id] a',
      '.result-card a',
      '.job-card a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const titleEl = el.querySelector('h3, .job-title, [class*="title"]');
        let title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3) {
          const card = el.closest('.job-tile, .job-card, .result-card, li');
          const locEl = card ? card.querySelector('.location-and-id, [class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  apple: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/en-in/details/"]',
      'a[href*="/en-us/details/"]',
      'a[href*="/details/"]',
      'tbody tr td a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const title = el.textContent.trim();
        const url = el.href || '';
        if (title && url && title.length > 3 && url.includes('/details/')) {
          const row = el.closest('tr, li');
          const cells = row ? row.querySelectorAll('td') : [];
          const location = cells.length >= 3 ? cells[2].textContent.trim() : '';
          results.push({ title, url, location });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  meta: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/jobs/"]',
      'a[href*="/v2/jobs/"]',
      'div[role="listitem"] a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const titleEl = el.querySelector('[class*="title"], [class*="Title"], h2, h3');
        let title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3 && url.includes('/jobs/')) {
          const card = el.closest('[class*="result"], [class*="card"], li, div[role="listitem"]');
          const locEl = card ? card.querySelector('[class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  salesforce: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/en/jobs/"]', 'a[href*="/jobs/"]',
      '.card-job a', '[class*="JobCard"] a', '[data-job] a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const titleEl = el.querySelector('h2, h3, [class*="title"]');
        let title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3) {
          const card = el.closest('.card, [class*="card"], li');
          const locEl = card ? card.querySelector('[class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  // Eightfold platform (PayPal, Nutanix, Micron)
  paypal: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/careers/job/"]', '.position-card a',
      '[class*="position-card"] a', '[data-test="position-card"] a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const titleEl = el.querySelector('h3, h4, [class*="title"], [class*="name"]');
        let title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3) {
          const card = el.closest('[class*="position"], [class*="card"], li');
          const locEl = card ? card.querySelector('[class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  linkedin: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/jobs/"]', '.job-card a',
      '[data-tracking-control-name*="job"] a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const titleEl = el.querySelector('h3, [class*="title"]');
        let title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3) {
          const card = el.closest('.job-card, [class*="card"], li');
          const locEl = card ? card.querySelector('[class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  intuit: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/job/"]', '.job-listing a',
      '[class*="search-result"] a', '.job-innerwrap a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const titleEl = el.querySelector('h2, h3, [class*="title"]');
        let title = titleEl ? titleEl.textContent.trim() : el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3) {
          const card = el.closest('.job-listing, [class*="result"], li');
          const locEl = card ? card.querySelector('[class*="location"], .job-location') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,

  sap: `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 5000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/job/"]', '.jobTitle a', '.job-title a',
      '#search-results-list a[href*="job"]',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const title = el.textContent.trim();
        const url = el.href || '';
        if (title && url && title.length > 3) {
          const row = el.closest('tr, li, [class*="result"]');
          const locEl = row ? row.querySelector('.jobLocation, [class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`,
};

// Reuse eightfold page function for similar platforms
COMPANY_PUPPETEER_FUNCTIONS.nutanix = COMPANY_PUPPETEER_FUNCTIONS.paypal;
COMPANY_PUPPETEER_FUNCTIONS.micron = COMPANY_PUPPETEER_FUNCTIONS.paypal;

// ServiceNow uses Workday under the hood
COMPANY_PUPPETEER_FUNCTIONS.servicenow = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 8000));
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      if (!url.includes('/job/') && !url.includes('/en-US/job/')) return;
      const title = el.textContent.trim().split('\\n')[0].trim();
      if (title && title.length > 3) {
        const card = el.closest('li, [class*="card"], [class*="result"]');
        const locEl = card ? card.querySelector('[class*="location"], [data-automation-id*="location"]') : null;
        results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
      }
    });
    return results;
  });
  return jobs;
}`;

// Qualcomm custom careers portal
COMPANY_PUPPETEER_FUNCTIONS.qualcomm = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 6000));
  const jobs = await page.evaluate(() => {
    const results = [];
    const selectors = [
      'a[href*="/careers/"]', 'a[href*="/job/"]', 'a[href*="/jobs/"]',
      '.job-listing a', '.job-card a', '[class*="JobCard"] a',
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const title = el.textContent.trim().split('\\n')[0].trim();
        const url = el.href || '';
        if (title && url && title.length > 3 && !title.includes('Apply') && !title.includes('Search')) {
          const card = el.closest('li, [class*="card"], [class*="result"], tr');
          const locEl = card ? card.querySelector('[class*="location"]') : null;
          results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
        }
      });
      if (results.length > 0) break;
    }
    return results;
  });
  return jobs;
}`;

// AMD careers portal
COMPANY_PUPPETEER_FUNCTIONS.amd = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 6000));
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      if (!url.match(/\\/job\\/|jobs-home\\/jobs\\/|careers/)) return;
      if (url === window.location.href) return;
      const title = el.textContent.trim().split('\\n')[0].trim();
      if (title && title.length > 5 && title.length < 200 && !title.includes('Search') && !title.includes('Apply Now')) {
        const card = el.closest('li, tr, [class*="card"], [class*="result"]');
        const locEl = card ? card.querySelector('[class*="location"]') : null;
        results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
      }
    });
    return results;
  });
  return jobs;
}`;

// SmartRecruiters-based (Freshworks)
COMPANY_PUPPETEER_FUNCTIONS.freshworks = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 6000));
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href*="/jobs/"]').forEach(el => {
      const url = el.href || '';
      const title = el.textContent.trim().split('\\n')[0].trim();
      if (title && url && title.length > 3 && !title.includes('Jobs')) {
        const card = el.closest('li, [class*="opening"], [class*="result"]');
        const locEl = card ? card.querySelector('[class*="location"], [class*="city"]') : null;
        results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
      }
    });
    return results;
  });
  return jobs;
}`;

// Atlassian (Beamery-based React app)
COMPANY_PUPPETEER_FUNCTIONS.atlassian = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 8000));
  // Scroll to load lazy content
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      window.scrollBy(0, 1000);
      await new Promise(r => setTimeout(r, 1000));
    }
  });
  const jobs = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      if (seen.has(url)) return;
      if (!url.includes('/job/') && !url.includes('/careers/') && !url.includes('/opening/')) return;
      if (url === window.location.href) return;
      seen.add(url);
      const title = el.textContent.trim().split('\\n')[0].trim();
      if (title && title.length > 5 && title.length < 200) {
        const card = el.closest('li, [class*="card"], [class*="result"], tr, div[class]');
        const locEl = card ? card.querySelector('[class*="location"], [class*="loc"]') : null;
        results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
      }
    });
    return results;
  });
  return jobs;
}`;

// Snowflake (Phenom-based)
COMPANY_PUPPETEER_FUNCTIONS.snowflake = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 6000));
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      if (!url.includes('/job/') && !url.includes('/jobs/') && !url.includes('/en/')) return;
      if (url === window.location.href) return;
      const title = el.textContent.trim().split('\\n')[0].trim();
      if (title && title.length > 5 && title.length < 200 && !title.includes('Search') && !title.includes('Home')) {
        const card = el.closest('li, [class*="card"], [class*="result"]');
        const locEl = card ? card.querySelector('[class*="location"]') : null;
        results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
      }
    });
    return results;
  });
  return jobs;
}`;

// HashiCorp (now IBM careers)
COMPANY_PUPPETEER_FUNCTIONS.hashicorp = `
async function pageFunction(context) {
  const { request, page, log } = context;
  await new Promise(r => setTimeout(r, 6000));
  const jobs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a[href]').forEach(el => {
      const url = el.href || '';
      if (!url.includes('/job/') && !url.includes('/careers/')) return;
      if (url === window.location.href) return;
      const title = el.textContent.trim().split('\\n')[0].trim();
      if (title && title.length > 5 && title.length < 200) {
        const card = el.closest('li, [class*="card"], [class*="result"]');
        const locEl = card ? card.querySelector('[class*="location"]') : null;
        results.push({ title, url, location: locEl ? locEl.textContent.trim() : '' });
      }
    });
    return results;
  });
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
  // Most custom career portals are React/Angular SPAs that require JS execution
  const PUPPETEER_SITES = new Set([
    'netflix', 'meta', 'flipkart', 'cred', 'meesho', 'swiggy', 'phonepe',
    'databricks', 'hubspot', 'uber',
    // Major tech portals — all are JS-rendered SPAs
    'microsoft', 'google', 'amazon', 'apple', 'salesforce', 'linkedin',
    'paypal', 'nutanix', 'micron', 'intuit', 'sap',
    // Recently migrated from Workday/Greenhouse — all JS-rendered
    'servicenow', 'qualcomm', 'amd', 'ti', 'freshworks',
    'atlassian', 'snowflake', 'hashicorp',
    // Other JS-rendered portals
    'zoho', 'upstox', 'juspay', 'pinelabs',
    // Greenhouse fallbacks that use Apify
    'zomato', 'dream11', 'browserstack', 'sharechat',
  ]);

  try {
    const usePuppeteer = PUPPETEER_SITES.has(companyKey);
    const actorId = usePuppeteer ? 'apify/puppeteer-scraper' : 'apify/cheerio-scraper';

    // Select page function: company-specific > generic, respecting Puppeteer vs Cheerio API
    const pageFnKey = apifyConfig.pageFunction || companyKey;
    let pageFunction;
    let usingCustomFn = false;

    if (usePuppeteer) {
      pageFunction = COMPANY_PUPPETEER_FUNCTIONS[pageFnKey] || GENERIC_PUPPETEER_FN;
      usingCustomFn = !!COMPANY_PUPPETEER_FUNCTIONS[pageFnKey];
    } else {
      pageFunction = GENERIC_CHEERIO_FN;
      usingCustomFn = false;
    }

    logger.info(`[Apify] Using ${usePuppeteer ? 'Puppeteer' : 'Cheerio'} for ${displayName} (${usingCustomFn ? 'custom' : 'generic'} page function)`);

    const run = await client.actor(actorId).call({
      startUrls: [{ url: apifyConfig.startUrl }],
      pageFunction,
      maxCrawlDepth: 1,
      maxPagesPerCrawl: usingCustomFn ? 25 : 10,
      proxyConfiguration: { useApifyProxy: true },
      ...(usePuppeteer && { waitUntil: ['networkidle2'], preNavigationHooks: '[]' }),
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
