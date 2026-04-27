<?php
// ============================================================
// pub-stats.php — Returns one month's click counts for a pub.
// Replaces the D1-only monthly-stats.php and earthbox-stats.php.
//
// Required params:
//   ?pub=defenseone        pub_key from Google Sheet
//   &type=topics|earthbox  which oref to count
//   &token=...             secret from .headline-lab-config.ini
// Optional:
//   &start=YYYY-MM-DD      explicit date range (defaults to prev month)
//   &end=YYYY-MM-DD
//
// Returns: { month, views, start, end, pub, type }
// ============================================================

header('Content-Type: application/json');

$config = parse_ini_file('/home/bradwu/.headline-lab-config.ini');
$token  = $_GET['token'] ?? '';
if ($token !== ($config['monthly_stats_token'] ?? '')) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

$pub_key = preg_replace('/[^a-z0-9]/', '', strtolower($_GET['pub'] ?? ''));
$type    = $_GET['type'] ?? '';
if (!$pub_key || !in_array($type, ['topics', 'earthbox'], true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Required params: pub, type (topics|earthbox)']);
    exit;
}

define('PUB_CONFIG_INCLUDED', true);
require_once __DIR__ . '/pub-config.php';

$pub = find_pub($pub_key);
if (!$pub) {
    http_response_code(400);
    echo json_encode(['error' => "Unknown or invalid pub: $pub_key"]);
    exit;
}

$ga4_property = (string) $pub['ga4_property_id'];
$oref = $type === 'topics'
    ? ($pub['topic_oref']   ?? '')
    : ($pub['earthbox_oref'] ?? '');

if (!$oref) {
    http_response_code(400);
    echo json_encode(['error' => "No oref configured for $pub_key / $type"]);
    exit;
}

// ── OAuth access token ────────────────────────────────────────
$creds = json_decode(file_get_contents('/home/bradwu/ga4-oauth.json'), true);
$ch = curl_init('https://oauth2.googleapis.com/token');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POSTFIELDS     => http_build_query([
        'client_id'     => $creds['client_id'],
        'client_secret' => $creds['client_secret'],
        'refresh_token' => $creds['refresh_token'],
        'grant_type'    => 'refresh_token',
    ]),
]);
$resp = json_decode(curl_exec($ch), true);
curl_close($ch);
$access_token = $resp['access_token'] ?? null;
if (!$access_token) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to refresh GA4 token']);
    exit;
}

// ── Date range ────────────────────────────────────────────────
if (!empty($_GET['start']) && !empty($_GET['end'])) {
    $start = $_GET['start'];
    $end   = $_GET['end'];
} else {
    $first_of_this_month = date('Y-m-01');
    $end   = date('Y-m-d', strtotime($first_of_this_month . ' -1 day'));
    $start = date('Y-m-01', strtotime($end));
}
$month_label = date('F Y', strtotime($start));

// ── GA4 query ─────────────────────────────────────────────────
$payload = json_encode([
    'dateRanges'      => [['startDate' => $start, 'endDate' => $end]],
    'dimensions'      => [],
    'metrics'         => [['name' => 'screenPageViews']],
    'dimensionFilter' => [
        'filter' => [
            'fieldName'    => 'fullPageUrl',
            'stringFilter' => ['matchType' => 'CONTAINS', 'value' => 'oref=' . $oref],
        ],
    ],
]);

$ch = curl_init("https://analyticsdata.googleapis.com/v1beta/properties/{$ga4_property}:runReport");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ' . $access_token,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => $payload,
]);
$result = json_decode(curl_exec($ch), true);
curl_close($ch);

$views = (int)($result['rows'][0]['metricValues'][0]['value'] ?? 0);

echo json_encode([
    'pub'   => $pub_key,
    'type'  => $type,
    'month' => $month_label,
    'views' => $views,
    'start' => $start,
    'end'   => $end,
]);
