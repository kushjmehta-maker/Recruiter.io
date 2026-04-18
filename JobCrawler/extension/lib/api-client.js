const API_BASE = 'https://jobcrawler-func.azurewebsites.net/api';
const API_KEY = 'dcec9d9bf19d9ff3f036b6ba658ee28a3d2a82ecad7eb5d8a7962f26e3390722';

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE;
  }

  async request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        ...options.headers,
      },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  // User
  async registerUser(email, targetRoles) {
    return this.request('/users/register', {
      method: 'POST',
      body: JSON.stringify({ email, targetRoles }),
    });
  }

  async getUser(userId) {
    return this.request(`/users/${userId}`);
  }

  // Resume upload
  async uploadResume(formData) {
    const res = await fetch(`${this.baseUrl}/upload/resume`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: formData, // multipart — no Content-Type header
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  }

  // Jobs
  async getJobs(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/jobs?${query}`);
  }

  async getJob(id) {
    return this.request(`/jobs/${id}`);
  }

  async getCompanies() {
    return this.request('/jobs/companies');
  }

  async getStats() {
    return this.request('/jobs/stats');
  }

  // Crawl
  async triggerCrawl(options = {}) {
    return this.request('/crawl/trigger', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getCrawlStatus(runId) {
    return this.request(`/crawl/status/${runId}`);
  }
}

const api = new ApiClient();
