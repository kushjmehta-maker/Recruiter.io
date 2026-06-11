"""Daily orchestrator.

Pipeline:
1. Verify LinkedIn session (Playwright persistent context).
2. Job discovery via JobSpy.
3. Fit-score new jobs (Haiku) and drop dealbreakers / score < 5.
4. Recruiter discovery via Playwright (skipped if cache fresh).
5. Draft outreach per (job, recruiter) up to per-company + daily caps.
6. Persist to SQLite + CSV + outreach/drafts/.
7. macOS notification.

Every step appends to data/last_run.log; failures don't crash the whole run.
"""
from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import db
from .config import Config, load_config
from .csv_mirror import write_csv
from .discovery import jobs as jobs_mod
from .discovery import posts as posts_mod
from .discovery import recruiters as rec_mod
from .discovery.linkedin_session import (
    ChallengePage,
    SessionExpired,
    browser_context,
    is_logged_in,
    long_pause,
)
from .drafting import draft_message, slugify
from .ranking import score_jobs
from .resume import find_resume, find_search_profile

log = logging.getLogger(__name__)


@dataclass
class RunSummary:
    new_jobs: int = 0
    qualified_jobs: int = 0
    new_contacts: int = 0
    new_drafts: int = 0
    errors: list[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


def run_daily(headless: bool = True) -> RunSummary:
    cfg = load_config()
    summary = RunSummary()
    _setup_logging(cfg.log_path)

    log.info("=== Daily run started: %s ===", datetime.utcnow().isoformat())

    resume = find_resume(cfg.resumes_dir, cfg.resume_filename)
    if not resume:
        msg = f"No resume found in {cfg.resumes_dir}; drop a .pdf/.docx/.md/.tex there."
        log.error(msg)
        summary.errors.append(msg)
        return summary

    search_profile = find_search_profile(cfg.resumes_dir)
    log.info("Resume loaded: %s (name=%r)", resume.path.name, resume.name)

    new_postings = jobs_mod.search_jobs(
        roles=cfg.roles,
        locations=cfg.locations,
        target_companies=cfg.all_companies,
        hours_old=cfg.hours_old,
    )
    log.info("JobSpy returned %d matching postings (after company filter)", len(new_postings))

    hiring_posts: list[posts_mod.HiringPost] = []
    if cfg.posts_enabled:
        try:
            with browser_context(cfg.browser_profile_dir, headless=headless) as ctx:
                page = ctx.new_page()
                logged_in = False
                try:
                    logged_in = is_logged_in(page)
                finally:
                    page.close()
                if not logged_in:
                    log.warning("Skipping hiring-posts discovery: LinkedIn session expired.")
                else:
                    hiring_posts = posts_mod.search_hiring_posts(
                        ctx,
                        role_keywords=cfg.roles,
                        target_companies=cfg.all_companies,
                        max_results_per_role=cfg.posts_max_results_per_role,
                    )
                    log.info("Hiring posts discovered: %d", len(hiring_posts))
        except ChallengePage as e:
            log.error("Challenge during posts discovery: %s", e)
            summary.errors.append(f"posts discovery: {e}")
        except Exception as e:
            log.exception("Posts discovery failed: %s", e)
            summary.errors.append(f"posts discovery: {e}")

    # Merge hiring posts into the postings stream as synthetic jobs.
    for hp in hiring_posts:
        new_postings.append(jobs_mod.JobPosting(
            company=hp.company,
            role="(hiring post)",
            location="",
            url=hp.post_url,
            description=hp.snippet,
            posted_at=hp.posted_at,
            job_type="",
            salary="",
            source="linkedin_post",
        ))

    with db.connect(cfg.db_path) as conn:
        new_job_ids = []
        for p in new_postings:
            jid = db.upsert_job(
                conn,
                company=p.company,
                role=p.role,
                location=p.location,
                job_type=p.job_type,
                salary=p.salary,
                url=p.url,
                description=p.description,
                discovered_at=datetime.utcnow().isoformat(),
                posted_at=p.posted_at,
                next_action="Review draft",
                apply_via="LinkedIn",
                source=p.source,
            )
            if jid:
                new_job_ids.append((jid, p))
        summary.new_jobs = len(new_job_ids)
        log.info("Inserted %d new jobs", summary.new_jobs)

        # Pre-attach hiring-post authors as contacts so the drafting loop picks them up.
        extra_contacts_by_company: dict[str, list[tuple[int, rec_mod.Contact]]] = {}
        for hp in hiring_posts:
            contact = rec_mod.Contact(
                name=hp.author_name,
                title=hp.author_title or "",
                profile_url=hp.author_profile_url,
                company=hp.company,
                connection_degree="3rd+",
                is_recruiter=posts_mod.author_is_recruiter(hp),
            )
            cid = db.upsert_contact(
                conn,
                company=hp.company,
                name=contact.name,
                title=contact.title,
                profile_url=contact.profile_url,
                connection_degree=contact.connection_degree,
                is_recruiter=int(contact.is_recruiter),
                discovered_at=datetime.utcnow().isoformat(),
            )
            extra_contacts_by_company.setdefault(hp.company, []).append((cid, contact))

        if not new_job_ids:
            log.info("No new jobs; skipping ranking + outreach.")
            write_csv(conn, cfg.csv_path, cfg.tier1_companies)
            return summary

        rank_input = [
            {
                "job_id": jid,
                "title": p.role,
                "company": p.company,
                "location": p.location,
                "description": p.description,
            }
            for jid, p in new_job_ids
        ]
        scores = score_jobs(
            api_key=cfg.azure_ai_api_key,
            endpoint=cfg.azure_ai_endpoint,
            deployment=cfg.azure_ai_deployment,
            api_version=cfg.azure_ai_api_version,
            resume_text=resume.text,
            search_profile=search_profile,
            jobs=rank_input,
        )
        score_by_id = {s.job_id: s for s in scores}

        qualified: list[tuple[int, jobs_mod.JobPosting]] = []
        dealbreakers_lower = {d.lower() for d in cfg.dealbreakers}
        for jid, p in new_job_ids:
            s = score_by_id.get(jid)
            if not s:
                continue
            db.update_job_score(conn, jid, s.score, s.reason, s.dealbreaker_hits)
            if s.score < 5:
                continue
            jd_lower = (p.description or "").lower()
            hard_hit = any(d in jd_lower for d in dealbreakers_lower)
            if hard_hit or s.dealbreaker_hits:
                log.info("Dealbreaker drop: %s @ %s (hits=%s)", p.role, p.company, s.dealbreaker_hits)
                continue
            qualified.append((jid, p))
        summary.qualified_jobs = len(qualified)
        log.info("Qualified jobs after scoring: %d", summary.qualified_jobs)

        if not qualified:
            write_csv(conn, cfg.csv_path, cfg.tier1_companies)
            return summary

        try:
            with browser_context(cfg.browser_profile_dir, headless=headless) as ctx:
                page = ctx.new_page()
                try:
                    if not is_logged_in(page):
                        msg = "LinkedIn session expired; run `linkedin-finder login` and retry."
                        log.error(msg)
                        summary.errors.append(msg)
                        page.close()
                        write_csv(conn, cfg.csv_path, cfg.tier1_companies)
                        return summary
                finally:
                    page.close()

                companies_for_outreach = _dedupe_keep_order([p.company for _, p in qualified])
                drafts_made_today = 0
                for company in companies_for_outreach:
                    if drafts_made_today >= cfg.daily_contact_cap:
                        log.info("Daily contact cap reached (%d).", cfg.daily_contact_cap)
                        break
                    contacts = _gather_contacts(ctx, conn, company, cfg)
                    # Prepend any hiring-post authors for this company (high priority).
                    extras = extra_contacts_by_company.get(company, [])
                    if extras:
                        seen = {cid for cid, _ in contacts}
                        contacts = [(cid, c) for cid, c in extras if cid not in seen] + contacts
                    if not contacts:
                        log.info("No recruiters found at %s; skipping drafts.", company)
                        continue
                    summary.new_contacts += len(contacts)
                    company_jobs = [(jid, p) for jid, p in qualified if p.company == company]

                    per_company = 0
                    for jid, posting in company_jobs:
                        if per_company >= cfg.per_company_contact_cap:
                            break
                        if drafts_made_today >= cfg.daily_contact_cap:
                            break
                        for c_id, contact in contacts[: cfg.per_company_contact_cap]:
                            try:
                                body = draft_message(
                                    api_key=cfg.azure_ai_api_key,
                                    endpoint=cfg.azure_ai_endpoint,
                                    deployment=cfg.azure_ai_deployment,
                                    api_version=cfg.azure_ai_api_version,
                                    user_first_name=cfg.first_name or (resume.name or "Me").split()[0],
                                    resume_text=resume.text,
                                    contact_name=contact.name,
                                    contact_title=contact.title,
                                    is_recruiter=contact.is_recruiter,
                                    role=posting.role,
                                    company=posting.company,
                                    job_description=posting.description,
                                )
                                file_path = _write_draft_file(cfg.drafts_dir, posting, contact, body)
                                draft_id = db.insert_draft(conn, jid, c_id, body, str(file_path))
                                if draft_id:
                                    summary.new_drafts += 1
                                    per_company += 1
                                    drafts_made_today += 1
                            except Exception as e:
                                log.exception("draft failed for %s @ %s: %s", contact.name, company, e)
                                summary.errors.append(f"draft failed: {e}")
                            if per_company >= cfg.per_company_contact_cap:
                                break
                        if per_company >= cfg.per_company_contact_cap:
                            break
                    long_pause()
        except ChallengePage as e:
            msg = f"LinkedIn challenge page hit; halting outreach phase: {e}"
            log.error(msg)
            summary.errors.append(msg)
        except SessionExpired as e:
            log.error("Session expired mid-run: %s", e)
            summary.errors.append(str(e))
        except Exception as e:
            log.exception("Browser phase failed: %s", e)
            summary.errors.append(f"browser phase: {e}")

        purged = db.purge_older_than(conn, cfg.retention_days)
        if any(purged.values()):
            log.info("Purged rows older than %dd: %s", cfg.retention_days, purged)
        write_csv(conn, cfg.csv_path, cfg.tier1_companies)
    _purge_draft_files(cfg.drafts_dir, cfg.retention_days)

    _macos_notify(
        title="LinkedIn Job Finder",
        message=f"{summary.new_drafts} new drafts ready ({summary.qualified_jobs} qualified jobs)",
    )
    log.info(
        "Run complete: new_jobs=%d qualified=%d drafts=%d contacts=%d errors=%d",
        summary.new_jobs,
        summary.qualified_jobs,
        summary.new_drafts,
        summary.new_contacts,
        len(summary.errors),
    )
    return summary


def _gather_contacts(ctx, conn, company: str, cfg: Config):
    """Fetch recruiters for company, respecting cache TTL. Returns [(contact_id, Contact)]."""
    if db.recruiter_cache_fresh(conn, company, cfg.recruiter_cache_days):
        rows = db.contacts_for_company(conn, company)
        log.info("Recruiter cache HIT for %s (%d contacts)", company, len(rows))
        return [(r["id"], _row_to_contact(r)) for r in rows if r["is_recruiter"]]

    log.info("Recruiter cache MISS for %s; running People search", company)
    try:
        contacts = rec_mod.search_recruiters(ctx, company, max_results=cfg.per_company_contact_cap)
    except Exception as e:
        log.warning("People search failed for %s: %s", company, e)
        return []

    out = []
    for c in contacts:
        cid = db.upsert_contact(
            conn,
            company=company,
            name=c.name,
            title=c.title,
            profile_url=c.profile_url,
            connection_degree=c.connection_degree,
            is_recruiter=int(c.is_recruiter),
            discovered_at=datetime.utcnow().isoformat(),
        )
        out.append((cid, c))
    db.mark_recruiter_searched(conn, company)
    return out


def _row_to_contact(row):
    return rec_mod.Contact(
        name=row["name"],
        title=row["title"] or "",
        profile_url=row["profile_url"],
        company=row["company"],
        connection_degree=row["connection_degree"] or "3rd+",
        is_recruiter=bool(row["is_recruiter"]),
    )


def _write_draft_file(drafts_dir: Path, posting, contact, body: str) -> Path:
    drafts_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    fname = f"{today}_{slugify(posting.company)}_{slugify(contact.name)}.md"
    path = drafts_dir / fname
    contents = (
        f"# {posting.company} - {posting.role}\n\n"
        f"**Contact:** {contact.name} ({contact.title or 'unknown title'})  \n"
        f"**Profile:** {contact.profile_url}  \n"
        f"**Job:** {posting.url}\n\n"
        f"---\n\n{body}\n"
    )
    path.write_text(contents)
    return path


def _purge_draft_files(drafts_dir: Path, days: int) -> None:
    if not drafts_dir.exists():
        return
    cutoff = datetime.utcnow().timestamp() - days * 86400
    removed = 0
    for p in drafts_dir.glob("*.md"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
                removed += 1
        except OSError:
            pass
    if removed:
        log.info("Purged %d draft files older than %dd", removed, days)


def _dedupe_keep_order(seq):
    seen = set()
    out = []
    for s in seq:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _setup_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fmt = "%(asctime)s %(levelname)s %(name)s: %(message)s"
    handler = logging.FileHandler(log_path)
    handler.setFormatter(logging.Formatter(fmt))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not any(isinstance(h, logging.FileHandler) for h in root.handlers):
        root.addHandler(handler)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler) for h in root.handlers):
        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter(fmt))
        root.addHandler(sh)


def _macos_notify(title: str, message: str) -> None:
    try:
        subprocess.run(
            ["osascript", "-e", f'display notification "{message}" with title "{title}"'],
            check=False,
            timeout=5,
        )
    except Exception:
        pass
