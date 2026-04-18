const cron = require('node-cron');
const { companies } = require('../config/companies');
const { runCrawl } = require('../crawlers');
const { scoreJobsForUser } = require('./relevance-scorer');
const { sendJobAlerts } = require('./email-service');
const User = require('../models/User');
const Job = require('../models/Job');
const logger = require('../utils/logger');

/**
 * Get the set of priority company keys (companies any user has in their alertCompanies).
 */
async function getPriorityCompanies() {
  const users = await User.find({ alertCompanies: { $exists: true, $ne: [] } });
  const priority = new Set();
  for (const user of users) {
    for (const company of user.alertCompanies) {
      priority.add(company);
    }
  }
  return priority;
}

function startScheduler() {
  // Priority companies: crawl every 2 hours (users' alertCompanies)
  // Inline scoring + alerting happens inside runCrawl automatically
  cron.schedule('0 */2 * * *', async () => {
    logger.info('[Scheduler] Starting priority company crawl (every 2h)');
    try {
      const priorityKeys = await getPriorityCompanies();
      if (priorityKeys.size === 0) {
        logger.info('[Scheduler] No priority companies configured, skipping');
        return;
      }
      logger.info(`[Scheduler] Priority companies: ${[...priorityKeys].join(', ')}`);
      await runCrawl({ companyKeys: [...priorityKeys] });
    } catch (err) {
      logger.error('[Scheduler] Priority crawl failed', { error: err.message });
    }
  });

  // Full crawl every 6 hours (all companies)
  // Inline scoring + alerting happens inside runCrawl automatically
  cron.schedule('0 */6 * * *', async () => {
    logger.info('[Scheduler] Starting full crawl (every 6h)');
    try {
      await runCrawl();
    } catch (err) {
      logger.error('[Scheduler] Full crawl failed', { error: err.message });
    }
  });

  // Catch-up scoring: score any jobs that were missed by inline scoring
  // (e.g., new users registered after last crawl, or scoring failures)
  cron.schedule('30 */6 * * *', async () => {
    logger.info('[Scheduler] Starting catch-up scoring');
    try {
      const users = await User.find({ resumeText: { $ne: '' } });
      for (const user of users) {
        await scoreJobsForUser(user);
      }
      // Batch alerts for anything missed by inline alerting
      await sendJobAlerts();
    } catch (err) {
      logger.error('[Scheduler] Catch-up scoring/alerts failed', { error: err.message });
    }
  });

  // Weekly: deactivate stale jobs (not updated in 30 days)
  cron.schedule('0 3 * * 0', async () => {
    logger.info('[Scheduler] Deactivating stale jobs');
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - 30);
    const result = await Job.updateMany(
      { updatedAt: { $lt: threshold }, isActive: true },
      { isActive: false }
    );
    logger.info(`[Scheduler] Deactivated ${result.modifiedCount} stale jobs`);
  });

  logger.info('[Scheduler] All cron jobs registered: priority(2h), full(6h), catch-up(6h+30m), cleanup(weekly)');
}

module.exports = { startScheduler };
