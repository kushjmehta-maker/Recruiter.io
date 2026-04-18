const sgMail = require('@sendgrid/mail');
const User = require('../models/User');
const Job = require('../models/Job');
const Alert = require('../models/Alert');
const logger = require('../utils/logger');
const { ALERT_COOLDOWN_HOURS } = require('../config/constants');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Generate HTML email content for job alert digest.
 */
function buildAlertEmail(user, jobs) {
  const jobRows = jobs.map((job) => {
    const score = job.relevanceScores?.find(
      (s) => s.userId.toString() === user._id.toString()
    );
    const scoreVal = score?.score || 0;
    const color = scoreVal >= 90 ? '#10b981' : scoreVal >= 75 ? '#3b82f6' : '#f59e0b';

    return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 16px;">
        <div style="font-weight: 600; font-size: 16px; color: #111827;">${job.title}</div>
        <div style="color: #6b7280; margin-top: 4px;">${job.companyDisplayName} · ${job.location || 'Location not specified'}</div>
        ${job.recruiter?.email ? `<div style="color: #6b7280; margin-top: 2px;">Recruiter: ${job.recruiter.name || ''} ${job.recruiter.email}</div>` : ''}
      </td>
      <td style="padding: 16px; text-align: center;">
        <span style="background: ${color}; color: white; padding: 4px 12px; border-radius: 12px; font-weight: 600;">${scoreVal}%</span>
      </td>
      <td style="padding: 16px; text-align: center;">
        <a href="${job.url}" style="background: #2563eb; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 500;">Apply</a>
      </td>
    </tr>`;
  }).join('');

  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f3f4f6;">
    <div style="max-width: 700px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 24px 32px; color: white;">
        <h1 style="margin: 0; font-size: 24px;">🎯 New Job Matches</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${jobs.length} new job${jobs.length > 1 ? 's' : ''} matching your profile (${user.targetRoles.join(', ')})</p>
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 12px 16px; text-align: left; color: #6b7280; font-size: 12px; text-transform: uppercase;">Position</th>
            <th style="padding: 12px 16px; text-align: center; color: #6b7280; font-size: 12px; text-transform: uppercase;">Match</th>
            <th style="padding: 12px 16px; text-align: center; color: #6b7280; font-size: 12px; text-transform: uppercase;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${jobRows}
        </tbody>
      </table>
      <div style="padding: 20px 32px; background: #f9fafb; color: #6b7280; font-size: 13px; text-align: center;">
        JobCrawler Alert · <a href="#" style="color: #2563eb;">Manage preferences</a>
      </div>
    </div>
  </body>
  </html>`;
}

/**
 * Check if a user is within their alert cooldown period.
 */
function isWithinCooldown(user) {
  if (!user.lastAlertSentAt) return false;
  const cooldownDate = new Date();
  cooldownDate.setHours(cooldownDate.getHours() - ALERT_COOLDOWN_HOURS);
  return user.lastAlertSentAt >= cooldownDate;
}

/**
 * Send alert for a specific user with specific jobs (used by inline alerting).
 * Respects cooldown, location, and company filters.
 * @param {object} user - User document
 * @param {Array} jobs - Job documents with relevanceScores already populated
 * @returns {boolean} - Whether an alert was sent
 */
async function sendAlertForUser(user, jobs) {
  if (isWithinCooldown(user)) {
    logger.info(`[Email] Skipping ${user.email} — within cooldown`);
    return false;
  }

  // Filter by location preference
  let filtered = jobs;
  if (user.preferredLocations?.length > 0) {
    const locRegex = new RegExp(user.preferredLocations.join('|'), 'i');
    filtered = filtered.filter((j) => locRegex.test(j.location || ''));
  }

  // Filter by alert companies (empty = all)
  if (user.alertCompanies?.length > 0) {
    filtered = filtered.filter((j) => user.alertCompanies.includes(j.company));
  }

  // Filter by threshold
  filtered = filtered.filter((j) => {
    const userScore = j.relevanceScores?.find(
      (s) => s.userId.toString() === user._id.toString()
    );
    return (userScore?.score || 0) >= user.alertThreshold;
  });

  if (filtered.length === 0) return false;

  try {
    const msg = {
      to: user.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'alerts@jobcrawler.io',
        name: process.env.SENDGRID_FROM_NAME || 'JobCrawler Alerts',
      },
      subject: `🎯 ${filtered.length} new job match${filtered.length > 1 ? 'es' : ''} for ${user.targetRoles[0] || 'you'}`,
      html: buildAlertEmail(user, filtered),
    };

    const [response] = await sgMail.send(msg);

    await Alert.create({
      userId: user._id,
      jobIds: filtered.map((j) => j._id),
      emailStatus: 'sent',
      sendgridMessageId: response?.headers?.['x-message-id'] || '',
    });

    user.lastAlertSentAt = new Date();
    await user.save();

    logger.info(`[Email] Sent alert to ${user.email} with ${filtered.length} jobs`);
    return true;
  } catch (err) {
    logger.error(`[Email] Failed to send alert to ${user.email}`, { error: err.message });
    await Alert.create({
      userId: user._id,
      jobIds: filtered.map((j) => j._id),
      emailStatus: 'failed',
    });
    return false;
  }
}

/**
 * Send job alerts to all users with new high-relevance jobs (batch mode).
 */
async function sendJobAlerts() {
  const cooldownDate = new Date();
  cooldownDate.setHours(cooldownDate.getHours() - ALERT_COOLDOWN_HOURS);

  const users = await User.find({
    $or: [
      { lastAlertSentAt: null },
      { lastAlertSentAt: { $lt: cooldownDate } },
    ],
  });

  logger.info(`[Email] ${users.length} users eligible for alerts`);

  for (const user of users) {
    const lastAlertDate = user.lastAlertSentAt || new Date(0);

    const jobFilter = {
      isActive: true,
      'relevanceScores': {
        $elemMatch: {
          userId: user._id,
          score: { $gte: user.alertThreshold },
          scoredAt: { $gt: lastAlertDate },
        },
      },
    };

    if (user.preferredLocations?.length > 0) {
      jobFilter.location = {
        $regex: user.preferredLocations.join('|'),
        $options: 'i',
      };
    }

    if (user.alertCompanies?.length > 0) {
      jobFilter.company = { $in: user.alertCompanies };
    }

    const jobs = await Job.find(jobFilter)
      .sort({ 'relevanceScores.score': -1 }).limit(20);

    if (jobs.length === 0) continue;

    await sendAlertForUser(user, jobs);
  }
}

module.exports = { sendJobAlerts, sendAlertForUser, buildAlertEmail };
