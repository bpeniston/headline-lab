# Dev Infrastructure — Setup & Context

This document describes the physical machines, services, and configurations that underpin all dev projects. Feed this to Claude at the start of any session involving infrastructure, cron jobs, deployment, or remote access.

---

## Machines

### Main MacBook Pro (M1) — `bp-mbp-m1`

- **Role:** Primary dev machine. All active coding, browser-based CMS work, Chrome extension development.
- **Tailscale IP:** `100.119.94.34`
- **Local repo:** `~/Documents/devstuff/headline-lab`
- **Homebrew:** installed at `/opt/homebrew`
- **SSH:** passwordless access to the Air and to DreamHost

### M1 MacBook Air — `blotchy-macbook`

- **Role:** Dedicated background/automation machine. Runs nighttime cron jobs and browser automation tasks. Sits in server closet.
- **Tailscale IP:** `100.117.250.37`
- **Local user:** `brad-developer`
- **SSH from MBP:** `ssh brad-developer@100.117.250.37`
- **Screen sharing from MBP:** `vnc://100.117.250.37`
- **Homebrew:** installed at `/opt/homebrew`
- **Repo:** `~/headline-lab` (cloned from GitHub)
- **Secrets:** `~/headline-lab/.env` (CMS credentials etc. — never in GitHub)
- **Sleep:** disabled (System Settings → Battery → Options)
- **FileVault:** being decrypted (auto-login will be enabled once complete)
- **SSH key to DreamHost:** installed (`~/.ssh/id_ed25519`)
- **Cron jobs:** managed via `crontab -e` on the Air

---

## Remote Access

### Tailscale

- **Account:** `bpeniston@github` (free tier)
- **Tailnet:** `bpeniston.github`
- Both machines connected and showing green in Tailscale admin: `login.tailscale.com/admin/machines`
- Enables SSH and Screen Sharing from anywhere, not just local network

### SSH

- MBP → Air: `ssh brad-developer@100.117.250.37` (passwordless)
- MBP → DreamHost: `ssh bradwu@pdx1-shared-a1-08.dreamhost.com` (passwordless)
- Air → DreamHost: `ssh bradwu@pdx1-shared-a1-08.dreamhost.com` (passwordless, SSH key installed Apr 2026)

---

## DreamHost Server

- **Host:** `pdx1-shared-a1-08.dreamhost.com`
- **User:** `bradwu`
- **Type:** Shared hosting (PHP, Python, MySQL available; no root, no Docker)
- **Home:** `/home/bradwu/`

### What runs on DreamHost

| Job                        | Schedule        | Location                             | Notes                                               |
| -------------------------- | --------------- | ------------------------------------ | --------------------------------------------------- |
| `ingest.py`                | Every 5 min     | `~/athena-helper/`                   | RSS ingest for D1 mirror/daybook; needs MySQL       |
| `calendar_fetch.py`        | Every 10 min    | `~/navybook.com/kitchen_config/`     | Calendar sync                                       |
| `traffic_stats_nightly.py` | 2:15am nightly  | `~/navybook.com/kitchen/`            | Traffic stats                                       |
| D1 Daily Digest            | 4:00am weekdays | `~/d1_scripts/`                      | Digest email to bpeniston@defenseone.com            |
| D1 Auto-Decline            | 4:30am weekdays | `~/d1_scripts/`                      | Auto-decline script                                 |
| dfnbot                     | 2:30pm weekdays | `~/venvs/venv1/`                     | Email to brad@navybook.com                          |
| Air heartbeat check        | 4:50am nightly  | `~/navybook.com/D1/seo/air-check.py` | Sends `Air: Problem` Slack alert if heartbeat stale |

### Key files on DreamHost

All auto-updater files (credentials, caches, daily update records, heartbeat, one-off analysis scripts) live under `~/navybook.com/D1/auto-updater/`, blocked from public web access via `.htaccess` (`Require all denied`, plus a rewrite stop so the docroot's WordPress catch-all doesn't cascade in first). The Headline Lab usage log is the one exception — it's a Headline Lab feature artifact, not auto-updater, and stays at `/home/bradwu/`.

