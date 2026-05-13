<?php
// =============================================================
// earthbox-posts.php — GE360 Earthbox Posts API
// Upload to: navybook.com/D1/seo/earthbox-posts.php
//
// Queries GA4 for top article pages (day / week / month),
// extracts post IDs and titles, weights by recency, and
// returns the top 6 articles as JSON.
//
// Usage: earthbox-posts.php?pub=defenseone  (defaults to defenseone)
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
$CREDS_FILE  = '/home/bradwu/ga4-oauth.json';
$GA4_PROPERTY = (string) $pub['ga4_property_id'];
$BASE_URL    = rtrim($pub['base_url'], '/');
$CACHE_FILE  = "/home/bradwu/earthbox-cache-{$pub_key}.json";
$TITLE_CACHE = "/home/bradwu/earthbox-title-cache-{$pub_key}.json";
$CACHE_TTL   = 3600;    // 1 hour
$TITLE_TTL   = 86400;   // 24 hours
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

// ── 2. Recent-staff mode ──────────────────────────────────────
// Mode is passed explicitly by the caller (apply-earthbox.js / apply-skybox.js).
// Fall back to pub config's earthbox_post_mode if not provided.
$mode_param = strtolower(preg_replace('/[^a-z_]/', '', $_GET['mode'] ?? ''));
$post_mode  = in_array($mode_param, ['ga4', 'recent_staff'], true)
    ? $mode_param
    : ($pub['earthbox_post_mode'] ?? 'ga4');

if ($post_mode === 'recent_staff') {
    if (empty($pub['rss_url']) || empty($pub['org_name'])) {
        die(json_encode(['error' => 'post_mode is recent_staff but rss_url or org_name is missing from pub config']));
    }
    $title_cache = file_exists($TITLE_CACHE)
        ? (json_decode(file_get_contents($TITLE_CACHE), true) ?? [])
        : [];

    $results = fetch_recent_staff_posts($pub, $title_cache, $TITLE_TTL, $TOP_N);

    file_put_contents($TITLE_CACHE, json_encode($title_cache));
    $output = ['posts' => $results, 'generated_at' => date('c'), 'mode' => 'recent_staff'];
    file_put_contents($CACHE_FILE, json_encode(['ts' => time(), 'data' => $output]));
    echo json_encode($output);
    exit;
}

// ── 3. OAuth access token ─────────────────────────────────────
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

// ── 4. Three GA4 queries (month / week / day) ─────────────────
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
    preg_match('#/(\d{5,7})/?$#', $path, $m);
    $v['post_id'] = $m[1] ?? null;
}
unset($v);

$all_paths = array_filter($all_paths, fn($v) => $v['post_id'] !== null);
uasort($all_paths, fn($a, $b) => $b['score'] <=> $a['score']);
$candidates = array_slice($all_paths, 0, $TOP_N * 4, true);

// ── 5. Fetch article titles and check for sponsored content ───
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
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; GE360EarthboxBot/1.0)',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 12,
    ]);
    foreach ($html_map as $url => $html) {
        $title_cache[$url] = [
            'ts'        => time(),
            'title'     => extract_title($html),
            'sponsored' => is_sponsored($html, $url),
        ];
    }
    file_put_contents($TITLE_CACHE, json_encode($title_cache));
}

// ── 6. Build ranked list; filter sponsored; take top N ────────
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

// ── 7. Cache and return ───────────────────────────────────────
$output = ['posts' => $results, 'generated_at' => date('c')];
file_put_contents($CACHE_FILE, json_encode(['ts' => time(), 'data' => $output]));
echo json_encode($output);


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
        if (preg_match('#/\d{5,7}/?$#', $path) && strpos($path, '/topic/') === false) {
            $pages[$path] = $views;
            if (count($pages) >= $limit) break;
        }
    }
    return $pages;
}

function extract_title(string $html): string {
    if (!$html) return '';
    $dom = new DOMDocument();
    @$dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOERROR | LIBXML_NOWARNING);
    foreach ($dom->getElementsByTagName('h1') as $h1) {
        $text = trim($h1->textContent);
        if ($text && strlen($text) > 10) return $text;
    }
    foreach ($dom->getElementsByTagName('title') as $t) {
        $text = preg_replace('/\s*[-|·].*$/u', '', $t->textContent);
        $text = trim($text);
        if ($text) return $text;
    }
    return '';
}

