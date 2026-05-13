Athena Tools — Claude Project Context
=====================================

What this project is
--------------------

A Chrome extension (`athena-tools/`) plus PHP backend (`navybook.com/D1/seo/`)
that adds editorial tools to the Athena CMS shared by all five GE360 publications.

Extension Features
------------------

### Post Editor (`server/add-post.html`, `content/main.js`)

Standalone page at `navybook.com/D1/seo/add-post.html`. A clean two-panel writing UI for drafting posts before they enter the CMS.

**Left pane:** Headline (auto-generates slug), subheadline, Quill rich-text editor, endnote (collapsible). **Right sidebar:** publish date/time, expiration, highlight label, tags, flags (sponsored, evergreen, suppress options), canonical URL, video URL. Autosaves to `localStorage`.

**"Open in CMS" flow:** encodes all field data as base64 JSON → opens `admin.govexec.com/athena/post_manager/post/add/#prefill=<base64>` → extension's `checkPrefill()` in `main.js` decodes and populates all Athena form fields (including CKEditor via `setData()`). Hash is cleared after population.

**Fields NOT pre-filled** (require Grappelli autocomplete in Athena): author, primary category, topics, featured image.

### UI Tweaks (`content/main.js`, `styles/tweaks.css`)

Runs on all CMS post editor pages. Reorders form fields, groups date/status into a cleaner bar.

### Headline Lab (`content/main.js`, `seo-api.php`)

On the CMS post editor: reads article body → calls `navybook.com/D1/seo/seo-api.php` → Anthropic API → returns 6 SEO headline/subhed/slug options.

### Skybox Push (`content/skybox.js`, `styles/skybox.css`)

Bookmarklet on any GE360 article page opens that pub's skybox admin with `#push=POSTID`. Content script cascades slots 1–5 (slot 6 is an ad, never touched). Override fields travel with their article; slot 1 gets a clean slate. State carried via `sessionStorage`. Uses real browser navigation + `saveBtn.click()` — fetch() POST is rejected by Athena (requires `sec-fetch-mode: navigate`).

**Sponsored wall:** if `title_override` starts with `"Sponsored:"`, that slot and everything below is untouched.

**Skybox item edit form fields:** `content_type` (22 = Post), `object_id`, `status`, `live_date_0/1`, `expiration_date_0/1`, `url_override`, `title_override`, `label_override`, `suppress_label`, `image_override-*`

### Trending Topics (`content/trending.js`, `styles/trending.css`, `server/trending-topics.php`)

On the D1-Trending items list page: calls `trending-topics.php` → GA4 Data API (OAuth) → scrapes article topic tags → scores `month_views + week_views + day_views` → returns top 7 for review → POSTs updates via Grappelli autocomplete.

**Excluded topics:** `$EXCLUDED_TOPICS` in `trending-topics.php` filters slugs/display names from recommendations regardless of score. Currently: `['commentary']`.

Nightly Automation
------------------

All scripts run on the M1 Air via launchd. They share a single saved Playwright CMS session (avoids nightly 2FA). Session is validated by `pre-flight.js` at 4:55am before the main jobs run.

| Time | Script | Job |
|---|---|---|
| 4:55am | `pre-flight.js` | Session validity check; alert if expired |
| 5:00am | `apply-trending.js` | Update trending topics for all enabled pubs |
| 5:30am | `apply-box.js` | Update earthboxes + skyboxes for all enabled pubs |

All three scripts send Slack notifications: `{Pub} {Type}: Changed|Unchanged|Problem`.

### Trending Topics (`scripts/apply-trending.js`)

Fetches GA4 topic scores for all `trending_enabled` pubs in parallel, then applies the top 7 topics to the CMS. Skips slots where `title_override` starts with `"Sponsored:"`.

