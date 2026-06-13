"""Tests for blob_sync — env-missing no-op + upload calls when configured."""
from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from linkedin_finder.blob_sync import sync_to_blob
from linkedin_finder.config import Config


def _make_cfg(tmp_path: Path, blob_url: str | None) -> Config:
    (tmp_path / "data").mkdir()
    (tmp_path / "outreach" / "drafts").mkdir(parents=True)
    return Config(
        project_root=tmp_path,
        first_name="x",
        resume_filename=None,
        roles=[],
        locations=[],
        hours_old=24,
        salary_floor_usd=None,
        tier1_companies=[],
        tier2_companies=[],
        must_haves=[],
        dealbreakers=[],
        daily_contact_cap=10,
        per_company_contact_cap=3,
        recruiter_cache_days=7,
        blob_account_url=blob_url,
    )


def test_sync_noop_when_blob_unconfigured(tmp_path):
    cfg = _make_cfg(tmp_path, blob_url=None)
    result = sync_to_blob(cfg)
    assert result == {"state": 0, "drafts": 0}


def test_sync_uploads_state_and_new_drafts(tmp_path, monkeypatch):
    cfg = _make_cfg(tmp_path, blob_url="https://fake.blob.core.windows.net")
    cfg.db_path.write_bytes(b"sqlite-bytes")
    cfg.csv_path.write_text("a,b,c\n")
    cfg.log_path.write_text("ok\n")
    (cfg.drafts_dir / "2026-06-11_acme_jane.md").write_text("# draft\n")

    mock_container = MagicMock()
    mock_client = MagicMock()
    mock_client.get_container_client.return_value = mock_container

    # Stub the azure SDK modules so blob_sync's deferred imports succeed even
    # when azure-storage-blob isn't installed in the dev env.
    fake_identity = types.ModuleType("azure.identity")
    fake_identity.DefaultAzureCredential = MagicMock()
    fake_storage = types.ModuleType("azure.storage")
    fake_storage_blob = types.ModuleType("azure.storage.blob")
    fake_storage_blob.BlobServiceClient = MagicMock(return_value=mock_client)
    azure_pkg = sys.modules.get("azure") or types.ModuleType("azure")

    monkeypatch.setitem(sys.modules, "azure", azure_pkg)
    monkeypatch.setitem(sys.modules, "azure.identity", fake_identity)
    monkeypatch.setitem(sys.modules, "azure.storage", fake_storage)
    monkeypatch.setitem(sys.modules, "azure.storage.blob", fake_storage_blob)

    result = sync_to_blob(cfg)

    assert result["state"] == 3
    assert result["drafts"] == 1
    assert mock_container.upload_blob.call_count == 4
