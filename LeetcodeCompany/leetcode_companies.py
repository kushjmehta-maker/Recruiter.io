#!/usr/bin/env python3
"""
LeetCode Premium - Company-wise Questions Scraper
Uses the companyTag GraphQL query to fetch accurate company-question mappings.
Enriches data with frequency scores (API) and acceptance/recency (Java CSV merge).
Outputs HTML, Markdown, and JSON reports.
"""

import argparse
import csv
import json
import urllib.request
import urllib.error
import time
import sys
import os
import random
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
# Read from environment variables (for CI/CD), fall back to hardcoded (local dev)
LEETCODE_SESSION = os.environ.get(
    "LEETCODE_SESSION",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfYXV0aF91c2VyX2lkIjoiMTkwMjU3NCIsIl9hdXRoX3VzZXJfYmFja2VuZCI6ImFsbGF1dGguYWNjb3VudC5hdXRoX2JhY2tlbmRzLkF1dGhlbnRpY2F0aW9uQmFja2VuZCIsIl9hdXRoX3VzZXJfaGFzaCI6ImY3YjQ4ZGZlZTgxYzFiOTk5ZjgyMDJjNzdhNjk4YTAyZTc2Y2Y4NjNlNjk3YjI4MTFmMTQ3MjRkMGZkYmMwNjUiLCJzZXNzaW9uX3V1aWQiOiJiMzdiZDhmNCIsImlkIjoxOTAyNTc0LCJlbWFpbCI6InNhdXJhYmhiaDIxQGdtYWlsLmNvbSIsInVzZXJuYW1lIjoiYmhhZ3ZhdHVsYSIsInVzZXJfc2x1ZyI6ImJoYWd2YXR1bGEiLCJhdmF0YXIiOiJodHRwczovL2Fzc2V0cy5sZWV0Y29kZS5jb20vdXNlcnMvYmhhZ3ZhdHVsYS9hdmF0YXJfMTU5MDkxMzQ3Mi5wbmciLCJyZWZyZXNoZWRfYXQiOjE3NzY1MTA4MDMsImlwIjoiMjQwNToyMDE6YzAzYzo3OTo2NDE0OmI2ZTY6NDllZDpiMzlmIiwiaWRlbnRpdHkiOiI5NThkNWU1M2RiYTdlMGFmODEyZWEwZWUwZTRlODI5MyIsImRldmljZV93aXRoX2lwIjpbIjNiMTZiNmMxNGFhMzEwYTgwYjlmNTgzODU0ZmNkMGE3IiwiMjQwNToyMDE6YzAzYzo3OTo2NDE0OmI2ZTY6NDllZDpiMzlmIl0sIl9zZXNzaW9uX2V4cGlyeSI6MTIwOTYwMH0.6Zdq4DEVEVeCuDUW3sCo_Sbjf25RPnZHs2xIqAgDOlQ"
)
CSRF_TOKEN = os.environ.get(
    "LEETCODE_CSRF",
    "kGiU3XyL1jjEg8NfK5Xiskmy7c0oeHZy"
)

GRAPHQL_URL = "https://leetcode.com/graphql"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_FILE = os.path.join(OUTPUT_DIR, ".leetcode_checkpoint.json")

JAVA_CSV_DIR = os.environ.get(
    "JAVA_CSV_DIR",
    os.path.join(OUTPUT_DIR, "java_csv_data")
)

# ── Rate Limiting Config ────────────────────────────────────────────────────
BASE_DELAY = 1.5
JITTER_RANGE = 0.5
BATCH_SIZE = 25
BATCH_PAUSE = 15
MAX_RETRIES = 5
BACKOFF_FACTOR = 2
BACKOFF_BASE = 5
REQUEST_TIMEOUT = 60
RATE_LIMIT_PAUSE = 60

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

