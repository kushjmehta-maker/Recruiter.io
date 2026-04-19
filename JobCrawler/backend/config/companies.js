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
  zeta:         { ats: 'greenhouse', slug: 'zetaglobal',    displayName: 'Zeta',         url: 'https://careers.zeta.tech/' },
  razorpay:     { ats: 'greenhouse', slug: 'razorpaysoftwareprivatelimited', displayName: 'Razorpay', url: 'https://razorpay.com/jobs/' },

  // Greenhouse — these companies moved off Greenhouse, fall through to Apify
  zomato:       { ats: 'greenhouse', slug: 'zomato',       displayName: 'Zomato',       url: 'https://www.zomato.com/careers', fallbackToApify: true, apifyConfig: { startUrl: 'https://www.zomato.com/careers' } },
  dream11:      { ats: 'greenhouse', slug: 'dream11',      displayName: 'Dream11',      url: 'https://www.dreamsports.group/careers/', fallbackToApify: true, apifyConfig: { startUrl: 'https://www.dreamsports.group/careers/' } },
  browserstack: { ats: 'greenhouse', slug: 'browserstack', displayName: 'BrowserStack', url: 'https://www.browserstack.com/careers', fallbackToApify: true, apifyConfig: { startUrl: 'https://www.browserstack.com/careers' } },
  sharechat:    { ats: 'greenhouse', slug: 'sharechat',    displayName: 'ShareChat',    url: 'https://sharechat.com/careers', fallbackToApify: true, apifyConfig: { startUrl: 'https://sharechat.com/careers' } },

  // ═══════════════════════════════════════════
  // WORKDAY (POST-based JSON API)
  // host: subdomain of myworkdayjobs.com
  // org: organization identifier in URL path
  // site: career site slug in URL path
  // ═══════════════════════════════════════════
  nvidia:  { ats: 'workday', host: 'nvidia.wd5',  org: 'nvidia',  site: 'NVIDIAExternalCareerSite', displayName: 'NVIDIA',  url: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite' },
  adobe:   { ats: 'workday', host: 'adobe.wd5',   org: 'adobe',   site: 'external_experienced',     displayName: 'Adobe',   url: 'https://careers.adobe.com/' },
  zoom:    { ats: 'workday', host: 'zoom.wd5',    org: 'zoom',    site: 'Zoom',                     displayName: 'Zoom',    url: 'https://careers.zoom.us/home' },
  intel:   { ats: 'workday', host: 'intel.wd1',   org: 'intel',   site: 'External',                 displayName: 'Intel',   url: 'https://jobs.intel.com/' },
  // VMware merged into Broadcom — updated endpoint
  vmware:  { ats: 'workday', host: 'broadcom.wd1', org: 'broadcom', site: 'External_Career', displayName: 'Broadcom (VMware)', url: 'https://broadcom.wd1.myworkdayjobs.com/External_Career' },

  // Workday — companies that moved off Workday, now use custom/Apify scraping
  servicenow:  { ats: 'custom', displayName: 'ServiceNow',      url: 'https://www.servicenow.com/careers.html', apifyConfig: { startUrl: 'https://servicenow.wd1.myworkdayjobs.com/careers', pageFunction: 'servicenow' } },
  qualcomm:    { ats: 'custom', displayName: 'Qualcomm',        url: 'https://www.qualcomm.com/company/careers', apifyConfig: { startUrl: 'https://www.qualcomm.com/company/careers', pageFunction: 'qualcomm' } },
  amd:         { ats: 'custom', displayName: 'AMD',              url: 'https://careers.amd.com/',  apifyConfig: { startUrl: 'https://careers.amd.com/careers-home/jobs', pageFunction: 'amd' } },
  ti:          { ats: 'custom', displayName: 'Texas Instruments', url: 'https://careers.ti.com/', apifyConfig: { startUrl: 'https://careers.ti.com/', pageFunction: 'ti' } },
  freshworks:  { ats: 'custom', displayName: 'Freshworks',      url: 'https://careers.freshworks.com/', apifyConfig: { startUrl: 'https://careers.smartrecruiters.com/Freshworks', pageFunction: 'freshworks' } },

  // ═══════════════════════════════════════════
  // CUSTOM PORTALS — moved off old ATS platforms
  // Atlassian: uses Beamery/custom React app
  // Snowflake: uses Phenom
  // HashiCorp: now IBM
  // ═══════════════════════════════════════════
  atlassian:  { ats: 'custom', displayName: 'Atlassian',  url: 'https://www.atlassian.com/company/careers', apifyConfig: { startUrl: 'https://www.atlassian.com/company/careers/all-jobs', pageFunction: 'atlassian' } },
  snowflake:  { ats: 'custom', displayName: 'Snowflake',  url: 'https://careers.snowflake.com/', apifyConfig: { startUrl: 'https://careers.snowflake.com/us/en', pageFunction: 'snowflake' } },
  hashicorp:  { ats: 'custom', displayName: 'HashiCorp',  url: 'https://www.hashicorp.com/careers', apifyConfig: { startUrl: 'https://www.ibm.com/careers/search?field_keyword_18[0]=HashiCorp', pageFunction: 'hashicorp' } },

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
