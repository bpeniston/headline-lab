<?php
// =============================================================
// trending-topics.php — Defense One Trending Topics API
// Upload to: navybook.com/D1/seo/trending-topics.php
//
// Queries GA4 for top article pages (day / week / month),
// scrapes topic tags from each article, weights by recency,
// and returns the top 7 topics as JSON.
// =============================================================

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: https://admin.govexec.com');
header('Access-Control-Allow-Methods: GET');

// ── Config ────────────────────────────────────────────────────
$CREDS_FILE      = '/home/bradwu/ga4-oauth.json';
$GA4_PROPERTY    = '353836589';
$MAIN_CACHE      = '/home/bradwu/trending-main-cache.json';
$ARTICLE_CACHE   = '/home/bradwu/trending-article-cache.json';
$TOPIC_NAME_CACHE= '/home/bradwu/trending-topicname-cache.json';
$MAIN_CACHE_TTL  = 3600;    // 1 hour  — re-run GA4 + scrape
$ARTICLE_TTL     = 86400;   // 24 hours — article→topics mapping
$TOPICNAME_TTL   = 604800;  // 7 days  — slug→display name mapping
$BASE_URL        = 'https://www.defenseone.com';
$TOP_N           = 7;

// Topics to never surface as Trending (slugs or display names, case-insensitive)
$EXCLUDED_TOPICS = ['commentary'];
$MAX_MONTH       = 80;      // top N article pages from month query
$MAX_WEEK        = 40;      // top N from week query
$MAX_DAY         = 20;      // top N from day query

// ── 1. Main cache check ───────────────────────────────────────
if (isset($_GET['nocache'])) {
    // allow cache-busting for debugging: ?nocache=1
} elseif (file_exists($MAIN_CACHE)) {
    $c = json_decode(file_get_contents($MAIN_CACHE), true);
    if ($c && isset($c['ts']) && (time() - $c['ts']) < $MAIN_CACHE_TTL) {
        echo json_encode($c['data']); exit;
    }
}

// ── 2. OAuth access token ──────────────────────────────────────
$creds = json_decode(@file_get_contents($CREDS_FILE), true);
if (!$creds || !isset($creds['client_id'])) {
    die(json_encode(['error' => 'Cannot read GA4 credentials file']));
}

$tok = http_post('https://oauth2.googleapis.com/token', [
    'client_id'     => $creds['client_id'],
    'client_secret' => $creds['client_secret'],
    'refresh_token' => $creds['refresh_token'],
    'grant_type'    => 'refresh_token',
]);
$access_token = $tok['access_token'] ?? null;
if (!$access_token) {
    die(json_encode(['error' => 'OAuth token refresh failed', 'detail' => $tok]));
}

// ── 3. Three GA4 queries (month / week / day) ─────────────────
// Each returns top article paths for that window with pageview counts.
// We merge the results; a path's score = month_views + week_views + day_views.
$month_pages = ga4_top_pages($access_token, $GA4_PROPERTY, '30daysAgo', 'today', $MAX_MONTH);
$week_pages  = ga4_top_pages($access_token, $GA4_PROPERTY, '7daysAgo',  'today', $MAX_WEEK);
$day_pages   = ga4_top_pages($access_token, $GA4_PROPERTY, '1daysAgo',  'today', $MAX_DAY);

// Merge into a single path → [month, week, day] map
$all_paths = [];
foreach ($month_pages as $path => $views) {
    $all_paths[$path]['month'] = $views;
}
foreach ($week_pages as $path => $views) {
    $all_paths[$path]['week'] = $views;
}
foreach ($day_pages as $path => $views) {
    $all_paths[$path]['day'] = $views;
}

// Fill in missing windows with 0
foreach ($all_paths as $path => &$v) {
    $v += ['month' => 0, 'week' => 0, 'day' => 0];
    $v['score'] = $v['month'] + $v['week'] + $v['day'];
}
unset($v);