COMPANY_TAG_QUESTIONS_QUERY = """
query getCompanyTag($slug: String!) {
  companyTag(slug: $slug) {
    name
    slug
    questionCount
    frequencies
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

RECENCY_BUCKETS = ["thirty-days", "three-months", "six-months", "more-than-six-months"]


# ── Rate Limiter ────────────────────────────────────────────────────────────
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


# ── HTTP / GraphQL ──────────────────────────────────────────────────────────
def graphql_request(query, variables=None):
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


# ── Data Fetching ───────────────────────────────────────────────────────────
def fetch_all_companies():
    print("Fetching company list...")
    result = graphql_request(COMPANY_TAGS_QUERY)
    if not result or "data" not in result or not result["data"].get("companyTags"):
        print("Failed to fetch companies. Check credentials.")
        print(f"Response: {json.dumps(result, indent=2)[:500] if result else 'None'}")
        sys.exit(1)

    companies = result["data"]["companyTags"]
    companies = [c for c in companies if c.get("questionCount", 0) > 0]
    companies.sort(key=lambda c: c.get("questionCount", 0), reverse=True)
    print(f"Found {len(companies)} companies with questions.\n")
    return companies


def fetch_company_questions(slug):
    """Fetch questions + frequency data for a company."""
    result = graphql_request(COMPANY_TAG_QUESTIONS_QUERY, {"slug": slug})
    if not result or "data" not in result:
        return None, None

    tag = result["data"].get("companyTag")
    if not tag:
        return None, None

    questions = tag.get("questions", [])

    # Parse frequencies JSON string
    freq_map = {}
    freq_raw = tag.get("frequencies", "")
    if freq_raw:
        try:
            freq_data = json.loads(freq_raw) if isinstance(freq_raw, str) else freq_raw
            for qid, values in freq_data.items():
                if isinstance(values, list) and len(values) >= 8:
                    freq_map[str(qid)] = {
                        "count_30d": values[0],
                        "count_3m": values[1],
                        "count_6m": values[2],
                        "count_all": values[3],
                        "freq_score_30d": round(values[4], 2),
                        "freq_score_3m": round(values[5], 2),
                        "freq_score_6m": round(values[6], 2),
                        "freq_score_all": round(values[7], 2),
                    }
        except (json.JSONDecodeError, TypeError):
            pass

    return questions, freq_map


# ── Java CSV Merge ──────────────────────────────────────────────────────────
def _read_csv(filepath):
    rows = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
    except Exception:
        pass
    return rows


def merge_java_csv_data(all_data):
    """Merge acceptance %, recency buckets, and fallback frequency from Java CSVs."""
    if not os.path.isdir(JAVA_CSV_DIR):
        print(f"  Java CSV dir not found: {JAVA_CSV_DIR}")
        print(f"  Skipping CSV merge. Set JAVA_CSV_DIR env var to override.")
        return

    merged_count = 0
    miss_count = 0

    for company_name, company_data in all_data.items():
        slug = company_data.get("slug", "")
        company_dir = os.path.join(JAVA_CSV_DIR, slug)

        if not os.path.isdir(company_dir):
            miss_count += 1
            continue

        # Build lookup: qid -> {acceptance_pct, recency_buckets, java_freq_pct}
        csv_lookup = {}

        # Read each recency bucket
        for bucket in RECENCY_BUCKETS:
            csv_path = os.path.join(company_dir, f"{bucket}.csv")
            if not os.path.exists(csv_path):
                continue
            for row in _read_csv(csv_path):
                qid = row.get("ID", "").strip()
                if not qid:
                    continue
                if qid not in csv_lookup:
                    csv_lookup[qid] = {
                        "acceptance_pct": row.get("Acceptance %", ""),
                        "java_freq_pct": row.get("Frequency %", ""),
                        "recency_buckets": [],
                    }
                csv_lookup[qid]["recency_buckets"].append(bucket)

        # Read all.csv for acceptance % (most complete source)
        all_csv_path = os.path.join(company_dir, "all.csv")
        if os.path.exists(all_csv_path):
            for row in _read_csv(all_csv_path):
                qid = row.get("ID", "").strip()
                if not qid:
                    continue
                if qid in csv_lookup:
                    csv_lookup[qid]["acceptance_pct"] = row.get("Acceptance %", csv_lookup[qid]["acceptance_pct"])
                else:
                    csv_lookup[qid] = {
                        "acceptance_pct": row.get("Acceptance %", ""),
                        "java_freq_pct": row.get("Frequency %", ""),
                        "recency_buckets": [],
                    }

        # Merge into each question
        freq_data = company_data.get("frequencies", {})
        for q in company_data["questions"]:
            qid = str(q.get("questionFrontendId", ""))

            # API frequency scores (precise)
            if qid in freq_data:
                q["freq_scores"] = freq_data[qid]

            # Java CSV data
            if qid in csv_lookup:
                csv_info = csv_lookup[qid]
                q["acceptance_pct"] = csv_info["acceptance_pct"]
                q["recency_buckets"] = csv_info["recency_buckets"]
                if not q.get("freq_scores"):
                    q["java_freq_pct"] = csv_info["java_freq_pct"]

        merged_count += 1

    print(f"  CSV merge: {merged_count} companies enriched, {miss_count} not found in Java data")


# ── Checkpoint (resume support) ─────────────────────────────────────────────
def save_checkpoint(all_data, completed_slugs):
    checkpoint = {
        "completed_slugs": list(completed_slugs),
        "data": all_data,
        "timestamp": datetime.now().isoformat(),
        "version": 3,
    }
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(checkpoint, f)


def load_checkpoint():
    if not os.path.exists(CHECKPOINT_FILE):
        return {}, set()
    try:
        with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
            checkpoint = json.load(f)
        if checkpoint.get("version") != 3:
            print("  Old checkpoint found. Starting fresh.\n")
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


# ── Helpers ─────────────────────────────────────────────────────────────────
def difficulty_emoji(d):
    return {"Easy": "🟢", "Medium": "🟡", "Hard": "🔴"}.get(d, "⚪")


def get_freq_display(q):
    """Get frequency percentage for display. Returns (value 0-100, source)."""
    fs = q.get("freq_scores")
    if fs:
        v = fs.get("freq_score_all", 0)
        return (min(v, 100), "api")
    jp = q.get("java_freq_pct", "")
    if jp:
        try:
            return (float(jp.replace("%", "")), "java")
        except ValueError:
            pass
    return (0, "none")


# ── HTML Generator ──────────────────────────────────────────────────────────
def generate_html(all_data):
    total_q = sum(len(cd["questions"]) for cd in all_data.values())
    unique_slugs = set()
    for cd in all_data.values():
        for q in cd["questions"]:
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
    --bg: #1a1a2e; --card: #16213e; --accent: #0f3460;
    --text: #e4e4e4; --muted: #8892b0;
    --easy: #00b8a3; --medium: #ffc01e; --hard: #ff375f;
    --border: #233554;
  }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
  }}
  .header {{
    background: linear-gradient(135deg, #0f3460 0%, #533483 100%);
    padding: 40px 20px; text-align: center;
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
    max-width: 600px; margin: 20px auto 0; display: flex; gap: 10px;
  }}
  .search-bar input {{
    flex: 1; padding: 12px 16px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--card);
    color: var(--text); font-size: 1em; outline: none;
  }}
  .search-bar input:focus {{ border-color: #533483; }}
  .container {{ max-width: 1400px; margin: 30px auto; padding: 0 20px; }}
  .toc {{
    background: var(--card); border-radius: 12px; padding: 24px;
    margin-bottom: 30px; border: 1px solid var(--border);
  }}
  .toc h2 {{ margin-bottom: 16px; font-size: 1.3em; }}
  .toc-grid {{
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px;
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
    margin-bottom: 20px; border: 1px solid var(--border); overflow: hidden;
  }}
  .company-header {{
    padding: 20px 24px; cursor: pointer; display: flex;
    justify-content: space-between; align-items: center;
    background: var(--accent); user-select: none;
  }}
  .company-header:hover {{ background: #1a4080; }}
  .company-header h2 {{ font-size: 1.2em; }}
  .company-header .badge {{ display: flex; gap: 10px; align-items: center; }}
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
  th.sortable {{ cursor: pointer; }}
  th.sortable:hover {{ color: #fff; }}
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

  /* Frequency bar */
  .freq-bar {{ display: inline-flex; align-items: center; gap: 6px; }}
  .freq-bar-track {{
    width: 60px; height: 8px; background: rgba(255,255,255,0.1);
    border-radius: 4px; overflow: hidden;
  }}
  .freq-bar-fill {{
    height: 100%; border-radius: 4px;
    background: linear-gradient(90deg, #ffa500, #ff6347);
  }}
  .freq-text {{ font-size: 0.78em; color: var(--muted); min-width: 35px; }}

  /* Recency tags */
  .recency-tags {{ display: flex; gap: 3px; flex-wrap: wrap; }}
  .recency-tag {{
    padding: 2px 6px; border-radius: 4px; font-size: 0.7em; font-weight: 600;
  }}
  .recency-30d {{ background: rgba(255,55,95,0.2); color: #ff375f; }}
  .recency-3m {{ background: rgba(255,192,30,0.2); color: #ffc01e; }}
  .recency-6m {{ background: rgba(0,184,163,0.2); color: #00b8a3; }}
  .recency-older {{ background: rgba(136,146,176,0.2); color: #8892b0; }}

  .acceptance {{ color: var(--muted); font-size: 0.85em; }}

  .footer {{
    text-align: center; padding: 40px; color: var(--muted); font-size: 0.85em;
  }}
  @media (max-width: 768px) {{
    .header h1 {{ font-size: 1.4em; }}
    .stats {{ gap: 15px; }}
    .toc-grid {{ grid-template-columns: 1fr; }}
    td, th {{ padding: 8px 10px; font-size: 0.85em; }}
    .freq-bar-track {{ width: 40px; }}
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

    for company, cd in all_data.items():
        slug = company.lower().replace(" ", "-").replace("&", "and")
        html += (f'      <a class="toc-item" href="#company-{slug}" '
                 f'onclick="openSection(\'{slug}\')">{company}'
                 f'<span class="count">{len(cd["questions"])}</span></a>\n')

    html += """    </div>
  </div>