| File                   | Path                                                              | Purpose                                                               |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| GA4 OAuth credentials  | `auto-updater/ga4-oauth.json`                                       | GA4 API access for all 5 pubs                                         |
| Sheets service account | `auto-updater/sheets-service-account.json`                          | Google Sheets API access for pub-config.php                           |
| Pub config cache       | `auto-updater/pub-config-cache.json`                                | 1hr cache of Google Sheet pub config                                  |
| Trending main cache    | `auto-updater/trending-main-cache-{pubkey}.json`                    | 1hr scored topic results (one file per pub)                           |
| Trending article cache | `auto-updater/trending-article-cache-{pubkey}.json`                 | 24hr per-article topic cache (one file per pub)                       |
| Trending name cache    | `auto-updater/trending-topicname-cache-{pubkey}.json`               | 7-day slug→display name cache (one file per pub)                      |
| Earthbox main cache    | `auto-updater/earthbox-cache-{pubkey}-{mode}.json`                  | 1hr scored post results (one file per pub+mode — GA4/RECENT_STAFF kept separate) |
| Earthbox title cache   | `auto-updater/earthbox-title-cache-{pubkey}.json`                   | 24hr per-article title/sponsored cache (one file per pub)             |
| Updates shared secret  | `auto-updater/.update-secret`                                       | Single-line `UPDATE_SECRET=<hex>`; authenticates POSTs from apply scripts |
| Daily updates data     | `auto-updater/ge360-updates-YYYY-MM-DD.json`                        | Written by `save-update.php`; read by `updates/index.php`             |
| Monthly stats token    | `auto-updater/.headline-lab-config.ini`                             | Token used by `pub-stats.php`                                          |
| Usage log              | `/home/bradwu/headline-lab-usage.log`                               | Headline Lab usage (not auto-updater — stays in home dir)             |
| Air heartbeat          | `auto-updater/air-heartbeat.txt`                                    | Unix timestamp written by Air every 10 min; checked by `air-check.py` |

### PHP endpoints (navybook.com/D1/seo/)

- `seo-api.php` — Headline Lab: takes article text, calls Anthropic API, returns headlines
- `trending-topics.php` — Trending Topics: accepts `?pub={pub_key}` (defaults to `defenseone`), reads per-pub config from Google Sheet, queries GA4, scrapes articles, scores topics, returns top 7 JSON. Per-pub cache files in `auto-updater/`: `trending-main-cache-{pubkey}.json`, `trending-article-cache-{pubkey}.json`, `trending-topicname-cache-{pubkey}.json`
- `earthbox-posts.php` — Earthbox/Skybox post recommendations: accepts `?pub={pub_key}&mode=ga4|recent_staff`, reads per-pub config from Google Sheet, queries GA4 or RSS depending on mode, scrapes article titles, filters sponsored, returns top 6 posts JSON. Per-pub+mode cache files in `auto-updater/`: `earthbox-cache-{pubkey}-{mode}.json`, `earthbox-title-cache-{pubkey}.json`
- `pub-config.php` — Publication config: reads GE360 pub settings from Google Sheet, validates, returns JSON. Cached 1 hour to `auto-updater/pub-config-cache.json`. Can be `require_once`'d by other PHP files (define `PUB_CONFIG_INCLUDED` first) to use `get_pub_configs()` / `find_pub($pubKey)` directly without an HTTP round-trip
- `pub-stats.php` — Returns one month's click counts for any pub; accepts `?pub={pubkey}&type=topics|earthbox&token=...` plus optional `?start=`/`?end=`. Replaced the old D1-only `monthly-stats.php`/`earthbox-stats.php` (deleted 2026-06-25 — their only caller, the one-off `earthbox-baseline.js`, had already run and was not scheduled anywhere)
- `heartbeat.php` — receives Air ping (`?key=hl-heartbeat-2026`), writes timestamp to `auto-updater/air-heartbeat.txt`
- `stats.php` — Returns usage log counts

### Publication config Google Sheet

Row 1 = column headers, row 2 = human-readable descriptions (skipped by script), row 3+ = one publication per row.

