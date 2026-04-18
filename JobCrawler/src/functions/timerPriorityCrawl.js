const { app } = require('@azure/functions');
const connectDB = require('../../backend/config/db');
const User = require('../../backend/models/User');
const { runCrawl } = require('../../backend/crawlers');
const logger = require('../../backend/utils/logger');

app.timer('timerPriorityCrawl', {
  schedule: '0 */2 * * *',
  handler: async (timer, context) => {
    logger.info('[Timer] Starting priority company crawl (every 2h)');
    await connectDB();

    try {
      const users = await User.find({ alertCompanies: { $exists: true, $ne: [] } });
      const priority = new Set();
      for (const user of users) {
        for (const company of user.alertCompanies) {
          priority.add(company);
        }
      }

      if (priority.size === 0) {
        logger.info('[Timer] No priority companies configured, skipping');
        return;
      }

      logger.info(`[Timer] Priority companies: ${[...priority].join(', ')}`);
      await runCrawl({ companyKeys: [...priority] });
      logger.info('[Timer] Priority crawl completed');
    } catch (err) {
      logger.error('[Timer] Priority crawl failed', { error: err.message });
    }
  },
});