"""

    bucket_labels = {
        "thirty-days": ("30d", "recency-30d"),
        "three-months": ("3m", "recency-3m"),
        "six-months": ("6m", "recency-6m"),
        "more-than-six-months": ("6m+", "recency-older"),
    }

    for company, cd in all_data.items():
        questions = cd["questions"]
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
        <thead><tr>
          <th>#</th><th>Title</th><th>Difficulty</th>
          <th class="sortable" onclick="sortByFreq(this)">Frequency &#8597;</th>
          <th>Recency</th><th>Acceptance</th>
        </tr></thead>
        <tbody>
"""
        for i, q in enumerate(questions, 1):
            title = q.get("title", "Unknown")
            t_slug = q.get("titleSlug", "")
            diff = q.get("difficulty", "Unknown")
            qid = q.get("questionFrontendId", "?")
            premium = '<span class="premium-tag">Premium</span>' if q.get("isPaidOnly") else ""
            url = f"https://leetcode.com/problems/{t_slug}/"

            # Frequency bar
            freq_val, _ = get_freq_display(q)
            if freq_val > 0:
                clamped = min(freq_val, 100)
                freq_bar_html = (
                    f'<div class="freq-bar">'
                    f'<div class="freq-bar-track">'
                    f'<div class="freq-bar-fill" style="width:{clamped:.0f}%"></div></div>'
                    f'<span class="freq-text">{freq_val:.1f}%</span></div>'
                )
            else:
                freq_bar_html = '<span class="freq-text">-</span>'

            # Recency tags
            buckets = q.get("recency_buckets", [])
            if buckets:
                recency_html = '<div class="recency-tags">'
                for b in buckets:
                    label, cls = bucket_labels.get(b, (b, "recency-older"))
                    recency_html += f'<span class="recency-tag {cls}">{label}</span>'
                recency_html += '</div>'
            else:
                recency_html = '<span class="freq-text">-</span>'

            # Acceptance
            acc = q.get("acceptance_pct", "")
            acc_html = f'<span class="acceptance">{acc}</span>' if acc else '-'

            html += f"""          <tr data-q="{title.lower()}" data-freq="{freq_val:.2f}">
            <td>{i}</td>
            <td><a class="q-link" href="{url}" target="_blank">{qid}. {title}</a>{premium}</td>
            <td><span class="diff diff-{diff}">{diff}</span></td>
            <td>{freq_bar_html}</td>
            <td>{recency_html}</td>
            <td>{acc_html}</td>
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
function sortByFreq(th) {
  const tbody = th.closest('table').querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const asc = th.dataset.sortDir === 'asc';
  th.dataset.sortDir = asc ? 'desc' : 'asc';
  rows.sort((a, b) => {
    const fa = parseFloat(a.dataset.freq) || 0;
    const fb = parseFloat(b.dataset.freq) || 0;
    return asc ? fa - fb : fb - fa;
  });
  rows.forEach(r => tbody.appendChild(r));
}
</script>
</body>
</html>"""
    return html


