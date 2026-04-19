/**
 * Test crawlers against known-working endpoints.
 * Run: node scripts/test-crawlers.js [companyKey]
 *
 * Examples:
 *   node scripts/test-crawlers.js            # run all default tests
 *   node scripts/test-crawlers.js google      # crawl only Google (custom/Apify)
 *   node scripts/test-crawlers.js microsoft   # crawl only Microsoft (custom/Apify)
 */
require('dotenv').config();
const connectDB = require('../backend/config/db');
const { crawlGreenhouse } = require('../backend/crawlers/greenhouse');
const { crawlWorkday } = require('../backend/crawlers/workday');
const { crawlLever } = require('../backend/crawlers/lever');
const { crawlApifyGeneric } = require('../backend/crawlers/apify-generic');
const { companies } = require('../backend/config/companies');

const crawlerMap = {
  greenhouse: crawlGreenhouse,
  workday: crawlWorkday,
  lever: crawlLever,
  custom: crawlApifyGeneric,
};

async function testSingleCompany(key) {
  const config = companies[key];
  if (!config) {
    console.error(`Unknown company key: "${key}". Valid keys: ${Object.keys(companies).join(', ')}`);
    process.exit(1);
  }

  await connectDB();

  console.log(`\n═══ Testing ${config.displayName} (${config.ats}) ═══`);
  const crawler = crawlerMap[config.ats];
  if (!crawler) {
    console.error(`No crawler for ATS type: ${config.ats}`);
    process.exit(1);
  }

  try {
    const result = await crawler(key, config);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`${config.displayName} crawl failed:`, err.message);
  }

  process.exit(0);
}

async function main() {
  // If a company key is passed as CLI arg, test only that company
  const targetCompany = process.argv[2];
  if (targetCompany) {
    return testSingleCompany(targetCompany);
  }

  await connectDB();

  console.log('\n═══ Testing Greenhouse (Stripe) ═══');
  try {
    const result = await crawlGreenhouse('stripe', companies.stripe);
    console.log('Result:', result);
  } catch (err) {
    console.error('Greenhouse test failed:', err.message);
  }

  console.log('\n═══ Testing Workday (NVIDIA) ═══');
  try {
    const result = await crawlWorkday('nvidia', companies.nvidia);
    console.log('Result:', result);
  } catch (err) {
    console.error('Workday test failed:', err.message);
  }

  console.log('\n═══ Testing Lever (Razorpay — may fail) ═══');
  try {
    const result = await crawlLever('razorpay', companies.razorpay);
    console.log('Result:', result);
  } catch (err) {
    console.error('Lever test failed (expected):', err.message);
  }

  console.log('\n═══ Quick Greenhouse scan for slug discovery ═══');
  const testSlugs = ['atlassian', 'snowflakecomputing', 'snowflake', 'hashicorp', 'hashicorp-62', 'zeta-global', 'zetatech',
    'zomato', 'dream11', 'dreamsports', 'browserstack', 'sharechat', 'mohalla-tech'];

  for (const slug of testSlugs) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      const data = await res.json();
      const count = data.jobs?.length || 0;
      if (count > 0) {
        console.log(`  ✅ ${slug}: ${count} jobs`);
      } else {
        console.log(`  ❌ ${slug}: 0 jobs`);
      }
    } catch (err) {
      console.log(`  ❌ ${slug}: error - ${err.message}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