// ── 4. Fetch article topics (parallelised, cached) ─────────────
$article_cache = file_exists($ARTICLE_CACHE)
    ? (json_decode(file_get_contents($ARTICLE_CACHE), true) ?? [])
    : [];

// Identify which URLs need a fresh scrape
$to_fetch = [];
foreach ($all_paths as $path => $_) {
    $url = $BASE_URL . $path;
    $cached = $article_cache[$url] ?? null;
    if (!$cached || (time() - $cached['ts']) > $ARTICLE_TTL) {
        $to_fetch[] = $url;
    }
}

// Parallel fetch
if ($to_fetch) {
    $html_map = curl_multi_get($to_fetch, [
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; D1TrendingBot/1.0)',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 12,
    ]);
    foreach ($html_map as $url => $html) {
        $article_cache[$url] = [
            'ts'     => time(),
            'topics' => extract_topics($html),
        ];
    }
    file_put_contents($ARTICLE_CACHE, json_encode($article_cache));
}

// ── 5. Resolve display names for any unknown slugs ─────────────
// If link text was empty on the article page, fetch the topic landing page.
$name_cache = file_exists($TOPIC_NAME_CACHE)
    ? (json_decode(file_get_contents($TOPIC_NAME_CACHE), true) ?? [])
    : [];

$slugs_needing_names = [];
foreach ($all_paths as $path => $_) {
    $url    = $BASE_URL . $path;
    $topics = $article_cache[$url]['topics'] ?? [];
    foreach ($topics as $slug => $label) {
        if (!$label && !isset($name_cache[$slug])) {
            $slugs_needing_names[$slug] = true;
        }
    }
}

if ($slugs_needing_names) {
    $topic_urls = [];
    foreach (array_keys($slugs_needing_names) as $slug) {
        $topic_urls[$slug] = $BASE_URL . '/topic/' . $slug . '/';
    }
    $topic_html = curl_multi_get(array_values($topic_urls), [
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; D1TrendingBot/1.0)',
        CURLOPT_TIMEOUT   => 8,
    ]);
    // Flip to slug → html
    $slug_url_map = array_flip($topic_urls);
    foreach ($topic_html as $url => $html) {
        $slug = $slug_url_map[$url] ?? null;
        if (!$slug || !$html) continue;
        $name = extract_heading($html) ?: slug_to_title($slug);
        $name_cache[$slug] = $name;
    }
    file_put_contents($TOPIC_NAME_CACHE, json_encode($name_cache));
}

// ── 6. Score topics ────────────────────────────────────────────
$topic_scores = [];

foreach ($all_paths as $path => $views) {
    $url    = $BASE_URL . $path;
    $topics = $article_cache[$url]['topics'] ?? [];
    if (!$topics) continue;

    foreach ($topics as $slug => $label) {
        // Resolve display name
        $display = $label
            ?: ($name_cache[$slug] ?? slug_to_title($slug));

        // Skip excluded topics
        if (in_array(strtolower($slug), $EXCLUDED_TOPICS) ||
            in_array(strtolower($display), $EXCLUDED_TOPICS)) continue;

        if (!isset($topic_scores[$slug])) {
            $topic_scores[$slug] = [
                'slug'  => $slug,
                'label' => $display,
                'month' => 0,
                'week'  => 0,
                'day'   => 0,
                'score' => 0,
            ];
        }
        $topic_scores[$slug]['month'] += $views['month'];
        $topic_scores[$slug]['week']  += $views['week'];
        $topic_scores[$slug]['day']   += $views['day'];
        $topic_scores[$slug]['score'] += $views['score'];
    }
}

// Sort by score, take top 7
usort($topic_scores, fn($a, $b) => $b['score'] <=> $a['score']);
$top_topics = array_slice($topic_scores, 0, $TOP_N);