| Column                  | Example (D1)                             | Notes                                                                                                                                           |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pub_name`              | Defense One                              | Display name for logs                                                                                                                           |
| `pub_key`               | defenseone                               | Short identifier, no spaces                                                                                                                     |
| `trending_enabled`      | TRUE                                     | TRUE or FALSE                                                                                                                                   |
| `earthbox_enabled`      | TRUE                                     | TRUE or FALSE                                                                                                                                   |
| `trending_cms_path`     | `/athena/curate/defenseonetrendingitem/` | Path on admin.govexec.com — must start with `/`                                                                                                 |
| `earthbox_cms_path`     | `/athena/curate/defenseoneearthboxitem/` | Path on admin.govexec.com — must start with `/`                                                                                                 |
| `ga4_property_id`       | 353836589                                | Integer only                                                                                                                                    |
| `grappelli_topic_model` | defenseonetopic                          | Varies per pub — confirm via Network tab on CMS Topics autocomplete                                                                             |
| `grappelli_app_label`   | post_manager                             | Varies per pub — D1: `post_manager`, WT: `core`. Confirm via Network tab                                                                        |
| `topic_content_type`    | 382                                      | Django content_type int for this pub's Topic model — find via CMS POST form data on save                                                        |
| `slack_channel`         | #edit-d1-aggs-n-stuff                    | Human-readable Slack channel name (for reference)                                                                                               |
| `slack_email`           | u5q8...@govexec.slack.com                | Slack channel email address for notifications                                                                                                   |
| `base_url`              | `https://www.defenseone.com`             | Public-facing site URL (no trailing slash) — used to build article scrape URLs                                                                  |
| `topic_oref`            | `d1-article-topics`                      | oref value on topic nav links in article HTML — used to identify topic tags during scraping                                                     |
| `earthbox_oref`         | `d1-earthbox-post`                       | oref value on Earthbox widget links in article HTML — used to count monthly Earthbox clicks in GA4. Confirm by inspecting a live article page   |
| `automation_start_date` | `2026-04-08`                             | Date automation first went live for this pub (YYYY-MM-DD). Set when trending_enabled or earthbox_enabled is first flipped to TRUE               |
| `topics_baseline`       | `3005`                                   | Pre-automation monthly avg for Topics nav clicks (integer). Leave blank if not yet calculated — report will show "baseline not yet established" |
| `earthbox_baseline`     | `1795`                                   | Pre-automation monthly avg for Earthbox widget clicks (integer). Leave blank if not yet calculated                                              |

**To add a new pub:**

1. Fill in the row — set `trending_enabled`/`earthbox_enabled` to FALSE until ready
2. Confirm `grappelli_topic_model` and `grappelli_app_label`: open a CMS trending item edit page for that pub, type in the Topics autocomplete field, inspect the Network request to `/grappelli/lookup/autocomplete/`
3. Find `topic_content_type`: read the `content_type` select value on that same edit page (or watch POST on save)
4. Confirm `topic_oref` and `earthbox_oref` by inspecting a live article page — pattern `{prefix}-article-topics` / `{prefix}-earthbox-post` has held for all 5 pubs
5. Calculate baselines via `pub-stats.php?pub=X&type=topics&start=...&end=...` over 6 pre-automation months
6. Set `automation_start_date` when flipping enabled to TRUE
7. No new PHP files needed — shared endpoints handle all pubs via `?pub={pub_key}`

**Confirmed per-pub values (all in sheet):**

| Pub                   | pub_key      | GA4 property | app_label      | model             | content_type | topic_oref          | earthbox_oref      | Sheet status                                   |
| --------------------- | ------------ | ------------ | -------------- | ----------------- | ------------ | ------------------- | ------------------ | ---------------------------------------------- |
| Defense One           | `defenseone` | `353836589`  | `post_manager` | `defenseonetopic` | `382`        | `d1-article-topics` | `d1-earthbox-post` | ✓ live                                         |
| Washington Technology | `washtech`   | `358726868`  | `core`         | `topic`           | TBD          | `wt-article-topics` | `wt-earthbox-post` | disabled — needs content_type, slack, base_url |
| GovExec               | `govexec`    | `353164424`  | `post_manager` | `govexectopic`    | `505`        | `ge-article-topics` | `ge-earthbox-post` | disabled — needs slack                         |
| Nextgov               | `nextgov`    | `353764914`  | `post_manager` | `nextgovtopic`    | `496`        | `ng-article-topics` | `ng-earthbox-post` | disabled — needs slack                         |
| Route Fifty           | `routefifty` | `353766084`  | `post_manager` | `topic`           | `164`*       | `rf-article-topics` | `rf-earthbox-post` | disabled — needs slack                         |

