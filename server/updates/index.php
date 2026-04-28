<?php
// =============================================================
// updates/index.php — GE360 automated updates display page
// Reads today's JSON from /home/bradwu/ge360-updates-YYYY-MM-DD.json
// and pub config from pub-config.php to show all pubs' daily results.
// =============================================================

$date    = date('Y-m-d');
$today   = date('F j, Y');

// ── Load today's update data ──────────────────────────────────
$dataFile = "/home/bradwu/ge360-updates-{$date}.json";
$pubData  = [];
if (file_exists($dataFile)) {
    $raw     = file_get_contents($dataFile);
    $updates = $raw ? (json_decode($raw, true) ?: []) : [];
    $pubData = $updates['pubs'] ?? [];
}

// ── Load pub config (uses server-side 1-hour cache) ──────────
$pubs = [];
$configRaw = @file_get_contents('https://www.navybook.com/D1/seo/pub-config.php');
if ($configRaw) {
    $config = json_decode($configRaw, true);
    $pubs   = $config['pubs'] ?? [];
}

// ── Sort: active pubs first (alpha), then inactive (alpha) ────
function parseBool($v): bool {
    return filter_var($v ?? false, FILTER_VALIDATE_BOOLEAN);
}
usort($pubs, function($a, $b) {
    $aActive = parseBool($a['trending_enabled'] ?? false) || parseBool($a['earthbox_enabled'] ?? false);
    $bActive = parseBool($b['trending_enabled'] ?? false) || parseBool($b['earthbox_enabled'] ?? false);
    if ($aActive !== $bActive) return $aActive ? -1 : 1;
    return strcmp($a['pub_name'] ?? '', $b['pub_name'] ?? '');
});

// ── Pub abbreviations (for nav and anchors) ───────────────────
$pubAbbrevs = [
    'defenseone'  => 'D1',
    'govexec'     => 'GE',
    'nextgov'     => 'NG',
    'routefifty'  => 'R50',
    'washtech'    => 'WT',
];
$navOrder = ['defenseone', 'govexec', 'nextgov', 'routefifty', 'washtech'];

// ── Render helpers ────────────────────────────────────────────
function statusBadge(string $status): string {
    $class = match($status) {
        'Changed'   => 'badge-changed',
        'Unchanged' => 'badge-unchanged',
        default     => 'badge-problem',
    };
    return '<span class="badge ' . $class . '">' . htmlspecialchars($status) . '</span>';
}

// Pipe-separated topic line; bold new items not in $oldSet
function topicLine(array $items, bool $markNew, array $oldSet): string {
    if (empty($items)) return '<span class="none">—</span>';
    $parts = [];
    foreach ($items as $item) {
        $isSponsored = str_starts_with((string)$item, 'SPONSORED:');
        $escaped     = htmlspecialchars((string)$item);
        if ($markNew && !$isSponsored && !isset($oldSet[$item])) {
            $parts[] = "<strong>{$escaped}</strong>";
        } else {
            $parts[] = $escaped;
        }
    }
    return implode(' <span class="pipe">|</span> ', $parts);
}

// Bulleted list; bold new items not in $oldSet
function earthboxList(array $items, bool $markNew, array $oldSet): string {
    if (empty($items)) return '<p class="none">—</p>';
    $html = '<ul class="eb-list">';
    foreach ($items as $item) {
        $isSponsored = str_starts_with((string)$item, 'SPONSORED:');
        $escaped     = htmlspecialchars((string)$item);
        if ($markNew && !$isSponsored && !isset($oldSet[$item])) {
            $html .= "<li>• <strong>{$escaped}</strong></li>";
        } else {
            $html .= "<li>• {$escaped}</li>";
        }
    }
    $html .= '</ul>';
    return $html;
}

function renderTopics(array $d): string {
    $new    = $d['new']    ?? [];
    $old    = $d['old']    ?? [];
    $status = $d['status'] ?? 'Problem';
    $errors = $d['errors'] ?? [];
    $oldSet = array_flip($old);
    $html   = '';

    if ($status === 'Unchanged') {
        // Badge already says Unchanged — skip the row-label
        $html .= '<p class="topic-line">' . topicLine($new, false, $oldSet) . '</p>';

    } elseif ($status === 'Problem') {
        $msg   = $errors ? implode(' · ', $errors) : 'Unknown error';
        $html .= '<p class="errors">⚠ ' . htmlspecialchars($msg) . '</p>';
        if (!empty($old)) {
            $html .= '<p class="row-label">Old</p>';
            $html .= '<p class="topic-line">' . topicLine($old, false, $oldSet) . '</p>';
        }

    } else { // Changed
        $html .= '<p class="row-label">New</p>';
        $html .= '<p class="topic-line">' . topicLine($new, true, $oldSet) . '</p>';
        $html .= '<p class="row-label">Old</p>';
        $html .= '<p class="topic-line">' . topicLine($old, false, $oldSet) . '</p>';
        if ($errors) {
            $html .= '<p class="errors">⚠ ' . htmlspecialchars(implode(' · ', $errors)) . '</p>';
        }
    }
    return $html;
}

