const express = require('express');
const Job = require('../models/Job');
const { companies } = require('../config/companies');
const { COMBINED_SORT_RELEVANCE_WEIGHT, COMBINED_SORT_RECENCY_WEIGHT, RECENCY_DECAY_DAYS } = require('../config/constants');

const router = express.Router();

// GET /api/jobs — List jobs with filtering, sorting, pagination
router.get('/', async (req, res) => {
  try {
    const {
      userId,
      page = 1,
      limit = 20,
      company,
      location,
      minRelevance = 0,
      sortBy = 'combined', // combined | relevance | recent
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    // Build filter
    const filter = { isActive: true };

    if (company) {
      const companyList = company.split(',').map((c) => c.trim());
      filter.company = { $in: companyList };
    }

    if (location) {
      // Match any job whose location field contains any of the given locations (case-insensitive)
      const locationList = location.split(',').map((l) => l.trim());
      filter.location = { $regex: locationList.join('|'), $options: 'i' };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { companyDisplayName: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
      ];
    }

    // If userId provided, filter by relevance score
    if (userId && parseInt(minRelevance) > 0) {
      filter['relevanceScores'] = {
        $elemMatch: {
          userId,
          score: { $gte: parseInt(minRelevance) },
        },
      };
    }

    const total = await Job.countDocuments(filter);
    let jobs = await Job.find(filter)
      .sort({ discoveredAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    // Compute combined scores and format response
    const now = new Date();
    jobs = jobs.map((job) => {
      // Get user's relevance score
      let relevanceScore = 0;
      let relevanceReasoning = '';
      if (userId) {
        const userScore = job.relevanceScores?.find(
          (s) => s.userId.toString() === userId
        );
        relevanceScore = userScore?.score || 0;
        relevanceReasoning = userScore?.reasoning || '';
      }

      // Recency score: 100 → 0 over RECENCY_DECAY_DAYS
      const daysSincePosted = (now - new Date(job.postedAt || job.discoveredAt)) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 100 - (daysSincePosted * (100 / RECENCY_DECAY_DAYS)));

      // Combined score
      const combinedScore = (relevanceScore * COMBINED_SORT_RELEVANCE_WEIGHT) +
        (recencyScore * COMBINED_SORT_RECENCY_WEIGHT);

      return {
        id: job._id,
        company: job.company,
        companyDisplayName: job.companyDisplayName,
        title: job.title,
        location: job.location,
        url: job.url,
        postedAt: job.postedAt,
        discoveredAt: job.discoveredAt,
        atsType: job.atsType,
        relevanceScore,
        relevanceReasoning,
        recencyScore: Math.round(recencyScore),
        combinedScore: Math.round(combinedScore),
        metadata: job.metadata,
        recruiter: job.recruiter,
      };
    });

    // Sort by chosen criteria
    if (sortBy === 'relevance') {
      jobs.sort((a, b) => b.relevanceScore - a.relevanceScore);
    } else if (sortBy === 'recent') {
      jobs.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
    } else {
      jobs.sort((a, b) => b.combinedScore - a.combinedScore);
    }

    res.json({
      jobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/companies — List all tracked companies
router.get('/companies', (req, res) => {
  const list = Object.entries(companies).map(([key, c]) => ({
    key,
    displayName: c.displayName,
    atsType: c.ats,
  }));
  res.json({ companies: list });
});

// GET /api/jobs/stats — Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const totalJobs = await Job.countDocuments({ isActive: true });
    const companyCounts = await Job.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$companyDisplayName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);
    const newLast24h = await Job.countDocuments({
      discoveredAt: { $gte: last24h },
    });

    res.json({
      totalActiveJobs: totalJobs,
      newJobsLast24h: newLast24h,
      companyCounts: companyCounts.map((c) => ({ company: c._id, count: c.count })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id — Full job detail
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
