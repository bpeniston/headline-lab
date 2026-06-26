<!-- shared-infra pointer · v1.0 · 2026-05-31 -->
## Shared infrastructure context

Cross-project setup — machines, SSH, cron jobs, DreamHost, external services, and remote
access — lives in the **`dev-infrastructure`** repo's `SETUP.md`. Read that first for
anything touching infrastructure, deployment, cron, or remote access. Don't duplicate it
here; this file is only for THIS project's specifics.

- Canonical source: `bpeniston/dev-infrastructure` → `SETUP.md`
- Local clone: `~/Documents/devstuff/dev-infrastructure/SETUP.md`

---

Athena Tools — Claude Project Context
=====================================

What this project is
--------------------

A Chrome extension (`athena-tools/`) plus PHP backend (`navybook.com/D1/seo/`)
that adds tools to the Athena CMS shared by the **GE360** family of
publications. Currently deployed for Defense One; being extended to the full
family.

Five features
-------------

### Post Editor (`server/add-post.html`, `content/main.js`)

Standalone page at `navybook.com/D1/seo/add-post.html`. A clean two-panel
writing UI (better than Athena's Django admin) for drafting posts before they
enter the CMS.

**Left pane:** Headline (auto-generates slug), subheadline, Quill rich-text
editor, endnote (collapsible). **Right sidebar:** publish date/time, expiration,
highlight label, tags, flags (sponsored, evergreen, suppress options), canonical
URL, video URL. Autosaves to `localStorage`.

**"Open in CMS" flow:** encodes all field data as base64 JSON → opens
`admin.govexec.com/athena/post_manager/post/add/#prefill=<base64>` → extension's
`checkPrefill()` in `main.js` detects the hash, decodes it, and populates all
Athena form fields (including CKEditor content via `setData()`). Shows a brief
confirmation banner. Hash is cleared from URL after population.

**Fields NOT pre-filled** (require Grappelli autocomplete in Athena): author,
primary category, topics, featured image.

### UI Tweaks (`content/main.js`, `styles/tweaks.css`)

Runs on all CMS post editor pages. Reorders form fields, groups date/status into
a cleaner bar.

### Headline Lab (`content/main.js`, `seo-api.php`)

On the CMS post editor: reads article body → calls
`navybook.com/D1/seo/seo-api.php` → Anthropic API → returns 6 SEO
headline/subhed/slug options.

### Skybox Push (`content/skybox.js`, `styles/skybox.css`)

Bookmarklet on any GE360 article page opens that pub's skybox admin with
`#push=POSTID`. Content script cascades slots 1–5 (slot 6 is an ad, never
touched). Override fields travel with their article; slot 1 gets a clean slate.
State carried via `sessionStorage`. Uses real browser navigation +
`saveBtn.click()` — fetch() POST is rejected by Athena (requires
`sec-fetch-mode: navigate`).

**Sponsored wall:** if `title_override` starts with `"Sponsored:"`, that slot
and everything below is untouched.

**Skybox item edit form fields:** `content_type` (22 = Post), `object_id`,
`status`, `live_date_0/1`, `expiration_date_0/1`, `url_override`,
`title_override`, `label_override`, `suppress_label`, `image_override-*`

### Trending Topics (`content/trending.js`, `styles/trending.css`, `server/trending-topics.php`)

On the D1-Trending items list page: calls `trending-topics.php` → GA4 Data API
(OAuth) → scrapes article topic tags → scores `month_views + week_views +
day_views` → returns top 7 for review → POSTs updates via Grappelli
autocomplete.

**Nightly auto-apply (launched 2026-04-08):** `scripts/apply-trending.js` runs
as a launchd job on the M1 Air at 5:00am via saved Playwright session (avoids
nightly 2FA). Skips sponsored slots. Sends Slack notification: subject
`Topics: Changes|Unchanged|Problem`, body `New: T1, T2, …` / `Old: T1, T2, …`
(comma-separated; items new to the list are bolded). Re-login alert sent if
session expired. Pre-flight check (`pre-flight.js`, 4:55am) validates session
before jobs run and sends one `CMS: ACTION REQUIRED — Playwright session expired`
alert (fires once per expiry event; suppressed on subsequent mornings until
`--setup` is run). Proactive `CMS: Session expiring soon` warning fires 5 days
before expected expiry; observed timeout is 14 days (recorded 2026-05-11), so
warning now fires at day 9. Timeout self-calibrates after each expiry
(`~/.session-meta.json`). **Test alerts:** `node scripts/pre-flight.js
--test-alert expired|warning` sends the real Slack message without running the
pre-flight browser check. See SETUP.md.

**Nightly GA4 stats (added 2026-05-08):** After each nightly CMS update,
`apply-trending.js` queries GA4 for `oref=d1-article-topics` click counts and
sends a separate Slack message: subject `Defense One Topics: Stats`, body shows
current month MTD with projected full-month total, plus the two prior months for
comparison. D1 only for now (oref validated; other pubs TBD). Uses the same
`httpsPost` pattern as the validation script (DreamHost Node is too old for
native `fetch` or optional chaining).

**Excluded topics:** `$EXCLUDED_TOPICS` in `trending-topics.php` filters slugs/display
names from recommendations regardless of score. Currently: `['commentary']`.

GE360 Publication Family
------------------------

All five pubs run Athena CMS at `admin.govexec.com`.

| Publication           | Site URL                 | Pub key (sheet) | CMS Trending path                             | CMS Skybox path                        | CMS Earthbox path                        | Earthbox model PK |
| --------------------- | ------------------------ | --------------- | --------------------------------------------- | -------------------------------------- | ---------------------------------------- | ----------------- |
| Defense One           | defenseone.com           | `defenseone`    | `/athena/curate/defenseonetrendingitem/`      | `/athena/curate/defenseoneskyboxitem/` | `/athena/curate/defenseoneearthboxitem/` | 548               |
| GovExec               | govexec.com              | `govexec`       | `/athena/curate/govexectrendingitem/`         | `/athena/curate/govexecskyboxitem/`    | `/athena/curate/govexecearthboxitem/`    | 501               |
| Nextgov               | nextgov.com              | `nextgov`       | `/athena/curate/nextgovtrendingitem/`         | `/athena/curate/nextgovskyboxitem/`    | `/athena/curate/nextgovearthboxitem/`    | 494               |
| Route Fifty           | route-fifty.com          | `routefifty`    | `/athena/curate/routefiftytrendingtopicitem/` | `/athena/curate/routefiftyskyboxitem/` | `/athena/curate/routefiftyearthboxitem/` | 510               |
| Washington Technology | washingtontechnology.com | `washtech`      | `/athena/curate/wttrendingitem/`              | `/athena/curate/wtskyboxitem/`         | `/athena/curate/wtearthboxitem/`         | 621               |

Per-pub automation config is managed in the **GE360 Pub Config** Google Sheet (see SETUP.md). Scripts read from it at runtime via `pub-config.php`. To add a pub: fill in its row (including `base_url` and `topic_oref`), then set `earthbox_enabled`/`skybox_enabled` to `GA4` or `RECENT_STAFF` — no new PHP files needed, the shared endpoints handle all pubs via `?pub={pub_key}`.

**Post-selection mode** (skybox + earthbox): `earthbox_enabled` and `skybox_enabled` columns in the sheet are now three-value dropdowns that simultaneously control whether nightly automation is active *and* which post-selection mode to use.

| Value          | Meaning                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `OFF`          | Nightly updater disabled for this box on this pub                         |
| `GA4`          | Enabled — traffic-weighted ranking from GA4 (default)                     |
| `RECENT_STAFF` | Enabled — recency-ordered staff-written posts via RSS + JSON-LD org check |

Two additional optional columns support `RECENT_STAFF` mode:

| Column     | Values                                  | Notes                                                                                                         |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `org_name` | e.g. `Government Executive`             | Publisher name as it appears in article JSON-LD `publisher.name`. Required when either box is `RECENT_STAFF`. |
| `rss_url`  | e.g. `https://www.govexec.com/rss/all/` | RSS 2.0 feed URL. Required when either box is `RECENT_STAFF`.                                                 |

`RECENT_STAFF` logic: skip the 5 most recent RSS items, then take the next 6 whose `publisher.name` matches `org_name` and are not sponsored. Sponsored slots in the CMS are never replaced (same as `GA4` mode).

**Per-pub configuration status:**

| Pub                   | GA4 Property | topic_oref          | earthbox_oref      | app_label      | model             | content_type | Sheet status                                         |
| --------------------- | ------------ | ------------------- | ------------------ | -------------- | ----------------- | ------------ | ---------------------------------------------------- |
| Defense One           | `353836589`  | `d1-article-topics` | `d1-earthbox-post` | `post_manager` | `defenseonetopic` | `382`        | ✓ live                                               |
| Washington Technology | `358726868`  | `wt-article-topics` | `wt-earthbox-post` | `core`         | `topic`           | TBD          | disabled — needs topic_content_type, slack, base_url |
| GovExec               | `353164424`  | `ge-article-topics` | `ge-earthbox-post` | `post_manager` | `govexectopic`    | `505`        | disabled — needs slack only                          |
| Nextgov               | `353764914`  | `ng-article-topics` | `ng-earthbox-post` | `post_manager` | `nextgovtopic`    | `496`        | disabled — needs slack only                          |
| Route Fifty           | `353766084`  | `rf-article-topics` | `rf-earthbox-post` | `post_manager` | `topic`           | `164`        | disabled — needs slack only                          |

**Key learnings:**

- `grappelli_app_label`: WT uses `core`; all others confirmed as `post_manager` — always verify via Network tab
- `grappelli_topic_model`: D1=`defenseonetopic`, GE=`govexectopic`, NG=`nextgovtopic`; WT and RF both use plain `topic`
- `topic_content_type` varies per pub — find via the `content_type` select on a trending item edit page
- `oref` pattern `{prefix}-article-topics` / `{prefix}-earthbox-post` holds for all 5 pubs (confirmed)
- D1 article tags appear twice in DOM (desktop/mobile) — deduplicate by slug; verify for each new pub
- DO NOT use GA4 property `529112613` — that's the extension's own analytics, not a pub property
- Route Fifty's `topic_content_type` 164 was unconfirmed (item had no pre-selected topic) — verify when saving a real trending item

**Automation failure modes:**

- **Slack "Page not available" card (govexec-branded):** Playwright error messages often contain full `admin.govexec.com` edit-page URLs (e.g. session expiry, navigation timeout). Slack unfurls those URLs → hits a Google Workspace auth wall → shows a govexec-branded "Page not available" card instead of notification content. Fix (live 2026-05-13): `sendSlackEmail` in `scripts/lib.js` strips `admin.govexec.com` URLs before sending, replacing them with `[CMS URL]`.
- **Missing pub entries in `updates/index.php`:** The page uses `parseBool()` from PHP's `FILTER_VALIDATE_BOOLEAN` to check if boxes are enabled. After the `earthbox_enabled`/`skybox_enabled` columns changed from TRUE/FALSE booleans to `OFF`/`GA4`/`RECENT_STAFF` strings (2026-05-13), `parseBool('GA4')` returned `false` and sections disappeared. Fix: use `!== 'OFF'` string comparison, not `parseBool()`, for these two columns. `updates/index.php` is not git-tracked — apply fix directly on the server.
- **Silent missing-pub entries in Slack (trending):** `apply-trending.js` fetches topics for all pubs in parallel via `Promise.all`. If a pub's fetch fails (transient GA4/network error), it is recorded as `null` and silently skipped — no update file entry is written, so the pub simply disappears from the Slack report and `updates/` page for that day. This is not a bug in the code; it indicates a transient upstream failure. Self-heals the next morning.
- **Duplicate log lines under launchd (fixed 2026-05-27):** `createLogger` previously called both `console.log` (captured by launchd's `StandardOutPath`) and `stream.write` (direct file write), doubling every line. Fixed by skipping `console.log` when `process.stdout.isTTY` is false (i.e. launchd). Terminal runs still echo to stdout.
- **Expiry alert firing every morning (fixed 2026-05-27):** `pre-flight.js` was setting `sessionExpiredAlertSent` in `.session-meta.json` but never reading it before sending — so the Slack alert fired again every morning the session remained expired. Fixed: alert is skipped if `sessionExpiredAlertSent` is already set; `die()` still fires either way so nightly jobs abort. Field is cleared when `--setup` saves a new session, so the next real expiry triggers a fresh alert.

**Defense One GA4:** account `395628`, property `353836589`

**D1 Trending Topics click baseline (oref=d1-article-topics):**

- Oct 2025: 2,512 · Nov: 2,191 · Dec: 2,911 · Jan 2026: 3,696 · Feb: 3,093 · Mar: 4,065
- Pre-launch avg (Oct 2025–Mar 2026): ~3,078/mo. Peak: 4,065 (Mar 2026).
- Automation launched ~Apr 8 2026. Apr total: 1,885 (anomalously low — cause unclear; launchd logs worth checking).
- May 2026 will be first full clean post-launch month. Interpretation thresholds: <3,078 = no lift; 3,078–4,065 = holding trend; >4,065 = clear lift.
- GA4 can backfill up to 72h — April's manually-pulled figure of 1,709 later settled to 1,885.

Key technical details
---------------------

**CMS / Grappelli** - Athena is Django + Grappelli admin - Grappelli autocomplete URL: `GET /grappelli/lookup/autocomplete/?term={name}&app_label={grappelli_app_label}&model_name={grappelli_topic_model}&query_string=t=id` — returns `[{"value": 32, "label": "Iran (Defense One)"}]` - `app_label` and `model_name` vary per pub (see table above) — always confirm via Network tab before adding a new pub - D1-Trending edit form fields: `content_type` (382), `object_id`, `status`, `live_date`, `expiration_date`, `url`, `title_override` - Earthbox edit form: `content_type` (22 = Post, same for all pubs), `object_id` (post ID), `status`, `live_date_0/1`, override fields, `_is_sponsored_content` checkbox (use this — not `title_override` — to detect sponsored wall slots). `image_override` deleted on save so post's featured image is used.

**GA4** - Auth: OAuth refresh token at `auto-updater/ga4-oauth.json` on server - Scoring: `score = month_views + week_views + day_views` - Click tracking orefs (stored in sheet columns `topic_oref` / `earthbox_oref` / `skybox_oref`, confirmed all 5 pubs): topics `{prefix}-article-topics`, earthbox `{prefix}-earthbox-post`, **skybox `{prefix}-skybox-hp`** (homepage — NOT `-skybox-post`; the natural guess from the earthbox pattern is wrong). `{prefix}` = d1/wt/ge/ng/rf. - **Pre-automation baselines (12-mo avg, Apr 2025–Mar 2026, measured via `scripts/pull-impact-report.js` as screenPageViews where fullPageUrl CONTAINS oref= — the same metric `pub-stats.php`/`monthly-report.js` use).** These replace the older 6-mo Oct–Mar estimates and now live in the sheet's `topics_baseline`/`earthbox_baseline`/`skybox_baseline` columns:

  | Pub | topics/mo | earthbox/mo | skybox/mo |
  | --- | --- | --- | --- |
  | Defense One | 2,586 | 1,842 | 6,233 |
  | Washington Technology | 1,136 | 437 | 3,721 |
  | GovExec | 7,130 | 3,475 | 39,444 |
  | Nextgov | 1,401 | 926 | 5,500 |
  | Route Fifty | 917 | 191 | 622 |

  The old sheet skybox figures (22,369, 5,038) were non-reproducible by any standard GA4 metric and were misattributed across rows; `customEvent:oref` is not a registered GA4 dimension. Baselines must use the same oref+metric `pub-stats.php` queries or the monthly "vs baseline" deltas are corrupt. (Monthly report now leads with traffic **share** ‰ + YoY; click-vs-baseline is secondary — see `monthly-report.js`.)

**Impact analysis scripts (one-offs, live and run from `auto-updater/` on the server, alongside `ga4-oauth.json`):**

- `scripts/pull-impact-report.js` — per-pub × per-feature report: clicks + traffic **share** (‰ of total site pageviews) + YoY, against the 12-mo baseline band. Use to compare a feature's performance before/after launch.
- `scripts/automation-lift.js` — the aggregate "what did automation do overall" answer. Counterfactual = `baseline_share × actual_pageviews` (normalizes out traffic swings); incremental = actual − counterfactual, summed across all automated pub×feature, counting only **full** months under automation (per `automation_start_date`). Reports incremental clicks as a % of total site traffic, with a YoY cross-check.
- `scripts/update-baselines.php` — rewrites the sheet's `*_baseline` columns (needs the service account temporarily granted **Editor**; it's normally read-only). Dry-runs by default; `--apply` to write.
- All use the screenPageViews-CONTAINS-`oref=` method (matching `pub-stats.php`) so figures are mutually comparable. Old-Node-safe (`httpsPost`, no `fetch`/`?.`).

**Latest impact finding (measured 2026-06-25, full-automation months May–Jun 25 2026):** net **+~9,900 incremental clicks ≈ +0.14% of total site traffic** (YoY cross-check +0.11%; June steady-state +0.06%). The net is positive *only* because of Earthbox (+242% vs counterfactual, ~+14,500 clicks); **Topics (−26%) and Skybox (−6%) are net drags** vs their pre-automation share. Attribution caveat: some of the Topics/Skybox decline is likely secular (un-automated pubs drifted down too), so the true automation effect on those is probably less negative. The clearest improvement lever is diagnosing why Topics/Skybox underperform their baselines.

**DreamHost Node version** is old (v12-era) — does not support native `fetch` or optional chaining (`?.`). Always use `require('https')` with a manual `httpsPost` helper and explicit `&&` null checks instead. See `fetchTopicClickStats()` in `apply-trending.js` for the pattern.

GE360 Pub Config Google Sheet — editing via browser tools
---------------------------------------------------------

Sheet ID: `1wLKVepPr8w6sZgiIa4dcgEDwmpQvHQqDE7yv3btvRp0`

**How to navigate to a specific cell (e.g. W1) reliably:**
The name box behaves unreliably when a row-range or multi-cell range is already selected — typing a cell address into it selects a region instead of jumping. The Name Box also doesn't work when you cmd+a in it from a bad state.

Reliable method:

1. Click any normal data cell in the sheet body to clear any range selection
2. Press `Cmd+Home` (or click cell A1 directly) to land on A1
3. Press `Ctrl+Right` to jump to the last non-empty cell in row 1
4. Press `Right` once more to land on the first empty column in row 1
5. Type the header, press `Tab` to move right, type next header, repeat
6. Press `Return` when done with row 1 — cursor moves to the first cell you started from in row 2
7. Repeat Tab-entry for descriptions in row 2

**Key pitfall:** Clicking frozen row cells (rows 1–2 at the top of the viewport) while the sheet is scrolled down selects the entire row instead of the cell. Always scroll to normal view first or use keyboard navigation from a known body cell.

Repo & deploy
-------------

- Local (MBP): `~/Documents/devstuff/headline-lab`

- Local (Air): `~/headline-lab` (used for automation scripts)

- GitHub: `https://github.com/bpeniston/headline-lab`

- Server: `bradwu@pdx1-shared-a1-08.dreamhost.com`

- Server paths (under `~/navybook.com/D1/`):
  
  - `seo/` — API endpoints + Headline Lab homepage (`index.php`); **git-tracked**
  - `updates/` — daily auto-update digest page (`index.php`); NOT git-tracked
  - `index.html` — tools landing page listing all D1 tools; NOT git-tracked
  - `auto-updater/` — all nightly-automation credentials, caches, and daily update data (moved out of `/home/bradwu/` 2026-06-25 to stop home-dir clutter); blocked from public web access via `.htaccess`. **All future auto-updater files (new caches, one-off analysis scripts, credentials) belong here, never loose in `/home/bradwu/`.**
  - **Do not scp updates/ files into seo/ or vice versa — both have an `index.php`**

- Deploy: `git push` then run `deploy` alias

- Upload PHP directly: `scp server/FILE.php
  bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/seo/FILE.php`

- Recovery: if a file in `seo/` gets overwritten, SSH in and run `git restore <file>`

- Reload extension: `chrome://extensions` → Athena Tools → ↺

Secrets & credentials
---------------------

- DreamHost SSH: passwordless from MBP and Air

- CMS credentials: `~/headline-lab/.env` on the Air (never in GitHub)

- GA4 OAuth: `auto-updater/ga4-oauth.json` on DreamHost

- Monthly stats token: `auto-updater/.headline-lab-config.ini`

- Sheets service account: `auto-updater/sheets-service-account.json`

- Updates shared secret: `auto-updater/.update-secret`

Extension manifest
------------------

- Version: 1.4.0 \| Permissions: `storage`, `alarms`, `notifications` \| Host
  permissions: `admin.govexec.com`, `www.navybook.com`

- Background: `background.js` service worker (minimal; automation lives on the
  Air)

- Content script 1: all `admin.govexec.com/*` → `main.js` + `tweaks.css`

- Content script 2: `defenseonetrendingitem*` → `trending.js` + `trending.css`

- Content script 3: all five pub `*skyboxitem/*` → `skybox.js` + `skybox.css`

Earthbox auto-updater (live, launched 2026-04-13)
-------------------------------------------------

Playwright script on the Air (`scripts/apply-box.js`, combined Earthbox + Skybox
runner, same pattern as `apply-trending.js`) populates editorial Earthbox slots
with top GA4 articles. Runs via launchd at 5:30am. Server-side:
`server/earthbox-posts.php`. Sponsored wall detected via `_is_sponsored_content`
checkbox on the individual edit form (the CMS list page does not expose this
column). Sends Slack notification: subject `Earthbox: Changes|Unchanged|Problem`,
body bullet list with sponsored slots inline as `SPONSORED: …` (items new to the
list are bolded). Proactive `Earthbox: Session expiring soon` warning shares the
same self-calibrating timeout logic as `apply-trending.js`. GA4 click tracking
via `oref=d1-earthbox-post` (confirmed present on D1 article pages); monthly
baseline being established via `scripts/earthbox-baseline.js`. See SETUP.md.

M1 Air — automation host
------------------------

- Tailscale IP: `100.117.250.37`
- SSH user: `brad-developer` (not `bradwu` — that's the DreamHost server user)
- SSH from MBP: `ssh brad-developer@100.117.250.37`
- Node: `/opt/homebrew/bin/node` — must set `PATH=/opt/homebrew/bin:$PATH` for non-interactive SSH sessions
- launchd plists: `~/Library/LaunchAgents/com.navybook.*.plist`
- All plists use absolute node path and set HOME + PATH in EnvironmentVariables — no shell profile needed

## Planned features

see PLANNED.md
