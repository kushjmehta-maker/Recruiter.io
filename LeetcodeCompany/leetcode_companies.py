#!/usr/bin/env python3
"""
LeetCode Premium - Company-wise Questions Scraper
Uses the companyTag GraphQL query to fetch accurate company-question mappings.
Outputs HTML, Markdown, and JSON reports.
"""

import json
import urllib.request
import urllib.error
import time
import sys
import os
import random
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
LEETCODE_SESSION = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfYXV0aF91c2VyX2lkIjoiMTkwMjU3NCIsIl9hdXRoX3VzZXJfYmFja2VuZCI6ImFsbGF1dGguYWNjb3VudC5hdXRoX2JhY2tlbmRzLkF1dGhlbnRpY2F0aW9uQmFja2VuZCIsIl9hdXRoX3VzZXJfaGFzaCI6ImY3YjQ4ZGZlZTgxYzFiOTk5ZjgyMDJjNzdhNjk4YTAyZTc2Y2Y4NjNlNjk3YjI4MTFmMTQ3MjRkMGZkYmMwNjUiLCJzZXNzaW9uX3V1aWQiOiJiMzdiZDhmNCIsImlkIjoxOTAyNTc0LCJlbWFpbCI6InNhdXJhYmhiaDIxQGdtYWlsLmNvbSIsInVzZXJuYW1lIjoiYmhhZ3ZhdHVsYSIsInVzZXJfc2x1ZyI6ImJoYWd2YXR1bGEiLCJhdmF0YXIiOiJodHRwczovL2Fzc2V0cy5sZWV0Y29kZS5jb20vdXNlcnMvYmhhZ3ZhdHVsYS9hdmF0YXJfMTU5MDkxMzQ3Mi5wbmciLCJyZWZyZXNoZWRfYXQiOjE3NzY1MTA4MDMsImlwIjoiMjQwNToyMDE6YzAzYzo3OTo2NDE0OmI2ZTY6NDllZDpiMzlmIiwiaWRlbnRpdHkiOiI5NThkNWU1M2RiYTdlMGFmODEyZWEwZWUwZTRlODI5MyIsImRldmljZV93aXRoX2lwIjpbIjNiMTZiNmMxNGFhMzEwYTgwYjlmNTgzODU0ZmNkMGE3IiwiMjQwNToyMDE6YzAzYzo3OTo2NDE0OmI2ZTY6NDllZDpiMzlmIl0sIl9zZXNzaW9uX2V4cGlyeSI6MTIwOTYwMH0.6Zdq4DEVEVeCuDUW3sCo_Sbjf25RPnZHs2xIqAgDOlQ"
CSRF_TOKEN = "kGiU3XyL1jjEg8NfK5Xiskmy7c0oeHZy"

GRAPHQL_URL = "https://leetcode.com/graphql"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_FILE = os.path.join(OUTPUT_DIR, ".leetcode_checkpoint.json")

# ── Rate Limiting Config ────────────────────────────────────────────────────
BASE_DELAY = 1.5          # Base delay between requests (seconds)
JITTER_RANGE = 0.5        # Random jitter added to delay
BATCH_SIZE = 25            # Companies before a long pause
BATCH_PAUSE = 15           # Seconds to pause between batches
MAX_RETRIES = 5            # Max retries per request
BACKOFF_FACTOR = 2         # Exponential backoff multiplier
BACKOFF_BASE = 5           # Base wait on first retry (seconds)
REQUEST_TIMEOUT = 60       # Timeout per HTTP request (seconds)
RATE_LIMIT_PAUSE = 60      # Pause when rate-limited (429) (seconds)

# ── GraphQL Queries ─────────────────────────────────────────────────────────
COMPANY_TAGS_QUERY = """
query {
  companyTags {
    name
    slug
    questionCount
  }
}
"""

# This is the CORRECT query - fetches questions directly from the company tag
COMPANY_TAG_QUESTIONS_QUERY = """
query getCompanyTag($slug: String!) {
  companyTag(slug: $slug) {
    name
    slug
    questionCount
    questions {
      title
      titleSlug
      difficulty
      questionFrontendId
      isPaidOnly
    }
  }
}
"""


