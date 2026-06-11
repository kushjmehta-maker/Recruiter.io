# Project rules for Claude Code sessions

This is a local Python runner that finds LinkedIn jobs daily, drafts outreach messages, and presents them in a Streamlit UI. It never sends messages.

## Hard rules

- **Never auto-send.** All outreach is drafts the user reviews.
- **Never click "Add a note"** on LinkedIn connection invites in any future automation.
- **Never use em-dashes** in outreach drafts. Period or comma instead.
- Drafts are 2–3 sentences max. Conversational. No "I hope you're doing well".
- Background sentence is third-person; greeting/sign-off is first-person.
- If a Playwright run hits a CAPTCHA or "unusual activity" page, halt and log. Never click through.

## Conventions inherited from the sibling project at `../claude-linkedin-assistant/`

- `job_tracker.csv` columns (in order): `Priority, Company, Role, Location, Type, Salary, Status, Applied Date, Next Action, URL, Notes, Discovered Date, Referral Needed, Referral Status, Referral Deadline, Apply Via`
- Status flow: `To Apply → Applied → Recruiter Call → Phone Screen → Onsite → Offer/Rejected/Withdrew`
- Referral Status values: `Not Needed / Outreach Pending / Connection Pending / Outreach Sent / Got Referral / Declined / No Referral`

## Entry points

- `linkedin-finder login` — open Chrome via Playwright persistent context for one-time LinkedIn login.
- `linkedin-finder daily` — orchestrator: discover jobs, rank, find recruiters, draft messages.
- `linkedin-finder ui` — Streamlit dashboard.

## Files of interest

- `src/linkedin_finder/daily.py` — the orchestrator
- `src/linkedin_finder/prompts/` — system + user prompt templates (edit these to tune tone)
- `config/targets.yaml` — companies/roles/filters
- `data/last_run.log` — append-only run log surfaced in the UI

## Anti-patterns

- Don't add a "send" feature.
- Don't bypass the daily contact cap from `targets.yaml`.
- Don't add fields to `job_tracker.csv` — keep the 16 columns aligned with the sibling project.
