const express = require('express');
const { runCrawl } = require('../crawlers');
const { scoreJobsForUser } = require('../services/relevance-scorer');
const { sendJobAlerts } = require('../services/email-service');
const CrawlRun = require('../models/CrawlRun');
const User = require('../models/User');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/crawl/trigger — Manually trigger a crawl
router.post('/trigger', async (req, res) => {
  try {
    const { companyKeys, atsTypes } = req.body;

    // Start crawl in background
    const crawlPromise = runCrawl({ companyKeys, atsTypes });

    // Return immediately with run ID
    const pendingRun = await CrawlRun.findOne().sort({ startedAt: -1 });

    res.json({
      message: 'Crawl triggered',
      runId: pendingRun?._id,
    });

    // After crawl finishes, score and alert
    crawlPromise.then(async (crawlRun) => {
      logger.info(`[Crawl] Run ${crawlRun._id} completed, starting scoring`);
      const users = await User.find({ resumeText: { $ne: '' } });
      for (const user of users) {
        await scoreJobsForUser(user);
      }
      await sendJobAlerts();
    }).catch((err) => {
      logger.error('[Crawl] Background processing failed', { error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crawl/status/:runId — Check crawl status
router.get('/status/:runId', async (req, res) => {
  try {
    const run = await CrawlRun.findById(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Crawl run not found' });

    res.json({
      id: run._id,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      companiesCrawled: run.companiesCrawled,
      newJobsFound: run.newJobsFound,
      jobsUpdated: run.jobsUpdated,
      errors: run.crawlErrors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crawl/history — List recent crawl runs
router.get('/history', async (req, res) => {
  try {
    const runs = await CrawlRun.find()
      .sort({ startedAt: -1 })
      .limit(20)
      .lean();
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
