# LinkedIn Job Finder

A local Python tool that, every morning, finds new LinkedIn job openings at companies you care about, surfaces the recruiters and hiring managers actively posting about them, and writes a polished outreach message per opportunity using your resume.

**It never sends anything.** Every draft is yours to review, edit, and send by hand from LinkedIn. The tool is a discovery + drafting assistant, not an auto-messenger.

---

## What it does, every day

1. Hits LinkedIn's public jobs feed (no login) and grabs every posting in the last 24 hours that matches your roles and locations.
2. Filters that list down to your target companies (tier-1 / tier-2 / tier-3 lists you define).
3. Logs into LinkedIn through a persistent Chrome profile and searches for **hiring posts** — people announcing openings in their feed, not through the formal Jobs board.
4. Asks an LLM to score every job against your resume (0–10) and drops anything below 5 or anything that hits a dealbreaker keyword.
5. For each qualifying company, finds the top recruiters / talent acquisition people, then drafts a personalized 2–3 sentence outreach for each (job, contact) pair.
6. Writes every draft to `outreach/drafts/{date}_{company}_{contact}.md` and a SQLite row, then mirrors everything to `job_tracker.csv`.
7. Pops a macOS notification: `"N new drafts ready for review"`.

You open the Streamlit dashboard, review each draft, optionally edit, click **Open compose** or **View profile (InMail)**, and send manually inside LinkedIn.

---

## Requirements

