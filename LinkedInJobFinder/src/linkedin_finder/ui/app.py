"""Streamlit dashboard.

Tabs:
- Today: pending drafts grouped by company. Edit -> Save. "Open in LinkedIn" -> manual send.
- All Jobs: searchable table mirroring job_tracker.csv, inline status edit.
- Contacts: recruiter directory across companies.
- Resume: upload + show extracted name.
- Targets: visual editor for config/targets.yaml.
- Settings: API key status, last run log, "Run daily now".

Runs in two modes (toggle: LINKEDIN_FINDER_REMOTE=1):
- Local (default): read/write the on-disk SQLite + CSV + drafts.
- Remote (Azure App Service): pull state from Blob to /tmp at every rerun;
  hide all mutating widgets and show a read-only banner.

Launch: `linkedin-finder ui` (or `streamlit run src/linkedin_finder/ui/app.py`).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import urllib.parse
from datetime import datetime
from pathlib import Path

import streamlit as st
import yaml

from linkedin_finder import blob_reader, db
from linkedin_finder.config import load_config
from linkedin_finder.csv_mirror import write_csv
from linkedin_finder.resume import find_resume

st.set_page_config(page_title="LinkedIn Job Finder", layout="wide")
cfg = load_config()

if cfg.remote_mode:
    try:
        blob_reader.ensure_local_copy(cfg)
    except Exception as e:
        st.error(f"Failed to sync state from Azure Blob: {e}")
    st.info("Read-only view (cloud mirror). Send / edit from the Mac app.")


def _profile_id_from_url(url: str) -> str:
    if not url:
        return ""
    return url.rstrip("/").split("/")[-1]


def _compose_url(profile_url: str) -> str:
    pid = _profile_id_from_url(profile_url)
    return f"https://www.linkedin.com/messaging/compose/?profileId={urllib.parse.quote(pid)}"


def _profile_view_url(profile_url: str) -> str:
    """Direct profile URL — Premium users see an InMail button on profiles for
    non-connections. Use this when the contact is 3rd-degree."""
    if not profile_url:
        return ""
    return profile_url if profile_url.startswith("http") else f"https://www.linkedin.com{profile_url}"


tabs = st.tabs(["Today", "All Jobs", "Contacts", "Resume", "Targets", "Settings"])

# ---- Today --------------------------------------------------------------
with tabs[0]:
    st.header("Pending drafts")
    with db.connect(cfg.db_path) as conn:
        rows = db.pending_drafts(conn)
    if not rows:
        st.info("No pending drafts. Run `linkedin-finder daily` or wait for the schedule.")
    else:
        st.caption(f"{len(rows)} drafts awaiting review")
        for r in rows:
            with st.container(border=True):
                cols = st.columns([3, 1])
                with cols[0]:
                    source_badge = ""
                    try:
                        if r["job_source"] == "linkedin_post":
                            source_badge = " :violet-badge[hiring post]"
                    except (IndexError, KeyError):
                        pass
                    st.subheader(f"{r['company']} - {r['role']}{source_badge}")
                    score_text = f"fit {r['fit_score']:.1f}/10" if r["fit_score"] is not None else "fit -"
                    st.caption(
                        f"{score_text} | Contact: {r['contact_name']} ({r['contact_title'] or 'unknown'})"
                    )
                    st.markdown(f"[Job posting]({r['job_url']}) | [Profile]({r['contact_profile_url']})")
                with cols[1]:
                    st.markdown(f"[Open compose ↗]({_compose_url(r['contact_profile_url'])})")
                    st.markdown(f"[View profile (InMail) ↗]({_profile_view_url(r['contact_profile_url'])})")

                edited = st.text_area(
                    "Draft",
                    value=r["body"],
                    height=140,
                    key=f"body_{r['id']}",
                    disabled=cfg.remote_mode,
                )
                if not cfg.remote_mode:
                    action_cols = st.columns(4)
                    if action_cols[0].button("Save edits", key=f"save_{r['id']}"):
                        with db.connect(cfg.db_path) as conn:
                            db.update_draft_body(conn, r["id"], edited)
                        st.success("Saved")
                    if action_cols[1].button("Mark sent", key=f"sent_{r['id']}"):
                        with db.connect(cfg.db_path) as conn:
                            db.update_draft_status(conn, r["id"], "Sent")
                            db.update_job_status(conn, r["job_id"], "Applied", datetime.utcnow().date().isoformat())
                            write_csv(conn, cfg.csv_path, cfg.tier1_companies, cfg.tier2_companies, cfg.tier3_companies)
                        st.success("Marked sent + job set to Applied")
                        st.rerun()
                    if action_cols[2].button("Dismiss", key=f"dismiss_{r['id']}"):
                        with db.connect(cfg.db_path) as conn:
                            db.update_draft_status(conn, r["id"], "Dismissed")
                        st.rerun()
                    if action_cols[3].button("Snooze 7d", key=f"snooze_{r['id']}"):
                        with db.connect(cfg.db_path) as conn:
                            db.update_draft_status(conn, r["id"], "Snoozed")
                        st.rerun()

# ---- All Jobs -----------------------------------------------------------
with tabs[1]:
    st.header("All jobs")
    with db.connect(cfg.db_path) as conn:
        all_jobs_rows = db.all_jobs(conn)
    if not all_jobs_rows:
        st.info("No jobs yet. Run `linkedin-finder daily`.")
    else:
        import pandas as pd
        df = pd.DataFrame(
            [
                {
                    "Company": j["company"],
                    "Role": j["role"],
                    "Location": j["location"] or "",
                    "Salary": j["salary"] or "",
                    "Fit": j["fit_score"],
                    "Status": j["status"],
                    "Source": (j["source"] if "source" in j.keys() else "linkedin_jobs"),
                    "Discovered": (j["discovered_at"] or "")[:10],
                    "URL": j["url"],
                }
                for j in all_jobs_rows
            ]
        )
        st.dataframe(df, use_container_width=True, height=600)

# ---- Contacts -----------------------------------------------------------
with tabs[2]:
    st.header("Recruiter / hiring-manager directory")
    with db.connect(cfg.db_path) as conn:
        contacts = db.all_contacts(conn)
    if not contacts:
        st.info("No contacts yet.")
    else:
        import pandas as pd
        df = pd.DataFrame(
            [
                {
                    "Company": c["company"],
                    "Name": c["name"],
                    "Title": c["title"] or "",
                    "Recruiter": "yes" if c["is_recruiter"] else "no",
                    "Profile": c["profile_url"],
                    "Discovered": (c["discovered_at"] or "")[:10],
                }
                for c in contacts
            ]
        )
        st.dataframe(df, use_container_width=True, height=500)

# ---- Resume -------------------------------------------------------------
with tabs[3]:
    st.header("Resume")
    if cfg.remote_mode:
        st.caption("(remote: managed on Mac)")
    else:
        resume = find_resume(cfg.resumes_dir, cfg.resume_filename)
        if resume:
            st.success(f"Loaded: {resume.path.name}")
            st.write(f"**Detected name:** {resume.name or '(could not detect)'}")
            with st.expander("Preview text", expanded=False):
                st.text(resume.text[:4000])
        else:
            st.warning("No resume found in resumes/")

        uploaded = st.file_uploader(
            "Upload a new resume (.pdf, .docx, .md, .tex)",
            type=["pdf", "docx", "md", "tex", "txt"],
        )
        if uploaded is not None:
            target = cfg.resumes_dir / uploaded.name
            target.write_bytes(uploaded.getbuffer())
            st.success(f"Saved to {target}")
            st.rerun()

# ---- Targets ------------------------------------------------------------
with tabs[4]:
    st.header("Targets (config/targets.yaml)")
    targets_path = cfg.project_root / "config" / "targets.yaml"
    raw = targets_path.read_text()
    if cfg.remote_mode:
        st.code(raw, language="yaml")
    else:
        edited = st.text_area("YAML", value=raw, height=500)
        if st.button("Save targets.yaml"):
            try:
                yaml.safe_load(edited)  # validate
                targets_path.write_text(edited)
                st.success("Saved. Reload the page to apply.")
            except yaml.YAMLError as e:
                st.error(f"Invalid YAML: {e}")

# ---- Settings -----------------------------------------------------------
with tabs[5]:
    st.header("Settings")
    st.subheader("Azure AI credentials")
    if cfg.llm_configured:
        st.success(
            f"Azure AI configured (deployment={cfg.azure_ai_deployment}, "
            f"endpoint={cfg.azure_ai_endpoint})"
        )
    else:
        missing = [
            n for n, v in [
                ("AZURE_AI_API_KEY", cfg.azure_ai_api_key),
                ("AZURE_AI_ENDPOINT", cfg.azure_ai_endpoint),
                ("AZURE_AI_DEPLOYMENT", cfg.azure_ai_deployment),
            ] if not v
        ]
        st.warning(
            f"Missing in .env: {', '.join(missing)}. Ranking + drafting will use fallback templates."
        )

    if not cfg.remote_mode:
        st.subheader("Run daily now")
        if st.button("Run daily pipeline now"):
            with st.spinner("Running... this can take 1-3 minutes"):
                from linkedin_finder.daily import run_daily
                summary = run_daily(headless=True)
            st.success(
                f"new_jobs={summary.new_jobs} qualified={summary.qualified_jobs} "
                f"contacts={summary.new_contacts} drafts={summary.new_drafts} errors={len(summary.errors)}"
            )
            if summary.errors:
                for e in summary.errors:
                    st.error(e)

    st.subheader("Last run log")
    if cfg.log_path.exists():
        with cfg.log_path.open() as f:
            log_text = f.read()
        st.code(log_text[-6000:], language="log")
    else:
        st.info("No log yet.")

    if not cfg.remote_mode:
        st.subheader("Schedule (macOS launchd)")
        plist_path = Path.home() / "Library" / "LaunchAgents" / "io.recruiter.linkedinfinder.plist"
        if plist_path.exists():
            st.success(f"Installed at {plist_path}")
            if st.button("Uninstall schedule"):
                subprocess.run(["bash", str(cfg.project_root / "scripts" / "uninstall_launchd.sh")], check=False)
                st.rerun()
        else:
            st.info("Not installed.")
            if st.button("Install schedule"):
                subprocess.run(["bash", str(cfg.project_root / "scripts" / "install_launchd.sh")], check=False)
                st.rerun()

    if cfg.remote_mode:
        st.subheader("Cloud mirror")
        st.caption(
            f"Reading from Blob: {cfg.blob_account_url} (containers: "
            f"{cfg.blob_state_container}, {cfg.blob_drafts_container})"
        )
