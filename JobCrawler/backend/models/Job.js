const mongoose = require('mongoose');

const relevanceScoreSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  score: { type: Number, required: true, min: 0, max: 100 },
  reasoning: { type: String, default: '' },
  scoredAt: { type: Date, default: Date.now },
}, { _id: false });

const recruiterSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  linkedinUrl: { type: String, default: '' },
  source: { type: String, enum: ['posting', 'linkedin_search', 'inferred', ''], default: '' },
}, { _id: false });

const jobSchema = new mongoose.Schema({
  externalId: { type: String, required: true },
  company: { type: String, required: true },
  companyDisplayName: { type: String, required: true },
  atsType: { type: String, enum: ['greenhouse', 'workday', 'lever', 'custom'], required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  descriptionHtml: { type: String, default: '' },
  location: { type: String, default: '' },
  url: { type: String, required: true },
  postedAt: { type: Date, default: null },
  discoveredAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  metadata: {
    department: { type: String, default: '' },
    workplaceType: { type: String, default: '' },
    seniorityLevel: { type: String, default: '' },
    reqId: { type: String, default: '' },
  },
  recruiter: { type: recruiterSchema, default: () => ({}) },
  relevanceScores: [relevanceScoreSchema],
}, { timestamps: true });

// Prevent duplicate jobs
jobSchema.index({ company: 1, externalId: 1 }, { unique: true });
// Sort by discovery date
jobSchema.index({ discoveredAt: -1 });
// Per-user relevance queries
jobSchema.index({ 'relevanceScores.userId': 1, 'relevanceScores.score': -1 });
// Filter active jobs
jobSchema.index({ isActive: 1 });

module.exports = mongoose.model('Job', jobSchema);
