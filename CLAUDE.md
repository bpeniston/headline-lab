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
session expired. Proactive `Topics: Session expiring soon` warning sent 5 days
before expected expiry; timeout duration self-calibrates after first observed
expiry (tracked in `~/.session-meta.json` on the Air). See SETUP.md.

**Excluded topics:** `$EXCLUDED_TOPICS` in `trending-topics.php` filters slugs/display
names from recommendations regardless of score. Currently: `['commentary']`.

GE360 Publication Family
------------------------

All five pubs run Athena CMS at `admin.govexec.com`.

| Publication           | Site URL                 | Pub key                | CMS Trending path                             | CMS Skybox path                        | CMS Earthbox path                        | Earthbox model PK |
|-----------------------|--------------------------|------------------------|-----------------------------------------------|----------------------------------------|------------------------------------------|-------------------|
| Defense One           | defenseone.com           | `defenseone`           | `/athena/curate/defenseonetrendingitem/`      | `/athena/curate/defenseoneskyboxitem/` | `/athena/curate/defenseoneearthboxitem/` | 548               |
| GovExec               | govexec.com              | `govexec`              | `/athena/curate/govexectrendingitem/`         | `/athena/curate/govexecskyboxitem/`    | `/athena/curate/govexecearthboxitem/`    | 501               |
| Nextgov               | nextgov.com              | `nextgov`              | `/athena/curate/nextgovtrendingitem/`         | `/athena/curate/nextgovskyboxitem/`    | `/athena/curate/nextgovearthboxitem/`    | 494               |
| Route Fifty           | route-fifty.com          | `routefifty`           | `/athena/curate/routefiftytrendingtopicitem/` | `/athena/curate/routefiftyskyboxitem/` | `/athena/curate/routefiftyearthboxitem/` | 510               |
| Washington Technology | washingtontechnology.com | `washingtontechnology` | `/athena/curate/wttrendingitem/`              | `/athena/curate/wtskyboxitem/`         | `/athena/curate/wtearthboxitem/`         | 621               |

Per-pub automation config is managed in the **GE360 Pub Config** Google Sheet (see SETUP.md). Scripts read from it at runtime via `pub-config.php`. To add a pub: fill in its row (including `base_url` and `topic_oref`), then set `trending_enabled`/`earthbox_enabled` to TRUE — no new PHP files needed, the shared endpoints handle all pubs via `?pub={pub_key}`.

**Per-pub values needed for each pub** (confirmed vs. still needed):

| Pub | GA4 Property | Article topic oref | Grappelli app_label | Grappelli model | topic_content_type | Status |
|---|---|---|---|---|---|---|
| Defense One | `353836589` (acct `395628`) | `oref=d1-article-topics` | `post_manager` | `defenseonetopic` | `382` | ✓ live |
| Washington Technology | `358726868` | `oref=wt-article-topics` | `core` | `topic` | TBD | in sheet, disabled; base_url + topic_oref filled, topic_content_type + slack + API URLs still needed |
| GovExec | TBD | likely `oref=govexec-article-topics` | TBD | TBD | TBD | not started |
| Nextgov | TBD | likely `oref=nextgov-article-topics` | TBD | TBD | TBD | not started |
| Route Fifty | TBD | likely `oref=routefifty-article-topics` | TBD | TBD | TBD | not started |

**Key learnings from D1 and WT discovery:**
- D1 topics use `app_label=post_manager`, but WT uses `app_label=core` — do NOT assume `post_manager` for new pubs; always confirm via Network tab on the CMS Topics autocomplete field
- `grappelli_topic_model` pattern is NOT consistent: D1 = `defenseonetopic`, WT = `topic` — inspect each pub
- `topic_content_type` is a Django integer that varies per pub/app — find it by watching the POST form data when saving a Trending item in the CMS, or by checking `admin.govexec.com/admin/contenttypes/contenttype/` if you have superuser access
- Article topic oref pattern `oref={pub}-article-topics` holds for D1 and WT (confirmed); likely holds for others but verify by inspecting a live article page
- D1 note: article tags appear twice in DOM (desktop/mobile) — deduplicate by slug. Check if this applies to other pubs.
- DO NOT use GA4 property `529112613` — that's the extension's own analytics, not a pub property

**Defense One GA4:** account `395628`, property `353836589`

Key technical details
---------------------

**CMS / Grappelli** - Athena is Django + Grappelli admin - Grappelli autocomplete URL: `GET /grappelli/lookup/autocomplete/?term={name}&app_label={grappelli_app_label}&model_name={grappelli_topic_model}&query_string=t=id` — returns `[{"value": 32, "label": "Iran (Defense One)"}]` - `app_label` and `model_name` vary per pub (see table above) — always confirm via Network tab before adding a new pub - D1-Trending edit form fields: `content_type` (382), `object_id`, `status`, `live_date`, `expiration_date`, `url`, `title_override` - Earthbox edit form: `content_type` (22 = Post, same for all pubs), `object_id` (post ID), `status`, `live_date_0/1`, override fields, `_is_sponsored_content` checkbox (use this — not `title_override` — to detect sponsored wall slots). `image_override` deleted on save so post's featured image is used.

**GA4** - Auth: OAuth refresh token at `/home/bradwu/ga4-oauth.json` on server - Scoring: `score = month_views + week_views + day_views` - Click tracking orefs: `oref=d1-article-topics` (Trending Topics nav links), `oref=d1-earthbox-post` (Earthbox widget links on article pages) — per-pub topic oref stored in `topic_oref` sheet column, used by `trending-topics.php` to identify topic tags during article scraping

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
subject `Earthbox: Changes|Unchanged|Problem`, body bullet list with sponsored
slots inline as `SPONSORED: …` (items new to the list are bolded). Proactive
`Earthbox: Session expiring soon` warning shares the same self-calibrating
timeout logic as `apply-trending.js`. GA4 click tracking via
`oref=d1-earthbox-post` (confirmed present on D1 article pages); monthly
baseline being established via `scripts/earthbox-baseline.js`. See SETUP.md.

## Planned features
see PLANNED.md
