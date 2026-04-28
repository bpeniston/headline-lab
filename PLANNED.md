# Athena Tools — Planned Features

## GE360 daily updates page
✓ **Deployed 2026-04-28.** `https://navybook.com/D1/updates/` — daily digest of nightly script results across all five pubs. Files: `server/updates/index.php`, `help.html`, `updates.css`, `server/save-update.php`.

## Earthbox auto-updater
✓ **Deployed 2026-04-10.** Runs as a launchd job on the Air at 5:30am nightly.

**Key implementation notes:**
- POST requires `_save`, tracking pixel formset management form, and `suppress_label` preserved from GET
- `image_override` deleted on each save so post's own featured image is used
- Sponsored wall detected via `_is_sponsored_content` checkbox (not `title_override`)
- Post ID extracted from GA4 page path (5–7 digit number)

## Headline Lab — SEO prompt improvements (future)

Research session 2026-04-11 identified these improvements to the headline generator, not yet implemented:

**7. Split headline into H1 + SEO title tag** — Add a `title_tag` field to the JSON output alongside `headline`. The H1 (display) is 50-65 chars, editorial. The title tag (SERP) is 60-70 chars, keyword-mechanical, with primary keyword in first 40 chars. Needs frontend changes to display/copy both.

**8. Add `og_title` output field** — Open Graph title for Discover/social shares. Should be curiosity-gap/aspirational ("feature-y"), ~50-75 chars. **Blocked: Athena has no `og_title` field on the Post model.** Inspected post 412741 on 2026-04-11 — the CMS form has no og:title, social title, or meta title override anywhere (confirmed via full form field audit). og:title is auto-generated from `title` at the template level with no bypass. Requires the Athena/govexec dev team to add an optional `social_title` or `og_title_override` CharField to the Post model, with the template falling back to `title` if unset.

**9. Add `content_type` parameter (breaking / analysis / feature / evergreen)** — Each type needs a different headline strategy. Breaking: short-tail, literal, freshness wins. Analysis: long-tail (3-5 word phrases), signal format ("what it means"). Evergreen: expertise framing, year signal. Implement as a prompt branch in `handle_headlines()`.

**10. Add few-shot headline examples to the prompt** — 2-3 good defense-journalism examples with rationale + 1 anti-example (cablese, question-form). Anthropic docs show this "dramatically improves accuracy and consistency."

**11. Switch prompt delimiters to XML tags** — Replace `---` with `<article>`, `<lede_facts>`, `<competing_headlines>` for unambiguous Claude parsing.

## Expand to full GE360 family (Trending Topics + Earthbox)
D1 and WT are fully live (trending + earthbox). To enable the remaining three pubs, add Slack config only (slack_channel + slack_email in the sheet) and set trending_enabled/earthbox_enabled to TRUE — all other config values are already filled in.

| Pub | Remaining |
|---|---|
| GovExec | Slack config only |
| Nextgov | Slack config only |
| Route Fifty | Slack config only; also verify `topic_content_type` 164 (unconfirmed — item had no pre-selected topic when set) |
