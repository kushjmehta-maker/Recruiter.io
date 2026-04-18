const { AzureOpenAI } = require('openai');
const Job = require('../models/Job');
const logger = require('../utils/logger');
const { MAX_RESUME_LENGTH, MAX_JOB_DESC_LENGTH, SCORING_CONCURRENCY, SCORE_CACHE_DAYS } = require('../config/constants');

const client = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2025-01-01-preview',
});

const SCORING_PROMPT = `You are a senior technical recruiter evaluating job-resume fit.

Given a candidate's resume and a job posting, score the relevance from 0-100:
- 90-100: Near-perfect match — skills, experience level, and role type all align
- 75-89: Strong match — most key requirements met, minor gaps
- 50-74: Partial match — some relevant skills but significant gaps
- 25-49: Weak match — different domain or seniority level
- 0-24: No meaningful overlap

Consider: technical skills, programming languages, frameworks, years of experience, domain expertise, seniority level, and role type.

Respond ONLY with valid JSON:
{"score": <number>, "reasoning": "<1-2 sentence explanation>"}`;

/**
 * Keyword pre-filter: cheap check before expensive LLM call.
 * Returns true if the job title likely matches the user's target roles.
 */
function passesKeywordFilter(jobTitle, targetRoles) {
  const titleLower = jobTitle.toLowerCase();

  // Common synonyms map
  const synonyms = {
    'software engineer': ['sde', 'swe', 'software developer', 'backend engineer', 'frontend engineer', 'fullstack engineer', 'full stack engineer', 'full-stack engineer'],
    'mts': ['member of technical staff', 'member technical staff'],
    'data scientist': ['ml engineer', 'machine learning engineer', 'data analyst'],
    'devops': ['sre', 'site reliability', 'platform engineer', 'infrastructure engineer'],
    'product manager': ['pm', 'product lead'],
  };

  for (const role of targetRoles) {
    const roleLower = role.toLowerCase();

    // Direct match
    if (titleLower.includes(roleLower)) return true;

    // Check synonyms
    for (const [key, alts] of Object.entries(synonyms)) {
      if (roleLower.includes(key) || alts.some((a) => roleLower.includes(a))) {
        if (titleLower.includes(key) || alts.some((a) => titleLower.includes(a))) {
          return true;
        }
      }
    }
  }

  // Also pass if it's an engineering role and user targets engineering
  const isEngineeringTarget = targetRoles.some((r) =>
    /engineer|developer|sde|swe|mts/i.test(r)
  );
  const isEngineeringJob = /engineer|developer|sde|swe|mts|architect/i.test(titleLower);

  return isEngineeringTarget && isEngineeringJob;
}

/**
 * Score a single job against a resume using Azure OpenAI GPT-4.1.
 */
async function scoreJob(resumeText, job) {
  const truncatedResume = resumeText.slice(0, MAX_RESUME_LENGTH);
  const truncatedDesc = (job.description || job.title).slice(0, MAX_JOB_DESC_LENGTH);

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      max_tokens: 200,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SCORING_PROMPT },
        {
          role: 'user',
          content: `--- RESUME ---\n${truncatedResume}\n\n--- JOB POSTING ---\nTitle: ${job.title}\nCompany: ${job.companyDisplayName}\nLocation: ${job.location}\n\n${truncatedDesc}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content || '';
    const parsed = JSON.parse(text);

    return {
      score: Math.min(100, Math.max(0, Math.round(parsed.score))),
      reasoning: parsed.reasoning || '',
    };
  } catch (err) {
    logger.error(`[Scorer] Failed to score job ${job._id}`, { error: err.message });
    return { score: 0, reasoning: 'Scoring failed' };
  }
}

/**
 * Score all unscored jobs for a user. Uses keyword pre-filter + Claude API.
 * @param {object} user - User document
 * @param {Array} jobIds - Optional: only score these specific job IDs (for inline scoring)
 * @returns {{ scored: number, filtered: number }}
 */
async function scoreJobsForUser(user, jobIds) {
  const cacheThreshold = new Date();
  cacheThreshold.setDate(cacheThreshold.getDate() - SCORE_CACHE_DAYS);

  // Find jobs that don't have a recent score for this user
  const filter = {
    isActive: true,
    $or: [
      { 'relevanceScores.userId': { $ne: user._id } },
      { relevanceScores: { $size: 0 } },
    ],
  };

  // If specific jobIds provided, only score those
  if (jobIds?.length) {
    filter._id = { $in: jobIds };
  }

  const unscoredJobs = await Job.find(filter);

  logger.info(`[Scorer] ${unscoredJobs.length} unscored jobs for ${user.email}`);

  // Stage 1: keyword pre-filter
  const candidates = unscoredJobs.filter((job) =>
    passesKeywordFilter(job.title, user.targetRoles)
  );
  const filtered = unscoredJobs.length - candidates.length;
  logger.info(`[Scorer] ${candidates.length} pass keyword filter (${filtered} filtered out)`);

  // Stage 2: Claude API scoring in batches
  let scored = 0;
  for (let i = 0; i < candidates.length; i += SCORING_CONCURRENCY) {
    const batch = candidates.slice(i, i + SCORING_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map((job) => scoreJob(user.resumeText, job))
    );

    for (let j = 0; j < results.length; j++) {
      const job = batch[j];
      const result = results[j];
      const { score, reasoning } = result.status === 'fulfilled'
        ? result.value
        : { score: 0, reasoning: 'Scoring error' };

      await Job.updateOne(
        { _id: job._id },
        {
          $push: {
            relevanceScores: {
              userId: user._id,
              score,
              reasoning,
              scoredAt: new Date(),
            },
          },
        }
      );
      scored++;
    }
  }

  // Give filtered-out jobs a score of 0 so they aren't re-processed
  if (filtered > 0) {
    const filteredIds = unscoredJobs
      .filter((job) => !passesKeywordFilter(job.title, user.targetRoles))
      .map((job) => job._id);

    await Job.updateMany(
      { _id: { $in: filteredIds } },
      {
        $push: {
          relevanceScores: {
            userId: user._id,
            score: 0,
            reasoning: 'Filtered out by keyword pre-filter',
            scoredAt: new Date(),
          },
        },
      }
    );
  }

  logger.info(`[Scorer] Scored ${scored} jobs for ${user.email}`);
  return { scored, filtered };
}

module.exports = { scoreJobsForUser, scoreJob, passesKeywordFilter };
