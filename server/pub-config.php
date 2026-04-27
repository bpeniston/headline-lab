<?php
// pub-config.php — GE360 publication config from Google Sheet.
// Returns: { "pubs": [...], "errors": [...] }
// "errors" lists rows with bad data; scripts log them and skip invalid rows.
// Used by apply-trending.js and apply-earthbox.js.

header('Content-Type: application/json');

define('KEY_FILE',    '/home/bradwu/sheets-service-account.json');
define('SHEET_ID',    '1wLKVepPr8w6sZgiIa4dcgEDwmpQvHQqDE7yv3btvRp0');
define('SHEET_RANGE', 'Pubs!A:O');
define('CACHE_FILE',  '/home/bradwu/pub-config-cache.json');
define('CACHE_TTL',   3600);  // 1 hour

$REQUIRED_COLUMNS = [
    'pub_name', 'pub_key', 'trending_enabled', 'earthbox_enabled',
    'trending_cms_path', 'earthbox_cms_path', 'ga4_property_id',
    'grappelli_topic_model', 'grappelli_app_label', 'topic_content_type',
    'slack_channel', 'slack_email', 'trending_api_url', 'earthbox_api_url',
];

// ── Cache ──────────────────────────────────────────────────────────────────
function readCache() {
    if (!file_exists(CACHE_FILE)) return null;
    $data = json_decode(file_get_contents(CACHE_FILE), true);
    if (!$data || (time() - ($data['ts'] ?? 0)) > CACHE_TTL) return null;
    return $data['payload'];
}
function writeCache($payload) {
    file_put_contents(CACHE_FILE, json_encode(['ts' => time(), 'payload' => $payload]));
}

// ── Google service account auth ────────────────────────────────────────────
function base64url($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function getAccessToken() {
    if (!file_exists(KEY_FILE)) throw new Exception('Service account key not found at ' . KEY_FILE);
    $key = json_decode(file_get_contents(KEY_FILE), true);
    if (!$key || empty($key['private_key'])) throw new Exception('Invalid service account key file');

    $now    = time();
    $header = base64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = base64url(json_encode([
        'iss'   => $key['client_email'],
        'scope' => 'https://www.googleapis.com/auth/spreadsheets.readonly',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $toSign = "$header.$claims";
    if (!openssl_sign($toSign, $sig, $key['private_key'], 'SHA256')) {
        throw new Exception('Failed to sign JWT — check private key in service account file');
    }
    $jwt = "$toSign." . base64url($sig);

    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    if (empty($resp['access_token'])) {
        throw new Exception('Failed to get access token: ' . json_encode($resp));
    }
    return $resp['access_token'];
}

// ── Fetch sheet rows ───────────────────────────────────────────────────────
function fetchSheetValues($token) {
    $url = 'https://sheets.googleapis.com/v4/spreadsheets/' . SHEET_ID .
           '/values/' . urlencode(SHEET_RANGE);
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ["Authorization: Bearer $token"],
        CURLOPT_RETURNTRANSFER => true,
    ]);
    $resp = json_decode(curl_exec($ch), true);
    curl_close($ch);

    if (isset($resp['error'])) {
        throw new Exception('Sheets API error: ' . $resp['error']['message']);
    }
    return $resp['values'] ?? [];
}

// ── Parse and validate rows ────────────────────────────────────────────────
function parseRows($rows, $requiredCols) {
    if (empty($rows)) throw new Exception('Sheet appears to be empty');

    // Validate header row — catches renamed or deleted columns early
    $headers = array_map('trim', $rows[0]);
    $missing = array_diff($requiredCols, $headers);
    if ($missing) {
        throw new Exception(
            'Missing required column headers: ' . implode(', ', $missing) .
            '. A column may have been renamed or deleted. Restore it to fix this error.'
        );
    }

    $pubs   = [];
    $errors = [];

    for ($i = 2; $i < count($rows); $i++) {  // row 2 is reserved for column descriptions
        $row    = $rows[$i];
        $rowNum = $i + 1;

        // Pad short rows to avoid undefined offset errors
        while (count($row) < count($headers)) $row[] = '';

        $r = [];
        foreach ($headers as $j => $col) {
            $r[$col] = trim($row[$j] ?? '');
        }

        // Skip blank rows silently
        if ($r['pub_name'] === '' && $r['pub_key'] === '') continue;

        $rowErrors = [];

        // Required string fields
        foreach (['pub_name', 'pub_key', 'trending_cms_path', 'earthbox_cms_path',
                  'grappelli_topic_model', 'grappelli_app_label', 'slack_channel',
                  'slack_email', 'trending_api_url', 'earthbox_api_url'] as $col) {
            if ($r[$col] === '') $rowErrors[] = "missing $col";
        }

        // Boolean fields — Google Sheets exports TRUE/FALSE in caps
        foreach (['trending_enabled', 'earthbox_enabled'] as $col) {
            $v = strtoupper($r[$col]);
            if ($v !== 'TRUE' && $v !== 'FALSE') {
                $rowErrors[] = "$col must be TRUE or FALSE (got: \"{$r[$col]}\")";
            } else {
                $r[$col] = ($v === 'TRUE');
            }
        }

        // Integer fields
        foreach (['ga4_property_id', 'topic_content_type'] as $col) {
            if ($r[$col] === '') {
                $rowErrors[] = "missing $col";
            } elseif (!ctype_digit($r[$col])) {
                $rowErrors[] = "$col must be a whole number (got: \"{$r[$col]}\")";
            } else {
                $r[$col] = (int) $r[$col];
            }
        }

        // URL fields
        foreach (['trending_api_url', 'earthbox_api_url'] as $col) {
            if ($r[$col] !== '' && !filter_var($r[$col], FILTER_VALIDATE_URL)) {
                $rowErrors[] = "$col is not a valid URL (got: \"{$r[$col]}\")";
            }
        }

        if ($rowErrors) {
            $label    = $r['pub_name'] ?: "row $rowNum";
            $errors[] = "Row $rowNum ($label): " . implode('; ', $rowErrors);
            $r['_valid'] = false;
        } else {
            $r['_valid'] = true;
        }

        $pubs[] = $r;
    }

    return ['pubs' => $pubs, 'errors' => $errors];
}

// ── Main ───────────────────────────────────────────────────────────────────
try {
    $cached = readCache();
    if ($cached) { echo json_encode($cached); exit; }

    $token  = getAccessToken();
    $values = fetchSheetValues($token);
    $result = parseRows($values, $REQUIRED_COLUMNS);
    writeCache($result);
    echo json_encode($result);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
