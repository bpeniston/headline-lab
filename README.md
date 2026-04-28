# Athena Tools
Internal newsroom toolset for the GE360 family of publications (Defense One, GovExec, Nextgov, Route Fifty, Washington Technology) · Athena CMS at `admin.govexec.com` · Hosted on DreamHost

---

## What this project contains

### 1. Chrome Extension — `athena-tools/` (v1.4.0)
A Manifest V3 Chrome extension that injects into the Athena CMS (`admin.govexec.com`) and adds four features:

| Feature | Where it runs | What it does |
|---|---|---|
| **UI Tweaks** | All CMS post editor pages | Reorders fields, groups date/status controls into a cleaner bar |
| **Headline Lab** | CMS post editor | Reads article body → calls backend API → generates 6 SEO headline/subhed/slug options with rationale and competition check |
| **Trending Topics** | Trending items list page (all enabled pubs) | Queries GA4, scrapes article topic tags, weights by recency, shows top 7 for review; nightly auto-apply at 5:00am |
| **Skybox Push** | All five pubs' skybox list + edit pages | Bookmarklet on any article page cascades it into skybox slot 1; slots shift down; sponsored slots act as a wall |

### 2. Backend API — `navybook.com/D1/seo/`
PHP endpoints on DreamHost shared hosting:

| File | What it does |
|---|---|
| `seo-api.php` | Headline Lab: takes article text, calls Anthropic API, returns headlines |
| `trending-topics.php` | Trending Topics: queries GA4, scrapes articles, scores topics, returns top 7 JSON |
| `earthbox-posts.php` | Earthbox: queries GA4 pageviews, returns top articles JSON |
| `pub-config.php` | Reads per-pub config from Google Sheet; 1-hour server-side cache |
| `pub-stats.php` | Monthly GA4 stats per pub (topics + earthbox click orefs) |
| `monthly-stats.php` | Aggregated monthly usage report |
| `save-update.php` | Receives nightly script results (authenticated POST); writes to daily JSON |

### 4. Daily Updates Page — `server/updates/`
`https://navybook.com/D1/updates/` — a daily digest showing what the nightly scripts changed across all five pubs.

| File | What it does |
|---|---|
| `updates/index.php` | Reads today's JSON + pub config; renders Topics/Earthbox per pub with status badges |
| `updates/help.html` | Static explainer page linked from the main page |
| `updates/updates.css` | Shared stylesheet (Playfair Display + IBM Plex, newspaper palette) |

### 3. Nightly Automation — `scripts/` (runs on M1 Air)
Playwright scripts that apply CMS updates without interactive login (saved session).

| Script | Schedule | What it does |
|---|---|---|
| `apply-trending.js` | 5:00am daily | Applies top 7 trending topics to each enabled pub's CMS trending list |
| `apply-earthbox.js` | 5:30am daily | Applies top 6 GA4 articles to each enabled pub's editorial earthbox slots |

Both scripts share utilities via `scripts/lib.js`. Per-pub config is read from the **GE360 Pub Config** Google Sheet at runtime. Slack notifications sent via email-to-Slack with subject `{PUB} Topics/Earthboxes: Changed|Unchanged|Problem`. Currently live for Defense One and Washington Technology.

---

## Deploy workflow

**Every time you make changes to the extension or server files:**

```bash
cd ~/Documents/devstuff/headline-lab
git add .
git commit -m "describe what you changed"
git push
deploy    # alias: ssh to server and git pull
```

**To upload a new/changed PHP file directly:**
```bash
scp server/trending-topics.php bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/seo/trending-topics.php
```

**To reload the extension after code changes:**
Go to `chrome://extensions` → Athena Tools → ↺ reload button, then hard-refresh the CMS page.

---

## Project locations

| What | Where |
|---|---|
| Local repo | `~/Documents/devstuff/headline-lab` |
| GitHub | `https://github.com/bpeniston/headline-lab` |
| Server (SSH) | `bradwu@pdx1-shared-a1-08.dreamhost.com` |
| Server path | `~/navybook.com/D1/seo/` |
| Deploy alias | `deploy` in Terminal |

---

## Server credentials & config files

