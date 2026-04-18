// Company Registry — central configuration for all crawl targets
// atsType: "greenhouse" | "workday" | "lever" | "custom"

const companies = {
  // ═══════════════════════════════════════════
  // GREENHOUSE (public JSON API)
  // ═══════════════════════════════════════════
  airbnb:       { ats: 'greenhouse', slug: 'airbnb',       displayName: 'Airbnb',       url: 'https://careers.airbnb.com/' },
  stripe:       { ats: 'greenhouse', slug: 'stripe',       displayName: 'Stripe',       url: 'https://stripe.com/jobs' },
  cloudflare:   { ats: 'greenhouse', slug: 'cloudflare',   displayName: 'Cloudflare',   url: 'https://www.cloudflare.com/careers/' },
  twilio:       { ats: 'greenhouse', slug: 'twilio',       displayName: 'Twilio',       url: 'https://www.twilio.com/company/jobs' },
  okta:         { ats: 'greenhouse', slug: 'okta',         displayName: 'Okta',         url: 'https://www.okta.com/company/careers/' },
  postman:      { ats: 'greenhouse', slug: 'postman',      displayName: 'Postman',      url: 'https://www.postman.com/company/careers/' },

  // Greenhouse — slugs need discovery (fall through to custom/apify if 0 results)
  atlassian:    { ats: 'greenhouse', slug: 'atlassian',    displayName: 'Atlassian',    url: 'https://www.atlassian.com/company/careers', fallbackToApify: true },
  zeta:         { ats: 'greenhouse', slug: 'zetaglobal',    displayName: 'Zeta',         url: 'https://careers.zeta.tech/' },
  snowflake:    { ats: 'greenhouse', slug: 'snowflakecomputing', displayName: 'Snowflake', url: 'https://careers.snowflake.com/', fallbackToApify: true },
  hashicorp:    { ats: 'greenhouse', slug: 'hashicorp',    displayName: 'HashiCorp',    url: 'https://www.hashicorp.com/careers', fallbackToApify: true },
  zomato:       { ats: 'greenhouse', slug: 'zomato',       displayName: 'Zomato',       url: 'https://www.zomato.com/careers', fallbackToApify: true },
  dream11:      { ats: 'greenhouse', slug: 'dream11',      displayName: 'Dream11',      url: 'https://www.dreamsports.group/careers/', fallbackToApify: true },
  browserstack: { ats: 'greenhouse', slug: 'browserstack', displayName: 'BrowserStack', url: 'https://www.browserstack.com/careers', fallbackToApify: true },
  sharechat:    { ats: 'greenhouse', slug: 'sharechat',    displayName: 'ShareChat',    url: 'https://sharechat.com/careers', fallbackToApify: true },

  // ═══════════════════════════════════════════
  // WORKDAY (POST-based JSON API)
  // host: subdomain of myworkdayjobs.com
  // org: organization identifier in URL path
  // site: career site slug in URL path
  // ═══════════════════════════════════════════
  nvidia:  { ats: 'workday', host: 'nvidia.wd5',  org: 'nvidia',  site: 'NVIDIAExternalCareerSite', displayName: 'NVIDIA',  url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' },
  adobe:   { ats: 'workday', host: 'adobe.wd5',   org: 'adobe',   site: 'external_experienced',     displayName: 'Adobe',   url: 'https://careers.adobe.com/' },
  zoom:    { ats: 'workday', host: 'zoom.wd5',    org: 'zoom',    site: 'Zoom',                     displayName: 'Zoom',    url: 'https://careers.zoom.us/home' },

  // Workday — site slugs need discovery
  vmware:      { ats: 'workday', host: 'vmware.wd1',      org: 'vmware',      site: 'VMwareExternalCareerSite', displayName: 'VMware',      url: 'https://careers.vmware.com/', fallbackToApify: true },
  servicenow:  { ats: 'workday', host: 'servicenow.wd1',  org: 'servicenow',  site: 'ServiceNowCareers',        displayName: 'ServiceNow',  url: 'https://www.servicenow.com/careers.html', fallbackToApify: true },
  qualcomm:    { ats: 'workday', host: 'qualcomm.wd5',    org: 'qualcomm',    site: 'External',                 displayName: 'Qualcomm',    url: 'https://www.qualcomm.com/company/careers', fallbackToApify: true },
  intel:       { ats: 'workday', host: 'intel.wd1',       org: 'intel',       site: 'External',                 displayName: 'Intel',       url: 'https://jobs.intel.com/' },
  amd:         { ats: 'workday', host: 'amd.wd1',         org: 'amd',         site: 'AMD',                      displayName: 'AMD',         url: 'https://careers.amd.com/', fallbackToApify: true },
  ti:          { ats: 'workday', host: 'ti.wd1',          org: 'ti',          site: 'Careers',                  displayName: 'Texas Instruments', url: 'https://careers.ti.com/', fallbackToApify: true },
  freshworks:  { ats: 'workday', host: 'freshworks.wd1',  org: 'freshworks',  site: 'Careers',                  displayName: 'Freshworks',  url: 'https://careers.freshworks.com/', fallbackToApify: true },

  // ═══════════════════════════════════════════
  // LEVER (public JSON API)
  // ═══════════════════════════════════════════
  razorpay: { ats: 'lever', slug: 'razorpay', displayName: 'Razorpay', url: 'https://razorpay.com/jobs/', fallbackToApify: true },

  // ═══════════════════════════════════════════
  // CUSTOM PORTALS (Apify web scraping)
  // ═══════════════════════════════════════════
  google:     { ats: 'custom', displayName: 'Google',     url: 'https://careers.google.com/locations/india/', apifyConfig: { startUrl: 'https://www.google.com/about/careers/applications/jobs/results/?location=India', pageFunction: 'google' }},
  microsoft:  { ats: 'custom', displayName: 'Microsoft',  url: 'https://careers.microsoft.com/us/en/india-jobs', apifyConfig: { startUrl: 'https://careers.microsoft.com/us/en/search-results?rt=professional&l=India', pageFunction: 'microsoft' }},
  amazon:     { ats: 'custom', displayName: 'Amazon',     url: 'https://www.amazon.jobs/en/locations/india', apifyConfig: { startUrl: 'https://www.amazon.jobs/en/search?base_query=&loc_query=India', pageFunction: 'amazon' }},
  apple:      { ats: 'custom', displayName: 'Apple',      url: 'https://jobs.apple.com/en-in', apifyConfig: { startUrl: 'https://jobs.apple.com/en-in/search?sort=newest', pageFunction: 'apple' }},
  meta:       { ats: 'custom', displayName: 'Meta',       url: 'https://www.metacareers.com/', apifyConfig: { startUrl: 'https://www.metacareers.com/jobs', pageFunction: 'meta' }},
  netflix:    { ats: 'custom', displayName: 'Netflix',    url: 'https://jobs.netflix.com/', apifyConfig: { startUrl: 'https://jobs.netflix.com/search', pageFunction: 'netflix' }},
  uber:       { ats: 'custom', displayName: 'Uber',       url: 'https://www.uber.com/global/en/careers/', apifyConfig: { startUrl: 'https://www.uber.com/global/en/careers/list/', pageFunction: 'uber' }},
  salesforce: { ats: 'custom', displayName: 'Salesforce',  url: 'https://www.salesforce.com/company/careers/', apifyConfig: { startUrl: 'https://careers.salesforce.com/en/jobs/', pageFunction: 'salesforce' }},
  paypal:     { ats: 'custom', displayName: 'PayPal',     url: 'https://www.paypal.com/in/webapps/mpp/jobs', apifyConfig: { startUrl: 'https://paypal.eightfold.ai/careers?query=&location=India', pageFunction: 'paypal' }},
  phonepe:    { ats: 'custom', displayName: 'PhonePe',    url: 'https://www.phonepe.com/careers/', apifyConfig: { startUrl: 'https://www.phonepe.com/careers/', pageFunction: 'phonepe' }},
  cred:       { ats: 'custom', displayName: 'CRED',       url: 'https://careers.cred.club/', apifyConfig: { startUrl: 'https://careers.cred.club/', pageFunction: 'cred' }},
  juspay:     { ats: 'custom', displayName: 'Juspay',     url: 'https://juspay.in/careers', apifyConfig: { startUrl: 'https://juspay.in/careers', pageFunction: 'juspay' }},
  pinelabs:   { ats: 'custom', displayName: 'Pine Labs',  url: 'https://www.pinelabs.com/careers', apifyConfig: { startUrl: 'https://www.pinelabs.com/careers', pageFunction: 'pinelabs' }},
  nutanix:    { ats: 'custom', displayName: 'Nutanix',    url: 'https://www.nutanix.com/company/careers', apifyConfig: { startUrl: 'https://nutanix.eightfold.ai/careers', pageFunction: 'nutanix' }},
  databricks: { ats: 'custom', displayName: 'Databricks',  url: 'https://www.databricks.com/company/careers', apifyConfig: { startUrl: 'https://www.databricks.com/company/careers/open-positions', pageFunction: 'databricks' }},
  intuit:     { ats: 'custom', displayName: 'Intuit',     url: 'https://careers.intuit.com/', apifyConfig: { startUrl: 'https://jobs.intuit.com/search-jobs', pageFunction: 'intuit' }},
  linkedin:   { ats: 'custom', displayName: 'LinkedIn',   url: 'https://careers.linkedin.com/', apifyConfig: { startUrl: 'https://careers.linkedin.com/search', pageFunction: 'linkedin' }},
  hubspot:    { ats: 'custom', displayName: 'HubSpot',    url: 'https://www.hubspot.com/careers', apifyConfig: { startUrl: 'https://www.hubspot.com/careers/jobs', pageFunction: 'hubspot' }},
  flipkart:   { ats: 'custom', displayName: 'Flipkart',   url: 'https://www.flipkartcareers.com/', apifyConfig: { startUrl: 'https://www.flipkartcareers.com/#!/joblist', pageFunction: 'flipkart' }},
  meesho:     { ats: 'custom', displayName: 'Meesho',     url: 'https://careers.meesho.com/', apifyConfig: { startUrl: 'https://careers.meesho.com/', pageFunction: 'meesho' }},
  swiggy:     { ats: 'custom', displayName: 'Swiggy',     url: 'https://careers.swiggy.com/', apifyConfig: { startUrl: 'https://careers.swiggy.com/', pageFunction: 'swiggy' }},
  zoho:       { ats: 'custom', displayName: 'Zoho',       url: 'https://www.zoho.com/careers.html', apifyConfig: { startUrl: 'https://www.zoho.com/careers.html', pageFunction: 'zoho' }},
  upstox:     { ats: 'custom', displayName: 'Upstox',     url: 'https://upstox.com/careers/', apifyConfig: { startUrl: 'https://upstox.com/careers/', pageFunction: 'upstox' }},
  micron:     { ats: 'custom', displayName: 'Micron Technology', url: 'https://micron.eightfold.ai/careers', apifyConfig: { startUrl: 'https://micron.eightfold.ai/careers', pageFunction: 'micron' }},
  sap:        { ats: 'custom', displayName: 'SAP',        url: 'https://jobs.sap.com/', apifyConfig: { startUrl: 'https://jobs.sap.com/search/?q=&locationsearch=India', pageFunction: 'sap' }},
};

// Helper: get companies by ATS type
const getByAtsType = (type) =>
  Object.entries(companies)
    .filter(([, c]) => c.ats === type)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

// Helper: get all company keys
const getAllKeys = () => Object.keys(companies);

module.exports = { companies, getByAtsType, getAllKeys };
