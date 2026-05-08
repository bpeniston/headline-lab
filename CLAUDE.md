Athena Tools — Claude Project Context
=====================================

What this project is
--------------------

A Chrome extension (`athena-tools/`) plus PHP backend (`navybook.com/D1/seo/`)
that adds tools to the Athena CMS shared by the **GE360** family of
publications. Nightly automation live for Defense One and Washington Technology;
GovExec, Nextgov, and Route Fifty pending Slack config only.

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
nightly 2FA). Skips sponsored slots — detected via `_is_sponsored_content`
checkbox on the individual edit form (CMS list page titles are blank for some
pubs; `title_override` check is unreliable). Sends Slack notification: subject
`{PUB} Topics: Changed|Unchanged|Problem` (e.g. `D1 Topics: Changed`), body
`New: T1, T2, …` / `Old: T1, T2, …` (comma-separated; items new to the list
are bolded). Re-login alert sent if session expired. Proactive
`Topics: Session expiring soon` warning sent 5 days before expected expiry;
timeout duration self-calibrates after first observed expiry (tracked in
`~/.session-meta.json` on the Air). See SETUP.md.

**Shared library:** `scripts/lib.js` contains all utilities shared between
`apply-trending.js`, `apply-earthbox.js`, and `apply-skybox.js`: logger factory, session metadata,
`.env` loader, Slack email, HTTP helpers, pub config fetch, `pubLabel()` helper,
`runSetup()`, `postForm()` (HTTPS POST helper), and `saveUpdate()`. API fetches
run in parallel across pubs via `Promise.all`.

`saveUpdate(pubKey, type, status, newItems, oldItems, errors, env, log)` — POSTs
result data to `save-update.php` after each script run, using `UPDATE_SECRET`
from `.env`. Skips gracefully if secret is absent. `sendSlackEmail` appends a
footer link to `https://navybook.com/D1/updates/` on every notification.

**Excluded topics:** `$EXCLUDED_TOPICS` in `trending-topics.php` filters slugs/display
names from recommendations regardless of score. Currently: `['commentary']`.

GE360 Publication Family
------------------------

All five pubs run Athena CMS at `admin.govexec.com`.

| Publication           | Site URL                 | Pub key (sheet)  | CMS Trending path                             | CMS Skybox path                        | CMS Earthbox path                        | Earthbox model PK |
|-----------------------|--------------------------|------------------|-----------------------------------------------|----------------------------------------|------------------------------------------|-------------------|
| Defense One           | defenseone.com           | `defenseone`     | `/athena/curate/defenseonetrendingitem/`      | `/athena/curate/defenseoneskyboxitem/` | `/athena/curate/defenseoneearthboxitem/` | 548               |
| GovExec               | govexec.com              | `govexec`        | `/athena/curate/govexectrendingitem/`         | `/athena/curate/govexecskyboxitem/`    | `/athena/curate/govexecearthboxitem/`    | 501               |
| Nextgov               | nextgov.com              | `nextgov`        | `/athena/curate/nextgovtrendingitem/`         | `/athena/curate/nextgovskyboxitem/`    | `/athena/curate/nextgovearthboxitem/`    | 494               |
| Route Fifty           | route-fifty.com          | `routefifty`     | `/athena/curate/routefiftytrendingtopicitem/` | `/athena/curate/routefiftyskyboxitem/` | `/athena/curate/routefiftyearthboxitem/` | 510               |
| Washington Technology | washingtontechnology.com | `washtech`       | `/athena/curate/wttrendingitem/`              | `/athena/curate/wtskyboxitem/`         | `/athena/curate/wtearthboxitem/`         | 621               |

Per-pub automation config is managed in the **GE360 Pub Config** Google Sheet (see SETUP.md). Scripts read from it at runtime via `pub-config.php`. To add a pub: fill in its row (including `base_url` and `topic_oref`), then set `trending_enabled`/`earthbox_enabled` to TRUE — no new PHP files needed, the shared endpoints handle all pubs via `?pub={pub_key}`.

**Per-pub configuration status:**

| Pub | GA4 Property | topic_oref | earthbox_oref | app_label | model | content_type | Sheet status |
|---|---|---|---|---|---|---|---|
| Defense One | `353836589` | `d1-article-topics` | `d1-earthbox-post` | `post_manager` | `defenseonetopic` | `382` | ✓ live |
| Washington Technology | `358726868` | `wt-article-topics` | `wt-earthbox-post` | `post_manager` | `wttopic` | `657` | ✓ live |
| GovExec | `353164424` | `ge-article-topics` | `ge-earthbox-post` | `post_manager` | `govexectopic` | `505` | ✓ trending + skybox live |
| Nextgov | `353764914` | `ng-article-topics` | `ng-earthbox-post` | `post_manager` | `nextgovtopic` | `496` | ✓ trending live |
| Route Fifty | `353766084` | `rf-article-topics` | `rf-earthbox-post` | `post_manager` | `topic` | `164` | ✓ trending live |

