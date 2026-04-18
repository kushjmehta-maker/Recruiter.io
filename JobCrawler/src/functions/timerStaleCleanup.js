const { app } = require('@azure/functions');
const connectDB = require('../../backend/config/db');
const Job = require('../../backend/models/Job');
const logger = require('../../backend/utils/logger');

app.timer('timerStaleCleanup', {
  schedule: '0 3 * * 0',
  handler: async (timer, context) => {
    logger.info('[Timer] Deactivating stale jobs');
    await connectDB();

    try {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - 30);
      const result = await Job.updateMany(
        { updatedAt: { $lt: threshold }, isActive: true },
        { isActive: false }
      );
      logger.info(`[Timer] Deactivated ${result.modifiedCount} stale jobs`);
    } catch (err) {
      logger.error('[Timer] Stale cleanup failed', { error: err.message });
    }
  },
});
