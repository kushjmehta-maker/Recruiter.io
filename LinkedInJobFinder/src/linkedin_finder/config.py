"""Configuration loading: targets.yaml + .env + path resolution.

Two runtime modes:
- Local (default): paths point at the repo (data/, outreach/drafts/, job_tracker.csv).
- Remote (LINKEDIN_FINDER_REMOTE=1, used by Azure App Service): paths point at
  /tmp/linkedin_finder/ where blob_reader.ensure_local_copy() drops a fresh
  mirror at every Streamlit rerun. SQLite + CSV + log live there; everything is
  read-only in this mode.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
REMOTE_CACHE_DIR = Path("/tmp/linkedin_finder")


@dataclass
class Config:
    project_root: Path
    first_name: str
    resume_filename: str | None
    roles: list[str]
    locations: list[str]
    hours_old: int
    salary_floor_usd: int | None
    tier1_companies: list[str]
    tier2_companies: list[str]
    tier3_companies: list[str]
    must_haves: list[str]
    dealbreakers: list[str]
    daily_contact_cap: int
    per_company_contact_cap: int
    recruiter_cache_days: int
    retention_days: int = 30
    posts_enabled: bool = True
    posts_max_results_per_role: int = 30
    azure_ai_api_key: str | None = field(repr=False, default=None)
    azure_ai_endpoint: str | None = None
    azure_ai_deployment: str | None = None
    azure_ai_api_version: str = "2024-10-21"
    remote_mode: bool = False
    blob_account_url: str | None = None
    blob_state_container: str = "state"
    blob_drafts_container: str = "drafts"

    @property
    def llm_configured(self) -> bool:
        return bool(self.azure_ai_api_key and self.azure_ai_endpoint and self.azure_ai_deployment)

    @property
    def blob_configured(self) -> bool:
        return bool(self.blob_account_url)

    @property
    def all_companies(self) -> list[str]:
        return self.tier1_companies + self.tier2_companies + self.tier3_companies

    @property
    def resumes_dir(self) -> Path:
        return self.project_root / "resumes"

    @property
    def data_dir(self) -> Path:
        return REMOTE_CACHE_DIR if self.remote_mode else self.project_root / "data"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jobs.db"

    @property
    def browser_profile_dir(self) -> Path:
        # Only meaningful in local mode; remote App Service never runs Playwright.
        return self.project_root / "data" / "browser_profile"

    @property
    def drafts_dir(self) -> Path:
        if self.remote_mode:
            return REMOTE_CACHE_DIR / "drafts"
        return self.project_root / "outreach" / "drafts"

    @property
    def csv_path(self) -> Path:
        return self.data_dir / "job_tracker.csv" if self.remote_mode else self.project_root / "job_tracker.csv"

    @property
    def log_path(self) -> Path:
        return self.data_dir / "last_run.log"


def load_config(project_root: Path | None = None) -> Config:
    root = project_root or PROJECT_ROOT
    load_dotenv(root / ".env")

    cfg_path = root / "config" / "targets.yaml"
    raw = yaml.safe_load(cfg_path.read_text())

    user = raw.get("user", {})
    search = raw.get("search", {})
    companies = raw.get("companies", {})
    filters = raw.get("filters", {})
    outreach = raw.get("outreach", {})
    posts = raw.get("posts", {})

    cfg = Config(
        project_root=root,
        first_name=user.get("first_name", ""),
        resume_filename=user.get("resume_filename"),
        roles=search.get("roles", []),
        locations=search.get("locations", []),
        hours_old=int(search.get("hours_old", 24)),
        salary_floor_usd=search.get("salary_floor_usd"),
        tier1_companies=companies.get("tier1", []),
        tier2_companies=companies.get("tier2", []),
        tier3_companies=companies.get("tier3", []),
        must_haves=filters.get("must_haves", []),
        dealbreakers=filters.get("dealbreakers", []),
        daily_contact_cap=int(outreach.get("daily_contact_cap", 15)),
        per_company_contact_cap=int(outreach.get("per_company_contact_cap", 3)),
        recruiter_cache_days=int(outreach.get("recruiter_cache_days", 7)),
        retention_days=int(outreach.get("retention_days", 30)),
        posts_enabled=bool(posts.get("enabled", True)),
        posts_max_results_per_role=int(posts.get("max_results_per_role", 30)),
        azure_ai_api_key=os.environ.get("AZURE_AI_API_KEY"),
        azure_ai_endpoint=os.environ.get("AZURE_AI_ENDPOINT"),
        azure_ai_deployment=os.environ.get("AZURE_AI_DEPLOYMENT"),
        azure_ai_api_version=os.environ.get("AZURE_AI_API_VERSION", "2024-10-21"),
        remote_mode=os.environ.get("LINKEDIN_FINDER_REMOTE", "").lower() in ("1", "true", "yes"),
        blob_account_url=os.environ.get("BLOB_ACCOUNT_URL"),
        blob_state_container=os.environ.get("BLOB_STATE_CONTAINER", "state"),
        blob_drafts_container=os.environ.get("BLOB_DRAFTS_CONTAINER", "drafts"),
    )

    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    cfg.drafts_dir.mkdir(parents=True, exist_ok=True)
    if not cfg.remote_mode:
        cfg.browser_profile_dir.mkdir(parents=True, exist_ok=True)

    return cfg
