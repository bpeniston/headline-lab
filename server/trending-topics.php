<?php
// =============================================================
// trending-topics.php — GE360 Trending Topics API
// Upload to: navybook.com/D1/seo/trending-topics.php
//
// Queries GA4 for top article pages (day / week / month),
// scrapes topic tags from each article, weights by recency,
// and returns the top 7 topics as JSON.
//
// Usage: trending-topics.php?pub=defenseone  (defaults to defenseone)
// =============================================================

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: https://admin.govexec.com');
header('Access-Control-Allow-Methods: GET');

define('PUB_CONFIG_INCLUDED', true);
require_once __DIR__ . '/pub-config.php';

// ── Resolve pub config ────────────────────────────────────────
$pub_key = preg_replace('/[^a-z0-9]/', '', strtolower($_GET['pub'] ?? 'defenseone'));
$pub = find_pub($pub_key);
if (!$pub) {
    http_response_code(400);
    die(json_encode(['error' => "Unknown or invalid pub: $pub_key"]));
}

// ── Config ────────────────────────────────────────────────────
$CREDS_FILE       = '/home/bradwu/ga4-oauth.json';
$GA4_PROPERTY     = (string) $pub['ga4_property_id'];
$BASE_URL         = rtrim($pub['base_url'], '/');
$TOPIC_OREF       = $pub['topic_oref'];
$MAIN_CACHE       = "/home/bradwu/trending-main-cache-{$pub_key}.json";
$ARTICLE_CACHE    = "/home/bradwu/trending-article-cache-{$pub_key}.json";
$TOPIC_NAME_CACHE = "/home/bradwu/trending-topicname-cache-{$pub_key}.json";
$MAIN_CACHE_TTL   = 3600;    // 1 hour  — re-run GA4 + scrape
$ARTICLE_TTL      = 86400;   // 24 hours — article→topics mapping
$TOPICNAME_TTL    = 604800;  // 7 days  — slug→display name mapping
$TOP_N            = 7;

$EXCLUDED_TOPICS = ['commentary'];
$MAX_MONTH       = 80;
$MAX_WEEK        = 40;
$MAX_DAY         = 20;

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
$month_pages = ga4_top_pages($access_token, $GA4_PROPERTY, '30daysAgo', 'today', $MAX_MONTH);
$week_pages  = ga4_top_pages($access_token, $GA4_PROPERTY, '7daysAgo',  'today', $MAX_WEEK);
$day_pages   = ga4_top_pages($access_token, $GA4_PROPERTY, '1daysAgo',  'today', $MAX_DAY);

$all_paths = [];
foreach ($month_pages as $path => $views) $all_paths[$path]['month'] = $views;
foreach ($week_pages  as $path => $views) $all_paths[$path]['week']  = $views;
foreach ($day_pages   as $path => $views) $all_paths[$path]['day']   = $views;

foreach ($all_paths as $path => &$v) {
    $v += ['month' => 0, 'week' => 0, 'day' => 0];
    $v['score'] = $v['month'] + $v['week'] + $v['day'];
}
unset($v);

// ── 4. Fetch article topics (parallelised, cached) ─────────────
$article_cache = file_exists($ARTICLE_CACHE)
    ? (json_decode(file_get_contents($ARTICLE_CACHE), true) ?? [])
    : [];

$to_fetch = [];
foreach ($all_paths as $path => $_) {
    $url = $BASE_URL . $path;
    $cached = $article_cache[$url] ?? null;
    if (!$cached || (time() - $cached['ts']) > $ARTICLE_TTL) {
        $to_fetch[] = $url;
    }
}

if ($to_fetch) {
    $html_map = curl_multi_get($to_fetch, [
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; GE360TrendingBot/1.0)',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 12,
    ]);
    foreach ($html_map as $url => $html) {
        $article_cache[$url] = [
            'ts'     => time(),
            'topics' => extract_topics($html, $TOPIC_OREF),
        ];
    }
    file_put_contents($ARTICLE_CACHE, json_encode($article_cache));
}

// ── 5. Resolve display names for any unknown slugs ─────────────
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
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; GE360TrendingBot/1.0)',
        CURLOPT_TIMEOUT   => 8,
    ]);
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
        $display = $label ?: ($name_cache[$slug] ?? slug_to_title($slug));

        if (in_array(strtolower($slug), $EXCLUDED_TOPICS) ||
            in_array(strtolower($display), $EXCLUDED_TOPICS)) continue;

        if (!isset($topic_scores[$slug])) {
            $topic_scores[$slug] = [
                'slug'  => $slug,
                'label' => $display,
                'month' => 0, 'week' => 0, 'day' => 0, 'score' => 0,
            ];
        }
        $topic_scores[$slug]['month'] += $views['month'];
        $topic_scores[$slug]['week']  += $views['week'];
        $topic_scores[$slug]['day']   += $views['day'];
        $topic_scores[$slug]['score'] += $views['score'];
    }
}

usort($topic_scores, fn($a, $b) => $b['score'] <=> $a['score']);
$top_topics = array_slice($topic_scores, 0, $TOP_N);

// ── 7. Build and cache response ────────────────────────────────
$result = ['topics' => $top_topics, 'generated_at' => date('c')];
file_put_contents($MAIN_CACHE, json_encode(['ts' => time(), 'data' => $result]));
echo json_encode($result);


// =============================================================
// HELPERS
// =============================================================

function ga4_top_pages(string $token, string $property,
                       string $start, string $end, int $limit): array {
    $url  = "https://analyticsdata.googleapis.com/v1beta/properties/{$property}:runReport";
    $body = [
        'dateRanges' => [['startDate' => $start, 'endDate' => $end]],
        'dimensions' => [['name' => 'pagePath']],
        'metrics'    => [['name' => 'screenPageViews']],
        'orderBys'   => [['metric' => ['metricName' => 'screenPageViews'], 'desc' => true]],
        'limit'      => $limit * 3,
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
        if (preg_match('#/\d{5,6}/?$#', $path)) {
            $pages[$path] = $views;
            if (count($pages) >= $limit) break;
        }
    }
    return $pages;
}

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

function curl_multi_get(array $urls, array $extra_opts = []): array {
    $mh = curl_multi_init();
    $handles = [];
    foreach ($urls as $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, $extra_opts + [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
        ]);
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

/** Extract topic slugs + labels from article HTML using pub-specific oref. */
function extract_topics(string $html, string $oref): array {
    if (!$html) return [];
    $topics = [];
    $dom    = new DOMDocument();
    @$dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
    foreach ($dom->getElementsByTagName('a') as $a) {
        $href = $a->getAttribute('href');
        if (strpos($href, 'oref=' . $oref) === false) continue;
        if (!preg_match('#/topic/([^/?]+)#', $href, $m)) continue;
        $slug  = $m[1];
        $label = trim($a->textContent);
        if ($slug) $topics[$slug] = $label ?: null;
    }
    return $topics;
}

function extract_heading(string $html): string {
    if (!$html) return '';
    $dom = new DOMDocument();
    @$dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
    foreach ($dom->getElementsByTagName('h1') as $h1) {
        $text = trim($h1->textContent);
        if ($text) return $text;
    }
    foreach ($dom->getElementsByTagName('title') as $t) {
        $text = preg_replace('/\s*[-|].*$/u', '', $t->textContent);
        $text = trim($text);
        if ($text) return $text;
    }
    return '';
}

function slug_to_title(string $slug): string {
    return ucwords(str_replace('-', ' ', $slug));
}
