const { app } = require('@azure/functions');
const connectDB = require('../../backend/config/db');
const { runCrawl } = require('../../backend/crawlers');
const logger = require('../../backend/utils/logger');

app.timer('timerFullCrawl', {
  schedule: '0 */6 * * *',
  handler: async (timer, context) => {
    logger.info('[Timer] Starting full crawl (every 6h)');
    await connectDB();

    try {
      await runCrawl();
      logger.info('[Timer] Full crawl completed');
    } catch (err) {
      logger.error('[Timer] Full crawl failed', { error: err.message });
    }
  },
});
