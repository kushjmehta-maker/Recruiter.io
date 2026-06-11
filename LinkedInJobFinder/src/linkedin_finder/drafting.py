"""Outreach drafting via Azure AI Inference.

System prompt = tone rules + resume (long, sent first for prefix-cache hits).
Per-call user message contains contact + role + JD + the fixed template to fill in.

The prompt enforces:
- 2-3 sentences max
- No em-dashes
- First-person greeting + sign-off; third-person background sentence
- Explicit ask for a referral
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"
RECRUITER_PROMPT = (PROMPTS_DIR / "draft_recruiter.md").read_text()
PEER_PROMPT = (PROMPTS_DIR / "draft_peer.md").read_text()


def draft_message(
    api_key: str | None,
    endpoint: str | None,
    deployment: str | None,
    api_version: str,
    user_first_name: str,
    resume_text: str,
    contact_name: str,
    contact_title: str,
    is_recruiter: bool,
    role: str,
    company: str,
    job_description: str,
) -> str:
    """Return a single outreach draft body."""
    if not (api_key and endpoint and deployment):
        log.warning("Azure AI credentials missing; emitting fallback template")
        return _fallback_template(
            user_first_name, contact_name, role, company, is_recruiter
        )

    from azure.ai.inference import ChatCompletionsClient
    from azure.ai.inference.models import SystemMessage, UserMessage
    from azure.core.credentials import AzureKeyCredential

    client = ChatCompletionsClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(api_key),
        api_version=api_version,
    )

    contact_first = (contact_name or "there").strip().split()[0]
    base_prompt = RECRUITER_PROMPT if is_recruiter else PEER_PROMPT
    system_text = (
        f"{base_prompt}\n\n"
        f"USER RESUME (source of background sentence):\n{resume_text}"
    )
    user_payload = (
        f"USER FIRST NAME: {user_first_name}\n"
        f"CONTACT FIRST NAME: {contact_first}\n"
        f"CONTACT TITLE: {contact_title or 'unknown'}\n"
        f"ROLE: {role}\n"
        f"COMPANY: {company}\n"
        f"JOB DESCRIPTION:\n{(job_description or '')[:3000]}\n\n"
        f"Draft the message body now."
    )

    try:
        resp = client.complete(
            model=deployment,
            messages=[
                SystemMessage(content=system_text),
                UserMessage(content=user_payload),
            ],
            max_tokens=300,
        )
        text = resp.choices[0].message.content or ""
    except Exception as e:
        log.warning("drafting call failed: %s; using fallback", e)
        return _fallback_template(
            user_first_name, contact_name, role, company, is_recruiter
        )

    return _enforce_tone_rules(text.strip())


def _enforce_tone_rules(text: str) -> str:
    text = re.sub(r"\s*[\u2014\u2013]\s*", ", ", text)
    text = re.sub(r" {2,}", " ", text)
    text = text.strip().strip('"').strip("'")
    return text


def _fallback_template(
    user_first_name: str, contact_name: str, role: str, company: str, is_recruiter: bool
) -> str:
    contact_first = (contact_name or "there").strip().split()[0]
    pitch = f"{user_first_name} is a software engineer interested in {company}"
    if is_recruiter:
        return (
            f"Hi {contact_first}, {pitch}. I saw the {role} role at {company} "
            f"and it looks like a great fit. Would you be open to a referral or sharing "
            f"more about the team? Thanks, {user_first_name}"
        )
    return (
        f"Hi {contact_first}, {pitch}. I saw the {role} opening at {company} "
        f"and it looks like a great fit. Would you be open to a referral if it feels right? "
        f"Would really appreciate it. Thanks, {user_first_name}"
    )


def slugify(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()[:40]
