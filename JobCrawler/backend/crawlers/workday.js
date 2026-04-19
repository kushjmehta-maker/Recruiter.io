const Job = require('../models/Job');
const { htmlToText } = require('../utils/html-to-text');
const { shouldStoreJob } = require('../utils/crawl-filter');
const logger = require('../utils/logger');
const { WORKDAY_PAGE_SIZE, WORKDAY_PAGE_DELAY_MS, WORKDAY_DETAIL_DELAY_MS } = require('../config/constants');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Crawl a Workday career site.
 * @param {string} companyKey - key from companies.js
 * @param {object} config - { host, org, site, displayName }
 * @returns {{ newJobs: number, updatedJobs: number }}
 */
async function crawlWorkday(companyKey, config) {
  const { host, org, site, displayName } = config;
  const baseUrl = `https://${host}.myworkdayjobs.com/wday/cxs/${org}/${site}`;
  logger.info(`[Workday] Crawling ${displayName} (${host}/${site})`);

  // Differential crawling: batch-load all known externalIds for this company
  const knownJobs = await Job.find(
    { company: companyKey },
    { externalId: 1 }
  ).lean();
  const knownIds = new Set(knownJobs.map((j) => j.externalId));

  let offset = 0;
  let total = 0;
  let newJobs = 0;
  let updatedJobs = 0;
  let firstPage = true;
  const newJobIds = [];

  do {
    const res = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: WORKDAY_PAGE_SIZE, offset }),
    });

    if (!res.ok) {
      throw new Error(`Workday list failed for ${displayName}: ${res.status}`);
    }

    const data = await res.json();
    if (firstPage) {
      total = data.total || 0;
      logger.info(`[Workday] ${displayName}: ${total} total jobs`);
      firstPage = false;
    }

    const postings = data.jobPostings || [];
    if (postings.length === 0) break;

    for (const posting of postings) {
      const externalId = posting.bulletFields?.[0] || posting.externalPath || String(offset);
      const externalPath = posting.externalPath;

      if (knownIds.has(externalId)) {
        await Job.updateOne(
          { company: companyKey, externalId },
          { title: posting.title, location: posting.locationsText, isActive: true }
        );
        updatedJobs++;
        continue;
      }

      // Filter: only store jobs matching user preferences (role + location)
      if (!(await shouldStoreJob(posting.title, posting.locationsText || ''))) {
        continue;
      }

      // Store listing info only (skip detail fetch for speed)
      try {
        const created = await Job.create({
          externalId,
          company: companyKey,
          companyDisplayName: displayName,
          atsType: 'workday',
          title: posting.title,
          description: '',
          descriptionHtml: '',
          location: posting.locationsText || '',
          url: `https://${host}.myworkdayjobs.com/en-US/${site}/job/${externalPath}`,
          postedAt: posting.postedOn && !isNaN(new Date(posting.postedOn).getTime())
            ? new Date(posting.postedOn) : new Date(),
          discoveredAt: new Date(),
          isActive: true,
          metadata: {},
        });
        newJobs++;
        newJobIds.push(created._id);
      } catch (err) {
        if (err.code === 11000) {
          updatedJobs++;
        } else {
          logger.error(`[Workday] Error saving job`, { error: err.message });
        }
      }
    }

    offset += WORKDAY_PAGE_SIZE;
    await delay(WORKDAY_PAGE_DELAY_MS);
  } while (offset < total);

  logger.info(`[Workday] ${displayName}: ${newJobs} new, ${updatedJobs} updated`);
  return { newJobs, updatedJobs, newJobIds };
}

module.exports = { crawlWorkday };
