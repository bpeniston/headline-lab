<?php
// =============================================================
// scripts/update-baselines.php  (one-off maintenance script)
// Rewrites topics_baseline / earthbox_baseline / skybox_baseline
// in the GE360 Pub Config sheet with freshly-measured 12-month
// pre-automation averages (Apr 2025–Mar 2026), measured as
// screenPageViews where fullPageUrl CONTAINS oref=<oref> — the
// SAME metric pub-stats.php / monthly-report.js use, so the
// monthly "vs baseline" deltas are internally consistent.
//
// Source of figures: scripts/pull-impact-report.js "Base avg".
//
// Locates rows by pub_key and columns by header name (never
// hardcoded positions), so it is robust to column reordering.
//
// Usage (run on the server, where the service-account key lives):
//   php update-baselines.php           dry run — prints old→new
//   php update-baselines.php --apply   writes the cells
// =============================================================

define('KEY_FILE',   '/home/bradwu/navybook.com/D1/auto-updater/sheets-service-account.json');
define('SHEET_ID',   '1wLKVepPr8w6sZgiIa4dcgEDwmpQvHQqDE7yv3btvRp0');
define('TAB',        'Pubs');
define('CACHE_FILE', '/home/bradwu/navybook.com/D1/auto-updater/pub-config-cache.json');

$APPLY = in_array('--apply', $argv, true);

// Freshly-measured 12-mo averages (clicks/mo).
$NEW = [
  'defenseone' => ['topics_baseline' => 2586, 'earthbox_baseline' => 1842, 'skybox_baseline' => 6233],
  'washtech'   => ['topics_baseline' => 1136, 'earthbox_baseline' => 437,  'skybox_baseline' => 3721],
  'govexec'    => ['topics_baseline' => 7130, 'earthbox_baseline' => 3475, 'skybox_baseline' => 39444],
  'nextgov'    => ['topics_baseline' => 1401, 'earthbox_baseline' => 926,  'skybox_baseline' => 5500],
  'routefifty' => ['topics_baseline' => 917,  'earthbox_baseline' => 191,  'skybox_baseline' => 622],
];

function base64url($d) { return rtrim(strtr(base64_encode($d), '+/', '-_'), '='); }

function getToken($scope) {
  if (!file_exists(KEY_FILE)) { fwrite(STDERR, "Service account key not found at " . KEY_FILE . "\n"); exit(1); }
  $key = json_decode(file_get_contents(KEY_FILE), true);
  $now = time();
  $h = base64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
  $c = base64url(json_encode([
    'iss'   => $key['client_email'],
    'scope' => $scope,
    'aud'   => 'https://oauth2.googleapis.com/token',
    'iat'   => $now,
    'exp'   => $now + 3600,
  ]));
  $toSign = "$h.$c";
  openssl_sign($toSign, $sig, $key['private_key'], 'SHA256');
  $jwt = "$toSign." . base64url($sig);
  $ch = curl_init('https://oauth2.googleapis.com/token');
  curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
    CURLOPT_RETURNTRANSFER => true,
  ]);
  $r = json_decode(curl_exec($ch), true);
  curl_close($ch);
  if (empty($r['access_token'])) { fwrite(STDERR, "Auth failed: " . json_encode($r) . "\n"); exit(1); }
  return $r['access_token'];
}

function sheetsGet($token, $range) {
  $ch = curl_init('https://sheets.googleapis.com/v4/spreadsheets/' . SHEET_ID . '/values/' . urlencode($range));
  curl_setopt_array($ch, [CURLOPT_HTTPHEADER => ["Authorization: Bearer $token"], CURLOPT_RETURNTRANSFER => true]);
  $r = json_decode(curl_exec($ch), true);
  curl_close($ch);
  if (isset($r['error'])) { fwrite(STDERR, "GET error: " . $r['error']['message'] . "\n"); exit(1); }
  return isset($r['values']) ? $r['values'] : [];
}

function colLetter($i) { // 0-based index -> A, B, ... Z, AA, ...
  $s = ''; $i++;
  while ($i > 0) { $m = ($i - 1) % 26; $s = chr(65 + $m) . $s; $i = intval(($i - 1) / 26); }
  return $s;
}

$scope = $APPLY ? 'https://www.googleapis.com/auth/spreadsheets'
                : 'https://www.googleapis.com/auth/spreadsheets.readonly';
$token = getToken($scope);
$rows  = sheetsGet($token, TAB . '!A:Z');
if (!$rows) { fwrite(STDERR, "Sheet empty / no values returned\n"); exit(1); }

$headers = array_map('trim', $rows[0]);
$colIdx  = array_flip($headers);
foreach (['pub_key', 'topics_baseline', 'earthbox_baseline', 'skybox_baseline'] as $need) {
  if (!isset($colIdx[$need])) { fwrite(STDERR, "Missing column header: $need\n"); exit(1); }
}
$pkCol = $colIdx['pub_key'];

$updates = [];
printf("%-12s %-18s %-10s    %-10s\n", 'pub', 'column', 'old', 'new');
echo str_repeat('-', 56) . "\n";
for ($r = 1; $r < count($rows); $r++) {
  $row = $rows[$r];
  $pk  = isset($row[$pkCol]) ? trim($row[$pkCol]) : '';
  if (!isset($NEW[$pk])) continue;
  $rowNum = $r + 1; // 1-based sheet row
  foreach ($NEW[$pk] as $col => $val) {
    $ci  = $colIdx[$col];
    $old = isset($row[$ci]) ? $row[$ci] : '';
    printf("%-12s %-18s %-10s -> %-10s\n", $pk, $col, ($old === '' ? '(blank)' : $old), $val);
    $updates[] = ['range' => TAB . '!' . colLetter($ci) . $rowNum, 'values' => [[$val]]];
  }
}

if (!$APPLY) {
  echo "\nDRY RUN — " . count($updates) . " cells would change. Re-run with --apply to write.\n";
  exit(0);
}

$body = json_encode(['valueInputOption' => 'RAW', 'data' => $updates]);
$ch = curl_init('https://sheets.googleapis.com/v4/spreadsheets/' . SHEET_ID . '/values:batchUpdate');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_HTTPHEADER     => ["Authorization: Bearer $token", "Content-Type: application/json"],
  CURLOPT_POSTFIELDS     => $body,
  CURLOPT_RETURNTRANSFER => true,
]);
$resp = json_decode(curl_exec($ch), true);
curl_close($ch);
if (isset($resp['error'])) { fwrite(STDERR, "WRITE error: " . $resp['error']['message'] . "\n"); exit(1); }
echo "\n✓ Updated " . (isset($resp['totalUpdatedCells']) ? $resp['totalUpdatedCells'] : '?') . " cells.\n";
if (file_exists(CACHE_FILE)) { @unlink(CACHE_FILE); echo "Cache busted (" . CACHE_FILE . ").\n"; }
