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
(comma-separated). Re-login alert sent if session expired. See SETUP.md.

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

**Defense One specifics (only pub fully configured so far):** - GA4 property:
`353836589` (account `395628`) — do NOT use `529112613` (extension's own
analytics) - Article topic oref: `oref=d1-article-topics`; article tags appear
twice in DOM (desktop/mobile) — deduplicate by slug - Grappelli autocomplete
model: `app_label=post_manager&model_name=defenseonetopic` - CMS content_type
for Topic: `382`; for Post: `22`

**Other pubs still need:** GA4 property IDs, Grappelli model names, topic oref
values, content_type integers. (Pattern is likely `oref={pub}-article-topics`;
confirm by inspecting a live article page.)

Key technical details
---------------------

**CMS / Grappelli** - Athena is Django + Grappelli admin - Grappelli
autocomplete: `GET
/grappelli/lookup/autocomplete/?term={name}&app_label=post_manager&model_name=defenseonetopic&query_string=t=id`
Returns: `[{"value": 32, "label": "Iran (Defense One)"}]` - D1-Trending edit
form fields: `content_type` (382), `object_id`, `status`, `live_date`,
`expiration_date`, `url`, `title_override` - Earthbox edit form: `content_type`
(22 = Post), `object_id` (post ID), `status`, `live_date_0/1`, override fields,
`_is_sponsored_content` checkbox (use this — not `title_override` — to detect
sponsored wall slots). `image_override` deleted on save so post's featured image
is used.

**GA4** - Auth: OAuth refresh token at `/home/bradwu/ga4-oauth.json` on server -
Scoring: `score = month_views + week_views + day_views` - Click tracking orefs:
`oref=d1-article-topics` (Trending Topics nav links), `oref=d1-earthbox-post`
(Earthbox widget links on article pages)

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
slots inline as `SPONSORED: …`. GA4 click tracking via `oref=d1-earthbox-post`
(confirmed present on D1 article pages); monthly baseline being established
via `scripts/earthbox-baseline.js`. See SETUP.md.

## Planned features
see PLANNED.md
