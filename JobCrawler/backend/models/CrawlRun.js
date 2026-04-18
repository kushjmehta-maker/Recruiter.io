const mongoose = require('mongoose');

const crawlRunSchema = new mongoose.Schema({
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
  companiesCrawled: { type: Number, default: 0 },
  newJobsFound: { type: Number, default: 0 },
  jobsUpdated: { type: Number, default: 0 },
  crawlErrors: [{
    company: String,
    error: String,
    timestamp: { type: Date, default: Date.now },
  }],
});

module.exports = mongoose.model('CrawlRun', crawlRunSchema);
