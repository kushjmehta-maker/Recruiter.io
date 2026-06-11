"""Fit-score jobs against the user's resume + search profile via Azure AI Inference.

Resume + search_profile go in the SYSTEM message first so Azure/OpenAI's
automatic prompt-prefix cache (~1024+ tokens) covers them across calls.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"
RANK_PROMPT = (PROMPTS_DIR / "rank.md").read_text()


@dataclass
class Score:
    job_id: int
    score: float
    reason: str
    dealbreaker_hits: list[str]


def score_jobs(
    api_key: str | None,
    endpoint: str | None,
    deployment: str | None,
    api_version: str,
    resume_text: str,
    search_profile: str,
    jobs: list[dict],
    batch_size: int = 20,
) -> list[Score]:
    """jobs: [{job_id, title, company, location, description}, ...]"""
    if not jobs:
        return []
    if not (api_key and endpoint and deployment):
        log.warning("Azure AI credentials missing; defaulting all scores to 6")
        return [Score(j["job_id"], 6.0, "Azure AI not configured - default score", []) for j in jobs]

    from azure.ai.inference import ChatCompletionsClient
    from azure.ai.inference.models import SystemMessage, UserMessage
    from azure.core.credentials import AzureKeyCredential

    client = ChatCompletionsClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(api_key),
        api_version=api_version,
    )

    system_text = (
        f"{RANK_PROMPT}\n\n"
        f"USER RESUME:\n{resume_text}\n\n"
        f"SEARCH PROFILE:\n{search_profile or '(none)'}"
    )

    out: list[Score] = []
    for start in range(0, len(jobs), batch_size):
        batch = jobs[start : start + batch_size]
        user_msg = json.dumps([
            {
                "job_id": j["job_id"],
                "title": j["title"],
                "company": j["company"],
                "location": j["location"],
                "description": (j["description"] or "")[:4000],
            }
            for j in batch
        ])
        try:
            resp = client.complete(
                model=deployment,
                messages=[
                    SystemMessage(content=system_text),
                    UserMessage(content=user_msg),
                ],
                max_tokens=2048,
            )
        except Exception as e:
            log.warning("ranking call failed: %s; defaulting batch to 6", e)
            out.extend(Score(j["job_id"], 6.0, f"ranking failed: {e}", []) for j in batch)
            continue

        text = resp.choices[0].message.content or ""
        parsed = _extract_json_array(text)
        if parsed is None:
            log.warning("ranking returned non-JSON; defaulting batch")
            out.extend(Score(j["job_id"], 6.0, "non-JSON response", []) for j in batch)
            continue

        for entry in parsed:
            try:
                out.append(Score(
                    job_id=int(entry["job_id"]),
                    score=float(entry["score"]),
                    reason=str(entry.get("reason", "")),
                    dealbreaker_hits=list(entry.get("dealbreaker_hits", [])),
                ))
            except (KeyError, ValueError, TypeError) as e:
                log.warning("malformed score entry %s: %s", entry, e)
    return out


def _extract_json_array(text: str) -> list | None:
    """Tolerate code fences, leading prose, and dict wrappers around the array."""
    s = text.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip()
        if s.endswith("```"):
            s = s[:-3].strip()
    try:
        parsed = json.loads(s)
    except json.JSONDecodeError:
        start = s.find("[")
        end = s.rfind("]")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(s[start : end + 1])
        except json.JSONDecodeError:
            return None
    if isinstance(parsed, dict):
        for key in ("results", "scores", "data", "jobs"):
            if isinstance(parsed.get(key), list):
                return parsed[key]
        return None
    return parsed if isinstance(parsed, list) else None