*Route Fifty `topic_content_type` 164 was read from an empty trending item — confirm when a real topic is saved.

**Validation:** `pub-config.php` checks that all headers exist, booleans are TRUE/FALSE, integers are integers, and API URLs are valid. Errors are returned in the `errors` array and logged by the scripts; affected rows are skipped. A renamed or deleted column header produces a fatal error (stops all pubs) rather than silently skipping data.

#### One-time setup

1. **Create the Google Sheet** with the columns above. Name the sheet tab `Pubs`. Fill in the D1 row.

2. **Create a GCP service account:**
   
   - Go to console.cloud.google.com → APIs & Services → Credentials → Create credentials → Service account
   - Name it something like `headline-lab-sheets-reader`
   - Grant it no roles (read-only sheet access is granted by sharing, not IAM)
   - Download the JSON key

3. **Enable the Sheets API** in the same GCP project (APIs & Services → Enable APIs → Google Sheets API)

4. **Share the sheet** with the service account's email (shown in the JSON key as `client_email`). View-only access is sufficient.

5. **Upload the key to DreamHost:**
   
   ```
   scp sheets-service-account.json bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/auto-updater/sheets-service-account.json
   ```

6. **Set the Sheet ID in `pub-config.php`:** Replace `REPLACE_WITH_SHEET_ID` with the ID from the sheet URL (`docs.google.com/spreadsheets/d/SHEET_ID/edit`). Deploy with `git push && deploy`.

7. **Test:** `curl https://www.navybook.com/D1/seo/pub-config.php` — should return `{"pubs":[...],"errors":[]}`

---

## GitHub

- **Account:** `bpeniston`
- **Headline Lab repo:** `https://github.com/bpeniston/headline-lab`
- GitHub is the source of truth for all code. DreamHost and the Air pull from GitHub.
- Deploy alias `deploy` on MBP: SSHes to DreamHost and runs `git pull`

---

## What runs on the Air

### Installed software

- **Node.js** (`/opt/homebrew/bin/node`) — v25.9.0, installed via Homebrew
- **Playwright** + Chromium — installed in `~/headline-lab/node_modules`
- **nodemailer** — installed in `~/headline-lab/node_modules`

### Secrets on the Air (`~/headline-lab/.env`)

- `CMS_USERNAME` / `CMS_PASSWORD` — Athena CMS login credentials
- `SMTP_USER` / `SMTP_PASS` — Gmail app password for dcwriter@gmail.com (used for Slack notifications)
- Never committed to GitHub

### CMS session (`~/headline-lab/.cms-session.json`)

- Playwright browser session saved after manual login (including 2FA)

- Reused by the nightly script so it never needs to log in fresh

- CMS hard-resets sessions periodically (observed 14 days as of 2026-05-11; recorded in `.session-meta.json` as `knownTimeoutDays`)

- To refresh: open Screen Sharing (`vnc://100.117.250.37`), open Terminal on the Air, paste this single command:
  
  ```
  export PATH=/opt/homebrew/bin:$PATH && cd ~/headline-lab && node scripts/apply-trending.js --setup
  ```
  
  Log in with 2FA in the browser window that opens, then press Enter in Terminal to save. The script exits automatically (no Ctrl+C needed).

### Session metadata (`~/headline-lab/.session-meta.json`)

- Tracks `loginDate` (set on each `--setup` run), `knownTimeoutDays` (learned on first observed expiry), `lastWarningSent` (deduplicates warnings across both nightly scripts), `sessionExpiredAlertSent` (set on first expiry morning; prevents pre-flight from re-alerting on subsequent mornings; cleared to `null` on `--setup`)
- Pre-flight warns via Slack 5 days before expected expiry (`knownTimeoutDays - 5`; defaults to day 20 on a fresh setup before timeout is observed). With `knownTimeoutDays: 14`, warning fires at day 9.
- On first expiry, the scripts record the actual elapsed days as `knownTimeoutDays` so future warnings self-calibrate
- Not committed to GitHub (Air-local, like `.cms-session.json`)
- **Session expiry detection:** checks page title for "log in" / "sign in" in addition to URL patterns, so any login-page redirect is caught correctly

### Launchd jobs

