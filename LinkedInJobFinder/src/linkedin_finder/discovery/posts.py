"""Hiring-post discovery via LinkedIn Content search.

Many openings are announced in LinkedIn posts by hiring managers / founders,
never going through the formal Jobs board. We search Posts for "hiring"
mentions in the last 24h, filter to posts that name a target company, and
emit each as a synthetic job + a high-signal contact (the post author —
usually the hiring decision maker).

Requires the logged-in Playwright context.
"""
from __future__ import annotations

import logging
import re
import urllib.parse
from dataclasses import dataclass

from .linkedin_session import (
    ChallengePage,
    assert_no_challenge,
    human_pause,
)

log = logging.getLogger(__name__)


# Words that suggest the post is an active hiring announcement (not just
# "I'm looking for a job" or "X laid off employees").
HIRING_SIGNAL_RE = re.compile(
    r"\b(we'?re hiring|we are hiring|hiring for|hiring a|now hiring|"
    r"open role|open roles|open position|join (?:my|our) team|"
    r"join us|apply now|looking to hire|recruiting for)\b",
    re.IGNORECASE,
)

ANTI_SIGNAL_RE = re.compile(
    r"\b(open to work|looking for (?:a|new) (?:job|role|opportunity)|"
    r"laid off|seeking (?:a|new) (?:job|role|position))\b",
    re.IGNORECASE,
)

RECRUITER_TITLE_RE = re.compile(
    r"(recruiter|talent acquisition|talent partner|sourcer|hiring|people partner)",
    re.IGNORECASE,
)


@dataclass
class HiringPost:
    author_name: str
    author_title: str
    author_profile_url: str
    company: str           # target company we matched on
    post_url: str
    snippet: str
    posted_at: str


def search_hiring_posts(
    context,
    role_keywords: list[str],
    target_companies: list[str],
    max_results_per_role: int = 30,
) -> list[HiringPost]:
    """One Posts search per role keyword; filter to posts mentioning a target company.

    Posts not authored by someone at a target company are still kept if their
    text names a target company (e.g. "we're hiring backend engineers at <Co>").
    """
    out: list[HiringPost] = []
    seen_urls: set[str] = set()
    targets_lower = [(c, c.lower()) for c in target_companies if c.strip()]

    for role in role_keywords:
        page = context.new_page()
        try:
            kw = urllib.parse.quote(f"hiring {role}")
            url = (
                f"https://www.linkedin.com/search/results/content/"
                f"?keywords={kw}"
                f"&datePosted=%22past-24h%22"
                f"&sortBy=%22date_posted%22"
            )
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                assert_no_challenge(page)
            except ChallengePage:
                raise
            except Exception as e:
                log.warning("Posts search failed for role=%r: %s", role, e)
                continue

            human_pause()
            _scroll_for_more(page, rounds=3)

            posts = _scrape_posts(page, max_results=max_results_per_role)
            log.info("Posts search role=%r: %d raw posts", role, len(posts))

            for p in posts:
                if p.post_url in seen_urls:
                    continue
                text_lower = p.snippet.lower()
                if not HIRING_SIGNAL_RE.search(text_lower):
                    continue
                if ANTI_SIGNAL_RE.search(text_lower):
                    continue
                matched_company = _match_target(p, targets_lower)
                if not matched_company:
                    continue
                p.company = matched_company
                seen_urls.add(p.post_url)
                out.append(p)
        finally:
            page.close()

    log.info("Posts discovery total: %d hiring posts across %d roles", len(out), len(role_keywords))
    return out


def _match_target(post: HiringPost, targets_lower: list[tuple[str, str]]) -> str | None:
    haystack = f"{post.snippet}\n{post.author_title}".lower()
    for orig, low in targets_lower:
        if low in haystack:
            return orig
    return None


def _scroll_for_more(page, rounds: int = 3) -> None:
    for _ in range(rounds):
        try:
            page.mouse.wheel(0, 4000)
        except Exception:
            break
        human_pause(2.0, 4.0)


def _scrape_posts(page, max_results: int) -> list[HiringPost]:
    """Heuristic scraper: walk feed-like containers under main, extract author + text."""
    posts: list[HiringPost] = []
    try:
        page.wait_for_selector("main", timeout=15_000)
    except Exception:
        return posts

    # Container selector covers feed-shared-update-v2 and search result wrappers.
    containers = page.locator(
        'main div[data-urn*="urn:li:activity"], '
        'main div.feed-shared-update-v2, '
        'main li.reusable-search__result-container'
    ).all()

    for c in containers:
        if len(posts) >= max_results:
            break
        try:
            container_text = (c.inner_text() or "").strip()
            if not container_text or len(container_text) < 30:
                continue

            # Find the author link.
            author_link = c.locator('a[href*="/in/"]').first
            try:
                href = author_link.get_attribute("href") or ""
            except Exception:
                continue
            if "/in/" not in href:
                continue
            profile_url = href.split("?")[0]
            if not profile_url.startswith("http"):
                profile_url = "https://www.linkedin.com" + profile_url

            # Author name = first non-empty line of the author link text.
            try:
                name = (author_link.inner_text() or "").strip().split("\n")[0]
            except Exception:
                name = ""
            if not name or len(name) > 80:
                continue

            # Title heuristic: line after the name in the container.
            title = ""
            lines = [l.strip() for l in container_text.split("\n") if l.strip()]
            for i, line in enumerate(lines):
                if line == name and i + 1 < len(lines):
                    cand = lines[i + 1]
                    if cand and not cand.lower().startswith(("follow", "•", "connect", "message")):
                        title = cand
                    break

            # Post permalink — search for a link with /feed/update/.
            post_url = ""
            try:
                perma = c.locator('a[href*="/feed/update/"]').first
                ph = perma.get_attribute("href") or ""
                if ph:
                    post_url = ph.split("?")[0]
                    if not post_url.startswith("http"):
                        post_url = "https://www.linkedin.com" + post_url
            except Exception:
                pass
            if not post_url:
                # Fall back to data-urn → permalink shape.
                try:
                    urn = c.get_attribute("data-urn") or ""
                    if urn.startswith("urn:li:activity:"):
                        post_url = f"https://www.linkedin.com/feed/update/{urn}/"
                except Exception:
                    pass
            if not post_url:
                continue

            # Snippet = container text minus the leading author/title chunk.
            snippet = container_text
            if name in snippet:
                snippet = snippet.split(name, 1)[-1]
            snippet = snippet.strip()[:2000]

            posts.append(HiringPost(
                author_name=name,
                author_title=title,
                author_profile_url=profile_url,
                company="",  # filled by caller after target match
                post_url=post_url,
                snippet=snippet,
                posted_at="",
            ))
        except Exception as e:
            log.debug("skipping post: %s", e)

    return posts


def author_is_recruiter(post: HiringPost) -> bool:
    return bool(RECRUITER_TITLE_RE.search(post.author_title or ""))
