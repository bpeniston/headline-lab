# Athena Tools — Claude Project Context

## What this project is
A Chrome extension (`athena-tools/`) plus PHP backend (`navybook.com/D1/seo/`) that adds tools to the Athena CMS shared by the **GE360** family of publications (see below). Currently deployed for Defense One; being extended to the full family.

## Four features

### UI Tweaks (`content/main.js`, `styles/tweaks.css`)
Runs on all CMS post editor pages. Reorders form fields, groups date/status into a cleaner bar.

### Headline Lab (`content/main.js`, `seo-api.php`)
On the CMS post editor: reads article body → calls `navybook.com/D1/seo/seo-api.php` → Anthropic API → returns 6 SEO headline/subhed/slug options.

### Skybox Push (`content/skybox.js`, `styles/skybox.css`)
Works on all five GE360 publication sites. Bookmarklet detects which pub you're on and opens that pub's skybox admin page.

- Triggered by a bookmarklet on any article page across all five pubs
- Bookmarklet detects the pub from `location.hostname` and opens the correct CMS skybox list page with `#push=POSTID`
- Content script cascades slots 1–5: each article shifts down one slot, new article lands in slot 1
- Override fields (URL, Title, Label) travel with their article; slot 1 gets a clean slate
- Slot 6 (ad) is never touched (script only reads slots 1–5)
- **Sponsored slots act as a wall**: if `title_override` starts with `"Sponsored:"`, that slot and everything below it is untouched; cascade stops just before it
- Uses real browser navigation + `saveBtn.click()` per slot — fetch() POST rejected by Athena server (requires `sec-fetch-mode: navigate`)
- State carried across page navigations via `sessionStorage`

**CMS skybox paths by pub:**
| Publication | CMS skybox list path |
|---|---|
| Defense One | `/athena/curate/defenseoneskyboxitem/` |
| GovExec | `/athena/curate/govexecskyboxitem/` |
| Nextgov | `/athena/curate/nextgovskyboxitem/` |
| Route Fifty | `/athena/curate/routefiftyskyboxitem/` |
| Washington Technology | `/athena/curate/wtskyboxitem/` |

**Bookmarklet** (save as a browser bookmark with this URL):
```
javascript:(function(){var h=location.hostname;var map={'defenseone.com':'defenseoneskyboxitem','govexec.com':'govexecskyboxitem','nextgov.com':'nextgovskyboxitem','route-fifty.com':'routefiftyskyboxitem','washingtontechnology.com':'wtskyboxitem'};var model;for(var k in map){if(h===k||h.endsWith('.'+k)){model=map[k];break;}}if(!model){alert('Not on a supported GE360 publication page.');return;}var m=location.pathname.match(/\/(\d{5,7})\/?$/);if(!m){alert('No post ID found — make sure you\'re on an article page.');return;}window.open('https://admin.govexec.com/athena/curate/'+model+'/#push='+m[1]);})();
```

**Skybox item edit form fields:** `content_type` (22 = Post), `object_id` (post ID integer), `status` (live), `live_date_0`/`live_date_1` (split date/time), `expiration_date_0`/`expiration_date_1`, `url_override`, `title_override`, `label_override`, `suppress_label` (checkbox), `image_override-*` (inline formset)

### Trending Topics (`content/trending.js`, `styles/trending.css`, `server/trending-topics.php`)
On the D1-Trending items list page (`admin.govexec.com/athena/curate/defenseonetrendingitem/`):
- Calls `navybook.com/D1/seo/trending-topics.php`
- Backend queries GA4 Data API (OAuth), scrapes top articles for `/topic/{slug}/?oref=d1-article-topics` tags
- Scores: month_views + week_views + day_views per topic
- Returns top 7; user reviews and clicks Apply
- Extension POSTs form updates to each Live item's edit page via Grappelli autocomplete

**Nightly auto-apply launched: 2026-04-08.** `scripts/apply-trending.js`, running as a launchd job on the M1 MacBook Air at 5:00am. Uses a saved Playwright browser session to avoid re-doing 2FA nightly. Skips sponsored slots. Sends a Slack notification (topic list in subject line) on success, or a re-login alert if the session has expired. See SETUP.md for full details.

## GE360 Publication Family

The newsroom operates five publications under the **GE360** umbrella, all running the Athena CMS at `admin.govexec.com`.

| Publication | Site URL | Pub key | CMS Trending path |
|---|---|---|---|
| Defense One | defenseone.com | `defenseone` | `/athena/curate/defenseonetrendingitem/` |
| GovExec | govexec.com | `govexec` | `/athena/curate/govexectrendingitem/` |
| Nextgov | nextgov.com | `nextgov` | `/athena/curate/nextgovtrendingitem/` |
| Route Fifty | route-fifty.com | `routefifty` | `/athena/curate/routefiftytrendingtopicitem/` |
| Washington Technology | washingtontechnology.com | `washingtontechnology` | `/athena/curate/wttrendingitem/` |

