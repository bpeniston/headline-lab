# Athena Tools — Planned Features

## Earthbox auto-updater
✓ **Deployed 2026-04-10.** Runs as a launchd job on the Air at 5:30am nightly.

**Key implementation notes:**
- POST requires `_save`, tracking pixel formset management form, and `suppress_label` preserved from GET
- `image_override` deleted on each save so post's own featured image is used
- Sponsored wall detected via `_is_sponsored_content` checkbox (not `title_override`)
- Post ID extracted from GA4 page path (5–7 digit number)

## Expand to full GE360 family (Trending Topics)
Currently only Defense One is configured. Each additional pub needs:
- GA4 property ID (need GA4 access permissions)
- Grappelli model name (get from autocomplete field on that pub's trending item edit page)
- Article topic oref (likely `oref={pub}-article-topics`; confirm by inspecting a live article page)
- content_type integer for Topic (may differ per pub; get from edit page form)