- macOS (the scheduler uses launchd; the rest works on Linux/Windows but you'd swap the scheduler)
- Python 3.11 or newer
- Google Chrome installed (Playwright uses your installed Chrome via the `chrome` channel)
- A LinkedIn account
- An Azure AI Foundry deployment, OR a willingness to point the code at a different OpenAI-compatible endpoint (see [Models & API keys](#models--api-keys))
- LinkedIn Premium is **optional** — without it you can still draft messages, but you can only send via Compose to 1st-degree connections. With Premium you also get InMail to non-connections.

---

## Quick start (about 10 minutes)

```bash
# 1. Clone and enter the project
git clone <repo-url> LinkedInJobFinder
cd LinkedInJobFinder

# 2. Create a virtual environment and install
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .

# 3. Install the Chromium binary Playwright needs
python -m playwright install chromium

# 4. Set up your API credentials
cp .env.example .env
$EDITOR .env   # fill in AZURE_AI_API_KEY, AZURE_AI_ENDPOINT, AZURE_AI_DEPLOYMENT

# 5. Drop your resume into resumes/
cp ~/path/to/your_resume.pdf resumes/

# 6. Edit your target companies/roles/locations
$EDITOR config/targets.yaml

# 7. Log into LinkedIn once — a Chrome window opens, you log in normally,
#    then close the window. Your cookies persist in data/browser_profile/.
linkedin-finder login

# 8. Run it for the first time
linkedin-finder daily

# 9. Open the dashboard to review drafts
linkedin-finder ui
```

That last command opens `http://localhost:8501`. The **Today** tab shows every pending draft.

---

## Models & API keys

This project uses the **Azure AI Inference SDK** against an Azure AI Foundry deployment. Two questions come up immediately:

### "Can my friends and I share one API key?"

Technically yes — paste the same `AZURE_AI_API_KEY` into each friend's `.env` and the code runs. Practically, **don't**:

- **Cost** — every friend's runs bill to whoever owns the Azure subscription. With 5 friends each running daily, you'll see a noticeable bill.
- **Quota throttling** — Azure deployments have per-minute token rate limits. Five people hitting the same deployment will get HTTP 429s during morning runs.
- **Security** — once a key is shared in a group chat, it's effectively public. Anyone who screenshots it can drain your quota or rack up cost.
- **Azure ToS** — sharing keys outside your organization is technically against terms of service.

**Recommended: each user provisions their own deployment.** It's free to set up (you pay only for tokens used, which is ~$0.50–$2 / month for daily runs on `gpt-4o-mini`). Steps below.

### Get your own Azure AI key (free signup, ~5 min)

1. Sign in at [https://ai.azure.com](https://ai.azure.com) with any Microsoft account.
2. Create a new **AI hub** (or use the default), then **+ Create project** inside it.
3. Inside the project, go to **Deployments → + Deploy model**. Pick `gpt-4o-mini` (cheap, fast, plenty good for this) or `gpt-5.4-pro` (better drafts, ~10× the cost).
4. After deployment finishes, open it and copy three things into your `.env`:
   - `AZURE_AI_API_KEY` — from the **Keys and Endpoint** panel (Key 1 or Key 2).
   - `AZURE_AI_ENDPOINT` — the **Target URI**, ending in `.services.ai.azure.com/models`.
   - `AZURE_AI_DEPLOYMENT` — the deployment name you chose in step 3.
5. Leave `AZURE_AI_API_VERSION=2024-10-21` as-is.

### Don't want Azure?

The code uses `azure-ai-inference`, which speaks the standard OpenAI Chat Completions protocol. To swap in plain OpenAI or another provider you'd edit `src/linkedin_finder/ranking.py` and `src/linkedin_finder/drafting.py` to use the `openai` or `anthropic` SDK instead. Not wired up by default. If a friend asks, point them at those two files — it's ~30 lines of changes.

---

## Configuring `config/targets.yaml`

This is the only file you tune regularly. Top-level sections:

```yaml
user:
  first_name: Kush                # used in outreach sign-offs

search:
  roles:                          # one search per role × location pair
    - "Software Engineer"
    - "Backend Engineer"
    - "ML Engineer"
  locations:
    - "Bengaluru, Karnataka, India"
    - "Remote"
    - "Singapore"
  hours_old: 24                   # only jobs posted in last N hours

companies:
  tier1:                          # priority companies — drafted first, marked HIGH in CSV
    - "Stripe"
    - "Anthropic"
  tier2:                          # same pipeline, marked MEDIUM in CSV
    - "Notion"
    - "Linear"
  tier3:                          # wider net, marked LOW in CSV (sorts last)
    - "Salesforce"
    - "SAP"

filters:
  must_haves:                     # positive signals for the ranker (level/YoE hints)
    - "SDE-2"
    - "Senior Software Engineer"
    - "3+ years"
  dealbreakers:                   # any job whose description contains these is dropped
    - "crypto"
    - "consulting"

outreach:
  daily_contact_cap: 50           # never draft more than this per day
  per_company_contact_cap: 8      # never draft more than this per company per day
  recruiter_cache_days: 7         # don't re-search People for the same company for N days
  retention_days: 30              # purge jobs/contacts/drafts older than N days

posts:
  enabled: true                   # discover "we're hiring" feed posts in addition to formal jobs
  max_results_per_role: 30        # cap posts scraped per role search
```

**Tuning notes:**

- Total JobSpy queries per run = `len(roles) × len(locations)`. Keep that under ~40 or runs get slow and you risk rate limits. Companies are filtered after fetch, so the company list can be long.
- `daily_contact_cap` and `per_company_contact_cap` are safety brakes against LinkedIn flagging your account. Don't push them past `60` and `10` respectively without a good reason.
- The full daily pipeline runs in 2–5 minutes typically (depends on how many qualifying jobs and recruiters get found).

---

## The dashboard (`linkedin-finder ui`)

Six tabs:

- **Today** — pending drafts grouped by job. Each card shows the company, role, fit score, contact name/title, and the editable draft body. Buttons: `Open compose ↗` (works for 1st-degree connections), `View profile (InMail) ↗` (lands on the profile so Premium users can use InMail), `Save edits`, `Mark sent`, `Dismiss`, `Snooze 7d`. Posts-sourced jobs show a purple `hiring post` badge.
- **All Jobs** — searchable table of every job ever discovered, with status, fit score, source, and URL.
- **Contacts** — recruiter/HM directory across all your target companies.
- **Resume** — drag-and-drop a new resume; shows extracted name preview.
- **Targets** — visual YAML editor for `config/targets.yaml`.
- **Settings** — API-key status, last run log (tail of `data/last_run.log`), a **Run daily pipeline now** button, and install/uninstall buttons for the launchd schedule.

---

## Scheduling (macOS only, optional)

To run the pipeline automatically every morning at 08:30 local:

```bash
bash scripts/install_launchd.sh
```

This drops a `~/Library/LaunchAgents/io.recruiter.linkedinfinder.plist` and loads it. Run output goes to `data/launchd.out.log` and `data/launchd.err.log`. Check it's loaded:

```bash
launchctl list io.recruiter.linkedinfinder
```

Uninstall:

```bash
bash scripts/uninstall_launchd.sh
```

If you're on Linux, set up the equivalent in cron or systemd timers — point it at `path/to/.venv/bin/python -m linkedin_finder daily`.

---

## Cloud mirror (optional, view drafts from your phone)

LinkedIn cookies are tied to the IP that issued them, so the pipeline has to keep running on your Mac. But you can mirror the *state* (jobs, drafts, contacts) to Azure Blob and host a read-only Streamlit view on an App Service, fronted by your Microsoft account. Cost: ~$15/month, covered by an Azure free credit.

What you get: open a URL on your phone, sign in with the same Microsoft account you use everywhere else, see today's drafts and the full jobs/contacts tables. All editing and sending still happens on the Mac.

Setup (~10 minutes, requires `az login` and an active Azure subscription):

```bash
pip install -e .[cloud]
az login
APP_NAME=your-dns-unique-name bash infra/deploy.sh
```

The script creates a resource group, deploys `infra/main.bicep` (Storage + App Service Plan B1 + App Service + Easy Auth restricted to your Entra ID), zips the source, and uploads it. At the end it prints two things:

1. The App Service URL (sign in with your Microsoft account).
2. The `BLOB_*` env vars to add to your local `.env`.

### Blob auth under launchd

The local pipeline uses `DefaultAzureCredential` to write to Blob. Under launchd, the `az login` token cache isn't available, so add a **service principal** scoped to the storage account and put its creds in `.env` — `EnvironmentCredential` picks them up automatically:

```bash
# create SP scoped to the storage account only (least privilege)
SA_ID=$(az storage account show -n <storage-account> --query id -o tsv)
az ad sp create-for-rbac \
  --name linkedinfinder-blob-writer \
  --role "Storage Blob Data Contributor" \
  --scopes "$SA_ID"
```

Paste the returned `tenant`, `appId`, `password` into `.env` as `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. Now the 08:30 launchd run can write to Blob without a logged-in shell.

After you paste those into `.env` and re-run `linkedin-finder daily`, the tail of `data/last_run.log` should show `blob_sync: uploaded 3 state files, N drafts`. Refresh the App Service URL: same drafts, same Today tab, but every write button is hidden with a "Read-only view" banner.

To make the Mac wake reliably for the 08:30 schedule, add a `pmset` rule:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 08:25:00
```

To tear it all down: `az group delete -n <APP_NAME>-rg --yes`.

---

## Folder layout

```
LinkedInJobFinder/
├── config/targets.yaml           your companies, roles, locations, dealbreakers
├── resumes/                      drop your resume here (gitignored)
├── outreach/drafts/              one .md per (job, contact) draft (gitignored)
├── data/jobs.db                  SQLite state (gitignored)
├── data/browser_profile/         Playwright persistent Chrome profile (gitignored)
├── data/last_run.log             append-only run log surfaced in the UI
├── job_tracker.csv               16-column CSV mirror, friendly for spreadsheets
├── src/linkedin_finder/          the package
├── infra/                        Bicep + deploy scripts for optional Azure mirror
└── scripts/                      launchd install/uninstall
```

Files you should **never commit**: `.env`, anything in `resumes/`, anything in `data/`. The included `.gitignore` covers all of them.

---

## Safety & hard rules

These are enforced in code and described in `CLAUDE.md`:

- **Never auto-sends** any message, connection request, or InMail.
- **Never clicks "Add a note"** on connection invites (the spam-flag trigger that gets accounts restricted).
- **Never uses em-dashes** in drafts (tone guideline).
- Drafts are kept to 2–3 sentences, conversational, with no "I hope you're doing well" filler.
- Random 4–9 s pauses between Playwright actions, 30–90 s pauses between companies during recruiter discovery.
- If a CAPTCHA or "unusual activity" page appears, the run halts and writes a screenshot to `data/debug/` — it never clicks through.
- 30-day rolling retention purges old jobs, contacts, drafts, and draft files automatically.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `linkedin-finder daily` says "session expired" | Run `linkedin-finder login`, log into LinkedIn in the window that opens, close the window, retry. |
| Streamlit can't start, port in use | `lsof -ti:8501 \| xargs kill -9` then `linkedin-finder ui`. |
| Run completes with `errors=1` and Azure auth error | Re-check the three `AZURE_AI_*` values in `.env`. The endpoint MUST end in `/models`. Restart the run. |
| 0 jobs found despite seeing them on LinkedIn | JobSpy's guest endpoint is occasionally rate-limited. Wait 30 min and rerun, or narrow `locations`. |
| 0 recruiters found for known-good companies | LinkedIn changes their People-search DOM occasionally. Check `data/debug/*_people_*.png` for what the scraper saw. Open an issue with that screenshot. |
| Notifications don't appear on macOS | System Settings → Notifications → Script Editor → toggle "Allow Notifications". |
| Want to wipe state and start over | `rm -rf data/ outreach/drafts/ job_tracker.csv` (you'll need to re-login). |

---

## FAQ

**Q: Will this get my LinkedIn account banned?**
A: The tool stays well under LinkedIn's published automation thresholds (random pauses, hard caps, no clicking through challenges, no auto-send). It uses your real cookies in a real Chrome profile, not the API. That said, **no automation is risk-free.** Use a personal account at your own risk; don't use it on an account whose loss would hurt.

**Q: Does it work with LinkedIn Recruiter / Sales Navigator?**
A: No special handling for those. People search reads what your account can see; if you have Sales Nav you'll see richer results automatically because the cookies carry that entitlement.

**Q: Can it apply to jobs for me?**
A: No, and that's intentional. Auto-apply tools have terrible reply rates and damage your reputation. This tool surfaces opportunities and warms up the introduction — you do the application.

**Q: Why drafts only, never send?**
A: Because the moment a tool sends on your behalf, two things happen: (1) your spam-flag risk goes through the roof, and (2) your messages start sounding like a tool. A human in the loop keeps both your account and your reputation healthy.

**Q: Does it work outside macOS?**
A: The pipeline does. The launchd-based scheduler doesn't — swap it for cron or systemd on Linux, Task Scheduler on Windows. macOS notifications also won't fire, but everything else works.

**Q: How much does it cost to run?**
A: ~$0.50–$2 / month of Azure inference for a typical user (daily runs, `gpt-4o-mini`, 5–20 qualifying jobs / day). LinkedIn itself is free; LinkedIn Premium is optional.

---

## License

MIT. Do whatever you want with it. Attribution appreciated but not required.

## Contributing

PRs welcome. If you change anything related to outreach tone, message templates, or the "never send" guarantee, please read `CLAUDE.md` first — those rules are load-bearing.
