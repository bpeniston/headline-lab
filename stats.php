<?php
// stats.php — returns usage counts from the log file
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

$log_file = '/home/bradwu/headline-lab-usage.log';
$today    = date('Y-m-d');

$counts = [
    'headlines_today'    => 0,
    'headlines_alltime'  => 0,
    'social_today'       => 0,
    'social_alltime'     => 0,
    'email_today'        => 0,
    'email_alltime'      => 0,
];

if (file_exists($log_file)) {
    $lines = file($log_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $parts  = explode("\t", $line);
        $date   = isset($parts[0]) ? substr($parts[0], 0, 10) : '';
        $action = $parts[1] ?? '';

        if ($action === 'headlines') {
            $counts['headlines_alltime']++;
            if ($date === $today) $counts['headlines_today']++;
        } elseif ($action === 'social') {
            $counts['social_alltime']++;
            if ($date === $today) $counts['social_today']++;
        } elseif ($action === 'email_subjects') {
            $counts['email_alltime']++;
            if ($date === $today) $counts['email_today']++;
        }
    }
}

echo json_encode($counts);