**Nightly GA4 stats:** After each update, sends a separate `Defense One Topics: Stats` Slack message showing D1 MTD clicks via `oref=d1-article-topics` with projected full-month total and two prior months for comparison. D1-only for now (other pubs' orefs not yet validated).

### Earthbox + Skybox (`scripts/apply-box.js`, `server/earthbox-posts.php`)

Runs both earthbox and skybox updates in a single browser session. Fetches all pub+box-type post recommendations in parallel, then applies them. Sponsored slots (detected via `_is_sponsored_content` checkbox on the individual edit form — not `title_override`) are skipped individually; remaining slots continue to be updated.

**Flags:** `--earthbox` / `--skybox` restrict to one box type; `--dry-run` fetches only; `--setup` opens a headed browser to log in and save the session.

**Post-selection modes** — set per pub per box type in the sheet:

| Value | Meaning |
|---|---|
| `OFF` | Nightly updater disabled for this box on this pub |
| `GA4` | Traffic-weighted ranking from GA4 |
| `RECENT_STAFF` | Recency-ordered staff-written posts via RSS + JSON-LD org check |

`RECENT_STAFF` logic: fetch RSS, skip the 5 most recent items, return the next 6 whose `publisher.name` in JSON-LD matches `org_name` in the sheet.

Post recommendations are cached in `earthbox-cache-{pub_key}-{mode}.json` on DreamHost — keyed on both pub and mode so GA4 and RECENT_STAFF results never collide when a pub uses different modes for its earthbox vs skybox.

**Earthbox/skybox edit form fields:** `content_type` (22 = Post, same for all pubs), `object_id`, `status`, `live_date_0/1`, `expiration_date_0/1`, `url_override`, `title_override`, `label_override`, `suppress_label`, `image_override-*` (deleted on save so the post's own featured image is used).

### Pre-flight + session management (`scripts/pre-flight.js`)

Navigates to the first enabled pub's CMS list page and checks for a login redirect. If expired: records `sessionExpiredAlertSent` in `~/.session-meta.json` and sends an alert — the main scripts check this flag and skip their own duplicate alerts. Also sends a proactive warning 5 days before expected timeout. Timeout self-calibrates: first expiry records `knownTimeoutDays`; subsequent warnings fire at `knownTimeoutDays - 5`. Observed timeout: 14 days (2026-05-11); warning fires at day 9.

### Shared utilities (`scripts/lib.js`)

- `isSessionExpired(url, title)` — detects login redirect by URL + page title (6-condition check used by all three scripts)
- `makeSetupMsg(scriptName)` / `makeWarnMsg(scriptName, elapsed, daysLeft)` — consistent session alert message builders with VNC/setup instructions
- `sendSlackEmail(subject, body, env, slackEmail)` — strips `admin.govexec.com` URLs before sending (prevents Slack unfurl → govexec "Page not available" card)
- `fetchPubConfig()` / `fetchJSON()` / `postForm()` — HTTP helpers using `require('https')` (DreamHost Node is v12-era; no native `fetch` or `?.`)
- `saveUpdate()` — posts daily update records to `navybook.com/D1/updates/`
- `runSetup()` — headed browser login flow; saves session cookies

GE360 Publication Family
------------------------

All five pubs run Athena CMS at `admin.govexec.com`.

| Publication | Site | Pub key | Trending path | Earthbox path | Skybox path |
|---|---|---|---|---|---|
| Defense One | defenseone.com | `defenseone` | `/athena/curate/defenseonetrendingitem/` | `/athena/curate/defenseoneearthboxitem/` | `/athena/curate/defenseoneskyboxitem/` |
| GovExec | govexec.com | `govexec` | `/athena/curate/govexectrendingitem/` | `/athena/curate/govexecearthboxitem/` | `/athena/curate/govexecskyboxitem/` |
| Nextgov | nextgov.com | `nextgov` | `/athena/curate/nextgovtrendingitem/` | `/athena/curate/nextgovearthboxitem/` | `/athena/curate/nextgovskyboxitem/` |
| Route Fifty | route-fifty.com | `routefifty` | `/athena/curate/routefiftytrendingtopicitem/` | `/athena/curate/routefiftyearthboxitem/` | `/athena/curate/routefiftyskyboxitem/` |
| Washington Technology | washingtontechnology.com | `washtech` | `/athena/curate/wttrendingitem/` | `/athena/curate/wtearthboxitem/` | `/athena/curate/wtskyboxitem/` |

Per-pub automation config is in the **GE360 Pub Config** Google Sheet (see SETUP.md). Scripts read from it at runtime via `pub-config.php`. To add or reconfigure a pub: edit the sheet — no code changes needed.

**Current automation status (as of 2026-05-13):**

| Pub | Trending | Earthbox | Skybox |
|---|---|---|---|
| Defense One | ✓ GA4 | ✓ GA4 | OFF |
| GovExec | ✓ GA4 | ✓ RECENT_STAFF | ✓ RECENT_STAFF |
| Nextgov | ✓ GA4 | ✓ GA4 | ✓ GA4 |
| Route Fifty | ✓ GA4 | ✓ GA4 | ✓ GA4 |
| Washington Technology | ✓ GA4 | ✓ GA4 | OFF |

**Per-pub Grappelli + GA4 config:**

| Pub | GA4 Property | topic_oref | earthbox_oref | app_label | topic_model | topic_content_type |
|---|---|---|---|---|---|---|
| Defense One | `353836589` | `d1-article-topics` | `d1-earthbox-post` | `post_manager` | `defenseonetopic` | `382` |
| GovExec | `353164424` | `ge-article-topics` | `ge-earthbox-post` | `post_manager` | `govexectopic` | `505` |
| Nextgov | `353764914` | `ng-article-topics` | `ng-earthbox-post` | `post_manager` | `nextgovtopic` | `496` |
| Route Fifty | `353766084` | `rf-article-topics` | `rf-earthbox-post` | `post_manager` | `topic` | `164` |
| Washington Technology | `358726868` | `wt-article-topics` | `wt-earthbox-post` | `core` | `topic` | TBD |

**Key learnings:**
- `grappelli_app_label`: WT uses `core`; all others use `post_manager` — always confirm via Network tab when adding a pub
- `topic_content_type` varies per pub — find via the `content_type` select on a trending item edit page
- `oref` pattern `{prefix}-article-topics` / `{prefix}-earthbox-post` holds for all 5 pubs (confirmed)
- D1 article tags appear twice in DOM (desktop/mobile) — deduplicate by slug; verify for each new pub
- DO NOT use GA4 property `529112613` — that's the extension's own analytics, not a pub property
- Route Fifty's `topic_content_type` 164 was unconfirmed (item had no pre-selected topic when inspected)
- `org_name` values for RECENT_STAFF: Defense One → `Defense One`, GovExec → `Government Executive`, Nextgov → `Nextgov/FCW`, Route Fifty → `Route Fifty`, Washington Technology → `Washington Technology`. All use `/rss/all/` as the feed path.
- **Defense One GA4:** account `395628`, property `353836589`

**Automation failure modes:**
- **Slack "Page not available" card (govexec-branded):** Playwright error messages contain `admin.govexec.com` edit-page URLs. Slack unfurls them → Google Workspace auth wall → govexec-branded "Page not available" card. Fix: `sendSlackEmail` in `lib.js` strips these URLs, replacing with `[CMS URL]`.
- **Missing pub entries in `updates/index.php`:** Uses `parseBool()` (PHP's `FILTER_VALIDATE_BOOLEAN`) to check if boxes are enabled — returns `false` for `'GA4'`/`'RECENT_STAFF'`. Fix: use `!== 'OFF'` comparison. File is not git-tracked — apply fix directly on the server.
- **Silent missing-pub entries in Slack (trending):** If a pub's API fetch fails in `Promise.all`, it's recorded as `null` and silently skipped — no update file is written, pub disappears from Slack and the updates page for that day. Indicates a transient upstream failure; self-heals the next morning.

**D1 Trending Topics click baseline (`oref=d1-article-topics`):**
Oct 2025: 2,512 · Nov: 2,191 · Dec: 2,911 · Jan 2026: 3,696 · Feb: 3,093 · Mar: 4,065. Pre-launch avg (Oct 2025–Mar 2026): ~3,078/mo. Automation launched ~Apr 8 2026; Apr settled at 1,885 (anomalously low; cause TBD). May 2026 = first full clean post-launch month. Interpretation: <3,078 = no lift; 3,078–4,065 = holding; >4,065 = clear lift. GA4 can backfill up to 72h (Apr manual figure 1,709 later settled to 1,885).

CMS / Technical Details
-----------------------

**Athena** is Django + Grappelli admin at `admin.govexec.com`.

**Grappelli autocomplete:** `GET /grappelli/lookup/autocomplete/?term={name}&app_label={app_label}&model_name={topic_model}&query_string=t=id` → `[{"value": 32, "label": "Iran (Defense One)"}]`

**Trending item form fields:** `content_type` (varies per pub), `object_id`, `status`, `live_date`, `expiration_date`, `url`, `title_override`

**Earthbox/skybox form fields:** `content_type` (22 = Post, same for all pubs), `object_id`, `status`, `live_date_0/1`, `expiration_date_0/1`, override fields, `_is_sponsored_content` checkbox (use this — not `title_override` — to detect sponsored slots)

**GA4:** Auth via OAuth refresh token at `/home/bradwu/ga4-oauth.json` on DreamHost. Scoring: `score = month_views + week_views + day_views`.

**DreamHost Node** is v12-era — no native `fetch` or optional chaining (`?.`). Use `require('https')` with a manual `httpsPost` helper and explicit `&&` null checks. See `fetchTopicClickStats()` in `apply-trending.js` for the pattern.

GE360 Pub Config Google Sheet — editing via browser tools
---------------------------------------------------------

Sheet ID: `1wLKVepPr8w6sZgiIa4dcgEDwmpQvHQqDE7yv3btvRp0`

**How to navigate to a specific cell reliably:**
The name box behaves unreliably when a row-range is already selected. Reliable method:
1. Click any normal body cell to clear range selection
2. Press `Cmd+Home` to land on A1
3. Press `Ctrl+Right` to the last non-empty header; `Right` once more to the first empty column
4. Type the header, `Tab` to move right, repeat; `Return` drops to row 2 for descriptions

**Key pitfall:** Clicking frozen-row cells (rows 1–2) while scrolled down selects the entire row. Always scroll to normal view or navigate from a known body cell.

Repo & Deploy
-------------

- **Local (MBP):** `~/Documents/devstuff/headline-lab`
- **Local (Air):** `~/headline-lab` (automation scripts)
- **GitHub:** `https://github.com/bpeniston/headline-lab`
- **DreamHost:** `bradwu@pdx1-shared-a1-08.dreamhost.com`

**Server paths** (three distinct directories under `~/navybook.com/D1/`):
- `seo/` — API endpoints + Headline Lab homepage (`index.php`); **git-tracked**
- `updates/` — daily auto-update digest (`index.php`); NOT git-tracked
- `index.html` — tools landing page; NOT git-tracked
- **Do not scp `updates/` files into `seo/` or vice versa — both have an `index.php`**

**Deploy:** `git push` then run `deploy` alias
**Direct PHP upload:** `scp server/FILE.php bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/seo/FILE.php`
**Recovery:** if a `seo/` file gets overwritten, SSH in and run `git restore <file>`
**Reload extension:** `chrome://extensions` → Athena Tools → ↺

Infrastructure
--------------

**M1 Air (automation host)**
- Tailscale IP: `100.117.250.37`
- SSH: `ssh brad-developer@100.117.250.37` (`brad-developer`, not `bradwu` — that's DreamHost)
- Node: `/opt/homebrew/bin/node` — must set `PATH=/opt/homebrew/bin:$PATH` for non-interactive SSH
- launchd plists: `~/Library/LaunchAgents/com.navybook.*.plist`
- All plists use absolute node path and set `HOME` + `PATH` — no shell profile needed

**Credentials**
- DreamHost SSH: passwordless from MBP and Air
- CMS session: `~/headline-lab/.cms-session.json` on the Air (Playwright saved state)
- CMS env vars: `~/headline-lab/.env` on the Air (never in GitHub)
- Session metadata: `~/headline-lab/.session-meta.json` (login date, known timeout, last-warning flags)
- GA4 OAuth: `/home/bradwu/ga4-oauth.json` on DreamHost
- Monthly stats token: `/home/bradwu/.headline-lab-config.ini`

**Extension manifest**
- Version: 1.4.0 | Permissions: `storage`, `alarms`, `notifications` | Host permissions: `admin.govexec.com`, `www.navybook.com`
- Content script 1: all `admin.govexec.com/*` → `main.js` + `tweaks.css`
- Content script 2: `defenseonetrendingitem*` → `trending.js` + `trending.css`
- Content script 3: all five pub `*skyboxitem/*` → `skybox.js` + `skybox.css`

## Planned features
see PLANNED.md
