"""Playwright persistent-context helpers.

Single browser profile lives in data/browser_profile/. The user logs in once
via `linkedin-finder login`; subsequent daily runs reuse the cookies.

Detection of CAPTCHA / "unusual activity" pages halts the run — we never
click through challenges.
"""
from __future__ import annotations

import logging
import random
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

log = logging.getLogger(__name__)


CHALLENGE_URL_MARKERS = [
    "/checkpoint/challenge",
    "/uas/login",
    "/authwall",
]

CHALLENGE_TITLE_MARKERS = [
    "security verification",
    "let's do a quick security check",
    "verify you're a human",
]


class SessionExpired(RuntimeError):
    pass


class ChallengePage(RuntimeError):
    pass


@contextmanager
def browser_context(profile_dir: Path, headless: bool = True) -> Iterator:
    """Yield a Playwright BrowserContext backed by a persistent profile."""
    from playwright.sync_api import sync_playwright

    profile_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            channel="chrome",
            headless=headless,
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            yield context
        finally:
            context.close()


def is_logged_in(page) -> bool:
    """Hit /feed; if we end up on the login page or a challenge, we're not."""
    page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30_000)
    url = page.url.lower()
    if any(m in url for m in CHALLENGE_URL_MARKERS):
        if "challenge" in url or "checkpoint" in url:
            _dump_debug_snapshot(page, "challenge_url")
            raise ChallengePage(f"LinkedIn challenge page detected: {page.url}")
        return False
    title = (page.title() or "").lower()
    if any(m in title for m in CHALLENGE_TITLE_MARKERS):
        _dump_debug_snapshot(page, "challenge_title")
        raise ChallengePage(f"Challenge title detected: {page.title()!r}")
    return "linkedin.com/feed" in url


def _dump_debug_snapshot(page, tag: str) -> None:
    try:
        out_dir = Path("data/debug")
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%S")
        (out_dir / f"{stamp}_{tag}.html").write_text(page.content() or "")
        page.screenshot(path=str(out_dir / f"{stamp}_{tag}.png"), full_page=False)
        log.warning("Saved challenge snapshot to data/debug/%s_%s.{html,png}", stamp, tag)
    except Exception as e:
        log.warning("debug snapshot failed: %s", e)


def human_pause(lo: float = 4.0, hi: float = 9.0) -> None:
    time.sleep(random.uniform(lo, hi))


def long_pause(lo: float = 30.0, hi: float = 90.0) -> None:
    time.sleep(random.uniform(lo, hi))


def assert_no_challenge(page) -> None:
    url = page.url.lower()
    if "challenge" in url or "checkpoint" in url:
        raise ChallengePage(f"Challenge encountered at {page.url}")
