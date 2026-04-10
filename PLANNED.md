# Athena Tools — Planned Features

## Earthbox auto-updater
Populate the 5 editorial Earthbox slots with top GA4 articles, scored by `month_views + week_views + day_views` (same weighting as Trending Topics). Runs as a launchd job on the Air at 5:30am (30 min after Trending).

**Scripts:**
- `server/earthbox-posts.php` — GA4 queries, title scraping, sponsored filtering, returns top 6
- `scripts/apply-earthbox.js` — Playwright apply script (--setup, --dry-run flags)
- `scripts/com.navybook.earthbox-apply.plist` — launchd plist

**Candidate filtering — exclude:**
- Homepage, topic landers (`/topic/` in path), non-article paths
- Sponsored/native-ad posts — detect via `_is_sponsored_content` checkbox (not `title_override`)

**Notes:**
- Post ID extracted from GA4 page path (5–7 digit number, e.g. `/policy/2024/03/title/123456/`)
- `image_override` deleted on each save so post's own featured image is used
- No Grappelli autocomplete needed — post ID already known from GA4
- Article oref: `oref=d1-earthbox-post`

## Expand to full GE360 family (Trending Topics)
Currently only Defense One is configured. Each additional pub needs:
- GA4 property ID (need GA4 access permissions)
- Grappelli model name (get from autocomplete field on that pub's trending item edit page)
- Article topic oref (likely `oref={pub}-article-topics`; confirm by inspecting a live article page)
- content_type integer for Topic (may differ per pub; get from edit page form)
