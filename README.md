# Athena Tools
Internal newsroom toolset for the Defense One / GovExec Athena CMS · Hosted on DreamHost

---

## What this project contains

### 1. Chrome Extension — `athena-tools/`
A Manifest V3 Chrome extension that injects into the Athena CMS (`admin.govexec.com`) and adds three features:

| Feature | Where it runs | What it does |
|---|---|---|
| **UI Tweaks** | All CMS post editor pages | Reorders fields, groups date/status controls into a cleaner bar |
| **Headline Lab** | CMS post editor | Reads article body → calls backend API → generates 6 SEO headline/subhed/slug options with rationale and competition check |
| **Trending Topics** | D1-Trending items list page | Queries GA4, scrapes article topic tags, weights by recency, shows top 7 for review, applies them to the CMS automatically |

### 2. Backend API — `navybook.com/D1/seo/`
PHP endpoints on DreamHost shared hosting:

| File | What it does |
|---|---|
| `seo-api.php` | Headline Lab: takes article text, calls Anthropic API, returns headlines |
| `trending-topics.php` | Trending Topics: queries GA4, scrapes articles, scores topics, returns top 7 JSON |
| `stats.php` | Returns usage log counts |

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
| GA4 OAuth credentials | `/home/bradwu/ga4-oauth.json` | Defense One GA4 API access (client_id, client_secret, refresh_token) |
| Trending main cache | `/home/bradwu/trending-main-cache.json` | 1-hour cache of scored topic results |
| Article topic cache | `/home/bradwu/trending-article-cache.json` | 24-hour per-article topic tag cache |
| Topic name cache | `/home/bradwu/trending-topicname-cache.json` | 7-day slug→display name cache |
| Usage log | `/home/bradwu/headline-lab-usage.log` | Tab-separated: timestamp, action, ip, json |

**GA4 property:** Defense One editorial = `353836589` (account `395628`). Do NOT use `529112613` — that tracks the Chrome extension itself.

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
        └── Trending Topics panel
              ├── GET → navybook.com/D1/seo/trending-topics.php
              │           ├── Google Analytics Data API (OAuth)
              │           └── defenseone.com article pages (scraped)
              └── PUT edits via Grappelli autocomplete + Django form POST
                  (directly within admin.govexec.com — no external call)
```

---

## Cost

- **Headline Lab:** Claude Sonnet ~$0.003/call · 100 uses/month ≈ $0.30
- **Trending Topics:** GA4 Data API is free within quota · article scraping is free · no ongoing cost
