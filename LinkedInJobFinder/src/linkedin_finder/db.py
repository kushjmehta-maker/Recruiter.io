"""SQLite schema + idempotent upserts.

Three tables:
- jobs: every posting we've seen
- contacts: every recruiter / hiring manager we've found, keyed by linkedin profile URL
- drafts: per (job, contact) outreach draft + send status
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT,
    job_type TEXT,
    salary TEXT,
    url TEXT NOT NULL UNIQUE,
    description TEXT,
    discovered_at TEXT NOT NULL,
    posted_at TEXT,
    fit_score REAL,
    fit_reason TEXT,
    dealbreaker_hits TEXT,
    status TEXT NOT NULL DEFAULT 'To Apply',
    applied_date TEXT,
    next_action TEXT,
    notes TEXT,
    referral_needed TEXT DEFAULT 'Yes',
    referral_status TEXT DEFAULT 'Outreach Pending',
    referral_deadline TEXT,
    apply_via TEXT,
    source TEXT NOT NULL DEFAULT 'linkedin_jobs'
);

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT,
    profile_url TEXT NOT NULL UNIQUE,
    connection_degree TEXT,
    is_recruiter INTEGER DEFAULT 0,
    discovered_at TEXT NOT NULL,
    last_outreach_at TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending Review',
    created_at TEXT NOT NULL,
    sent_at TEXT,
    file_path TEXT,
    UNIQUE (job_id, contact_id)
);

CREATE TABLE IF NOT EXISTS recruiter_search_cache (
    company TEXT PRIMARY KEY,
    last_searched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
"""


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(SCHEMA)
        _migrate(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive migrations for older DBs. Safe to run on every connect."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    if "source" not in cols:
        conn.execute(
            "ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'linkedin_jobs'"
        )


def upsert_job(conn: sqlite3.Connection, **fields) -> int | None:
    """Insert a job; return id, or None if it already existed."""
    cur = conn.execute(
        "SELECT id FROM jobs WHERE url = ?", (fields["url"],)
    )
    row = cur.fetchone()
    if row:
        return None
    cols = ",".join(fields.keys())
    placeholders = ",".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO jobs ({cols}) VALUES ({placeholders})",
        tuple(fields.values()),
    )
    return cur.lastrowid


def update_job_score(conn: sqlite3.Connection, job_id: int, score: float, reason: str, hits: list[str]) -> None:
    conn.execute(
        "UPDATE jobs SET fit_score=?, fit_reason=?, dealbreaker_hits=? WHERE id=?",
        (score, reason, ",".join(hits), job_id),
    )


def upsert_contact(conn: sqlite3.Connection, **fields) -> int:
    cur = conn.execute(
        "SELECT id FROM contacts WHERE profile_url = ?", (fields["profile_url"],)
    )
    row = cur.fetchone()
    if row:
        return row["id"]
    cols = ",".join(fields.keys())
    placeholders = ",".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO contacts ({cols}) VALUES ({placeholders})",
        tuple(fields.values()),
    )
    return cur.lastrowid


def insert_draft(conn: sqlite3.Connection, job_id: int, contact_id: int, body: str, file_path: str) -> int | None:
    """Insert a draft. Returns id, or None if (job, contact) already has one."""
    try:
        cur = conn.execute(
            "INSERT INTO drafts (job_id, contact_id, body, created_at, file_path) VALUES (?, ?, ?, ?, ?)",
            (job_id, contact_id, body, datetime.utcnow().isoformat(), file_path),
        )
        return cur.lastrowid
    except sqlite3.IntegrityError:
        return None


def recruiter_cache_fresh(conn: sqlite3.Connection, company: str, ttl_days: int) -> bool:
    cur = conn.execute(
        "SELECT last_searched_at FROM recruiter_search_cache WHERE company=?",
        (company,),
    )
    row = cur.fetchone()
    if not row:
        return False
    last = datetime.fromisoformat(row["last_searched_at"])
    return datetime.utcnow() - last < timedelta(days=ttl_days)


def mark_recruiter_searched(conn: sqlite3.Connection, company: str) -> None:
    conn.execute(
        "INSERT INTO recruiter_search_cache (company, last_searched_at) VALUES (?, ?) "
        "ON CONFLICT(company) DO UPDATE SET last_searched_at=excluded.last_searched_at",
        (company, datetime.utcnow().isoformat()),
    )


def all_jobs(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM jobs ORDER BY discovered_at DESC").fetchall()


def pending_drafts(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT d.*, j.company, j.role, j.url AS job_url, j.fit_score, j.source AS job_source,
               c.name AS contact_name, c.title AS contact_title,
               c.profile_url AS contact_profile_url
        FROM drafts d
        JOIN jobs j ON j.id = d.job_id
        JOIN contacts c ON c.id = d.contact_id
        WHERE d.status = 'Pending Review'
        ORDER BY d.created_at DESC
        """
    ).fetchall()


def update_draft_status(conn: sqlite3.Connection, draft_id: int, status: str) -> None:
    sent = datetime.utcnow().isoformat() if status == "Sent" else None
    conn.execute(
        "UPDATE drafts SET status=?, sent_at=? WHERE id=?",
        (status, sent, draft_id),
    )


def update_draft_body(conn: sqlite3.Connection, draft_id: int, body: str) -> None:
    conn.execute("UPDATE drafts SET body=? WHERE id=?", (body, draft_id))


def update_job_status(conn: sqlite3.Connection, job_id: int, status: str, applied_date: str | None = None) -> None:
    if applied_date:
        conn.execute(
            "UPDATE jobs SET status=?, applied_date=? WHERE id=?",
            (status, applied_date, job_id),
        )
    else:
        conn.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))


def contacts_for_company(conn: sqlite3.Connection, company: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM contacts WHERE company=? ORDER BY is_recruiter DESC, discovered_at DESC",
        (company,),
    ).fetchall()


def all_contacts(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM contacts ORDER BY discovered_at DESC, is_recruiter DESC"
    ).fetchall()


def purge_older_than(conn: sqlite3.Connection, days: int) -> dict[str, int]:
    """Delete jobs/contacts/drafts/cache rows older than `days`. Returns per-table delete counts."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    counts = {}
    for table, col in (("drafts", "created_at"), ("jobs", "discovered_at"), ("contacts", "discovered_at")):
        cur = conn.execute(f"DELETE FROM {table} WHERE {col} < ?", (cutoff,))
        counts[table] = cur.rowcount
    conn.execute("DELETE FROM recruiter_search_cache WHERE last_searched_at < ?", (cutoff,))
    return counts