# ── Markdown Generator ──────────────────────────────────────────────────────
def generate_markdown(all_data):
    total_q = sum(len(cd["questions"]) for cd in all_data.values())
    timestamp = datetime.now().strftime("%B %d, %Y")

    md = f"""# LeetCode Company-Wise Questions

> **{len(all_data)} Companies** | **{total_q:,} Total Questions** | Generated on {timestamp}

---

## Table of Contents

| # | Company | Easy | Medium | Hard | Total |
|---|---------|------|--------|------|-------|
"""
    for i, (company, cd) in enumerate(all_data.items(), 1):
        questions = cd["questions"]
        easy = sum(1 for q in questions if q.get("difficulty") == "Easy")
        med = sum(1 for q in questions if q.get("difficulty") == "Medium")
        hard = sum(1 for q in questions if q.get("difficulty") == "Hard")
        anchor = company.lower().replace(" ", "-").replace("&", "and")
        md += f"| {i} | [{company}](#{anchor}) | {easy} | {med} | {hard} | {len(questions)} |\n"

    md += "\n---\n\n"

    bucket_short = {
        "thirty-days": "30d", "three-months": "3m",
        "six-months": "6m", "more-than-six-months": "6m+",
    }

    for company, cd in all_data.items():
        questions = cd["questions"]
        easy = sum(1 for q in questions if q.get("difficulty") == "Easy")
        med = sum(1 for q in questions if q.get("difficulty") == "Medium")
        hard = sum(1 for q in questions if q.get("difficulty") == "Hard")

        md += f"## {company}\n\n"
        md += (f"> {difficulty_emoji('Easy')} Easy: {easy} | "
               f"{difficulty_emoji('Medium')} Medium: {med} | "
               f"{difficulty_emoji('Hard')} Hard: {hard} | Total: {len(questions)}\n\n")
        md += "| # | Problem | Difficulty | Freq | Recency | Acceptance |\n"
        md += "|---|---------|------------|------|---------|------------|\n"

        for i, q in enumerate(questions, 1):
            title = q.get("title", "Unknown")
            t_slug = q.get("titleSlug", "")
            diff = q.get("difficulty", "Unknown")
            qid = q.get("questionFrontendId", "?")
            emoji = difficulty_emoji(diff)
            url = f"https://leetcode.com/problems/{t_slug}/"

            freq_val, _ = get_freq_display(q)
            freq_str = f"{freq_val:.1f}%" if freq_val > 0 else "-"

            buckets = q.get("recency_buckets", [])
            recency_str = ",".join(bucket_short.get(b, b) for b in buckets) if buckets else "-"

            acc = q.get("acceptance_pct", "-")

            md += f"| {i} | [{qid}. {title}]({url}) | {emoji} {diff} | {freq_str} | {recency_str} | {acc} |\n"

        md += "\n---\n\n"

    return md


