<?php
// heartbeat.php — receives a ping from the Air every 10 minutes.
// Writes the current Unix timestamp to ~/air-heartbeat.txt.
// Protected by a shared key so the endpoint isn't hit accidentally.
// Checked at 4:50am by air-check.py before nightly jobs run.

$expected_key = 'hl-heartbeat-2026';

if (($_GET['key'] ?? '') !== $expected_key) {
    http_response_code(403);
    exit('forbidden');
}

$file = '/home/bradwu/air-heartbeat.txt';
file_put_contents($file, time() . "\n");
echo 'ok';
