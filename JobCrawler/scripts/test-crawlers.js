/**
 * Test crawlers against known-working endpoints.
 * Run: node scripts/test-crawlers.js
 */
require('dotenv').config();
const connectDB = require('../backend/config/db');
const { crawlGreenhouse } = require('../backend/crawlers/greenhouse');
const { crawlWorkday } = require('../backend/crawlers/workday');
const { crawlLever } = require('../backend/crawlers/lever');
const { companies } = require('../backend/config/companies');

async function main() {
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