**Known per-publication details (Defense One only so far):**
- GA4 property: `353836589` (account `395628`)
- Article topic oref: `oref=d1-article-topics`
- Grappelli autocomplete model: `app_label=post_manager&model_name=defenseonetopic`
- CMS content_type for Topic: `382`

**Pending for GovExec, Nextgov, Route Fifty, Washington Technology:**
- GA4 property IDs (need GA4 access permissions)
- Grappelli model names (get from autocomplete field on each pub's trending item edit page)
- Article topic oref values (likely `oref={pub}-article-topics`; confirm by inspecting a live article page per pub)
- content_type integer for Topic (may differ per pub; get from edit page form)

**Sponsored topic slots:**
Some Trending slots are sold to advertisers; their `title_override` text begins with `"Sponsored:"`. The auto-apply function must **skip** any slot currently holding a sponsored topic and leave it unchanged.

## Key technical details

**CMS / Grappelli**
- Athena CMS is Django + Grappelli admin at `admin.govexec.com`
- D1-Trending item edit form fields: `content_type` (382 = Topic), `object_id` (integer), `status`, `live_date`, `expiration_date`, `url`, `title_override`
- Grappelli autocomplete: `GET /grappelli/lookup/autocomplete/?term={name}&app_label=post_manager&model_name=defenseonetopic&query_string=t=id`
  Returns: `[{"value": 32, "label": "Iran (Defense One)"}]`

**GA4**
- Defense One editorial property ID: `353836589` (account `395628`)
- Auth: OAuth refresh token at `/home/bradwu/ga4-oauth.json` on the server
- Do NOT use property `529112613` — that's the extension's own analytics

**Article topics HTML**
- `<a href="/topic/{slug}/?oref=d1-article-topics">Label</a>` inside `<article>`
- Tags appear twice in DOM (desktop/mobile) — deduplicate by slug

## Repo & deploy
- Local (MBP): `~/Documents/devstuff/headline-lab`
- Local (Air): `~/headline-lab` (cloned; used for cron automation scripts)
- GitHub: `https://github.com/bpeniston/headline-lab`
- Server: `bradwu@pdx1-shared-a1-08.dreamhost.com:~/navybook.com/D1/seo/`
- Deploy: `git push` then run `deploy` alias in Terminal
- Upload PHP directly: `scp server/FILE.php bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/seo/FILE.php`
- Reload extension: `chrome://extensions` → Athena Tools → ↺

## Server cache files (all in `/home/bradwu/`)
- `ga4-oauth.json` — OAuth credentials
- `trending-main-cache.json` — 1hr scored results cache
- `trending-article-cache.json` — 24hr article→topics cache
- `trending-topicname-cache.json` — 7-day slug→display name cache
- `headline-lab-usage.log` — usage log

## Secrets & credentials
- DreamHost SSH: passwordless from both MBP (`bradwu@pdx1-shared-a1-08.dreamhost.com`) and Air (SSH key installed)
- CMS credentials: stored in `~/headline-lab/.env` on the Air (never in GitHub)
- GA4 OAuth: `/home/bradwu/ga4-oauth.json` on DreamHost server

## Extension manifest
- Version: 1.4.0
- Permissions: `storage`, `alarms`, `notifications`
- Host permissions: `admin.govexec.com`, `www.navybook.com`
- Background: `background.js` service worker (minimal; automation lives on the Air)
- Content script 1: all `admin.govexec.com/*` → `main.js` + `tweaks.css`
- Content script 2: `admin.govexec.com/athena/curate/defenseonetrendingitem*` → `trending.js` + `trending.css`
- Content script 3: all five pub `*skyboxitem/*` paths → `skybox.js` + `skybox.css`

## Trending Topics impact measurement
- **Baseline established: 2026-04-08** (day automation launched)
- Pre-automation monthly pageviews on `oref=d1-article-topics` links (Oct 2025–Mar 2026): avg **3,005/month**
- **Automated monthly report** fires 6am on the 1st of each month via `scripts/monthly-report.js` on the Air — fetches previous month's count from `monthly-stats.php` on DreamHost, compares to baseline, sends Slack email
- `monthly-stats.php` is protected by `monthly_stats_token` in `/home/bradwu/.headline-lab-config.ini` (not in GitHub)
- To pull data manually: SSH to DreamHost, use GA4 OAuth at `/home/bradwu/ga4-oauth.json`, query property `353836589`, dimension `yearMonth`, metric `screenPageViews`, filter `fullPageUrl` contains `oref=d1-article-topics`
