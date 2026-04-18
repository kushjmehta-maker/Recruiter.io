const { app } = require('@azure/functions');
const connectDB = require('../../backend/config/db');
const User = require('../../backend/models/User');
const { scoreJobsForUser } = require('../../backend/services/relevance-scorer');
const { sendJobAlerts } = require('../../backend/services/email-service');
const logger = require('../../backend/utils/logger');

app.timer('timerCatchupScoring', {
  schedule: '30 */6 * * *',
  handler: async (timer, context) => {
    logger.info('[Timer] Starting catch-up scoring');
    await connectDB();

    try {
      const users = await User.find({ resumeText: { $ne: '' } });
      for (const user of users) {
        await scoreJobsForUser(user);
      }
      await sendJobAlerts();
      logger.info('[Timer] Catch-up scoring completed');
    } catch (err) {
      logger.error('[Timer] Catch-up scoring failed', { error: err.message });
    }
  },
});
