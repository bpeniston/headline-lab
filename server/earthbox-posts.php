<?php
// =============================================================
// earthbox-posts.php — Defense One Earthbox Posts API
// Upload to: navybook.com/D1/seo/earthbox-posts.php
//
// Queries GA4 for top article pages (day / week / month),
// extracts post IDs and titles, weights by recency, and
// returns the top 6 articles as JSON.
//
// Scoring: score = month_views + week_views + day_views
// Filters: must have 5–7 digit post ID in path; no /topic/ landers;
//          no sponsored/brandlab posts (detected from page HTML).
// =============================================================

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: https://admin.govexec.com');
header('Access-Control-Allow-Methods: GET');

// Allow calls from the Air automation script (no Referer header)
$referer = $_SERVER['HTTP_REFERER'] ?? '';
if ($referer && !str_starts_with($referer, 'https://admin.govexec.com/')) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// ── Config ────────────────────────────────────────────────────
$CREDS_FILE  = '/home/bradwu/ga4-oauth.json';
$GA4_PROPERTY = '353836589';
$CACHE_FILE  = '/home/bradwu/earthbox-cache.json';
$TITLE_CACHE = '/home/bradwu/earthbox-title-cache.json';
$CACHE_TTL   = 3600;    // 1 hour
$TITLE_TTL   = 86400;   // 24 hours
$BASE_URL    = 'https://www.defenseone.com';
$TOP_N       = 6;       // 5 editorial slots + 1 backup
$MAX_MONTH   = 80;
$MAX_WEEK    = 40;
$MAX_DAY     = 20;

// ── 1. Main cache check ───────────────────────────────────────
if (!isset($_GET['nocache']) && file_exists($CACHE_FILE)) {
    $c = json_decode(file_get_contents($CACHE_FILE), true);
    if ($c && isset($c['ts']) && (time() - $c['ts']) < $CACHE_TTL) {
        echo json_encode($c['data']); exit;
    }
}

// ── 2. OAuth access token ─────────────────────────────────────
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

// Merge; score = month + week + day (recency-weighted)
$all_paths = [];
foreach ($month_pages as $path => $views) $all_paths[$path]['month'] = $views;
foreach ($week_pages  as $path => $views) $all_paths[$path]['week']  = $views;
foreach ($day_pages   as $path => $views) $all_paths[$path]['day']   = $views;

foreach ($all_paths as $path => &$v) {
    $v += ['month' => 0, 'week' => 0, 'day' => 0];
    $v['score'] = $v['month'] + $v['week'] + $v['day'];
    preg_match('#/(\d{5,7})/?$#', $path, $m);
    $v['post_id'] = $m[1] ?? null;
}
unset($v);

// Remove any paths without a valid numeric post ID
$all_paths = array_filter($all_paths, fn($v) => $v['post_id'] !== null);

// Sort by score descending
uasort($all_paths, fn($a, $b) => $b['score'] <=> $a['score']);

// Take a generous buffer of candidates to allow for filtering
$candidates = array_slice($all_paths, 0, $TOP_N * 4, true);

// ── 4. Fetch article titles and check for sponsored content ───
$title_cache = file_exists($TITLE_CACHE)
    ? (json_decode(file_get_contents($TITLE_CACHE), true) ?? [])
    : [];

$to_fetch = [];
foreach (array_keys($candidates) as $path) {
    $url = $BASE_URL . $path;
    $cached = $title_cache[$url] ?? null;
    if (!$cached || (time() - $cached['ts']) > $TITLE_TTL) {
        $to_fetch[] = $url;
    }
}

if ($to_fetch) {
    $html_map = curl_multi_get($to_fetch, [
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; D1EarthboxBot/1.0)',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 12,
    ]);
    foreach ($html_map as $url => $html) {
        $title_cache[$url] = [
            'ts'        => time(),
            'title'     => extract_title($html),
            'sponsored' => is_sponsored($html),
        ];
    }
    file_put_contents($TITLE_CACHE, json_encode($title_cache));
}

// ── 5. Build ranked list; filter sponsored; take top N ────────
$results = [];
foreach ($candidates as $path => $data) {
    if (count($results) >= $TOP_N) break;
    $url       = $BASE_URL . $path;
    $cached    = $title_cache[$url] ?? null;
    $title     = ($cached['title'] ?? '') ?: path_to_title($path);
    $sponsored = $cached['sponsored'] ?? false;

    if ($sponsored) continue;

    $results[] = [
        'post_id' => (int)$data['post_id'],
        'title'   => $title,
        'path'    => $path,
        'score'   => $data['score'],
        'month'   => $data['month'],
        'week'    => $data['week'],
        'day'     => $data['day'],
    ];
}

// ── 6. Cache and return ───────────────────────────────────────
$output = ['posts' => $results, 'generated_at' => date('c')];
file_put_contents($CACHE_FILE, json_encode(['ts' => time(), 'data' => $output]));
echo json_encode($output);


// =============================================================
// HELPERS
// =============================================================

/** Query GA4 for top article page paths.
 *  Filters to paths with a 5–7-digit post ID; excludes /topic/ landers. */
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
        // Must end with 5–7-digit post ID; must not be a topic lander
        if (preg_match('#/\d{5,7}/?$#', $path) && strpos($path, '/topic/') === false) {
            $pages[$path] = $views;
            if (count($pages) >= $limit) break;
        }
    }
    return $pages;
}

/** Extract the article headline from page HTML. */
function extract_title(string $html): string {
    if (!$html) return '';
    $dom = new DOMDocument();
    @$dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
    foreach ($dom->getElementsByTagName('h1') as $h1) {
        $text = trim($h1->textContent);
        if ($text && strlen($text) > 10) return $text;
    }
    // Fall back to <title>, stripping site name suffix
    foreach ($dom->getElementsByTagName('title') as $t) {
        $text = preg_replace('/\s*[-|·].*$/u', '', $t->textContent);
        $text = trim($text);
        if ($text) return $text;
    }
    return '';
}

/** Detect sponsored/branded content from article HTML. */
function is_sponsored(string $html): bool {
    if (!$html) return false;
    return str_contains($html, 'sponsor-content')
        || str_contains($html, 'brandlab')
        || str_contains($html, '"sponsored":true')
        || (bool)preg_match('/class="[^"]*\bsponsored\b/i', $html);
}

/** Last-resort: derive a readable title from the URL path slug. */
function path_to_title(string $path): string {
    $parts = array_filter(explode('/', $path));
    foreach (array_reverse($parts) as $part) {
        if (preg_match('/^\d+$/', $part)) continue;  // skip numeric ID
        if (preg_match('/^\d{4}$/', $part)) continue; // skip year
        if (strlen($part) <= 2) continue;
        return ucwords(str_replace('-', ' ', $part));
    }
    return 'Article';
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
