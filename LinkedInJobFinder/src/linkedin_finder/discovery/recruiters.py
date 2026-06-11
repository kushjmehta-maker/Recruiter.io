"""Recruiter / hiring-manager discovery via LinkedIn People search.

Per-company query: keywords="recruiter OR talent acquisition", filter by
currentCompany. Scrape top N results from the rendered search page.

We also try the job page's "Job poster" panel for a direct hiring-manager hit.

Hard caps and human-pacing pauses live in linkedin_session.py.
"""
from __future__ import annotations

import logging
import re
import urllib.parse
from dataclasses import dataclass
from typing import Optional

from .linkedin_session import (
    ChallengePage,
    assert_no_challenge,
    human_pause,
    long_pause,
)

log = logging.getLogger(__name__)


RECRUITER_TITLE_PATTERN = re.compile(
    r"(recruiter|talent acquisition|talent partner|sourcer|hiring|people partner)",
    re.IGNORECASE,
)


@dataclass
class Contact:
    name: str
    title: str
    profile_url: str
    company: str
    connection_degree: str
    is_recruiter: bool


def search_recruiters(context, company: str, max_results: int = 5) -> list[Contact]:
    """Search People for recruiters at company. Returns up to max_results."""
    page = context.new_page()
    try:
        kw = urllib.parse.quote(
            f'(recruiter OR "talent acquisition" OR sourcer) "{company}"'
        )
        url = (
            f"https://www.linkedin.com/search/results/people/"
            f"?keywords={kw}&origin=GLOBAL_SEARCH_HEADER"
        )
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        assert_no_challenge(page)
        human_pause()

        results = _scrape_people_results(page, max_results=max_results * 4, company=company)
        if not results:
            _dump_people_debug(page, company, "no_results")
        recruiters = []
        for r in results:
            r.is_recruiter = bool(RECRUITER_TITLE_PATTERN.search(r.title))
            if r.is_recruiter and _company_matches(r, company):
                recruiters.append(r)
            if len(recruiters) >= max_results:
                break
        if results and not recruiters:
            _dump_people_debug(page, company, "no_match")
        return recruiters
    except ChallengePage:
        raise
    finally:
        page.close()


def _dump_people_debug(page, company: str, tag: str) -> None:
    try:
        from pathlib import Path
        import time as _time
        out_dir = Path("data/debug")
        out_dir.mkdir(parents=True, exist_ok=True)
        slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-")
        stamp = _time.strftime("%Y%m%dT%H%M%S")
        (out_dir / f"{stamp}_people_{slug}_{tag}.html").write_text(page.content() or "")
        page.screenshot(path=str(out_dir / f"{stamp}_people_{slug}_{tag}.png"), full_page=True)
        log.warning("Saved People-search snapshot: data/debug/%s_people_%s_%s.{html,png}", stamp, slug, tag)
    except Exception as e:
        log.warning("People debug snapshot failed for %s: %s", company, e)


def _company_matches(contact: Contact, target: str) -> bool:
    if not contact.title:
        return False
    target_norm = target.lower().strip()
    title_norm = contact.title.lower()
    return target_norm in title_norm


def _scrape_people_results(page, max_results: int, company: str) -> list[Contact]:
    contacts: list[Contact] = []
    page.wait_for_selector("main", timeout=15_000)
    items = page.locator('main a[href*="/in/"]').all()
    seen_urls: set[str] = set()
    for a in items:
        try:
            href = a.get_attribute("href") or ""
            if "/in/" not in href:
                continue
            profile_url = href.split("?")[0]
            if not profile_url.startswith("http"):
                profile_url = "https://www.linkedin.com" + profile_url
            if profile_url in seen_urls:
                continue
            seen_urls.add(profile_url)
            name = (a.inner_text() or "").strip().split("\n")[0]
            if not name or len(name) > 80:
                continue
            title = ""
            container_text = ""
            try:
                container = a.locator(
                    'xpath=ancestor::*[@role="listitem" or self::li][1]'
                )
                container_text = (container.inner_text() or "").strip()
                lines = [l.strip(" •") for l in container_text.split("\n") if l.strip()]
                # Typical order: name, "• 2nd" (degree), title, location.
                # Find first line after the name that isn't a degree marker.
                degree_re = re.compile(r"^(1st|2nd|3rd|3rd\+|Following|\d+(st|nd|rd))$", re.IGNORECASE)
                started = False
                for line in lines:
                    if not started:
                        if line.lower().startswith(name.lower()[:8]):
                            started = True
                        continue
                    if degree_re.match(line):
                        continue
                    if line.lower() in ("connect", "message", "follow", "more"):
                        continue
                    title = line
                    break
            except Exception:
                pass
            degree = "3rd+"
            for d in ("1st", "2nd", "3rd"):
                if f" {d}" in container_text or f"• {d}" in container_text:
                    degree = d
                    break
            contacts.append(Contact(
                name=name,
                title=title,
                profile_url=profile_url,
                company=company,
                connection_degree=degree,
                is_recruiter=False,
            ))
            if len(contacts) >= max_results:
                break
        except Exception as e:
            log.debug("skipping result: %s", e)
    return contacts


def find_job_poster(context, job_url: str) -> Optional[Contact]:
    """Open a job page and extract the 'Job poster' / 'Meet the hiring team' panel."""
    page = context.new_page()
    try:
        page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
        assert_no_challenge(page)
        human_pause(2, 4)
        # The hiring-team module has a fairly stable text marker.
        candidates = page.locator('a[href*="/in/"]').all()
        for a in candidates:
            try:
                href = (a.get_attribute("href") or "").split("?")[0]
                if "/in/" not in href:
                    continue
                # Filter to anchors near hiring-team text.
                container_text = a.locator("xpath=ancestor::*[self::section or self::div][1]").inner_text() or ""
                if not re.search(r"hiring team|meet the hiring|job poster|posted by", container_text, re.IGNORECASE):
                    continue
                name_text = (a.inner_text() or "").strip().split("\n")[0]
                if not name_text:
                    continue
                # Title is usually the next text line in the container.
                title = ""
                m = re.search(rf"{re.escape(name_text)}\s*\n([^\n]+)", container_text)
                if m:
                    title = m.group(1).strip()
                profile_url = href if href.startswith("http") else "https://www.linkedin.com" + href
                return Contact(
                    name=name_text,
                    title=title,
                    profile_url=profile_url,
                    company="",
                    connection_degree="3rd+",
                    is_recruiter=bool(RECRUITER_TITLE_PATTERN.search(title)),
                )
            except Exception:
                continue
        return None
    except ChallengePage:
        raise
    finally:
        page.close()