# ── Helpers ─────────────────────────────────────────────────────────────────
class RateLimiter:
    def __init__(self):
        self.request_count = 0
        self.company_count = 0
        self.batch_count = 0
        self.last_request_time = 0
        self.consecutive_errors = 0

    def wait(self):
        elapsed = time.time() - self.last_request_time
        delay = BASE_DELAY + random.uniform(0, JITTER_RANGE)
        if self.consecutive_errors > 0:
            delay += self.consecutive_errors * 2
        remaining = delay - elapsed
        if remaining > 0:
            time.sleep(remaining)
        self.last_request_time = time.time()
        self.request_count += 1

    def company_done(self):
        self.company_count += 1
        if self.company_count > 0 and self.company_count % BATCH_SIZE == 0:
            self.batch_count += 1
            pause = BATCH_PAUSE + random.uniform(0, 5)
            print(f"\n  [Batch {self.batch_count}] {self.company_count} companies done. "
                  f"Cooling {pause:.0f}s...")
            time.sleep(pause)

    def report_success(self):
        self.consecutive_errors = 0

    def report_error(self):
        self.consecutive_errors += 1


rate_limiter = RateLimiter()


def graphql_request(query, variables=None):
    """Make an authenticated GraphQL request with retry + exponential backoff."""
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")

    for attempt in range(MAX_RETRIES + 1):
        if attempt == 0:
            rate_limiter.wait()

        req = urllib.request.Request(GRAPHQL_URL, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Cookie", f"LEETCODE_SESSION={LEETCODE_SESSION}; csrftoken={CSRF_TOKEN}")
        req.add_header("x-csrftoken", CSRF_TOKEN)
        req.add_header("Referer", "https://leetcode.com")
        req.add_header("User-Agent",
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")

        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
                rate_limiter.report_success()
                return data
        except urllib.error.HTTPError as e:
            rate_limiter.report_error()
            if e.code == 429:
                wait = RATE_LIMIT_PAUSE * (attempt + 1) + random.uniform(0, 10)
                print(f"\n  [429 RATE LIMITED] Waiting {wait:.0f}s ({attempt+1}/{MAX_RETRIES})...")
                time.sleep(wait)
                continue
            elif e.code == 403:
                wait = BACKOFF_BASE * (BACKOFF_FACTOR ** attempt) + random.uniform(0, 3)
                print(f"\n  [403 Forbidden] Retrying in {wait:.0f}s ({attempt+1}/{MAX_RETRIES})...")
                time.sleep(wait)
                continue
            elif e.code >= 500:
                wait = BACKOFF_BASE * (BACKOFF_FACTOR ** attempt) + random.uniform(0, 3)
                print(f"\n  [HTTP {e.code}] Retrying in {wait:.0f}s ({attempt+1}/{MAX_RETRIES})...")
                time.sleep(wait)
                continue
            else:
                body = e.read().decode()[:200] if e.fp else ""
                print(f"\n  [HTTP {e.code}]: {body}")
                return None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            rate_limiter.report_error()
            if attempt < MAX_RETRIES:
                wait = BACKOFF_BASE * (BACKOFF_FACTOR ** attempt) + random.uniform(0, 3)
                print(f"\n  [Network Error] {e}. Retrying in {wait:.0f}s ({attempt+1}/{MAX_RETRIES})...")
                time.sleep(wait)
                continue
            print(f"\n  [Network Error] {e} — giving up")
            return None
        except Exception as e:
            rate_limiter.report_error()
            print(f"\n  [Unexpected Error] {e}")
            return None
    return None


def fetch_all_companies():
    """Fetch the list of all company tags."""
    print("Fetching company list...")
    result = graphql_request(COMPANY_TAGS_QUERY)
    if not result or "data" not in result or not result["data"].get("companyTags"):
        print("Failed to fetch companies. Check credentials.")
        print(f"Response: {json.dumps(result, indent=2)[:500] if result else 'None'}")
        sys.exit(1)

    companies = result["data"]["companyTags"]
    # Filter out companies with 0 questions
    companies = [c for c in companies if c.get("questionCount", 0) > 0]
    companies.sort(key=lambda c: c.get("questionCount", 0), reverse=True)
    print(f"Found {len(companies)} companies with questions.\n")
    return companies


def fetch_company_questions(slug):
    """Fetch questions for a company using the companyTag query (accurate, single request)."""
    result = graphql_request(COMPANY_TAG_QUESTIONS_QUERY, {"slug": slug})
    if not result or "data" not in result:
        return None

    tag = result["data"].get("companyTag")
    if not tag:
        return None

    questions = tag.get("questions", [])
    return questions


# ── Checkpoint (resume support) ─────────────────────────────────────────────
def save_checkpoint(all_data, completed_slugs):
    checkpoint = {
        "completed_slugs": list(completed_slugs),
        "data": all_data,
        "timestamp": datetime.now().isoformat(),
        "version": 2  # Mark as v2 (companyTag-based)
    }
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(checkpoint, f)


def load_checkpoint():
    if not os.path.exists(CHECKPOINT_FILE):
        return {}, set()
    try:
        with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
            checkpoint = json.load(f)
        # Only resume v2 checkpoints (companyTag-based)
        if checkpoint.get("version") != 2:
            print("  Old checkpoint found (v1, incorrect data). Starting fresh.\n")
            return {}, set()
        data = checkpoint.get("data", {})
        slugs = set(checkpoint.get("completed_slugs", []))
        ts = checkpoint.get("timestamp", "unknown")
        print(f"  Resuming from checkpoint ({ts}) — {len(slugs)} companies already fetched.\n")
        return data, slugs
    except (json.JSONDecodeError, KeyError):
        return {}, set()


def clear_checkpoint():
    if os.path.exists(CHECKPOINT_FILE):
        os.remove(CHECKPOINT_FILE)


def difficulty_color(d):
    return {"Easy": "#00b8a3", "Medium": "#ffc01e", "Hard": "#ff375f"}.get(d, "#888")


def difficulty_emoji(d):
    return {"Easy": "🟢", "Medium": "🟡", "Hard": "🔴"}.get(d, "⚪")


# ── HTML Generator ──────────────────────────────────────────────────────────
def generate_html(all_data):
    total_q = sum(len(qs) for qs in all_data.values())
    # Count unique questions
    unique_slugs = set()
    for qs in all_data.values():
        for q in qs:
            unique_slugs.add(q.get("titleSlug", ""))
    timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LeetCode Company-Wise Questions</title>
<style>
  :root {{
    --bg: #1a1a2e;
    --card: #16213e;
    --accent: #0f3460;
    --text: #e4e4e4;
    --muted: #8892b0;
    --easy: #00b8a3;
    --medium: #ffc01e;
    --hard: #ff375f;
    --border: #233554;
  }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
  }}
  .header {{
    background: linear-gradient(135deg, #0f3460 0%, #533483 100%);
    padding: 40px 20px;
    text-align: center;
    position: sticky; top: 0; z-index: 100;
  }}
  .header h1 {{ font-size: 2em; margin-bottom: 8px; }}
  .header p {{ color: #ccc; font-size: 0.95em; }}
  .stats {{
    display: flex; justify-content: center; gap: 30px;
    margin-top: 16px; flex-wrap: wrap;
  }}
  .stat {{ text-align: center; }}
  .stat .num {{ font-size: 1.8em; font-weight: 700; color: #fff; }}
  .stat .label {{ font-size: 0.8em; color: #aaa; text-transform: uppercase; letter-spacing: 1px; }}
  .search-bar {{
    max-width: 600px; margin: 20px auto 0;
    display: flex; gap: 10px;
  }}
  .search-bar input {{
    flex: 1; padding: 12px 16px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--card);
    color: var(--text); font-size: 1em; outline: none;
  }}
  .search-bar input:focus {{ border-color: #533483; }}
  .container {{ max-width: 1200px; margin: 30px auto; padding: 0 20px; }}
  .toc {{
    background: var(--card); border-radius: 12px; padding: 24px;
    margin-bottom: 30px; border: 1px solid var(--border);
  }}
  .toc h2 {{ margin-bottom: 16px; font-size: 1.3em; }}
  .toc-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }}
  .toc-item {{
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; border-radius: 6px; background: var(--accent);
    text-decoration: none; color: var(--text); font-size: 0.9em;
    transition: background 0.2s;
  }}
  .toc-item:hover {{ background: #1a4080; }}
  .toc-item .count {{
    background: #533483; padding: 2px 8px; border-radius: 12px;
    font-size: 0.8em; font-weight: 600;
  }}
  .company-section {{
    background: var(--card); border-radius: 12px;
    margin-bottom: 20px; border: 1px solid var(--border);
    overflow: hidden;
  }}
  .company-header {{
    padding: 20px 24px;
    cursor: pointer; display: flex;
    justify-content: space-between; align-items: center;
    background: var(--accent);
    user-select: none;
  }}
  .company-header:hover {{ background: #1a4080; }}
  .company-header h2 {{ font-size: 1.2em; }}
  .company-header .badge {{
    display: flex; gap: 10px; align-items: center;
  }}
  .company-header .badge span {{
    padding: 4px 10px; border-radius: 12px; font-size: 0.8em; font-weight: 600;
  }}
  .badge .easy {{ background: rgba(0,184,163,0.2); color: var(--easy); }}
  .badge .medium {{ background: rgba(255,192,30,0.2); color: var(--medium); }}
  .badge .hard {{ background: rgba(255,55,95,0.2); color: var(--hard); }}
  .badge .total {{ background: rgba(83,52,131,0.3); color: #ccc; }}
  .company-body {{ display: none; padding: 0; }}
  .company-body.open {{ display: block; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th {{
    background: rgba(15,52,96,0.5); padding: 12px 16px;
    text-align: left; font-size: 0.85em; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.5px;
    position: sticky; top: 0;
  }}
  td {{ padding: 10px 16px; border-top: 1px solid var(--border); font-size: 0.92em; }}
  tr:hover td {{ background: rgba(15,52,96,0.3); }}
  .q-link {{ color: #7eb8f7; text-decoration: none; }}
  .q-link:hover {{ text-decoration: underline; }}
  .diff {{
    padding: 3px 10px; border-radius: 12px; font-size: 0.8em; font-weight: 600;
    display: inline-block;
  }}
  .diff-Easy {{ background: rgba(0,184,163,0.15); color: var(--easy); }}
  .diff-Medium {{ background: rgba(255,192,30,0.15); color: var(--medium); }}
  .diff-Hard {{ background: rgba(255,55,95,0.15); color: var(--hard); }}
  .premium-tag {{
    background: rgba(255,165,0,0.15); color: #ffa500;
    padding: 2px 8px; border-radius: 8px; font-size: 0.75em; margin-left: 6px;
  }}
  .arrow {{ transition: transform 0.3s; font-size: 1.2em; }}
  .arrow.open {{ transform: rotate(90deg); }}
  .footer {{
    text-align: center; padding: 40px; color: var(--muted); font-size: 0.85em;
  }}
  @media (max-width: 768px) {{
    .header h1 {{ font-size: 1.4em; }}
    .stats {{ gap: 15px; }}
    .toc-grid {{ grid-template-columns: 1fr; }}
    td, th {{ padding: 8px 10px; font-size: 0.85em; }}
  }}
</style>
</head>
<body>

<div class="header">
  <h1>LeetCode Company-Wise Questions</h1>
  <p>Premium question bank organized by company &mdash; Generated {timestamp}</p>
  <div class="stats">
    <div class="stat"><div class="num">{len(all_data)}</div><div class="label">Companies</div></div>
    <div class="stat"><div class="num">{len(unique_slugs):,}</div><div class="label">Unique Questions</div></div>
    <div class="stat"><div class="num">{total_q:,}</div><div class="label">Total Mappings</div></div>
  </div>
  <div class="search-bar">
    <input type="text" id="search" placeholder="Search companies or questions..." oninput="filterAll(this.value)">
  </div>
</div>

<div class="container">
  <div class="toc" id="toc">
    <h2>Companies Index</h2>
    <div class="toc-grid">
"""

    for company, questions in all_data.items():
        slug = company.lower().replace(" ", "-").replace("&", "and")
        html += f'      <a class="toc-item" href="#company-{slug}" onclick="openSection(\'{slug}\')">{company}<span class="count">{len(questions)}</span></a>\n'

    html += """    </div>
  </div>
"""

    for company, questions in all_data.items():
        slug = company.lower().replace(" ", "-").replace("&", "and")
        easy = sum(1 for q in questions if q.get("difficulty") == "Easy")
        med = sum(1 for q in questions if q.get("difficulty") == "Medium")
        hard = sum(1 for q in questions if q.get("difficulty") == "Hard")

        html += f"""
  <div class="company-section" id="company-{slug}" data-name="{company.lower()}">
    <div class="company-header" onclick="toggle(this)">
      <h2>{company}</h2>
      <div class="badge">
        <span class="easy">Easy {easy}</span>
        <span class="medium">Med {med}</span>
        <span class="hard">Hard {hard}</span>
        <span class="total">Total {len(questions)}</span>
        <span class="arrow">&#9654;</span>
      </div>
    </div>
    <div class="company-body">
      <table>
        <thead><tr><th>#</th><th>Title</th><th>Difficulty</th><th>ID</th></tr></thead>
        <tbody>
"""
        for i, q in enumerate(questions, 1):
            title = q.get("title", "Unknown")
            t_slug = q.get("titleSlug", "")
            diff = q.get("difficulty", "Unknown")
            qid = q.get("questionFrontendId", "?")
            premium = '<span class="premium-tag">Premium</span>' if q.get("isPaidOnly") else ""
            url = f"https://leetcode.com/problems/{t_slug}/"

            html += f"""          <tr data-q="{title.lower()}">
            <td>{i}</td>
            <td><a class="q-link" href="{url}" target="_blank">{qid}. {title}</a>{premium}</td>
            <td><span class="diff diff-{diff}">{diff}</span></td>
            <td>{qid}</td>
          </tr>
"""

        html += """        </tbody>
      </table>
    </div>
  </div>
"""

    html += """</div>

<div class="footer">
  Generated using LeetCode Premium API &bull; Share freely!
</div>

<script>
function toggle(el) {
  const body = el.nextElementSibling;
  const arrow = el.querySelector('.arrow');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}
function openSection(slug) {
  const section = document.getElementById('company-' + slug);
  if (section) {
    const body = section.querySelector('.company-body');
    const arrow = section.querySelector('.arrow');
    if (!body.classList.contains('open')) {
      body.classList.add('open');
      arrow.classList.add('open');
    }
  }
}
function filterAll(val) {
  const v = val.toLowerCase();
  document.querySelectorAll('.company-section').forEach(s => {
    const name = s.dataset.name;
    let companyMatch = name.includes(v);
    let anyQ = false;
    s.querySelectorAll('tr[data-q]').forEach(row => {
      if (companyMatch || row.dataset.q.includes(v)) {
        row.style.display = '';
        anyQ = true;
      } else {
        row.style.display = 'none';
      }
    });
    s.style.display = (companyMatch || anyQ) ? '' : 'none';
    if (anyQ && v.length > 0) {
      s.querySelector('.company-body').classList.add('open');
      s.querySelector('.arrow').classList.add('open');
    }
  });
  document.querySelectorAll('.toc-item').forEach(a => {
    a.style.display = a.textContent.toLowerCase().includes(v) ? '' : 'none';
  });
}
</script>
</body>
</html>"""
    return html


# ── Markdown Generator ──────────────────────────────────────────────────────
def generate_markdown(all_data):
    total_q = sum(len(qs) for qs in all_data.values())
    timestamp = datetime.now().strftime("%B %d, %Y")

    md = f"""# LeetCode Company-Wise Questions

> **{len(all_data)} Companies** | **{total_q:,} Total Questions** | Generated on {timestamp}

---

## Table of Contents

| # | Company | Easy | Medium | Hard | Total |
|---|---------|------|--------|------|-------|
"""
    for i, (company, questions) in enumerate(all_data.items(), 1):
        easy = sum(1 for q in questions if q.get("difficulty") == "Easy")
        med = sum(1 for q in questions if q.get("difficulty") == "Medium")
        hard = sum(1 for q in questions if q.get("difficulty") == "Hard")
        anchor = company.lower().replace(" ", "-").replace("&", "and")
        md += f"| {i} | [{company}](#{anchor}) | {easy} | {med} | {hard} | {len(questions)} |\n"

    md += "\n---\n\n"

    for company, questions in all_data.items():
        easy = sum(1 for q in questions if q.get("difficulty") == "Easy")
        med = sum(1 for q in questions if q.get("difficulty") == "Medium")
        hard = sum(1 for q in questions if q.get("difficulty") == "Hard")

        md += f"## {company}\n\n"
        md += f"> {difficulty_emoji('Easy')} Easy: {easy} | {difficulty_emoji('Medium')} Medium: {med} | {difficulty_emoji('Hard')} Hard: {hard} | Total: {len(questions)}\n\n"
        md += "| # | Problem | Difficulty |\n"
        md += "|---|---------|------------|\n"

        for i, q in enumerate(questions, 1):
            title = q.get("title", "Unknown")
            t_slug = q.get("titleSlug", "")
            diff = q.get("difficulty", "Unknown")
            qid = q.get("questionFrontendId", "?")
            emoji = difficulty_emoji(diff)
            url = f"https://leetcode.com/problems/{t_slug}/"
            md += f"| {i} | [{qid}. {title}]({url}) | {emoji} {diff} |\n"

        md += "\n---\n\n"

    return md


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  LeetCode Company-Wise Questions Scraper v2")
    print("  (Using companyTag API for accurate results)")
    print("=" * 60)
    print()
    print(f"  Rate limiting: {BASE_DELAY}s base + {JITTER_RANGE}s jitter")
    print(f"  Batch pause: {BATCH_PAUSE}s every {BATCH_SIZE} companies")
    print(f"  Retries: {MAX_RETRIES}x with exponential backoff")
    print()

    # Step 1: Fetch all companies
    companies = fetch_all_companies()

    # Step 2: Load checkpoint if resuming
    all_data, completed_slugs = load_checkpoint()
    skipped = 0
    failed = []
    total = len(companies)

    start_time = time.time()

    for i, company in enumerate(companies, 1):
        name = company["name"]
        slug = company["slug"]
        expected = company.get("questionCount", 0)

        # Skip already-fetched companies (resume support)
        if slug in completed_slugs:
            skipped += 1
            continue

        # Progress with ETA
        done = len(all_data)
        remaining = total - i
        elapsed = time.time() - start_time
        actual_fetched = done - skipped if done > skipped else max(done - skipped, 1)
        rate = actual_fetched / elapsed if elapsed > 0 and actual_fetched > 0 else 0
        eta = f" | ETA: {remaining / rate / 60:.0f}min" if rate > 0.01 else ""

        sys.stdout.write(
            f"\r  [{i}/{total}] {name:<35} "
            f"(expected: {expected:>4}, done: {done}, failed: {len(failed)}{eta})  "
        )
        sys.stdout.flush()

        questions = fetch_company_questions(slug)
        if questions is not None:
            all_data[name] = questions
            completed_slugs.add(slug)

            # Sanity check: flag if returned count is wildly different from expected
            actual = len(questions)
            if expected > 0 and actual > expected * 3:
                print(f"\n  [WARNING] {name}: expected ~{expected}, got {actual} — possible API issue")
        else:
            failed.append(name)
            print(f"\n  [FAILED] {name}")

        rate_limiter.company_done()

        # Save checkpoint every BATCH_SIZE companies
        if len(all_data) % BATCH_SIZE == 0:
            save_checkpoint(all_data, completed_slugs)

    # Final checkpoint save
    save_checkpoint(all_data, completed_slugs)

    elapsed_total = time.time() - start_time
    print(f"\n\nCompleted in {elapsed_total / 60:.1f} minutes.")
    print(f"  Fetched: {len(all_data)} companies")
    if skipped:
        print(f"  Resumed: {skipped} companies from checkpoint")
    if failed:
        print(f"  Failed:  {len(failed)} companies: {', '.join(failed[:10])}")
    print(f"  Total API calls: {rate_limiter.request_count}")

    # Data quality summary
    total_q = sum(len(qs) for qs in all_data.values())
    unique_slugs = set()
    for qs in all_data.values():
        for q in qs:
            unique_slugs.add(q.get("titleSlug", ""))
    print(f"\n  Total question-company mappings: {total_q:,}")
    print(f"  Unique questions across all companies: {len(unique_slugs):,}")
    print()

    # Step 3: Generate outputs
    print("Generating HTML report...")
    html = generate_html(all_data)
    html_path = os.path.join(OUTPUT_DIR, "leetcode_company_questions.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved: {html_path}")

    print("Generating Markdown report...")
    md = generate_markdown(all_data)
    md_path = os.path.join(OUTPUT_DIR, "leetcode_company_questions.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"  Saved: {md_path}")

    # Save raw JSON
    json_path = os.path.join(OUTPUT_DIR, "leetcode_company_questions.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_data, f, indent=2)
    print(f"  Saved: {json_path}")

    clear_checkpoint()

    print(f"\nDone! Open the HTML file in your browser:")
    print(f"  open \"{html_path}\"")


if __name__ == "__main__":
    main()
