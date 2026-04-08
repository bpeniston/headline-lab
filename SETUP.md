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
| Usage log | `/home/bradwu/headline-lab-usage.log` | Headline Lab usage |

### PHP endpoints (navybook.com/D1/seo/)
- `seo-api.php` — Headline Lab: takes article text, calls Anthropic API, returns headlines
- `trending-topics.php` — Trending Topics: queries GA4, scrapes articles, scores topics, returns top 7 JSON
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

### Nightly job: Trending Topics auto-apply

| Job | Schedule | Script | Notes |
|---|---|---|---|
| D1 Trending Topics | 5:00am nightly | `scripts/apply-trending.js` | Playwright fetches GA4 scores, applies top 7 topics to CMS, skips sponsored slots, sends Slack notification |

**Flow:**
1. Fetches scored topics from `navybook.com/D1/seo/trending-topics.php`
2. Loads saved CMS session; detects expiry and sends Slack alert if needed
3. Parses D1 Trending Items list — skips any slot whose title starts with `"Sponsored:"`
4. For each editable Live slot: GETs edit page for CSRF, resolves topic via Grappelli autocomplete, POSTs form
5. Re-saves session to keep cookies fresh
6. Sends Slack email via Gmail SMTP — subject line is the applied topic list (`Drones | Army | Iran | …`)

**Script flags:**
- `--dry-run` — fetch and log recommendations, skip CMS writes
- `--setup` — interactive login to save/refresh session (requires desktop, not SSH)

**Currently Defense One only.** Will extend to other GE360 pubs once GA4 property IDs and Grappelli model names are confirmed.

---

## Philosophy
- **Air:** Tasks that need a browser, local compute, or Playwright automation
- **DreamHost:** Server-side PHP/Python tasks, MySQL-dependent jobs, lightweight cron
- **MBP:** Active development only; not a cron host
- **GitHub:** Source of truth for all code; secrets never committed