**Key learnings:**
- `grappelli_app_label`: all five pubs confirmed as `post_manager` — always verify via Network tab
- `grappelli_topic_model`: D1=`defenseonetopic`, GE=`govexectopic`, NG=`nextgovtopic`, WT=`wttopic`; RF uses plain `topic`
- `topic_content_type` varies per pub — find via the `content_type` select on a trending item edit page
- `oref` pattern `{prefix}-article-topics` / `{prefix}-earthbox-post` holds for all 5 pubs (confirmed)
- D1 article tags appear twice in DOM (desktop/mobile) — deduplicate by slug; verify for each new pub
- DO NOT use GA4 property `529112613` — that's the extension's own analytics, not a pub property
- Route Fifty's `topic_content_type` 164 was unconfirmed (item had no pre-selected topic) — verify when saving a real trending item
- **`is_sponsored()` in `earthbox-posts.php`**: do NOT match `'sponsor-content'` as an HTML string — WT's skybox includes a `/sponsors/sponsor-content/…` link on every page, causing every editorial article to be flagged as sponsored (same class of problem as D1's `skybox-item-sponsored` nav). Use the article's own URL path instead: check `str_contains(path, '/sponsors/')`. Sponsored articles live under `/sponsors/`; regular articles that merely link to one do not.
- **`apply-earthbox.js` zero-posts guard**: if the API returns no posts, `count = 0`, the slot loop never runs, and `[].every()` returns `true`, so the script silently reports `Unchanged` with empty arrays. Guard: treat `count === 0` as `Problem` and return early.
- **`save-update.php` type allowlist**: `type` is validated against an explicit list (`trending`, `earthbox`, `skybox`). When adding a new script, add its type string to the `in_array()` check or `saveUpdate` will fail with `Missing pub_key or type`.
- **GovExec `base_url` in sheet**: was set to `www.washingtontechnology.com` instead of `www.govexec.com`, causing trending to scrape WT pages and find no `ge-article-topics`. GovExec articles DO have their own `ge-article-topics` links. After fixing `base_url`, clear `~/trending-article-cache-govexec.json` and `~/trending-main-cache-govexec.json` on the server to purge stale data.

**Defense One GA4:** account `395628`, property `353836589`

Key technical details
---------------------

**CMS / Grappelli** - Athena is Django + Grappelli admin - Grappelli autocomplete URL: `GET /grappelli/lookup/autocomplete/?term={name}&app_label={grappelli_app_label}&model_name={grappelli_topic_model}&query_string=t=id` — returns `[{"value": 32, "label": "Iran (Defense One)"}]` - `app_label` and `model_name` vary per pub (see table above) — always confirm via Network tab before adding a new pub - D1-Trending edit form fields: `content_type` (382), `object_id`, `status`, `live_date`, `expiration_date`, `url`, `title_override` - Earthbox edit form: `content_type` (22 = Post, same for all pubs), `object_id` (post ID), `status`, `live_date_0/1`, override fields, `_is_sponsored_content` checkbox (use this — not `title_override` — to detect sponsored wall slots). `image_override` deleted on save so post's featured image is used.

**GA4** - Auth: OAuth refresh token at `/home/bradwu/ga4-oauth.json` on server - Scoring: `score = month_views + week_views + day_views` - Click tracking orefs follow pattern `{prefix}-article-topics` / `{prefix}-earthbox-post` (confirmed all 5 pubs); stored in sheet columns `topic_oref` / `earthbox_oref` - Pre-automation baselines (Oct 2025–Apr 2026 avg): D1 topics 3,005/mo, D1 earthbox 1,795/mo; WT topics 1,699/mo, WT earthbox 459/mo; GE topics 5,611/mo, GE earthbox 2,403/mo, GE skybox 22,369/mo; NG topics 1,677/mo, NG earthbox 933/mo, NG skybox 5,038/mo; RF topics 1,426/mo, RF earthbox 245/mo, RF skybox 261/mo. All stored in GE360 Pub Config sheet. - GA4 queries must use `pageLocation` or `fullPageUrl` dimension (not `pagePath`) to filter by `oref=` query param — `pagePath` strips query strings.

Repo & deploy
-------------

-   Local (MBP): `~/Documents/devstuff/headline-lab`

-   Local (Air): `~/headline-lab` (used for automation scripts)

-   GitHub: `https://github.com/bpeniston/headline-lab`

-   Server: `bradwu@pdx1-shared-a1-08.dreamhost.com:~/navybook.com/D1/seo/`

-   Deploy: `git push` then run `deploy` alias

-   Upload PHP directly: `scp server/FILE.php
    bradwu@pdx1-shared-a1-08.dreamhost.com:/home/bradwu/navybook.com/D1/seo/FILE.php`

-   Reload extension: `chrome://extensions` → Athena Tools → ↺

Secrets & credentials
---------------------

-   DreamHost SSH: passwordless from MBP and Air