# ── Per-Company CSV Generator ───────────────────────────────────────────────
def generate_company_csvs(all_data):
    """Generate a CSV file per company in companies/<slug>/questions.csv."""
    companies_dir = os.path.join(OUTPUT_DIR, "companies")
    os.makedirs(companies_dir, exist_ok=True)

    bucket_short = {
        "thirty-days": "30d", "three-months": "3m",
        "six-months": "6m", "more-than-six-months": "6m+",
    }

    for company_name, cd in all_data.items():
        slug = cd.get("slug", company_name.lower().replace(" ", "-"))
        company_dir = os.path.join(companies_dir, slug)
        os.makedirs(company_dir, exist_ok=True)

        questions = cd["questions"]
        csv_path = os.path.join(company_dir, "questions.csv")

        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                "ID", "Title", "URL", "Difficulty", "Frequency Score",
                "Recency", "Acceptance %", "Premium"
            ])
            for q in questions:
                qid = q.get("questionFrontendId", "")
                title = q.get("title", "")
                t_slug = q.get("titleSlug", "")
                url = f"https://leetcode.com/problems/{t_slug}/"
                diff = q.get("difficulty", "")

                freq_val, _ = get_freq_display(q)
                freq_str = f"{freq_val:.1f}%" if freq_val > 0 else ""

                buckets = q.get("recency_buckets", [])
                recency_str = ",".join(bucket_short.get(b, b) for b in buckets)

                acc = q.get("acceptance_pct", "")
                premium = "Yes" if q.get("isPaidOnly") else "No"

                writer.writerow([qid, title, url, diff, freq_str, recency_str, acc, premium])

    print(f"  Saved: {companies_dir}/ ({len(all_data)} company folders)")