function is_sponsored(string $html, string $url = ''): bool {
    if (!$html) return false;
    // Check URL path first — real sponsored articles live under /sponsors/.
    // Do NOT match 'sponsor-content' in HTML: WT's skybox links to sponsored
    // articles on every page, causing false positives on editorial content.
    if ($url && str_contains(parse_url($url, PHP_URL_PATH) ?? '', '/sponsors/')) return true;
    return str_contains($html, 'brandlab')
        || str_contains($html, '"sponsored":true');
}

function path_to_title(string $path): string {
    $parts = array_filter(explode('/', $path));
    foreach (array_reverse($parts) as $part) {
        if (preg_match('/^\d+$/', $part)) continue;
        if (preg_match('/^\d{4}$/', $part)) continue;
        if (strlen($part) <= 2) continue;
        return ucwords(str_replace('-', ' ', $part));
    }
    return 'Article';
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

function fetch_recent_staff_posts(array $pub, array &$title_cache, int $title_ttl, int $top_n): array {
    $rss_url  = $pub['rss_url'];
    $org_name = $pub['org_name'];

    // Fetch RSS feed
    $ch = curl_init($rss_url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; GE360EarthboxBot/1.0)',
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $rss_xml = curl_exec($ch);
    curl_close($ch);

    if (!$rss_xml) return [];

    $xml = @simplexml_load_string($rss_xml);
    if (!$xml) return [];

    // Parse <item> elements (RSS 2.0); try <link> then <guid>
    $items = [];
    foreach ($xml->channel->item as $item) {
        $link = (string)$item->link;
        if (!$link) $link = (string)$item->guid;
        if (!$link) continue;
        $path = parse_url($link, PHP_URL_PATH) ?: '';
        if (strpos($path, '/topic/') !== false) continue;
        preg_match('#/(\d{5,7})/?$#', $path, $m);
        if (!isset($m[1])) continue;
        $items[] = ['link' => $link, 'post_id' => $m[1], 'path' => $path];
    }

    // Skip 5 most recent; cap candidates to avoid excessive fetches
    if (count($items) <= 5) return [];
    $candidates = array_slice($items, 5, $top_n * 4);

    // Determine which article pages need fetching (missing or stale org data)
    $to_fetch = [];
    foreach ($candidates as $item) {
        $cached = $title_cache[$item['link']] ?? null;
        if (!$cached || (time() - $cached['ts']) > $title_ttl || !isset($cached['org'])) {
            $to_fetch[] = $item['link'];
        }
    }

    if ($to_fetch) {
        $html_map = curl_multi_get($to_fetch, [
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; GE360EarthboxBot/1.0)',
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 12,
        ]);
        foreach ($html_map as $url => $html) {
            $title_cache[$url] = [
                'ts'        => time(),
                'title'     => extract_title($html),
                'sponsored' => is_sponsored($html, $url),
                'org'       => extract_org($html),
            ];
        }
    }

    $results = [];
    foreach ($candidates as $item) {
        if (count($results) >= $top_n) break;
        $cached    = $title_cache[$item['link']] ?? null;
        $sponsored = $cached['sponsored'] ?? false;
        $org       = $cached['org'] ?? '';
        if ($sponsored) continue;
        if ($org !== $org_name) continue;
        $results[] = [
            'post_id' => (int)$item['post_id'],
            'title'   => ($cached['title'] ?? '') ?: path_to_title($item['path']),
            'path'    => $item['path'],
            'score'   => 0,
        ];
    }
    return $results;
}

function extract_org(string $html): string {
    if (!$html) return '';
    if (preg_match_all('/<script[^>]+type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/i', $html, $matches)) {
        foreach ($matches[1] as $json_str) {
            $data = json_decode($json_str, true);
            if (!$data) continue;
            $nodes = isset($data['@graph']) ? $data['@graph'] : [$data];
            foreach ($nodes as $node) {
                if (isset($node['publisher']['name'])) return $node['publisher']['name'];
                if (isset($node['sourceOrganization']['name'])) return $node['sourceOrganization']['name'];
            }
        }
    }
    return '';
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
