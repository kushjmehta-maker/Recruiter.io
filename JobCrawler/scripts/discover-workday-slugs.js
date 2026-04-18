/**
 * Discover Workday career site slugs for companies where the site slug is unknown.
 * Run: node scripts/discover-workday-slugs.js
 */

const COMMON_SITE_SLUGS = [
  'External', 'ExternalCareerSite', 'Careers', 'en',
  'external_experienced', 'ExternalSite', 'CareersExternal',
];

const WORKDAY_COMPANIES = [
  { name: 'VMware', host: 'vmware.wd1', org: 'vmware' },
  { name: 'ServiceNow', host: 'servicenow.wd1', org: 'servicenow' },
  { name: 'Qualcomm', host: 'qualcomm.wd5', org: 'qualcomm' },
  { name: 'Intel', host: 'intel.wd1', org: 'intel' },
  { name: 'AMD', host: 'amd.wd1', org: 'amd' },
  { name: 'Texas Instruments', host: 'ti.wd1', org: 'ti' },
  { name: 'Freshworks', host: 'freshworks.wd1', org: 'freshworks' },
];

async function discoverSlug(company) {
  console.log(`\n── ${company.name} (${company.host}) ──`);

  // Also try company-name-specific slugs
  const customSlugs = [
    company.name.replace(/\s+/g, ''),
    `${company.name.replace(/\s+/g, '')}ExternalCareerSite`,
    `${company.name.replace(/\s+/g, '')}Careers`,
  ];

  const allSlugs = [...COMMON_SITE_SLUGS, ...customSlugs];

  for (const site of allSlugs) {
    const url = `https://${company.host}.myworkdayjobs.com/wday/cxs/${company.org}/${site}/jobs`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 1, offset: 0 }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`  ✅ site="${site}" → ${data.total || 0} jobs`);
        return;
      } else {
        console.log(`  ❌ site="${site}" → ${res.status}`);
      }
    } catch (err) {
      console.log(`  ❌ site="${site}" → ${err.message}`);
    }
  }

  console.log(`  ⚠️  No working slug found for ${company.name}`);
}

async function main() {
  for (const company of WORKDAY_COMPANIES) {
    await discoverSlug(company);
  }
  process.exit(0);
}

main().catch(console.error);
