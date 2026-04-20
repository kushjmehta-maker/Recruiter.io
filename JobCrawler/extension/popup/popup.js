// ═══════════════════════════════════════════
// JobCrawler Extension - Popup Controller
// ═══════════════════════════════════════════

let state = {
  userId: null,
  currentPage: 1,
  sortBy: 'combined',
  company: '',
  location: '',
  search: '',
  minRelevance: 0,
  jobs: [],
};

// ───── Init ─────
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['userId', 'email']);
  if (data.userId) {
    state.userId = data.userId;
    showView('jobs');
    loadJobs();
    loadStats();
    loadCompanyFilter();
  } else {
    showView('onboarding');
  }
  chrome.runtime.sendMessage({ type: 'popup-opened' });
  bindEvents();
});

// ───── View Management ─────
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => (v.style.display = 'none'));
  document.getElementById(`view-${name}`).style.display = 'block';
}

// ───── Event Bindings ─────
function bindEvents() {
  // Onboarding form
  document.getElementById('onboarding-form').addEventListener('submit', handleOnboarding);

  // File input label
  document.getElementById('resume').addEventListener('change', (e) => {
    const label = document.getElementById('file-label');
    if (e.target.files.length) {
      label.textContent = e.target.files[0].name;
      label.classList.add('has-file');
    }
  });

  // Role tag input — Enter key or datalist selection
  const roleInput = document.getElementById('role-input');
  roleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag('role', e.target.value.trim());
      e.target.value = '';
    }
  });
  // Handle datalist click selection (fires 'input' after value changes)
  let lastRoleValue = '';
  roleInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    // Datalist selection sets value instantly to a full match
    const options = document.querySelectorAll('#role-suggestions option');
    const isDatalistPick = [...options].some((opt) => opt.value === val);
    if (isDatalistPick && val !== lastRoleValue) {
      addTag('role', val);
      e.target.value = '';
    }
    lastRoleValue = val;
  });

  // Location tag input (onboarding) — Enter key or datalist selection
  const locInput = document.getElementById('location-input');
  locInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag('location', e.target.value.trim());
      e.target.value = '';
    }
  });
  let lastLocValue = '';
  locInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    const options = document.querySelectorAll('#location-suggestions option');
    const isDatalistPick = [...options].some((opt) => opt.value === val);
    if (isDatalistPick && val !== lastLocValue) {
      addTag('location', val);
      e.target.value = '';
    }
    lastLocValue = val;
  });

  // Company select input (onboarding) — dropdown of all companies from API
  const companySelect = document.getElementById('company-input');
  companySelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) {
      // Find display name from the option text
      const displayName = e.target.options[e.target.selectedIndex].textContent;
      addTag('company', val, displayName);
      e.target.value = '';
    }
  });
  // Populate company dropdown from API
  loadOnboardingCompanies();

  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.sortBy = btn.dataset.sort;
      state.currentPage = 1;
      loadJobs();
    });
  });

  // Search
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.search = e.target.value;
      state.currentPage = 1;
      loadJobs();
    }, 300);
  });

  // Location filter (job list)
  let locationTimeout;
  document.getElementById('location-filter').addEventListener('input', (e) => {
    clearTimeout(locationTimeout);
    locationTimeout = setTimeout(() => {
      state.location = e.target.value;
      state.currentPage = 1;
      loadJobs();
    }, 300);
  });

  // Company filter
  document.getElementById('company-filter').addEventListener('change', (e) => {
    state.company = e.target.value;
    state.currentPage = 1;
    loadJobs();
  });

  // Relevance slider
  document.getElementById('relevance-slider').addEventListener('input', (e) => {
    state.minRelevance = parseInt(e.target.value);
    document.getElementById('relevance-val').textContent = state.minRelevance;
  });

  document.getElementById('relevance-slider').addEventListener('change', () => {
    state.currentPage = 1;
    loadJobs();
  });

  // Refresh / crawl
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.textContent = '...';
    btn.disabled = true;
    try {
      await api.triggerCrawl();
      setTimeout(() => loadJobs(), 3000);
    } catch (err) {
      console.error('Crawl trigger failed:', err);
    } finally {
      btn.textContent = '⟳';
      btn.disabled = false;
    }
  });

  // Settings (go back to onboarding to update)
  document.getElementById('btn-settings').addEventListener('click', () => {
    showView('onboarding');
  });

  // Back from detail
  document.getElementById('btn-back').addEventListener('click', () => {
    showView('jobs');
  });

  // Load more
  document.getElementById('load-more').addEventListener('click', () => {
    state.currentPage++;
    loadJobs(true);
  });
}

// ───── Onboarding ─────
const tagState = {
  role: [],
  location: [],
  company: [], // stores { key, displayName } for companies
};

