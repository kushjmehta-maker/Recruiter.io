const { companies } = require('../config/companies');
const { CRAWL_BATCH_SIZE } = require('../config/constants');
const { crawlGreenhouse } = require('./greenhouse');
const { crawlWorkday } = require('./workday');
const { crawlLever } = require('./lever');
const { crawlApifyGeneric } = require('./apify-generic');
const { crawlGoogleJobs } = require('./google-jobs');
const { extractRecruiter } = require('./recruiter-extractor');
const { scoreJobsForUser } = require('../services/relevance-scorer');
const { sendAlertForUser } = require('../services/email-service');
const CrawlRun = require('../models/CrawlRun');
const Job = require('../models/Job');
const User = require('../models/User');
const logger = require('../utils/logger');

const crawlerMap = {
  greenhouse: crawlGreenhouse,
  workday: crawlWorkday,
  lever: crawlLever,
  custom: crawlApifyGeneric,
};

/**
 * Crawl a single company, with fallback to Apify for failed ATS crawls.
 */
async function crawlCompany(key, config) {
  const crawler = crawlerMap[config.ats];
  if (!crawler) {
    throw new Error(`No crawler for ATS type: ${config.ats}`);
  }

  try {
    const result = await crawler(key, config);

    // If ATS crawler returned 0 and fallback is configured, try Apify
    if (result.newJobs === 0 && result.updatedJobs === 0 && config.fallbackToApify) {
      logger.info(`[Orchestrator] ${config.displayName}: ATS returned 0, falling back to Apify`);
      return await crawlApifyGeneric(key, { ...config, ats: 'custom' });
    }

    return result;
  } catch (err) {
    if (config.fallbackToApify) {
      logger.warn(`[Orchestrator] ${config.displayName}: primary crawler failed, falling back to Apify`, { error: err.message });
      try {
        return await crawlApifyGeneric(key, { ...config, ats: 'custom' });
      } catch (fallbackErr) {
        logger.error(`[Orchestrator] ${config.displayName}: Apify fallback also failed`, { error: fallbackErr.message });
        throw fallbackErr;
      }
    }
    throw err;
  }
}

/**
 * Run recruiter extraction on newly discovered jobs that don't have recruiter info.
 */
async function enrichRecruiters(newJobIds) {
  const filter = newJobIds?.length
    ? { _id: { $in: newJobIds }, description: { $ne: '' } }
    : { 'recruiter.email': '', 'recruiter.source': { $ne: 'posting' }, description: { $ne: '' } };

  const jobs = await Job.find(filter).limit(500);

  let enriched = 0;
  for (const job of jobs) {
    const recruiter = extractRecruiter(job.description, job.company);
    if (recruiter.email || recruiter.linkedinUrl) {
      await Job.updateOne({ _id: job._id }, { recruiter });
      enriched++;
    }
  }
  logger.info(`[Recruiter] Enriched ${enriched}/${jobs.length} jobs with recruiter info`);
}

/**
 * Inline scoring + alerting: score new jobs for all users immediately after a company crawl,
 * then fire alerts for users who have 75%+ matches.
 * @param {Array} newJobIds - MongoDB _ids of newly discovered jobs
 */
async function scoreAndAlertForNewJobs(newJobIds) {
  if (!newJobIds || newJobIds.length === 0) return;

  const users = await User.find({ resumeText: { $ne: '' } });
  if (users.length === 0) return;

  const newJobs = await Job.find({ _id: { $in: newJobIds } });

  for (const user of users) {
    // Score the new jobs for this user
    const { scored } = await scoreJobsForUser(user, newJobIds);
    logger.info(`[Inline] Scored ${scored} new jobs for ${user.email}`);

    if (scored === 0) continue;

    // Reload jobs with fresh scores
    const scoredJobs = await Job.find({ _id: { $in: newJobIds } });

    // Check if any meet the alert threshold and try to send alert
    const highMatches = scoredJobs.filter((job) => {
      const userScore = job.relevanceScores?.find(
        (s) => s.userId.toString() === user._id.toString()
      );
      return (userScore?.score || 0) >= user.alertThreshold;
    });

    if (highMatches.length > 0) {
      await sendAlertForUser(user, highMatches);
    }
  }
}

/**
 * Main orchestration: crawl all or specific companies in batches.
 * Now with inline scoring + alerting after each batch.
 * @param {object} options - { companyKeys?: string[], atsTypes?: string[] }
 * @returns {CrawlRun}
 */
