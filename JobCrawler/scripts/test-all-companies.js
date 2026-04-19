/**
 * Diagnostic: test every company crawler and report results.
 * Run: node scripts/test-all-companies.js
 *
 * Tests all companies in batches, reports extracted job counts,
 * and prints a summary table at the end.
 *
 * Puppeteer-based crawls (custom ATS) run one at a time to avoid
 * exceeding Apify's memory limit.
 */
require('dotenv').config();
const connectDB = require('../backend/config/db');
const { companies } = require('../backend/config/companies');
const { crawlGreenhouse } = require('../backend/crawlers/greenhouse');
const { crawlWorkday } = require('../backend/crawlers/workday');
const { crawlLever } = require('../backend/crawlers/lever');
const { crawlApifyGeneric } = require('../backend/crawlers/apify-generic');

const crawlerMap = {
  greenhouse: crawlGreenhouse,
  workday: crawlWorkday,
  lever: crawlLever,
  custom: crawlApifyGeneric,
};

const BATCH_SIZE = 5;

async function testCompany(key, config) {
  const crawler = crawlerMap[config.ats];
  if (!crawler) return { key, status: 'ERROR', error: `Unknown ATS: ${config.ats}`, jobs: 0 };

  const start = Date.now();
  try {
    const result = await crawler(key, config);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const totalJobs = (result.newJobs || 0) + (result.updatedJobs || 0);
    return {
      key,
      displayName: config.displayName,
      ats: config.ats,
      status: totalJobs > 0 ? 'OK' : 'EMPTY',
      jobs: totalJobs,
      newJobs: result.newJobs || 0,
      updatedJobs: result.updatedJobs || 0,
      elapsed,
    };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return {
      key,
      displayName: config.displayName,
      ats: config.ats,
      status: 'FAIL',
      jobs: 0,
      error: err.message?.slice(0, 80),
      elapsed,
    };
  }
}

function printResult(res) {
  const icon = res.status === 'OK' ? '✅' : res.status === 'EMPTY' ? '⚠️' : '❌';
  const detail = res.status === 'OK' || res.status === 'EMPTY'
    ? `${res.jobs} jobs (${res.newJobs} new, ${res.updatedJobs} updated) [${res.elapsed}s]`
    : `${res.error} [${res.elapsed || '?'}s]`;
  console.log(`  ${icon} ${(res.displayName || res.key).padEnd(22)} ${res.ats?.padEnd(12) || ''} ${detail}`);
}

async function main() {
  await connectDB();

  const entries = Object.entries(companies);
  const apiEntries = entries.filter(([, c]) => c.ats !== 'custom');
  const customEntries = entries.filter(([, c]) => c.ats === 'custom');

  console.log(`\nTesting ${entries.length} companies (${apiEntries.length} API-based in batches, ${customEntries.length} custom one-at-a-time)...\n`);

  const results = [];

  // Phase 1: API-based crawlers (Greenhouse, Workday, Lever) — can run in parallel batches
  if (apiEntries.length > 0) {
    console.log('══ Phase 1: API-based crawlers (batched) ══\n');
    for (let i = 0; i < apiEntries.length; i += BATCH_SIZE) {
      const batch = apiEntries.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(apiEntries.length / BATCH_SIZE);
      console.log(`── Batch ${batchNum}/${totalBatches}: ${batch.map(([k]) => k).join(', ')} ──`);

      const batchResults = await Promise.allSettled(
        batch.map(([key, config]) => testCompany(key, config))
      );

      for (const r of batchResults) {
        const res = r.status === 'fulfilled' ? r.value : { key: '?', status: 'CRASH', error: r.reason?.message };
        results.push(res);
        printResult(res);
      }
      console.log('');
    }
  }

  // Phase 2: Custom/Apify crawlers — run ONE AT A TIME to avoid Apify memory limit
  if (customEntries.length > 0) {
    console.log('══ Phase 2: Custom crawlers (sequential — Apify memory limit) ══\n');
    for (let i = 0; i < customEntries.length; i++) {
      const [key, config] = customEntries[i];
      const res = await testCompany(key, config);
      results.push(res);
      printResult(res);
    }
    console.log('');
  }

  // Summary
  const ok = results.filter(r => r.status === 'OK');
  const empty = results.filter(r => r.status === 'EMPTY');
  const fail = results.filter(r => r.status === 'FAIL' || r.status === 'CRASH' || r.status === 'ERROR');

  console.log('═══════════════════════════════════════════');
  console.log(`SUMMARY: ${ok.length} working, ${empty.length} empty (0 jobs), ${fail.length} failed`);
  console.log(`Total jobs extracted: ${results.reduce((s, r) => s + (r.jobs || 0), 0)}`);

  if (empty.length > 0) {
    console.log(`\n⚠️  Empty (crawled OK but 0 jobs — may be filtered or selectors need fixing):`);
    empty.forEach(r => console.log(`   - ${r.displayName} (${r.ats})`));
  }

  if (fail.length > 0) {
    console.log(`\n❌ Failed:`);
    fail.forEach(r => console.log(`   - ${r.displayName || r.key} (${r.ats || '?'}): ${r.error}`));
  }

  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
