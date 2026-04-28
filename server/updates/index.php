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

// Sort alphabetically by pub_name
usort($pubs, fn($a, $b) => strcmp($a['pub_name'] ?? '', $b['pub_name'] ?? ''));

// ── Helpers ───────────────────────────────────────────────────
function parseBool($v): bool {
    return filter_var($v ?? false, FILTER_VALIDATE_BOOLEAN);
}

function statusBadge(string $status): string {
    $class = match($status) {
        'Changed'   => 'badge-changed',
        'Unchanged' => 'badge-unchanged',
        default     => 'badge-problem',
    };
    return '<span class="badge ' . $class . '">' . htmlspecialchars($status) . '</span>';
}

// Pipe-separated topic line; bold items in $items that aren't in $oldSet
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

// Bulleted list; bold items in $items that aren't in $oldSet
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

    $html = '';
    if ($status === 'Unchanged') {
        $html .= '<p class="row-label">Unchanged</p>';
        $html .= '<p class="topic-line">' . topicLine($new, false, $oldSet) . '</p>';
    } else {
        $html .= '<p class="row-label">New</p>';
        $html .= '<p class="topic-line">' . topicLine($new, true, $oldSet) . '</p>';
        $html .= '<p class="row-label">Old</p>';
        $html .= '<p class="topic-line">' . topicLine($old, false, $oldSet) . '</p>';
    }
    if ($errors) {
        $html .= '<p class="errors">⚠ ' . htmlspecialchars(implode(' · ', $errors)) . '</p>';
    }
    return $html;
}

function renderEarthboxes(array $d): string {
    $new    = $d['new']    ?? [];
    $old    = $d['old']    ?? [];
    $status = $d['status'] ?? 'Problem';
    $errors = $d['errors'] ?? [];
    $oldSet = array_flip($old);

    $html = '';
    if ($status === 'Unchanged') {
        $html .= '<p class="row-label">Unchanged</p>';
        $html .= earthboxList($new, false, $oldSet);
    } else {
        $html .= '<p class="row-label">New</p>';
        $html .= earthboxList($new, true, $oldSet);
        $html .= '<p class="row-label">Old</p>';
        $html .= earthboxList($old, false, $oldSet);
    }
    if ($errors) {
        $html .= '<p class="errors">⚠ ' . htmlspecialchars(implode(' · ', $errors)) . '</p>';
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
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.55;
      color: #1a1a1a;
      background: #fff;
      max-width: 820px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }

    h1 {
      font-size: 1.3em;
      font-weight: 700;
      margin: 0 0 4px;
    }

    .contact {
      color: #555;
      font-size: 0.88em;
      margin: 0 0 40px;
    }
    .contact a {
      color: #0066cc;
      text-decoration: none;
    }
    .contact a:hover { text-decoration: underline; }

    /* ── Pub block ── */
    .pub {
      border-top: 1px solid #ddd;
      padding-top: 20px;
      margin-bottom: 32px;
    }
    .pub-name {
      font-size: 1.05em;
      font-weight: 700;
      margin: 0 0 12px;
    }

    /* ── Section (Topics / Earthboxes) ── */
    .section { margin-bottom: 18px; }

    .section-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 0.75em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #555;
      margin: 0 0 6px;
    }

    /* ── Status badge ── */
    .badge {
      font-size: 0.85em;
      font-weight: 600;
      text-transform: none;
      letter-spacing: 0;
      padding: 1px 7px;
      border-radius: 3px;
    }
    .badge-changed   { background: #e6f4ea; color: #1e7e34; }
    .badge-unchanged { background: #e8f0fe; color: #1a56bb; }
    .badge-problem   { background: #fce8e6; color: #c5221f; }

    /* ── Row label (New / Old / Unchanged) ── */
    .row-label {
      font-size: 0.72em;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #999;
      margin: 8px 0 3px;
    }
    .row-label:first-child { margin-top: 0; }

    /* ── Topics ── */
    .topic-line {
      margin: 0;
      font-size: 0.95em;
    }
    .pipe { color: #bbb; }

    /* ── Earthboxes ── */
    .eb-list {
      list-style: none;
      padding: 0;
      margin: 0;
      font-size: 0.95em;
    }
    .eb-list li { padding: 1px 0; }

    /* ── States ── */
    .disabled { color: #aaa; font-style: italic; font-size: 0.9em; }
    .not-run  { color: #bbb; font-style: italic; font-size: 0.88em; margin: 0; }
    .none     { color: #ccc; }
    .errors   { color: #c5221f; font-size: 0.85em; margin: 6px 0 0; }
  </style>
</head>
<body>

<h1>GE360 automated updates for <?= htmlspecialchars($today) ?></h1>
<p class="contact">Problems? Holler at <a href="mailto:bpeniston@defenseone.com">Brad Peniston</a></p>

<?php if (empty($pubs)): ?>
  <p style="color:#c5221f">Could not load pub config.</p>
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
  <div class="pub">
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

</body>
</html>
