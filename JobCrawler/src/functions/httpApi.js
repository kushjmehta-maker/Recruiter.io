const { app } = require('@azure/functions');
const connectDB = require('../../backend/config/db');
const Job = require('../../backend/models/Job');
const User = require('../../backend/models/User');
const CrawlRun = require('../../backend/models/CrawlRun');
const { companies } = require('../../backend/config/companies');
const { COMBINED_SORT_RELEVANCE_WEIGHT, COMBINED_SORT_RECENCY_WEIGHT, RECENCY_DECAY_DAYS } = require('../../backend/config/constants');
const { runCrawl } = require('../../backend/crawlers');
const { scoreJobsForUser } = require('../../backend/services/relevance-scorer');
const { sendJobAlerts, sendAlertForUser } = require('../../backend/services/email-service');
const { parseResume } = require('../../backend/services/resume-parser');
const { clearCrawlFilterCache } = require('../../backend/utils/crawl-filter');
const logger = require('../../backend/utils/logger');

// --- Helpers ---

const API_KEY = process.env.API_KEY;

function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    clean[key] = typeof value === 'object' ? sanitize(value) : value;
  }
  return clean;
}

function checkAuth(request) {
  if (!API_KEY) return true;
  return request.headers.get('x-api-key') === API_KEY;
}

function getQuery(request) {
  const params = {};
  const url = new URL(request.url);
  for (const [key, value] of url.searchParams) {
    params[key] = value;
  }
  return sanitize(params);
}

async function getBody(request) {
  try {
    const body = await request.json();
    return sanitize(body);
  } catch {
    return {};
  }
}

function json(data, status = 200) {
  return { status, jsonBody: data, headers: { 'Content-Type': 'application/json' } };
}

function cors(response) {
  response.headers = {
    ...response.headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Max-Age': '86400',
  };
  return response;
}

const CORS_PREFLIGHT = cors({ status: 204 });

function isPreflight(request) {
  return request.method === 'OPTIONS';
}

// --- Health ---

app.http('health', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => {
    return cors(json({ status: 'ok', timestamp: new Date().toISOString() }));
  },
});

// --- CORS Preflight (catch-all OPTIONS) ---

app.http('corsPreflight', {
  methods: ['OPTIONS'],
  authLevel: 'anonymous',
  route: '{*restOfPath}',
  handler: async () => {
    return {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
        'Access-Control-Max-Age': '86400',
      },
    };
  },
});

// --- Users ---

