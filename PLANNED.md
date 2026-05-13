# Athena Tools — Planned Features

## Skybox/Earthbox — alternate post-selection mode (`recent_staff`)
✓ **Deployed 2026-05-13.** `post_mode` column added to the GE360 Pub Config Sheet. When set to `recent_staff`, `earthbox-posts.php` fetches the pub's RSS feed, skips the 5 most recent posts, and returns the next 6 whose `publisher.name` in JSON-LD matches `org_name` in the sheet — featuring only staff-written content. Sponsored CMS slots are still never replaced. `ga4` (traffic-weighted) remains the default. GovExec is the first pub using this mode.

**New sheet columns:** `post_mode` (W), `org_name` (X), `rss_url` (Y). Confirmed `org_name` values: Defense One → `Defense One`, GovExec → `Government Executive`, Nextgov → `Nextgov/FCW`, Route Fifty → `Route Fifty`, Washington Technology → `Washington Technology`. All five pubs use `/rss/all/` as the feed path.

## Earthbox auto-updater
✓ **Deployed 2026-04-13.** Runs as a launchd job on the Air at 5:30am nightly.

**Key implementation notes:**
- POST requires `_save`, tracking pixel formset management form, and `suppress_label` preserved from GET
- `image_override` deleted on each save so post's own featured image is used
- Sponsored wall detected via `_is_sponsored_content` checkbox (not `title_override`)
- Post ID extracted from GA4 page path (5–7 digit number)

## Trending Topics — GA4 click stats in nightly Slack
✓ **Deployed 2026-05-08.** `apply-trending.js` now sends a follow-up `Topics: Stats`
Slack message after each nightly CMS update. Shows D1 MTD clicks (with projected
full-month total) plus the two prior months for trend comparison. Query validated
against manually-pulled GA4 data (March figure matched exactly at 4,065).

**Next steps for stats:**
- Pull end-of-May data manually to confirm first full clean post-launch month
- Once May and June data are in, assess whether automation is producing measurable lift vs the pre-launch 3,078/mo avg and 4,065 March peak
- Consider adding topic quality signal (CTR per slot) as a secondary metric if volume alone is ambiguous

## Trending Topics — impact study (ongoing)
Pre-launch baseline (Oct 2025–Mar 2026 avg): ~3,078 clicks/mo via `oref=d1-article-topics`.
Automation launched ~Apr 8 2026. April settled at 1,885 (anomalously low; cause TBD).
May 2026 = first full clean post-launch month.

Interpretation thresholds for May:
- Below 3,078 → no lift; investigate topic selection quality and launchd reliability
- 3,078–4,065 → holding trend; automation working, not yet adding measurable lift
- Above 4,065 → clear lift above pre-launch peak

## Headline Lab — SEO prompt improvements (future)

Research session 2026-04-11 identified these improvements to the headline generator, not yet implemented:

**7. Split headline into H1 + SEO title tag** — Add a `title_tag` field to the JSON output alongside `headline`. The H1 (display) is 50-65 chars, editorial. The title tag (SERP) is 60-70 chars, keyword-mechanical, with primary keyword in first 40 chars. Needs frontend changes to display/copy both.

**8. Add `og_title` output field** — Open Graph title for Discover/social shares. Should be curiosity-gap/aspirational ("feature-y"), ~50-75 chars. **Blocked: Athena has no `og_title` field on the Post model.** Inspected post 412741 on 2026-04-11 — the CMS form has no og:title, social title, or meta title override anywhere (confirmed via full form field audit). og:title is auto-generated from `title` at the template level with no bypass. Requires the Athena/govexec dev team to add an optional `social_title` or `og_title_override` CharField to the Post model, with the template falling back to `title` if unset.

**9. Add `content_type` parameter (breaking / analysis / feature / evergreen)** — Each type needs a different headline strategy. Breaking: short-tail, literal, freshness wins. Analysis: long-tail (3-5 word phrases), signal format ("what it means"). Evergreen: expertise framing, year signal. Implement as a prompt branch in `handle_headlines()`.

**10. Add few-shot headline examples to the prompt** — 2-3 good defense-journalism examples with rationale + 1 anti-example (cablese, question-form). Anthropic docs show this "dramatically improves accuracy and consistency."

**11. Switch prompt delimiters to XML tags** — Replace `---` with `<article>`, `<lede_facts>`, `<competing_headlines>` for unambiguous Claude parsing.

## Expand to full GE360 family (Trending Topics)
Currently only Defense One is configured. Each additional pub needs:
- GA4 property ID (need GA4 access permissions)
- Grappelli model name (get from autocomplete field on that pub's trending item edit page)
- Article topic oref (likely `oref={pub}-article-topics`; confirm by inspecting a live article page)
- content_type integer for Topic (may differ per pub; get from edit page form)

Note: as of 2026-05-08, the dry-run shows all 5 pubs fetching topics successfully
(D1, WT, GovExec, Nextgov, Route Fifty) — trending_enabled appears to be set TRUE
for all in the sheet. GA4 stats Slack is D1-only until other pubs' orefs are validated.
