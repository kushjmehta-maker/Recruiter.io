"""Local → Azure Blob Storage sync.

Called at the tail of the daily pipeline. Uploads three state files (jobs.db,
job_tracker.csv, last_run.log) plus any new/changed draft markdown. Authenticates
with DefaultAzureCredential, so the user just runs `az login` once on the Mac and
the refresh token lives in the OS keychain.

No-op when BLOB_ACCOUNT_URL is unset, so users who don't want a cloud mirror are
not affected.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from .config import Config

log = logging.getLogger(__name__)

LAST_SYNC_FILE = ".last_sync"


def sync_to_blob(cfg: Config, force_full: bool = False) -> dict[str, int]:
    """Push state + new drafts to Blob. Returns per-bucket upload counts.

    Returns {"state": 0, "drafts": 0} (and logs) when not configured, so the
    caller can treat it as best-effort.
    """
    if not cfg.blob_configured:
        log.info("blob_sync: BLOB_ACCOUNT_URL unset; skipping cloud mirror")
        return {"state": 0, "drafts": 0}

    try:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient
    except ImportError:
        log.warning("blob_sync: azure-storage-blob not installed; run `pip install -e .[cloud]`")
        return {"state": 0, "drafts": 0}

    cred = DefaultAzureCredential()
    client = BlobServiceClient(account_url=cfg.blob_account_url, credential=cred)

    state_uploaded = _upload_state_files(client, cfg)
    drafts_uploaded = _upload_new_drafts(client, cfg, force_full=force_full)

    log.info("blob_sync: uploaded %d state files, %d drafts", state_uploaded, drafts_uploaded)
    return {"state": state_uploaded, "drafts": drafts_uploaded}


def _upload_state_files(client, cfg: Config) -> int:
    container = client.get_container_client(cfg.blob_state_container)
    _ensure_container(container)

    files = [
        ("jobs.db", cfg.db_path),
        ("job_tracker.csv", cfg.csv_path),
        ("last_run.log", cfg.log_path),
    ]
    count = 0
    for blob_name, local_path in files:
        if not local_path.exists():
            continue
        with local_path.open("rb") as f:
            container.upload_blob(name=blob_name, data=f, overwrite=True)
        count += 1
    return count


def _upload_new_drafts(client, cfg: Config, force_full: bool) -> int:
    container = client.get_container_client(cfg.blob_drafts_container)
    _ensure_container(container)

    sync_marker = cfg.project_root / "data" / LAST_SYNC_FILE
    last_sync_ts = 0.0
    if sync_marker.exists() and not force_full:
        try:
            last_sync_ts = float(json.loads(sync_marker.read_text()).get("ts", 0))
        except (json.JSONDecodeError, ValueError):
            last_sync_ts = 0.0

    count = 0
    newest = last_sync_ts
    for md in sorted(cfg.drafts_dir.glob("*.md")):
        mtime = md.stat().st_mtime
        if mtime <= last_sync_ts:
            continue
        with md.open("rb") as f:
            container.upload_blob(name=md.name, data=f, overwrite=True)
        count += 1
        if mtime > newest:
            newest = mtime

    if count:
        sync_marker.write_text(json.dumps({"ts": newest, "at": datetime.utcnow().isoformat()}))
    return count


def _ensure_container(container) -> None:
    try:
        container.create_container()
    except Exception:
        # Already exists, or RBAC role doesn't permit create. Either way, uploads
        # will surface the real error.
        pass