// ── 7. Build and cache response ────────────────────────────────
$result = [
    'topics'       => $top_topics,
    'generated_at' => date('c'),
];
file_put_contents($MAIN_CACHE, json_encode(['ts' => time(), 'data' => $result]));
echo json_encode($result);


// =============================================================
// HELPERS
// =============================================================

/** Query GA4 for top article page paths in a date range.
 *  Returns [ pagePath => pageviews ] filtered to article URLs. */
function ga4_top_pages(string $token, string $property,
                       string $start, string $end, int $limit): array {
    $url  = "https://analyticsdata.googleapis.com/v1beta/properties/{$property}:runReport";
    $body = [
        'dateRanges' => [['startDate' => $start, 'endDate' => $end]],
        'dimensions' => [['name' => 'pagePath']],
        'metrics'    => [['name' => 'screenPageViews']],
        'orderBys'   => [['metric' => ['metricName' => 'screenPageViews'], 'desc' => true]],
        'limit'      => $limit * 3, // fetch extra to account for non-article pages
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $res  = curl_exec($ch);
    curl_close($ch);
    $data = json_decode($res, true);

    $pages = [];
    foreach ($data['rows'] ?? [] as $row) {
        $path  = $row['dimensionValues'][0]['value'];
        $views = (int)($row['metricValues'][0]['value'] ?? 0);
        // Filter: D1 article URLs end with a 5–6-digit numeric ID
        if (preg_match('#/\d{5,6}/?$#', $path)) {
            $pages[$path] = $views;
            if (count($pages) >= $limit) break;
        }
    }
    return $pages;
}

/** POST form-encoded data, return decoded JSON. */
function http_post(string $url, array $fields): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($fields),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    return json_decode($res, true) ?? [];
}

/** Fetch multiple URLs in parallel. Returns [ url => html ] */
function curl_multi_get(array $urls, array $extra_opts = []): array {
    $mh = curl_multi_init();
    $handles = [];
    foreach ($urls as $url) {
        $ch = curl_init($url);
        $opts = $extra_opts + [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
        ];
        curl_setopt_array($ch, $opts);
        curl_multi_add_handle($mh, $ch);
        $handles[$url] = $ch;
    }
    $running = null;
    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh);
    } while ($running > 0);

    $results = [];
    foreach ($handles as $url => $ch) {
        $results[$url] = curl_multi_getcontent($ch);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $results;
}

/** Extract topic slugs + labels from article HTML.
 *  Looks for <a href="/topic/{slug}/?oref=d1-article-topics">Label</a> */
function extract_topics(string $html): array {
    if (!$html) return [];
    $topics = [];
    $dom    = new DOMDocument();
    @$dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
    foreach ($dom->getElementsByTagName('a') as $a) {
        $href = $a->getAttribute('href');
        if (strpos($href, 'oref=d1-article-topics') === false) continue;
        if (!preg_match('#/topic/([^/?]+)#', $href, $m)) continue;
        $slug  = $m[1];
        $label = trim($a->textContent);
        if ($slug) {
            // Store label even if empty; we'll resolve later
            $topics[$slug] = $label ?: null;
        }
    }
    return $topics;
}

/** Extract the page heading from topic landing-page HTML. */
function extract_heading(string $html): string {
    if (!$html) return '';
    $dom = new DOMDocument();
    @$dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
    // Try <h1> first
    $h1s = $dom->getElementsByTagName('h1');
    foreach ($h1s as $h1) {
        $text = trim($h1->textContent);
        if ($text) return $text;
    }
    // Fall back to <title>, stripping site suffix
    $titles = $dom->getElementsByTagName('title');
    foreach ($titles as $t) {
        $text = preg_replace('/\s*[-|].*$/u', '', $t->textContent);
        $text = trim($text);
        if ($text) return $text;
    }
    return '';
}

/** Last-resort: convert slug to Title Case. */
function slug_to_title(string $slug): string {
    return ucwords(str_replace('-', ' ', $slug));
}
