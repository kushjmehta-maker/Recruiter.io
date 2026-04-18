const logger = require('../utils/logger');

// Regex patterns for extracting recruiter info from job descriptions
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.]+/gi;
const GENERIC_EMAILS = new Set([
  'jobs', 'careers', 'noreply', 'no-reply', 'hr', 'recruiting', 'talent',
  'apply', 'hiring', 'recruitment', 'info', 'contact', 'support', 'help',
]);

/**
 * Extract recruiter contact from job description text.
 * @param {string} text - plain text job description
 * @param {string} companyKey
 * @returns {{ name: string, email: string, linkedinUrl: string, source: string }}
 */
function extractRecruiter(text, companyKey) {
  const result = { name: '', email: '', linkedinUrl: '', source: '' };

  if (!text) return result;

  // 1. Extract non-generic email addresses
  const emails = text.match(EMAIL_REGEX) || [];
  for (const email of emails) {
    const localPart = email.split('@')[0].toLowerCase();
    if (!GENERIC_EMAILS.has(localPart) && !localPart.includes('team')) {
      result.email = email;
      result.source = 'posting';

      // Try to infer name from email (john.doe@company.com → John Doe)
      const parts = localPart.split(/[._-]/);
      if (parts.length >= 2 && parts[0].length > 1 && parts[1].length > 1) {
        result.name = parts
          .slice(0, 2)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(' ');
      }
      break;
    }
  }

  // 2. Generate LinkedIn recruiter search URL
  const companyDisplayName = companyKey.charAt(0).toUpperCase() + companyKey.slice(1);
  result.linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(companyDisplayName + ' recruiter')}&origin=GLOBAL_SEARCH_HEADER`;

  return result;
}

/**
 * Try to extract recruiter name from common patterns in text.
 * Patterns: "Contact: Name", "Recruiter: Name", "Hiring Manager: Name"
 */
function extractRecruiterName(text) {
  const patterns = [
    /(?:recruiter|hiring manager|contact|reach out to|point of contact)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
    /(?:questions\??\s*(?:contact|email|reach out))[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

module.exports = { extractRecruiter, extractRecruiterName };