# ── Incremental Mode ────────────────────────────────────────────────────────
def load_existing_json():
    """Load previously saved JSON data to support incremental scraping."""
    json_path = os.path.join(OUTPUT_DIR, "leetcode_company_questions.json")
    if not os.path.exists(json_path):
        return {}
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(f"  Loaded existing data: {len(data)} companies from {json_path}")
        return data
    except (json.JSONDecodeError, IOError) as e:
        print(f"  Warning: Could not load existing JSON ({e}). Running full scrape.")
        return {}


def detect_changed_companies(companies, existing_data):
    """Compare live questionCount vs stored data to find companies needing re-fetch.

    Returns (to_fetch, unchanged) where to_fetch is the list of company dicts
    that need scraping and unchanged is a dict of company data to carry forward.
    """
    # Build lookup: slug -> (company_name, stored questionCount)
    stored_lookup = {}
    for name, cd in existing_data.items():
        slug = cd.get("slug", "")
        stored_count = cd.get("questionCount", len(cd.get("questions", [])))
        stored_lookup[slug] = (name, stored_count)

    to_fetch = []
    unchanged = {}  # name -> company data (carried forward as-is)

    for company in companies:
        slug = company["slug"]
        name = company["name"]
        live_count = company.get("questionCount", 0)

        if slug in stored_lookup:
            stored_name, stored_count = stored_lookup[slug]
            if live_count == stored_count:
                # No change — carry forward existing data
                unchanged[stored_name] = existing_data[stored_name]
                continue

        # New company or questionCount changed
        to_fetch.append(company)

    return to_fetch, unchanged


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="LeetCode Company-Wise Questions Scraper")
    parser.add_argument(
        "--full", action="store_true",
        help="Force a full re-scrape of all companies (default: incremental)"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  LeetCode Company-Wise Questions Scraper v3")
    print("  (companyTag API + frequency enrichment + CSV merge)")
    mode_label = "FULL" if args.full else "INCREMENTAL"
    print(f"  Mode: {mode_label}")
    print("=" * 60)
    print()

    if not LEETCODE_SESSION or not CSRF_TOKEN:
        print("ERROR: Set LEETCODE_SESSION and LEETCODE_CSRF environment variables.")
        sys.exit(1)

    print(f"  Rate limiting: {BASE_DELAY}s base + {JITTER_RANGE}s jitter")
    print(f"  Batch pause: {BATCH_PAUSE}s every {BATCH_SIZE} companies")
    print(f"  Retries: {MAX_RETRIES}x with exponential backoff")
    print()

    # Step 1: Fetch all companies
    companies = fetch_all_companies()

    # Step 1b: Incremental mode — detect which companies actually changed
    existing_data = {}
    unchanged_data = {}
    if not args.full:
        existing_data = load_existing_json()
        if existing_data:
            companies_to_fetch, unchanged_data = detect_changed_companies(companies, existing_data)
            print(f"  Incremental: {len(unchanged_data)} unchanged, "
                  f"{len(companies_to_fetch)} to fetch "
                  f"({len(companies) - len(unchanged_data) - len(companies_to_fetch)} new)\n")
            companies = companies_to_fetch
        else:
            print("  No existing data found. Running full scrape.\n")

    # Step 2: Load checkpoint if resuming an interrupted run
    all_data, completed_slugs = load_checkpoint()
    skipped = 0
    failed = []
    total = len(companies)

    if total == 0:
        print("  All companies up to date — nothing to fetch.")
        # Still carry forward unchanged data for report regeneration
        all_data = {}
        for name, cd in unchanged_data.items():
            all_data[name] = {
                "slug": cd["slug"],
                "questionCount": cd.get("questionCount", len(cd.get("questions", []))),
                "questions": cd.get("questions", []),
                "frequencies": cd.get("frequencies", {}),
            }
    else:
        start_time = time.time()

        for i, company in enumerate(companies, 1):
            name = company["name"]
            slug = company["slug"]
            expected = company.get("questionCount", 0)

            if slug in completed_slugs:
                skipped += 1
                continue

            done = len(all_data)
            remaining = total - i
            elapsed = time.time() - start_time
            actual_fetched = max(done - skipped, 1)
            rate = actual_fetched / elapsed if elapsed > 0 and actual_fetched > 0 else 0
            eta = f" | ETA: {remaining / rate / 60:.0f}min" if rate > 0.01 else ""

            sys.stdout.write(
                f"\r  [{i}/{total}] {name:<35} "
                f"(expected: {expected:>4}, done: {done}, failed: {len(failed)}{eta})  "
            )
            sys.stdout.flush()

            questions, freq_map = fetch_company_questions(slug)
            if questions is not None:
                all_data[name] = {
                    "slug": slug,
                    "questionCount": expected,
                    "questions": questions,
                    "frequencies": freq_map or {},
                }
                completed_slugs.add(slug)
            else:
                failed.append(name)
                print(f"\n  [FAILED] {name}")

            rate_limiter.company_done()

            if len(all_data) % BATCH_SIZE == 0:
                save_checkpoint(all_data, completed_slugs)

        save_checkpoint(all_data, completed_slugs)

        elapsed_total = time.time() - start_time
        print(f"\n\nCompleted in {elapsed_total / 60:.1f} minutes.")
        print(f"  Fetched: {len(all_data)} companies")
        if skipped:
            print(f"  Resumed: {skipped} companies from checkpoint")
        if failed:
            print(f"  Failed:  {len(failed)} companies: {', '.join(failed[:10])}")
        print(f"  Total API calls: {rate_limiter.request_count}")

        # Merge unchanged data back into all_data
        for name, cd in unchanged_data.items():
            if name not in all_data:
                all_data[name] = {
                    "slug": cd["slug"],
                    "questionCount": cd.get("questionCount", len(cd.get("questions", []))),
                    "questions": cd.get("questions", []),
                    "frequencies": cd.get("frequencies", {}),
                }

    # Step 3: Merge Java CSV data
    print("\nMerging Java scraper CSV data...")
    merge_java_csv_data(all_data)

    # Stats
    total_q = sum(len(cd["questions"]) for cd in all_data.values())
    unique_slugs = set()
    for cd in all_data.values():
        for q in cd["questions"]:
            unique_slugs.add(q.get("titleSlug", ""))
    print(f"\n  Total question-company mappings: {total_q:,}")
    print(f"  Unique questions: {len(unique_slugs):,}")
    print()

    # Step 4: Generate outputs
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

    # Save JSON (strip frequencies dict from top-level to keep it clean)
    print("Saving JSON...")
    json_out = {}
    for name, cd in all_data.items():
        json_out[name] = {
            "slug": cd["slug"],
            "questionCount": cd.get("questionCount", len(cd["questions"])),
            "questions": cd["questions"],
        }
    json_path = os.path.join(OUTPUT_DIR, "leetcode_company_questions.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_out, f, indent=2)
    print(f"  Saved: {json_path}")

    print("Generating per-company CSVs...")
    generate_company_csvs(all_data)

    clear_checkpoint()

    print(f"\nDone! Open the HTML file in your browser:")
    print(f"  open \"{html_path}\"")


if __name__ == "__main__":
    main()
