# Athena Tools — Planned Features

## Trending Topics — impact study (ongoing)

Pre-launch baseline (Oct 2025–Mar 2026 avg): ~3,078 clicks/mo via `oref=d1-article-topics`. Automation launched ~Apr 8 2026. April settled at 1,885 (anomalously low; cause TBD). May 2026 = first full clean post-launch month.

Interpretation thresholds for May:
- Below 3,078 → no lift; investigate topic selection quality and launchd reliability
- 3,078–4,065 → holding trend; automation working, not yet adding measurable lift
- Above 4,065 → clear lift above pre-launch peak

**Next steps:**
- Pull end-of-May data manually to confirm first full clean post-launch month
- Once May and June data are in, assess whether automation is producing measurable lift
- Consider adding topic quality signal (CTR per slot) as a secondary metric if volume alone is ambiguous

## Expand to full GE360 family (Trending Topics)

All 5 pubs have `trending_enabled = TRUE` and fetch topics successfully. To fully activate each non-D1 pub, the GA4 `topic_oref` needs to be validated (confirm by inspecting a live article page for the correct `oref=` parameter). GA4 stats Slack is D1-only until other pubs' orefs are confirmed.

## Add Post — SEO slug generator button

A button on the Add Post page (`server/add-post.html`) that, when clicked, sends the current headline, subheadline, and body copy to the API and returns the single best SEO slug, then replaces the contents of the slug field.

Slug rules: lowercase, hyphens, drop stop words, lead with the primary keyword, 4–6 words max. Use the same Claude call as headline generation, or a lightweight `?mode=slug` variant of `seo-api.php`.

**Implementation notes:**
- Button sits adjacent to the slug input field in the left pane
- If the slug field already has content, prompt before overwriting (or use a "re-generate" icon)
- The slug field auto-generates from the headline on keystroke today — this is a deliberate override for when the auto-slug isn't keyword-optimal
- **Only show the button when the post has not yet been published** — check the status field; hide if status is `Live`. Show on both `/post/add/` and `/post/NNN/change/` as long as the post hasn't gone live. Overwriting the slug of a published post would break existing URLs.

## Headline Lab — SEO prompt improvements

Research session 2026-04-11 identified these improvements (changes 1–6 were implemented; 7–11 remain):

**7. Split headline into H1 + SEO title tag** — Add a `title_tag` field to the JSON output alongside `headline`. The H1 (display) is 50–65 chars, editorial. The title tag (SERP) is 60–70 chars, keyword-mechanical, with primary keyword in first 40 chars. Needs frontend changes to display/copy both.

**8. Add `og_title` output field** — Open Graph title for Discover/social shares; ~50–75 chars, curiosity-gap/aspirational. **Blocked:** Athena has no `og_title` field — it's auto-generated from `title` at the template level with no override. Requires the govexec dev team to add an optional `og_title_override` CharField to the Post model.

**9. Add `content_type` parameter (breaking / analysis / feature / evergreen)** — Each type needs a different headline strategy. Breaking: short-tail, literal, freshness wins. Analysis: long-tail, signal format ("what it means"). Evergreen: expertise framing, year signal. Implement as a prompt branch in `handle_headlines()`.

**10. Add few-shot examples to the prompt** — 2–3 good defense-journalism examples with rationale + 1 anti-example (cablese, question-form). Anthropic docs show this "dramatically improves accuracy and consistency."

**11. Switch prompt delimiters to XML tags** — Replace `---` with `<article>`, `<lede_facts>`, `<competing_headlines>` for unambiguous Claude parsing.
