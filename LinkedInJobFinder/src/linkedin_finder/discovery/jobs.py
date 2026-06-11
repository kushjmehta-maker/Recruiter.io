"""Job discovery via JobSpy.

JobSpy hits LinkedIn's public guest-job-search endpoint. No login required.
We run one search per (role, location) and filter the union to target companies.

Reference: https://github.com/Bunsly/JobSpy
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import pandas as pd

log = logging.getLogger(__name__)


@dataclass
class JobPosting:
    company: str
    role: str
    location: str
    url: str
    description: str
    posted_at: str
    job_type: str
    salary: str
    source: str = "linkedin_jobs"


def _normalize_company(name: str) -> str:
    return (name or "").strip().lower()


def _matches_target(company: str, targets: Iterable[str]) -> bool:
    cn = _normalize_company(company)
    if not cn:
        return False
    for t in targets:
        tn = _normalize_company(t)
        if tn and (tn == cn or tn in cn or cn in tn):
            return True
    return False


def search_jobs(
    roles: list[str],
    locations: list[str],
    target_companies: list[str],
    hours_old: int = 24,
    results_wanted: int = 50,
) -> list[JobPosting]:
    """Run JobSpy across (role, location) pairs and filter to target companies."""
    from jobspy import scrape_jobs  # imported lazily so the package import is light

    seen_urls: set[str] = set()
    out: list[JobPosting] = []

    for role in roles:
        for location in locations:
            log.info("JobSpy search: role=%r location=%r", role, location)
            try:
                df: pd.DataFrame = scrape_jobs(
                    site_name=["linkedin"],
                    search_term=role,
                    location=location,
                    results_wanted=results_wanted,
                    hours_old=hours_old,
                    linkedin_fetch_description=True,
                    country_indeed="USA",
                )
            except Exception as e:
                log.warning("JobSpy failed for %r / %r: %s", role, location, e)
                continue

            if df is None or df.empty:
                continue

            for _, row in df.iterrows():
                url = (row.get("job_url") or "").strip()
                if not url or url in seen_urls:
                    continue
                company = row.get("company") or ""
                if not _matches_target(company, target_companies):
                    continue
                seen_urls.add(url)
                out.append(JobPosting(
                    company=company.strip(),
                    role=(row.get("title") or role).strip(),
                    location=(row.get("location") or location).strip(),
                    url=url,
                    description=(row.get("description") or "").strip(),
                    posted_at=_format_date(row.get("date_posted")),
                    job_type=(row.get("job_type") or "").strip(),
                    salary=_format_salary(row),
                ))

    return out


def _format_date(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, str):
        return value[:10]
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10]
    return str(value)[:10]


def _format_salary(row) -> str:
    lo = row.get("min_amount")
    hi = row.get("max_amount")
    interval = row.get("interval") or ""
    if pd.isna(lo) and pd.isna(hi):
        return ""
    parts = []
    if not pd.isna(lo):
        parts.append(f"${int(lo):,}")
    if not pd.isna(hi):
        parts.append(f"${int(hi):,}")
    return " - ".join(parts) + (f" / {interval}" if interval else "")