app.http('userRegister', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'users/register',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const { email, targetRoles, targetLocations, preferredLocations, alertCompanies, alertThreshold } = await getBody(request);
      if (!email) return cors(json({ error: 'Email is required' }, 400));

      const user = await User.findOneAndUpdate(
        { email: email.toLowerCase().trim() },
        {
          targetRoles: targetRoles || [],
          targetLocations: targetLocations || [],
          preferredLocations: preferredLocations || [],
          alertCompanies: alertCompanies || [],
          ...(alertThreshold != null && { alertThreshold }),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      clearCrawlFilterCache();
      return cors(json({
        userId: user._id,
        email: user.email,
        targetRoles: user.targetRoles,
        preferredLocations: user.preferredLocations,
        alertCompanies: user.alertCompanies,
        alertThreshold: user.alertThreshold,
        hasResume: !!user.resumeText,
      }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

app.http('userGet', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'users/{id}',
  handler: async (request, context) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const id = request.params.id;
      const user = await User.findById(id);
      if (!user) return cors(json({ error: 'User not found' }, 404));

      return cors(json({
        userId: user._id,
        email: user.email,
        targetRoles: user.targetRoles,
        targetLocations: user.targetLocations,
        preferredLocations: user.preferredLocations,
        alertCompanies: user.alertCompanies,
        alertThreshold: user.alertThreshold,
        hasResume: !!user.resumeText,
        resumeFileName: user.resumeFileName,
        createdAt: user.createdAt,
      }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

app.http('userUpdate', {
  methods: ['PUT', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'users/{id}',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const id = request.params.id;
      const { targetRoles, targetLocations, preferredLocations, alertCompanies, alertThreshold } = await getBody(request);
      const update = {};
      if (targetRoles) update.targetRoles = targetRoles;
      if (targetLocations) update.targetLocations = targetLocations;
      if (preferredLocations) update.preferredLocations = preferredLocations;
      if (alertCompanies) update.alertCompanies = alertCompanies;
      if (alertThreshold != null) update.alertThreshold = alertThreshold;

      const user = await User.findByIdAndUpdate(id, update, { new: true });
      if (!user) return cors(json({ error: 'User not found' }, 404));

      clearCrawlFilterCache();
      return cors(json({ userId: user._id, email: user.email, ...update }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

// --- Jobs ---

app.http('jobsList', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'jobs',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const query = getQuery(request);
      const {
        userId,
        page = 1,
        limit = 20,
        company,
        location,
        minRelevance = 0,
        sortBy = 'combined',
        search,
      } = query;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

      const filter = { isActive: true };
      if (company) {
        filter.company = { $in: company.split(',').map((c) => c.trim()) };
      }
      if (location) {
        filter.location = { $regex: location.split(',').map((l) => l.trim()).join('|'), $options: 'i' };
      }
      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: 'i' } },
          { companyDisplayName: { $regex: search, $options: 'i' } },
          { location: { $regex: search, $options: 'i' } },
        ];
      }
      if (userId && parseInt(minRelevance) > 0) {
        filter['relevanceScores'] = {
          $elemMatch: { userId, score: { $gte: parseInt(minRelevance) } },
        };
      }

      const total = await Job.countDocuments(filter);
      let jobs = await Job.find(filter)
        .sort({ discoveredAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean();

      const now = new Date();
      jobs = jobs.map((job) => {
        let relevanceScore = 0;
        let relevanceReasoning = '';
        if (userId) {
          const userScore = job.relevanceScores?.find((s) => s.userId.toString() === userId);
          relevanceScore = userScore?.score || 0;
          relevanceReasoning = userScore?.reasoning || '';
        }
        const daysSincePosted = (now - new Date(job.postedAt || job.discoveredAt)) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.max(0, 100 - (daysSincePosted * (100 / RECENCY_DECAY_DAYS)));
        const combinedScore = (relevanceScore * COMBINED_SORT_RELEVANCE_WEIGHT) + (recencyScore * COMBINED_SORT_RECENCY_WEIGHT);

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

      if (sortBy === 'relevance') jobs.sort((a, b) => b.relevanceScore - a.relevanceScore);
      else if (sortBy === 'recent') jobs.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
      else jobs.sort((a, b) => b.combinedScore - a.combinedScore);

      return cors(json({ jobs, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

// --- Jobs (detail, companies, stats) ---

app.http('jobDetail', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'jobs/{id}',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    const id = request.params.id;

    // Handle sub-routes that Azure Functions incorrectly routes here
    if (id === 'companies') {
      if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
      await connectDB();
      const list = Object.entries(companies).map(([key, c]) => ({
        key, displayName: c.displayName, atsType: c.ats,
      }));
      // Include companies discovered via Google Jobs not in our config
      try {
        const googleJobsCompanies = await Job.aggregate([
          { $match: { atsType: 'google-jobs', isActive: true } },
          { $group: { _id: '$company', displayName: { $first: '$companyDisplayName' }, count: { $sum: 1 } } },
        ]);
        const configuredKeys = new Set(Object.keys(companies));
        for (const gc of googleJobsCompanies) {
          if (!configuredKeys.has(gc._id)) {
            list.push({ key: gc._id, displayName: gc.displayName, atsType: 'google-jobs', jobCount: gc.count });
          }
        }
      } catch (_) { /* non-critical */ }
      return cors(json({ companies: list }));
    }

    if (id === 'stats') {
      if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
      await connectDB();
      try {
        const totalJobs = await Job.countDocuments({ isActive: true });
        const companyCounts = await Job.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$companyDisplayName', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]);
        const last24h = new Date();
        last24h.setHours(last24h.getHours() - 24);
        const newLast24h = await Job.countDocuments({ discoveredAt: { $gte: last24h } });
        const sourceCounts = await Job.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$atsType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]);
        return cors(json({
          totalActiveJobs: totalJobs,
          newJobsLast24h: newLast24h,
          companyCounts: companyCounts.map((c) => ({ company: c._id, count: c.count })),
          sourceCounts: sourceCounts.map((s) => ({ source: s._id, count: s.count })),
        }));
      } catch (err) {
        return cors(json({ error: err.message }, 500));
      }
    }

    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const job = await Job.findById(request.params.id).lean();
      if (!job) return cors(json({ error: 'Job not found' }, 404));
      return cors(json(job));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

// --- Crawl ---

app.http('crawlTrigger', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'crawl/trigger',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const { companyKeys, atsTypes } = await getBody(request);

      // Run crawl (this may take minutes — Azure Functions allows up to 10min timeout)
      const crawlRun = await runCrawl({ companyKeys, atsTypes });

      logger.info(`[Crawl] Run ${crawlRun._id} completed, starting scoring`);
      const users = await User.find({ resumeText: { $ne: '' } });
      for (const user of users) {
        await scoreJobsForUser(user);
      }
      await sendJobAlerts();

      return cors(json({
        message: 'Crawl completed',
        runId: crawlRun._id,
        newJobsFound: crawlRun.newJobsFound,
        companiesCrawled: crawlRun.companiesCrawled,
      }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

app.http('crawlStatus', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'crawl/{subpath}',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    const subpath = request.params.subpath;

    // GET /api/crawl/history
    if (subpath === 'history') {
      try {
        const runs = await CrawlRun.find().sort({ startedAt: -1 }).limit(20).lean();
        return cors(json({ runs }));
      } catch (err) {
        return cors(json({ error: err.message }, 500));
      }
    }

    // GET /api/crawl/status/:runId → route is crawl/{subpath}/{runId}
    // Since we can't nest, treat any other subpath as an error
    return cors(json({ error: 'Not found' }, 404));
  },
});

app.http('crawlStatusDetail', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'crawl/status/{runId}',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const run = await CrawlRun.findById(request.params.runId);
      if (!run) return cors(json({ error: 'Crawl run not found' }, 404));
      return cors(json({
        id: run._id,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        companiesCrawled: run.companiesCrawled,
        newJobsFound: run.newJobsFound,
        jobsUpdated: run.jobsUpdated,
        errors: run.crawlErrors,
      }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

// --- Upload ---

app.http('uploadResume', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'upload/resume',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const formData = await request.formData();
      const email = formData.get('email');
      const resumeFile = formData.get('resume');

      if (!email) return cors(json({ error: 'Email is required' }, 400));
      if (!resumeFile) return cors(json({ error: 'Resume PDF is required' }, 400));

      // Parse form fields (may be JSON strings from multipart)
      const parseField = (val) => {
        if (!val) return [];
        try { return typeof val === 'string' ? JSON.parse(val) : val; }
        catch { return [val].filter(Boolean); }
      };

      const targetRoles = parseField(formData.get('targetRoles'));
      const targetLocations = parseField(formData.get('targetLocations'));
      const preferredLocations = parseField(formData.get('preferredLocations'));
      const alertCompanies = parseField(formData.get('alertCompanies'));

      // Read PDF buffer
      const arrayBuffer = await resumeFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const resumeText = await parseResume(buffer);

      const user = await User.findOneAndUpdate(
        { email: email.toString().toLowerCase().trim() },
        {
          resumeText,
          resumeFileName: resumeFile.name || 'resume.pdf',
          targetRoles,
          targetLocations,
          preferredLocations,
          alertCompanies,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return cors(json({
        userId: user._id,
        email: user.email,
        targetRoles: user.targetRoles,
        targetLocations: user.targetLocations,
        preferredLocations: user.preferredLocations,
        alertCompanies: user.alertCompanies,
        resumeParsed: true,
        resumeSnippet: resumeText.slice(0, 200) + '...',
      }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});

// --- Test Alert (admin only — forces an email alert ignoring cooldown) ---

app.http('testAlert', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'test/send-alert',
  handler: async (request) => {
    if (isPreflight(request)) return CORS_PREFLIGHT;
    if (!checkAuth(request)) return cors(json({ error: 'Invalid or missing API key' }, 401));
    await connectDB();
    try {
      const { userId } = await getBody(request);
      const user = await User.findById(userId);
      if (!user) return cors(json({ error: 'User not found' }, 404));
      if (!user.resumeText) return cors(json({ error: 'User has no resume' }, 400));

      // Clear cooldown to force email
      user.lastAlertSentAt = null;
      await user.save();

      // Find high-scoring jobs for this user
      const jobs = await Job.find({
        isActive: true,
        'relevanceScores': {
          $elemMatch: {
            userId: user._id,
            score: { $gte: user.alertThreshold },
          },
        },
      }).limit(20);

      if (jobs.length === 0) {
        return cors(json({ error: 'No jobs above threshold to send', threshold: user.alertThreshold }));
      }

      const sent = await sendAlertForUser(user, jobs);
      return cors(json({
        message: sent ? 'Alert email sent!' : 'Email filtered out (location/company filters)',
        jobsFound: jobs.length,
        email: user.email,
        sent,
      }));
    } catch (err) {
      return cors(json({ error: err.message }, 500));
    }
  },
});