| File | Path on server | Purpose |
|---|---|---|
| GA4 OAuth credentials | `/home/bradwu/ga4-oauth.json` | GA4 API access (client_id, client_secret, refresh_token) |
| Pub config cache | `/home/bradwu/pub-config-cache.json` | 1-hour cache of Google Sheet pub config |
| Trending main cache | `/home/bradwu/trending-main-cache.json` | 1-hour cache of scored topic results |
| Article topic cache | `/home/bradwu/trending-article-cache.json` | 24-hour per-article topic tag cache |
| Topic name cache | `/home/bradwu/trending-topicname-cache.json` | 7-day slug→display name cache |
| Usage log | `/home/bradwu/headline-lab-usage.log` | Tab-separated: timestamp, action, ip, json |
| Updates shared secret | `/home/bradwu/.update-secret` | Single-line `UPDATE_SECRET=<hex>`; authenticates POSTs from apply scripts |
| Daily updates data | `/home/bradwu/ge360-updates-YYYY-MM-DD.json` | Written by `save-update.php`; read by `updates/index.php` |

| File | Path on Air | Purpose |
|---|---|---|
| CMS session | `~/headline-lab/.cms-session.json` | Saved Playwright browser session (shared by both apply scripts) |
| Session metadata | `~/headline-lab/.session-meta.json` | Login date + learned timeout duration for expiry warnings |
| Env vars | `~/headline-lab/.env` | SMTP credentials for Slack email notifications |

**GA4 properties:** D1 = `353836589`, WT = `358726868`, GE = `353164424`, NG = `353764914`, RF = `353766084`. Do NOT use `529112613` — that tracks the Chrome extension itself.

---

## Checking usage logs

```bash
ssh bradwu@pdx1-shared-a1-08.dreamhost.com
tail -50 ~/headline-lab-usage.log       # last 50 entries
tail -f ~/headline-lab-usage.log        # live tail
cut -f2 ~/headline-lab-usage.log | sort | uniq -c   # count by action
```

---

## Architecture

```
CMS browser (admin.govexec.com)
  └── Athena Tools extension
        ├── UI Tweaks (CSS + DOM reorder)
        ├── Headline Lab panel
        │     └── POST → navybook.com/D1/seo/seo-api.php
        │                   └── Anthropic API
        ├── Trending Topics panel
        │     ├── GET → navybook.com/D1/seo/trending-topics.php
        │     │           ├── Google Analytics Data API (OAuth)
        │     │           └── pub article pages (scraped for topic tags)
        │     └── Applies edits via Grappelli autocomplete + Django form POST
        │         (directly within admin.govexec.com — no external call)
        └── Skybox Push (triggered by bookmarklet on article pages)
              └── Cascades slots 1–5 via sequential page navigation + saveBtn.click()
                  (sessionStorage carries plan across navigations)

Bookmarklet (browser toolbar)
  └── Skyboxer → detects pub from hostname → opens CMS skybox page with #push=POSTID

M1 Air (launchd nightly jobs)
  ├── apply-trending.js (5:00am)
  │     ├── GET pub config → navybook.com/D1/seo/pub-config.php (Google Sheet)
  │     ├── GET topics → navybook.com/D1/seo/trending-topics.php (GA4 + scraper)
  │     ├── Playwright → admin.govexec.com trending items (Grappelli + form POST)
  │     └── POST results → navybook.com/D1/seo/save-update.php → daily JSON
  └── apply-earthbox.js (5:30am)
        ├── GET pub config → navybook.com/D1/seo/pub-config.php
        ├── GET posts → navybook.com/D1/seo/earthbox-posts.php (GA4 pageviews)
        ├── Playwright → admin.govexec.com earthbox items (form POST per slot)
        └── POST results → navybook.com/D1/seo/save-update.php → daily JSON
  Both scripts → Slack notification via Gmail SMTP email-to-channel (with link to updates page)

navybook.com/D1/updates/ (daily digest page)
  └── reads daily JSON → renders Topics/Earthbox status for all pubs
```

---

## Cost

- **Headline Lab:** Claude Sonnet ~$0.003/call · 100 uses/month ≈ $0.30
- **Trending Topics:** GA4 Data API is free within quota · article scraping is free · no ongoing cost
