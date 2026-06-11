"""Write the 16-column job_tracker.csv from the SQLite jobs table.

Columns (matches sibling project at ../claude-linkedin-assistant/):
Priority, Company, Role, Location, Type, Salary, Status, Applied Date,
Next Action, URL, Notes, Discovered Date, Referral Needed, Referral Status,
Referral Deadline, Apply Via
"""
from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

COLUMNS = [
    "Priority", "Company", "Role", "Location", "Type", "Salary",
    "Status", "Applied Date", "Next Action", "URL", "Notes",
    "Discovered Date", "Referral Needed", "Referral Status",
    "Referral Deadline", "Apply Via",
]


def _priority_for(score: float | None, tier1: list[str], company: str) -> str:
    if company in tier1:
        return "HIGH"
    if score is None:
        return "MEDIUM"
    if score >= 8:
        return "HIGH"
    if score >= 6:
        return "MEDIUM"
    return "LOW"


def write_csv(conn: sqlite3.Connection, csv_path: Path, tier1_companies: list[str]) -> int:
    rows = conn.execute(
        "SELECT * FROM jobs ORDER BY discovered_at DESC"
    ).fetchall()
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(COLUMNS)
        for r in rows:
            writer.writerow([
                _priority_for(r["fit_score"], tier1_companies, r["company"]),
                r["company"] or "",
                r["role"] or "",
                r["location"] or "",
                r["job_type"] or "",
                r["salary"] or "",
                r["status"] or "To Apply",
                r["applied_date"] or "",
                r["next_action"] or "",
                r["url"] or "",
                r["notes"] or "",
                r["discovered_at"][:10] if r["discovered_at"] else "",
                r["referral_needed"] or "Yes",
                r["referral_status"] or "Outreach Pending",
                r["referral_deadline"] or "",
                r["apply_via"] or "LinkedIn",
            ])
    return len(rows)
