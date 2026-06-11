from datetime import datetime
from pathlib import Path

from linkedin_finder import db
from linkedin_finder.csv_mirror import COLUMNS, write_csv


def test_csv_columns_match_sibling():
    expected = [
        "Priority", "Company", "Role", "Location", "Type", "Salary",
        "Status", "Applied Date", "Next Action", "URL", "Notes",
        "Discovered Date", "Referral Needed", "Referral Status",
        "Referral Deadline", "Apply Via",
    ]
    assert COLUMNS == expected


def test_write_csv_round_trip(tmp_path: Path):
    db_path = tmp_path / "j.db"
    csv_path = tmp_path / "out.csv"
    with db.connect(db_path) as conn:
        db.upsert_job(
            conn,
            company="Anthropic",
            role="Software Engineer",
            location="Remote",
            job_type="Full-time",
            salary="$200k - $300k",
            url="https://linkedin.com/jobs/view/1",
            description="Build cool things.",
            discovered_at=datetime.utcnow().isoformat(),
            posted_at="2026-06-09",
            next_action="Review",
            apply_via="LinkedIn",
        )
        n = write_csv(conn, csv_path, ["Anthropic"])
    assert n == 1
    rows = csv_path.read_text().splitlines()
    assert rows[0].split(",")[0] == "Priority"
    assert "Anthropic" in rows[1]
    assert "HIGH" in rows[1]  # tier1 -> HIGH priority
