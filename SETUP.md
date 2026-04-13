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

| Job | Schedule | Location | Notes |
|---|---|---|---|
| `ingest.py` | Every 5 min | `~/athena-helper/` | RSS ingest for D1 mirror/daybook; needs MySQL |
| `calendar_fetch.py` | Every 10 min | `~/navybook.com/kitchen_config/` | Calendar sync |
| `traffic_stats_nightly.py` | 2:15am nightly | `~/navybook.com/kitchen/` | Traffic stats |
| D1 Daily Digest | 4:00am weekdays | `~/d1_scripts/` | Digest email to bpeniston@defenseone.com |
| D1 Auto-Decline | 4:30am weekdays | `~/d1_scripts/` | Auto-decline script |
| dfnbot | 2:30pm weekdays | `~/venvs/venv1/` | Email to brad@navybook.com |

### Key files on DreamHost

| File | Path | Purpose |
|---|---|---|
| GA4 OAuth credentials | `/home/bradwu/ga4-oauth.json` | Defense One GA4 API access |
| Trending main cache | `/home/bradwu/trending-main-cache.json` | 1hr scored topic results |
| Trending article cache | `/home/bradwu/trending-article-cache.json` | 24hr per-article topic cache |
| Trending name cache | `/home/bradwu/trending-topicname-cache.json` | 7-day slug→display name cache |
| Earthbox main cache | `/home/bradwu/earthbox-cache.json` | 1hr scored post results |
| Earthbox title cache | `/home/bradwu/earthbox-title-cache.json` | 24hr per-article title/sponsored cache |
| Usage log | `/home/bradwu/headline-lab-usage.log` | Headline Lab usage |

### PHP endpoints (navybook.com/D1/seo/)
- `seo-api.php` — Headline Lab: takes article text, calls Anthropic API, returns headlines
- `trending-topics.php` — Trending Topics: queries GA4, scrapes articles, scores topics, returns top 7 JSON
- `earthbox-posts.php` — Earthbox: queries GA4, scrapes article titles, filters sponsored, returns top 6 posts JSON
- `stats.php` — Returns usage log counts

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
- Expires every few weeks; when it does the script sends a Slack alert with re-login instructions
- To refresh: open Screen Sharing (`vnc://100.117.250.37`), open Terminal, run:
  ```
  export PATH=/opt/homebrew/bin:$PATH
  cd ~/headline-lab
  node scripts/apply-trending.js --setup
  ```

### Launchd job
- **Plist:** `~/Library/LaunchAgents/com.navybook.trending-apply.plist`
- **Source:** `scripts/com.navybook.trending-apply.plist` in repo
- **Schedule:** 5:00am nightly
- **Log:** `~/headline-lab/logs/trending-apply.log`
- To reload after plist changes:
  ```
  launchctl unload ~/Library/LaunchAgents/com.navybook.trending-apply.plist
  launchctl load ~/Library/LaunchAgents/com.navybook.trending-apply.plist
  ```
- To run manually: `launchctl start com.navybook.trending-apply`

### Launchd jobs

| Job | Schedule | Plist | Script | Log |
|---|---|---|---|---|
| D1 Trending Topics | 5:00am nightly | `com.navybook.trending-apply.plist` | `scripts/apply-trending.js` | `logs/trending-apply.log` |
| D1 Earthbox | 5:30am nightly | `com.navybook.earthbox-apply.plist` | `scripts/apply-earthbox.js` | `logs/earthbox-apply.log` | ⚠️ plist not yet installed on Air |
| Monthly click report | 6:00am on 1st | `com.navybook.monthly-report.plist` | `scripts/monthly-report.js` | `logs/monthly-report.log` |

To reload a plist after changes:
```
launchctl unload ~/Library/LaunchAgents/com.navybook.JOBNAME.plist
launchctl load  ~/Library/LaunchAgents/com.navybook.JOBNAME.plist
```
To run manually: `launchctl start com.navybook.JOBNAME`

---

### Job: Trending Topics auto-apply (`apply-trending.js`)

**Flow:**
1. Fetches scored topics from `navybook.com/D1/seo/trending-topics.php`
2. Loads saved CMS session; detects expiry and sends Slack alert with re-login instructions
3. Parses D1 Trending Items list — skips any slot whose title starts with `"Sponsored:"`
4. For each editable Live slot: GETs edit page for CSRF, resolves topic via Grappelli autocomplete, POSTs form
5. Re-saves session to keep cookies fresh
6. Sends Slack email via Gmail SMTP — subject: `Topics: Changes`, `Topics: Unchanged`, or `Topics: Problem`; body: `New: …` / `Old: …` (or error detail if Problem)

**Flags:** `--dry-run` (no CMS writes), `--setup` (interactive login — requires desktop, not SSH)

**Currently Defense One only.** Will extend to other GE360 pubs once GA4 property IDs and Grappelli model names are confirmed.

---

### Job: Earthbox auto-apply (`apply-earthbox.js`)

**Flow:**
1. Fetches top GA4 articles from `navybook.com/D1/seo/earthbox-posts.php` (scores: month + week + day views; filters sponsored articles)
2. Loads saved CMS session; detects expiry and sends Slack alert with re-login instructions
3. Parses D1 Earthbox Items list — skips any slot where `_is_sponsored_content` is checked
4. For each editable Live slot: GETs edit page for CSRF and current state, POSTs update (content_type=22, object_id=post_id, clears image_override so post's own image is used)
5. Re-saves session to keep cookies fresh
6. Sends Slack email via Gmail SMTP — subject: `Earthbox: Changes`, `Earthbox: Unchanged`, or `Earthbox: Problem`; body: `New: …` / `Old: …` (or error detail if Problem)

**Flags:** `--dry-run` (no CMS writes), `--setup` (interactive login — requires desktop, not SSH)

**⚠️ Status: launchd plist not yet installed on Air.** Install steps in PLANNED.md.

---

### Job: Monthly click report (`monthly-report.js`)

Runs 6:00am on the 1st of each month. Calls `navybook.com/D1/seo/monthly-stats.php` (protected by secret token in `~/.headline-lab-config.ini` on DreamHost), which queries GA4 for previous month's pageviews on URLs containing `oref=d1-article-topics`.

Sends a Slack email comparing the result to the pre-automation baseline:
- **Baseline:** 3,005/month avg (Oct 2025–Mar 2026)
- **Subject:** `D1 Trending Topics — [Month Year]: [N] clicks`
- **Body:** total + `+/-N (+/-X%) vs Oct 2025–Mar 2026 avg of 3,005`

**Secret:** `monthly_stats_token` in `/home/bradwu/.headline-lab-config.ini` on DreamHost (not in GitHub).

---

## Philosophy
- **Air:** Tasks that need a browser, local compute, or Playwright automation
- **DreamHost:** Server-side PHP/Python tasks, MySQL-dependent jobs, lightweight cron
- **MBP:** Active development only; not a cron host
- **GitHub:** Source of truth for all code; secrets never committed
