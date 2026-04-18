const Job = require('../models/Job');
const { htmlToText } = require('../utils/html-to-text');
const { shouldStoreJob } = require('../utils/crawl-filter');
const logger = require('../utils/logger');

/**
 * Crawl a Lever job board.
 * @param {string} companyKey - key from companies.js
 * @param {object} config - { slug, displayName }
 * @returns {{ newJobs: number, updatedJobs: number }}
 */
async function crawlLever(companyKey, config) {
  const { slug, displayName } = config;
  logger.info(`[Lever] Crawling ${displayName} (slug: ${slug})`);

  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);

  if (!res.ok) {
    throw new Error(`Lever failed for ${slug}: ${res.status}`);
  }

  const postings = await res.json();
  logger.info(`[Lever] ${displayName}: found ${postings.length} postings`);

  // Differential crawling: batch-load known externalIds
  const knownJobs = await Job.find(
    { company: companyKey },
    { externalId: 1 }
  ).lean();
  const knownIds = new Set(knownJobs.map((j) => j.externalId));

  let newJobs = 0;
  let updatedJobs = 0;
  const newJobIds = [];

  for (const posting of postings) {
    const externalId = posting.id;

    if (knownIds.has(externalId)) {
      await Job.updateOne(
        { company: companyKey, externalId },
        { title: posting.text, isActive: true }
      );
      updatedJobs++;
      continue;
    }

    // Filter: only store jobs matching user preferences (role + location)
    if (!(await shouldStoreJob(posting.text, posting.categories?.location || ''))) {
      continue;
    }

    const descriptionHtml = (posting.descriptionPlain || '') +
      (posting.lists || []).map((l) => `\n${l.text}\n${l.content}`).join('');

    try {
      const created = await Job.create({
        externalId,
        company: companyKey,
        companyDisplayName: displayName,
        atsType: 'lever',
        title: posting.text,
        description: posting.descriptionPlain || htmlToText(posting.description || ''),
        descriptionHtml: posting.description || '',
        location: posting.categories?.location || '',
        url: posting.hostedUrl || posting.applyUrl || '',
        postedAt: posting.createdAt ? new Date(posting.createdAt) : new Date(),
        discoveredAt: new Date(),
        isActive: true,
        metadata: {
          department: posting.categories?.department || '',
          workplaceType: posting.categories?.commitment || '',
          seniorityLevel: posting.categories?.level || '',
        },
      });
      newJobs++;
      newJobIds.push(created._id);
    } catch (err) {
      if (err.code === 11000) {
        updatedJobs++;
      } else {
        logger.error(`[Lever] Error saving job`, { error: err.message });
      }
    }
  }

  logger.info(`[Lever] ${displayName}: ${newJobs} new, ${updatedJobs} updated`);
  return { newJobs, updatedJobs, newJobIds };
}

module.exports = { crawlLever };