-   CMS credentials: `~/headline-lab/.env` on the Air (never in GitHub)

-   GA4 OAuth: `/home/bradwu/ga4-oauth.json` on DreamHost

-   Monthly stats token: `/home/bradwu/.headline-lab-config.ini`

-   Updates shared secret: `/home/bradwu/.update-secret` on DreamHost (one line:
    `UPDATE_SECRET=<hex>`). Mirrored as `UPDATE_SECRET` in `~/headline-lab/.env`
    on the Air. Used by `save-update.php` to authenticate POSTs from the apply
    scripts. Daily results written to `/home/bradwu/ge360-updates-YYYY-MM-DD.json`.

Extension manifest
------------------

-   Version: 1.4.0 \| Permissions: `storage`, `alarms`, `notifications` \| Host
    permissions: `admin.govexec.com`, `www.navybook.com`

-   Background: `background.js` service worker (minimal; automation lives on the
    Air)

-   Content script 1: all `admin.govexec.com/*` → `main.js` + `tweaks.css`

-   Content script 2: `defenseonetrendingitem*` → `trending.js` + `trending.css`

-   Content script 3: all five pub `*skyboxitem/*` → `skybox.js` + `skybox.css`

Earthbox auto-updater (live, launched 2026-04-13)
-------------------------------------------------

Playwright script on the Air (`scripts/apply-earthbox.js`, same pattern as
`apply-trending.js`) populates editorial Earthbox slots with top GA4 articles.
Runs via launchd at 5:30am. Server-side: `server/earthbox-posts.php`. Sponsored
wall detected via `_is_sponsored_content` checkbox on the individual edit form
(the CMS list page does not expose this column). Sends Slack notification:
subject `{PUB} Earthboxes: Changed|Unchanged|Problem` (e.g. `WT Earthboxes: Changed`),
body bullet list with sponsored slots inline as `SPONSORED: …` (items new to
the list are bolded). Proactive `Earthboxes: Session expiring soon` warning
shares the same self-calibrating timeout logic as `apply-trending.js`. GA4
click tracking via `oref=d1-earthbox-post` (confirmed present on D1 article
pages); monthly baseline being established via `scripts/earthbox-baseline.js`.
See SETUP.md. Live for D1 and WT as of 2026-04-28.

Skybox auto-updater (live, launched 2026-05-08)
-----------------------------------------------

Playwright script on the Air (`scripts/apply-skybox.js`, same pattern as
`apply-earthbox.js`) populates editorial Skybox slots (1–N Live slots, stopping
at the sponsored wall) with top GA4 articles. Runs via launchd at 5:35am (5
minutes after earthbox). Post rankings come from `earthbox-posts.php` — the
same GA4-weighted list, served from the earthbox script's 1-hour cache (no
extra GA4 queries). Sponsored wall: stops when `_is_sponsored_content` is
checked on a slot; that slot and everything below is left untouched. Sends Slack
notification: `{PUB} Skyboxes: Changed|Unchanged|Problem`. Updates page shows
a Skyboxes section per pub (same bulleted-list renderer as earthbox). Controlled
via `skybox_enabled` / `skybox_cms_path` columns in the GE360 Pub Config sheet.

**Skybox oref values (GA4 click tracking):** `d1-skybox-hp`, `wt-skybox-hp`,
`ge-skybox-hp`, `ng-skybox-hp`, `rf-skybox-hp` (confirmed D1 and WT; others
inferred from pattern).

**To activate for a pub:** set `skybox_enabled = TRUE` in the sheet; ensure
`skybox_cms_path` and `skybox_oref` are filled in. No new PHP or launchd work
needed — the plist exists at `scripts/com.navybook.skybox-apply.plist` and must
be copied to `~/Library/LaunchAgents/` on the Air and loaded with `launchctl`.
Live for GovExec as of 2026-05-08.

## GE360 daily updates page (live, launched 2026-04-28)

`https://navybook.com/D1/updates/` — a daily digest of what the nightly scripts
changed. Files: `server/updates/index.php`, `server/updates/help.html`,
`server/updates/updates.css`.

- `save-update.php` (new server endpoint) accepts POSTs from `apply-trending.js`,
  `apply-earthbox.js`, and `apply-skybox.js` (authenticated via `UPDATE_SECRET`) and writes results
  to `/home/bradwu/ge360-updates-YYYY-MM-DD.json` with `flock` for concurrency.
- `index.php` reads today's JSON + pub config; renders Topics/Earthbox sections
  per pub with Changed/Unchanged/Problem badges; new items in a Changed run are
  **bolded**; sponsored slots shown inline as `SPONSORED: …` (never bolded).
  Active pubs sort first (alpha), inactive after.
- `help.html` — static explainer page linked from the main page.
- `updates.css` — shared stylesheet (Playfair Display + IBM Plex Mono/Sans,
  newspaper-style palette). Bump `?v=N` on the `<link>` tag when deploying CSS
  changes to bust browser cache.

## Planned features
see PLANNED.md
