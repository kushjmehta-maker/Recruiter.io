"""Azure Blob → local /tmp mirror for the cloud Streamlit instance.

The App Service runs in remote mode (LINKEDIN_FINDER_REMOTE=1). At every
Streamlit rerun, the UI calls ensure_local_copy() before any DB read. We pull
jobs.db / job_tracker.csv / last_run.log down to /tmp/linkedin_finder/ if the
blob ETag has changed since the last fetch (cached in .etags.json). Cheap.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from .config import REMOTE_CACHE_DIR, Config

log = logging.getLogger(__name__)

ETAG_CACHE = REMOTE_CACHE_DIR / ".etags.json"

STATE_FILES = ["jobs.db", "job_tracker.csv", "last_run.log"]


def ensure_local_copy(cfg: Config) -> Path:
    """Download state files to /tmp/linkedin_finder/ if changed. Returns the dir."""
    REMOTE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (REMOTE_CACHE_DIR / "drafts").mkdir(parents=True, exist_ok=True)

    if not cfg.blob_configured:
        log.warning("blob_reader: BLOB_ACCOUNT_URL unset; remote mode will see empty data")
        return REMOTE_CACHE_DIR

    try:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient
    except ImportError:
        log.error("blob_reader: azure-storage-blob missing; install with .[cloud]")
        return REMOTE_CACHE_DIR

    cred = DefaultAzureCredential()
    client = BlobServiceClient(account_url=cfg.blob_account_url, credential=cred)
    container = client.get_container_client(cfg.blob_state_container)

    etags = _load_etags()
    for name in STATE_FILES:
        blob = container.get_blob_client(name)
        try:
            props = blob.get_blob_properties()
        except Exception as e:
            log.info("blob_reader: %s missing in blob (%s)", name, e)
            continue
        etag = props.etag
        if etags.get(name) == etag and (REMOTE_CACHE_DIR / name).exists():
            continue
        target = REMOTE_CACHE_DIR / name
        with target.open("wb") as f:
            f.write(blob.download_blob().readall())
        etags[name] = etag
        log.info("blob_reader: refreshed %s", name)
    _save_etags(etags)
    return REMOTE_CACHE_DIR


def list_draft_blobs(cfg: Config) -> list[str]:
    if not cfg.blob_configured:
        return []
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient

    cred = DefaultAzureCredential()
    client = BlobServiceClient(account_url=cfg.blob_account_url, credential=cred)
    container = client.get_container_client(cfg.blob_drafts_container)
    return [b.name for b in container.list_blobs()]


def read_draft_blob(cfg: Config, name: str) -> str:
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient

    cred = DefaultAzureCredential()
    client = BlobServiceClient(account_url=cfg.blob_account_url, credential=cred)
    blob = client.get_container_client(cfg.blob_drafts_container).get_blob_client(name)
    return blob.download_blob().readall().decode("utf-8")


def _load_etags() -> dict[str, str]:
    if not ETAG_CACHE.exists():
        return {}
    try:
        return json.loads(ETAG_CACHE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_etags(etags: dict[str, str]) -> None:
    try:
        ETAG_CACHE.write_text(json.dumps(etags))
    except OSError:
        pass