function addTag(type, value, displayName) {
  if (!value) return;
  if (type === 'company') {
    if (tagState.company.some((c) => c.key === value)) return;
    tagState.company.push({ key: value, displayName: displayName || value });
  } else {
    if (tagState[type].includes(value)) return;
    tagState[type].push(value);
  }
  renderTags(type);
}

function removeTag(type, value) {
  if (type === 'company') {
    tagState.company = tagState.company.filter((c) => c.key !== value);
  } else {
    const idx = tagState[type].indexOf(value);
    if (idx > -1) tagState[type].splice(idx, 1);
  }
  renderTags(type);
}

function renderTags(type) {
  const container = document.getElementById(`${type}-tags`);
  const items = type === 'company'
    ? tagState.company.map((c) => ({ display: c.displayName, value: c.key }))
    : tagState[type].map((v) => ({ display: v, value: v }));

  container.innerHTML = items
    .map(
      (item) =>
        `<span class="tag">${escapeHtml(item.display)}<span class="remove" data-type="${type}" data-value="${item.value}">×</span></span>`
    )
    .join('');

  container.querySelectorAll('.remove').forEach((el) => {
    el.addEventListener('click', () => removeTag(el.dataset.type, el.dataset.value));
  });
}

async function handleOnboarding(e) {
  e.preventDefault();

  const btn = document.getElementById('btn-submit');
  const btnText = btn.querySelector('.btn-text');
  const btnLoading = btn.querySelector('.btn-loading');
  const errorEl = document.getElementById('error-msg');

  btn.disabled = true;
  btnText.style.display = 'none';
  btnLoading.style.display = 'inline';
  errorEl.style.display = 'none';

  try {
    const email = document.getElementById('email').value.trim();
    const resumeFile = document.getElementById('resume').files[0];

    if (tagState.role.length === 0) {
      throw new Error('Add at least one target role');
    }

    const formData = new FormData();
    formData.append('email', email);
    formData.append('resume', resumeFile);
    formData.append('targetRoles', JSON.stringify(tagState.role));
    formData.append('preferredLocations', JSON.stringify(tagState.location));
    formData.append('alertCompanies', JSON.stringify(tagState.company.map((c) => c.key)));

    const result = await api.uploadResume(formData);

    state.userId = result.userId;
    await chrome.storage.local.set({
      userId: result.userId,
      email: result.email,
    });

    showView('jobs');
    loadJobs();
    loadStats();
    loadCompanyFilter();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btnText.style.display = 'inline';
    btnLoading.style.display = 'none';
  }
}

