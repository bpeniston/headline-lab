<?php
// ============================================================
// earthbox-stats.php — Returns previous month's pageviews for
// article links with oref=d1-earthbox-post via GA4 Data API.
// Called by scripts/monthly-report.js on the Air.
// ============================================================

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Called server-to-server from the Air — restrict by secret token.
$token = $_GET['token'] ?? '';
$config = parse_ini_file('/home/bradwu/.headline-lab-config.ini');
if ($token !== ($config['monthly_stats_token'] ?? '')) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// ── OAuth: refresh access token ───────────────────────────────
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

// ── Date range: previous calendar month ──────────────────────
$first_of_this_month = date('Y-m-01');
$last_month_end      = date('Y-m-d', strtotime($first_of_this_month . ' -1 day'));
$last_month_start    = date('Y-m-01', strtotime($last_month_end));
$month_label         = date('F Y', strtotime($last_month_end));

// ── GA4 query ─────────────────────────────────────────────────
$payload = json_encode([
    'dateRanges' => [['startDate' => $last_month_start, 'endDate' => $last_month_end]],
    'dimensions' => [],
    'metrics'    => [['name' => 'screenPageViews']],
    'dimensionFilter' => [
        'filter' => [
            'fieldName'    => 'fullPageUrl',
            'stringFilter' => ['matchType' => 'CONTAINS', 'value' => 'oref=d1-earthbox-post'],
        ],
    ],
]);

$ch = curl_init('https://analyticsdata.googleapis.com/v1beta/properties/353836589:runReport');
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
    'month'  => $month_label,
    'views'  => $views,
    'start'  => $last_month_start,
    'end'    => $last_month_end,
]);
