<?php
// ============================================================
// prefill.php  —  Bookmarklet relay
// Accepts a POST from the bookmarklet, stores article text in
// a PHP session, then redirects to index.html which reads it.
// ============================================================

session_start();

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.html');
    exit;
}

// Basic origin check — only accept requests from the Athena admin domain
// Uncomment and adjust if you want to lock this down further
// $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
// if ($origin !== 'https://admin.govexec.com') {
//     http_response_code(403);
//     exit('Forbidden');
// }

$text = $_POST['text'] ?? '';

// Sanitize: strip tags, trim whitespace, cap at 50,000 characters
$text = trim(strip_tags($text));
$text = mb_substr($text, 0, 50000);

if (strlen($text) > 10) {
    $_SESSION['prefill'] = $text;
}

// Redirect to the tool
header('Location: index.php');
exit;