// ───── Load Jobs ─────
async function loadJobs(append = false) {
  const listEl = document.getElementById('job-list');
  const loadMoreEl = document.getElementById('load-more');

  if (!append) {
    listEl.innerHTML = '<div class="loading">Loading jobs...</div>';
  }

  try {
    const params = {
      userId: state.userId,
      page: state.currentPage,
      limit: 20,
      sortBy: state.sortBy,
    };
    if (state.company) params.company = state.company;
    if (state.location) params.location = state.location;
    if (state.search) params.search = state.search;
    if (state.minRelevance > 0) params.minRelevance = state.minRelevance;

    const result = await api.getJobs(params);
    const { jobs, pagination } = result;

    if (!append) listEl.innerHTML = '';

    if (jobs.length === 0 && !append) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 48px;">🔍</div>
          <p>No jobs found yet. Click ⟳ to trigger a crawl, or adjust your filters.</p>
        </div>`;
      loadMoreEl.style.display = 'none';
      return;
    }

    jobs.forEach((job) => {
      listEl.appendChild(createJobCard(job));
    });

    loadMoreEl.style.display =
      pagination.page < pagination.pages ? 'block' : 'none';

    state.jobs = append ? [...state.jobs, ...jobs] : jobs;
  } catch (err) {
    if (!append) {
      listEl.innerHTML = `<div class="error">${err.message}</div>`;
    }
  }
}

function createJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.addEventListener('click', () => showJobDetail(job));

  const score = job.relevanceScore || 0;
  let badgeClass = 'relevance-none';
  if (score >= 75) badgeClass = 'relevance-high';
  else if (score >= 50) badgeClass = 'relevance-mid';
  else if (score > 0) badgeClass = 'relevance-low';

  const postedDate = job.postedAt
    ? timeAgo(new Date(job.postedAt))
    : 'Date unknown';

  const salary = job.metadata?.salary || '';
  const postedVia = job.metadata?.postedVia || '';
  const source = job.atsType === 'google-jobs' ? 'Google Jobs' : '';

  card.innerHTML = `
    <div class="job-card-header">
      <div>
        <div class="job-title">${escapeHtml(job.title)}</div>
        <div class="job-company">${escapeHtml(job.companyDisplayName)} · ${escapeHtml(job.location || 'N/A')}</div>
      </div>
      <span class="relevance-badge ${badgeClass}">${score}%</span>
    </div>
    <div class="job-meta">
      <span class="job-meta-item">📅 ${postedDate}</span>
      ${salary ? `<span class="job-meta-item">💰 ${escapeHtml(salary)}</span>` : ''}
      ${job.metadata?.workplaceType ? `<span class="job-meta-item">🏢 ${escapeHtml(job.metadata.workplaceType)}</span>` : ''}
      ${postedVia ? `<span class="job-meta-item">📌 via ${escapeHtml(postedVia)}</span>` : ''}
      ${source ? `<span class="job-meta-item source-badge">🌐 ${source}</span>` : ''}
      ${job.recruiter?.email ? `<span class="job-meta-item">👤 Recruiter found</span>` : ''}
    </div>
  `;
  return card;
}

// ───── Job Detail ─────
function showJobDetail(job) {
  const container = document.getElementById('job-detail');

  const score = job.relevanceScore || 0;
  let badgeClass = 'relevance-none';
  if (score >= 75) badgeClass = 'relevance-high';
  else if (score >= 50) badgeClass = 'relevance-mid';
  else if (score > 0) badgeClass = 'relevance-low';

  const detailSalary = job.metadata?.salary || '';
  const detailPostedVia = job.metadata?.postedVia || '';
  const detailSource = job.atsType === 'google-jobs' ? 'Google Jobs' : job.atsType;

  container.innerHTML = `
    <div class="detail-title">${escapeHtml(job.title)}</div>
    <div class="detail-company">${escapeHtml(job.companyDisplayName)} · ${escapeHtml(job.location || 'N/A')}</div>

    ${detailSalary || detailPostedVia ? `
    <div class="detail-section detail-meta-grid">
      ${detailSalary ? `<div class="detail-meta-item"><span class="detail-meta-label">💰 Salary</span><span>${escapeHtml(detailSalary)}</span></div>` : ''}
      ${detailPostedVia ? `<div class="detail-meta-item"><span class="detail-meta-label">📌 Posted via</span><span>${escapeHtml(detailPostedVia)}</span></div>` : ''}
      <div class="detail-meta-item"><span class="detail-meta-label">🔗 Source</span><span>${escapeHtml(detailSource)}</span></div>
    </div>` : ''}

    <div class="detail-section">
      <h3>Relevance</h3>
      <span class="relevance-badge ${badgeClass}" style="font-size: 14px;">${score}% match</span>
      ${job.relevanceReasoning ? `<p style="margin-top: 6px; font-size: 13px; color: #4b5563;">${escapeHtml(job.relevanceReasoning)}</p>` : ''}
    </div>

    ${job.recruiter?.email || job.recruiter?.linkedinUrl ? `
    <div class="detail-section">
      <h3>Recruiter Contact</h3>
      <div class="recruiter-info">
        ${job.recruiter.name ? `<div><strong>${escapeHtml(job.recruiter.name)}</strong></div>` : ''}
        ${job.recruiter.email ? `<div>📧 <a href="mailto:${escapeHtml(job.recruiter.email)}">${escapeHtml(job.recruiter.email)}</a></div>` : ''}
        ${job.recruiter.linkedinUrl ? `<div>🔗 <a href="${escapeHtml(job.recruiter.linkedinUrl)}" target="_blank">Search recruiters on LinkedIn</a></div>` : ''}
      </div>
    </div>` : ''}

    <div class="detail-section">
      <h3>Description</h3>
      <div class="detail-description">${escapeHtml(job.description || 'No description available.').replace(/\n/g, '<br>')}</div>
    </div>

    <div class="detail-actions">
      <a href="${escapeHtml(job.url)}" target="_blank" class="btn btn-apply">Apply Now →</a>
    </div>
  `;

  showView('detail');
}

// ───── Stats & Filters ─────
async function loadStats() {
  try {
    const stats = await api.getStats();
    document.getElementById('stat-total').textContent = stats.totalActiveJobs;
    document.getElementById('stat-new').textContent = stats.newJobsLast24h;
  } catch {
    // Non-critical
  }
}

async function loadCompanyFilter() {
  try {
    const data = await api.getCompanies();
    const select = document.getElementById('company-filter');
    data.companies
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.key;
        opt.textContent = c.displayName;
        select.appendChild(opt);
      });
  } catch {
    // Non-critical
  }
}

async function loadOnboardingCompanies() {
  try {
    const data = await api.getCompanies();
    const select = document.getElementById('company-input');
    data.companies
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.key;
        opt.textContent = c.displayName;
        select.appendChild(opt);
      });
  } catch {
    // Non-critical
  }
}

// ───── Helpers ─────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}