async function runCrawl(options = {}) {
  const crawlRun = await CrawlRun.create({ startedAt: new Date() });
  logger.info(`[Orchestrator] Starting crawl run ${crawlRun._id}`);

  // Filter companies based on options
  let entries = Object.entries(companies);
  if (options.companyKeys?.length) {
    entries = entries.filter(([key]) => options.companyKeys.includes(key));
  }
  if (options.atsTypes?.length) {
    entries = entries.filter(([, config]) => options.atsTypes.includes(config.ats));
  }

  // Split into API-based (can batch) and custom/Apify (must serialize to avoid memory limit)
  const apiEntries = entries.filter(([, c]) => c.ats !== 'custom');
  const customEntries = entries.filter(([, c]) => c.ats === 'custom');

  let totalNew = 0;
  let totalUpdated = 0;
  let companiesCrawled = 0;

  // Process API-based crawlers in batches (Greenhouse, Workday, Lever)
  for (let i = 0; i < apiEntries.length; i += CRAWL_BATCH_SIZE) {
    const batch = apiEntries.slice(i, i + CRAWL_BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(([key, config]) => crawlCompany(key, config))
    );

    // Collect all new job IDs from this batch for inline scoring
    const batchNewJobIds = [];

    for (let j = 0; j < results.length; j++) {
      const [key, config] = batch[j];
      const result = results[j];

      if (result.status === 'fulfilled') {
        totalNew += result.value.newJobs;
        totalUpdated += result.value.updatedJobs;
        companiesCrawled++;
        if (result.value.newJobIds?.length) {
          batchNewJobIds.push(...result.value.newJobIds);
        }
      } else {
        logger.error(`[Orchestrator] ${config.displayName} failed`, { error: result.reason?.message });
        crawlRun.crawlErrors.push({
          company: key,
          error: result.reason?.message || 'Unknown error',
          timestamp: new Date(),
        });
      }
    }

    // Inline: enrich recruiters + score + alert for this batch's new jobs
    if (batchNewJobIds.length > 0) {
      await enrichRecruiters(batchNewJobIds);
      await scoreAndAlertForNewJobs(batchNewJobIds);
    }
  }

  // Process custom/Apify crawlers ONE AT A TIME to avoid Apify memory limits
  for (const [key, config] of customEntries) {
    try {
      const result = await crawlCompany(key, config);
      totalNew += result.newJobs;
      totalUpdated += result.updatedJobs;
      companiesCrawled++;

      if (result.newJobIds?.length) {
        await enrichRecruiters(result.newJobIds);
        await scoreAndAlertForNewJobs(result.newJobIds);
      }
    } catch (err) {
      logger.error(`[Orchestrator] ${config.displayName} failed`, { error: err.message });
      crawlRun.crawlErrors.push({
        company: key,
        error: err.message || 'Unknown error',
        timestamp: new Date(),
      });
    }
  }

  // Phase 3: Google Jobs supplementary crawl — runs on EVERY crawl.
  // Uses Google's aggregation to catch additional listings for our configured
  // companies from LinkedIn, Glassdoor, ZipRecruiter, etc.
  try {
    logger.info('[Orchestrator] Starting Google Jobs supplementary phase');
    const googleResult = await crawlGoogleJobs();
    totalNew += googleResult.newJobs;
    totalUpdated += googleResult.updatedJobs;

    if (googleResult.newJobIds?.length) {
      await enrichRecruiters(googleResult.newJobIds);
      await scoreAndAlertForNewJobs(googleResult.newJobIds);
    }

    logger.info(`[Orchestrator] Google Jobs: ${googleResult.newJobs} new, ${googleResult.updatedJobs} updated`);
  } catch (err) {
    logger.error('[Orchestrator] Google Jobs phase failed', { error: err.message });
    crawlRun.crawlErrors.push({
      company: 'google-jobs',
      error: err.message || 'Unknown error',
      timestamp: new Date(),
    });
  }

  // Finalize crawl run
  crawlRun.status = 'completed';
  crawlRun.completedAt = new Date();
  crawlRun.companiesCrawled = companiesCrawled;
  crawlRun.newJobsFound = totalNew;
  crawlRun.jobsUpdated = totalUpdated;
  await crawlRun.save();

  logger.info(`[Orchestrator] Crawl complete: ${companiesCrawled} companies, ${totalNew} new jobs, ${totalUpdated} updated`);
  return crawlRun;
}

module.exports = { runCrawl, crawlCompany };
