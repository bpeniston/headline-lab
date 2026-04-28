<?php
// =============================================================
// save-update.php — receives daily update records from the Air
// apply scripts and stores them for the updates display page.
//
// POST fields:
//   secret   — shared secret (from ~/.update-secret on server)
//   pub_key  — e.g. "defenseone"
//   type     — "trending" or "earthbox"
//   status   — "Changed", "Unchanged", or "Problem"
//   new      — JSON array of new labels/titles
//   old      — JSON array of old labels/titles
//   errors   — JSON array of error strings
// =============================================================

header('Content-Type: application/json');

// Secret lives outside the web root (never in git)
$secretFile = '/home/bradwu/.update-secret';
$expected   = trim(@file_get_contents($secretFile) ?: '');
if (!$expected || ($_POST['secret'] ?? '') !== $expected) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

$pubKey   = preg_replace('/[^a-z0-9_-]/', '', $_POST['pub_key'] ?? '');
$type     = in_array($_POST['type'] ?? '', ['trending', 'earthbox']) ? $_POST['type'] : '';
$status   = in_array($_POST['status'] ?? '', ['Changed', 'Unchanged', 'Problem']) ? $_POST['status'] : 'Problem';
$newItems = json_decode($_POST['new']    ?? '[]', true) ?: [];
$oldItems = json_decode($_POST['old']    ?? '[]', true) ?: [];
$errors   = json_decode($_POST['errors'] ?? '[]', true) ?: [];

if (!$pubKey || !$type) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing pub_key or type']);
    exit;
}

$date     = date('Y-m-d');
$dataFile = "/home/bradwu/ge360-updates-{$date}.json";

$fp = fopen($dataFile, 'c+');
if (!$fp) {
    http_response_code(500);
    echo json_encode(['error' => 'Could not open data file']);
    exit;
}

if (flock($fp, LOCK_EX)) {
    $raw  = stream_get_contents($fp);
    $data = ($raw !== false && $raw !== '') ? (json_decode($raw, true) ?: []) : [];

    if (!isset($data['date'])) $data['date'] = $date;
    if (!isset($data['pubs'])) $data['pubs'] = [];

    $data['pubs'][$pubKey][$type] = [
        'status'  => $status,
        'new'     => $newItems,
        'old'     => $oldItems,
        'errors'  => $errors,
        'updated' => date('c'),
    ];

    rewind($fp);
    ftruncate($fp, 0);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT));
    flock($fp, LOCK_UN);
}
fclose($fp);

echo json_encode(['ok' => true]);