| Job                  | Schedule       | Plist                               | Script                      | Log                       |
| -------------------- | -------------- | ----------------------------------- | --------------------------- | ------------------------- |
| Air heartbeat        | Every 10 min   | `com.navybook.heartbeat.plist`      | `scripts/heartbeat.sh`      | `logs/heartbeat.log`      |
| CMS pre-flight check | 4:55am nightly | `com.navybook.preflight.plist`      | `scripts/pre-flight.js`     | `logs/pre-flight.log`     |
| D1 Trending Topics   | 5:00am nightly | `com.navybook.trending-apply.plist` | `scripts/apply-trending.js` | `logs/trending-apply.log` |
| Earthbox + Skybox    | 5:30am nightly | `com.navybook.box-apply.plist`      | `scripts/apply-box.js`      | `logs/box-apply.log`      |
| Monthly click report | 6:00am on 1st  | `com.navybook.monthly-report.plist` | `scripts/monthly-report.js` | `logs/monthly-report.log` |

To reload a plist after changes:

```
launchctl unload ~/Library/LaunchAgents/com.navybook.JOBNAME.plist
launchctl load  ~/Library/LaunchAgents/com.navybook.JOBNAME.plist
```

To run manually: `launchctl start com.navybook.JOBNAME`

---

### Job: CMS pre-flight check (`pre-flight.js`)

Runs at 4:55am — 5 minutes before the first nightly job — and validates the saved CMS session.

- **Session expired:** sends `CMS: ACTION REQUIRED — Playwright session expired` once (guarded by `sessionExpiredAlertSent` — subsequent mornings skip the alert but still `die()` so nightly jobs abort). Records `sessionExpiredAlertSent` and, on first ever expiry, `knownTimeoutDays`. Alert includes a 5-step VNC recovery walkthrough and a single copy-pasteable command. ⚠️ The alert explicitly warns that logging in via Chrome/Safari does NOT fix it — Playwright uses a separate cookie jar.
- **Session aging:** sends `CMS: Session expiring soon` if session age ≥ warning threshold (same `lastWarningSent` dedup used by main scripts — only one warning per day regardless of how many jobs run).
- **Session healthy:** exits 0 silently.

**Install on Air:**

```
scp scripts/com.navybook.preflight.plist brad-developer@100.117.250.37:~/Library/LaunchAgents/
ssh brad-developer@100.117.250.37 "launchctl load ~/Library/LaunchAgents/com.navybook.preflight.plist"
```

---

### Job: Trending Topics auto-apply (`apply-trending.js`)

**Flow:**

1. Fetches scored topics from `navybook.com/D1/seo/trending-topics.php`
2. Loads saved CMS session; detects expiry and sends Slack alert with re-login instructions
3. Parses D1 Trending Items list — skips any slot whose title starts with `"Sponsored:"`
4. For each editable Live slot: GETs edit page for CSRF, resolves topic via Grappelli autocomplete, POSTs form
5. Re-saves session to keep cookies fresh
6. Sends Slack email via Gmail SMTP — subject: `Topics: Changes`, `Topics: Unchanged`, or `Topics: Problem`; body: `New: …` / `Old: …` (items new to the list are bolded with `*text*`); or error detail if Problem
7. If session age ≥ warning threshold, sends a `Topics: Session expiring soon` Slack message (once per day, deduped with Earthbox via `.session-meta.json`)

**Flags:** `--dry-run` (no CMS writes), `--setup` (interactive login — requires desktop, not SSH), `--test-alert expired|warning` (sends the Slack alert immediately without running the browser check — useful for previewing alert copy)

**Excluded topics:** `$EXCLUDED_TOPICS` in `trending-topics.php` (line ~29) lists slugs/display names that are never surfaced, regardless of score. Currently: `['commentary']`. Add slugs or display names (case-insensitive) to extend.

**Multi-pub:** Script loops over all `trending_enabled` pubs from the Google Sheet. Each pub's topics are fetched from `trending-topics.php?pub={pub_key}`, which reads all per-pub config (GA4 property, base URL, topic oref) from the sheet at runtime.

---

### Job: Earthbox + Skybox auto-apply (`apply-box.js`)

**Flow:**

