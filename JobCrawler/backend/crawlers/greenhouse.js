const Job = require('../models/Job');
const { htmlToText } = require('../utils/html-to-text');
const { shouldStoreJob } = require('../utils/crawl-filter');
const logger = require('../utils/logger');
const { GREENHOUSE_DELAY_MS } = require('../config/constants');

const GREENHOUSE_API = 'https://boards-api.greenhouse.io/v1/boards';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Crawl a Greenhouse job board.
 * @param {string} companyKey - key from companies.js
 * @param {object} config - company config with slug, displayName
 * @returns {{ newJobs: number, updatedJobs: number }}
 */
async function crawlGreenhouse(companyKey, config) {
  const { slug, displayName } = config;
  logger.info(`[Greenhouse] Crawling ${displayName} (slug: ${slug})`);

  // 1. Fetch all jobs list
  const listUrl = `${GREENHOUSE_API}/${slug}/jobs`;
  const res = await fetch(listUrl);

  if (!res.ok) {
    throw new Error(`Greenhouse list failed for ${slug}: ${res.status}`);
  }

  const data = await res.json();
  const jobs = data.jobs || [];
  logger.info(`[Greenhouse] ${displayName}: found ${jobs.length} jobs`);

  if (jobs.length === 0) {
    return { newJobs: 0, updatedJobs: 0, newJobIds: [] };
  }

  // Differential crawling: batch-load all known externalIds for this company
  const knownJobs = await Job.find(
    { company: companyKey },
    { externalId: 1 }
  ).lean();
  const knownIds = new Set(knownJobs.map((j) => j.externalId));

  let newJobs = 0;
  let updatedJobs = 0;
  const newJobIds = [];

  for (const job of jobs) {
    const externalId = String(job.id);

    if (knownIds.has(externalId)) {
      // Bulk-update metadata for known jobs (skip detail fetch)
      await Job.updateOne(
        { company: companyKey, externalId },
        { title: job.title, location: job.location?.name || '', url: job.absolute_url, isActive: true }
      );
      updatedJobs++;
      continue;
    }

    // Filter: only store jobs matching user preferences (role + location)
    const jobLocation = job.location?.name || '';
    if (!(await shouldStoreJob(job.title, jobLocation))) {
      continue;
    }

    // 2. Fetch full job detail only for NEW relevant jobs
    let description = '';
    let descriptionHtml = '';
    try {
      await delay(GREENHOUSE_DELAY_MS);
      const detailRes = await fetch(`${GREENHOUSE_API}/${slug}/jobs/${job.id}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        descriptionHtml = detail.content || '';
        description = htmlToText(descriptionHtml);
      }
    } catch (err) {
      logger.warn(`[Greenhouse] Failed to fetch detail for ${displayName} job ${job.id}`, { error: err.message });
    }

    const department = job.departments?.map((d) => d.name).join(', ') || '';

    try {
      const created = await Job.create({
        externalId,
        company: companyKey,
        companyDisplayName: displayName,
        atsType: 'greenhouse',
        title: job.title,
        description,
        descriptionHtml,
        location: job.location?.name || '',
        url: job.absolute_url,
        postedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
        discoveredAt: new Date(),
        isActive: true,
        metadata: {
          department,
          reqId: job.requisition_id || '',
        },
      });
      newJobs++;
      newJobIds.push(created._id);
    } catch (err) {
      if (err.code === 11000) {
        updatedJobs++;
      } else {
        logger.error(`[Greenhouse] Error saving job ${externalId}`, { error: err.message });
      }
    }
  }

  logger.info(`[Greenhouse] ${displayName}: ${newJobs} new, ${updatedJobs} updated`);
  return { newJobs, updatedJobs, newJobIds };
}

module.exports = { crawlGreenhouse };