function renderEarthboxes(array $d): string {
    $new    = $d['new']    ?? [];
    $old    = $d['old']    ?? [];
    $status = $d['status'] ?? 'Problem';
    $errors = $d['errors'] ?? [];
    $oldSet = array_flip($old);
    $html   = '';

    if ($status === 'Unchanged') {
        // Badge already says Unchanged — skip the row-label
        $html .= earthboxList($new, false, $oldSet);

    } elseif ($status === 'Problem') {
        $msg   = $errors ? implode(' · ', $errors) : 'Unknown error';
        $html .= '<p class="errors">⚠ ' . htmlspecialchars($msg) . '</p>';
        if (!empty($old)) {
            $html .= '<p class="row-label">Old</p>';
            $html .= earthboxList($old, false, $oldSet);
        }

    } else { // Changed
        $html .= '<p class="row-label">New</p>';
        $html .= earthboxList($new, true, $oldSet);
        $html .= '<p class="row-label">Old</p>';
        $html .= earthboxList($old, false, $oldSet);
        if ($errors) {
            $html .= '<p class="errors">⚠ ' . htmlspecialchars(implode(' · ', $errors)) . '</p>';
        }
    }
    return $html;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GE360 automated updates — <?= htmlspecialchars($today) ?></title>
  <link rel="stylesheet" href="updates.css">
</head>
<body>

<header>
  <h1>GE360 automated updates for <?= htmlspecialchars($today) ?></h1>
</header>

<div class="page">

<p class="contact">Problems? Holler at <a href="mailto:bpeniston@defenseone.com">Brad Peniston</a> · <a href="/D1/updates/help.html">What is this and how does it work?</a></p>

<nav class="pub-nav">
<?php
$navLinks = [];
foreach ($navOrder as $navKey):
    $abbrev = $pubAbbrevs[$navKey] ?? strtoupper($navKey);
    $navLinks[] = '<a href="#' . htmlspecialchars($navKey) . '">' . htmlspecialchars($abbrev) . '</a>';
endforeach;
echo implode('<span class="sep">|</span>', $navLinks);
?>
</nav>

<?php if (empty($pubs)): ?>
  <p style="color:var(--accent)">Could not load pub config.</p>
<?php else: ?>
  <?php foreach ($pubs as $pub):
    $key      = $pub['pub_key']  ?? '';
    $name     = $pub['pub_name'] ?? $key;
    if (!$name) continue;
    $tEnabled = parseBool($pub['trending_enabled']  ?? false);
    $eEnabled = parseBool($pub['earthbox_enabled']  ?? false);
    $tData    = $pubData[$key]['trending']  ?? null;
    $eData    = $pubData[$key]['earthbox']  ?? null;
  ?>
  <div class="pub" id="<?= htmlspecialchars($key) ?>">
    <p class="pub-name"><?= htmlspecialchars($name) ?></p>

    <?php if (!$tEnabled && !$eEnabled): ?>
      <p class="disabled">No auto-updates set</p>

    <?php else: ?>

      <?php if ($tEnabled): ?>
        <div class="section">
          <p class="section-head">
            Topics
            <?php if ($tData): echo statusBadge($tData['status']); endif; ?>
          </p>
          <?php if ($tData): ?>
            <?= renderTopics($tData) ?>
          <?php else: ?>
            <p class="not-run">Not yet run today</p>
          <?php endif; ?>
        </div>
      <?php endif; ?>

      <?php if ($eEnabled): ?>
        <div class="section">
          <p class="section-head">
            Earthboxes
            <?php if ($eData): echo statusBadge($eData['status']); endif; ?>
          </p>
          <?php if ($eData): ?>
            <?= renderEarthboxes($eData) ?>
          <?php else: ?>
            <p class="not-run">Not yet run today</p>
          <?php endif; ?>
        </div>
      <?php endif; ?>

    <?php endif; ?>
  </div>
  <?php endforeach; ?>
<?php endif; ?>

</div><!-- /.page -->
</body>
</html>