1. Fetches top GA4 articles from `navybook.com/D1/seo/earthbox-posts.php?pub={pub_key}` for each enabled pub (scores: month + week + day views; filters sponsored articles)
2. Loads saved CMS session; detects expiry and sends Slack alert with re-login instructions
3. Parses D1 Earthbox Items list — reads all Live slots (note: `_is_sponsored_content` column is not shown on the list page)
4. For each Live slot: GETs edit page for CSRF and current state; skips if `_is_sponsored_content` checkbox is checked; otherwise POSTs update (content_type=22, object_id=post_id, clears image_override so post's own featured image is used)
5. Re-saves session to keep cookies fresh
6. Sends Slack email via Gmail SMTP — subject: `Earthbox: Changes`, `Earthbox: Unchanged`, or `Earthbox: Problem`; body: bullet list of updated headlines (sponsored slots appear inline as `SPONSORED: …`; items new to the list are bolded with `*text*`); Problem messages include error detail
7. If session age ≥ warning threshold, sends a `Earthbox: Session expiring soon` Slack message (once per day, deduped with Topics via `.session-meta.json`)

**Flags:** `--dry-run` (no CMS writes), `--setup` (interactive login — requires desktop, not SSH), `--test-alert expired|warning` (same as pre-flight)

---

### Job: Air heartbeat (`heartbeat.sh` + `air-check.py`)

The Air pings DreamHost every 10 minutes via curl → `heartbeat.php`, which writes the current Unix timestamp to `~/air-heartbeat.txt`. At 4:50am (10 min before the first nightly job), `air-check.py` on DreamHost checks the file age. If the last heartbeat is more than 20 minutes old, it sends a `Air: Problem` Slack alert with recovery instructions.

**Status:** fully installed and running. Air plist loaded, DreamHost cron active.

---

### Air recovery checklist

When the Air stops responding to SSH or VNC:

1. **Check Tailscale:** `login.tailscale.com/admin/machines` — is `blotchy-macbook` green?
   
   - If offline: the Air lost network, crashed, or Tailscale dropped
   - If online but SSH fails: Remote Login was turned off (common after macOS update)

2. **Try VNC first:** `open vnc://100.117.250.37` — sometimes VNC works when SSH doesn't

3. **On Air, check Tailscale:** menu bar icon → if "Logged Out", sign back in
   
   - Note: VPN on the MBP blocks Tailscale's coordination server — turn it off first

4. **Check Sharing settings:** System Settings → General → Sharing → Remote Login ON

5. **Restart Tailscale if stuck:** quit from menu bar, reopen from Applications

6. **Once SSH is back:**
   
   ```bash
   ssh air   # uses alias in ~/.ssh/config
   cd ~/headline-lab && git pull
   ```

**Tailscale note:** Only the App Store version (system extension) is installed. The Homebrew formula was removed (April 2026).

---

### Job: Monthly click report (`monthly-report.js`)

Runs 6:00am on the 1st of each month. Fetches Topics and Earthbox click counts from GA4 for every automation-enabled pub in the Google Sheet, then sends one combined email to `bpeniston@defenseone.com`.

- **Subject:** `GE360 Monthly Report — [Month Year]`
- **Body:** One section per pub showing Topics and Earthbox clicks vs pre-automation baseline, followed by cross-pub totals (once more than one pub is active)
- **Stats endpoint:** `pub-stats.php?pub={pubkey}&type=topics|earthbox` — reads `ga4_property_id`, `topic_oref`, and `earthbox_oref` from the sheet
- **Baselines** (from sheet columns S/T, calculated from Oct 2025–Mar 2026 GA4 data):

| Pub                   | Topics baseline | Earthbox baseline |
| --------------------- | --------------- | ----------------- |
| Defense One           | 3,005/mo        | 1,795/mo          |
| Washington Technology | 1,699/mo        | 459/mo            |

- A pub appears in the report when `trending_enabled` OR `earthbox_enabled` is TRUE and the row is valid
- If baseline is 0/blank, report shows "baseline not yet established" instead of a comparison

**Secret:** `monthly_stats_token` in `auto-updater/.headline-lab-config.ini` on DreamHost (not in GitHub).

---

## Philosophy

- **Air:** Tasks that need a browser, local compute, or Playwright automation
- **DreamHost:** Server-side PHP/Python tasks, MySQL-dependent jobs, lightweight cron
- **MBP:** Active development only; not a cron host
- **GitHub:** Source of truth for all code; secrets never committed
