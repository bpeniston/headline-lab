<?php
// ============================================================
// seo-api.php  —  Private SEO Headline & Social Generator
// ============================================================

$config = parse_ini_file('/home/bradwu/.headline-lab-config.ini');
define('ANTHROPIC_API_KEY', $config['anthropic_key']);
define('BRAVE_API_KEY',     $config['brave_key']);
define('ALLOWED_ORIGIN',    'https://admin.govexec.com');

define('COMPETITOR_DOMAINS', [
    'nytimes.com', 'washingtonpost.com', 'cnn.com', 'bbc.com', 'bbc.co.uk',
    'reuters.com', 'apnews.com', 'theguardian.com', 'nbcnews.com', 'cbsnews.com',
    'abcnews.go.com', 'foxnews.com', 'politico.com', 'thehill.com', 'axios.com',
    'npr.org', 'wsj.com', 'usatoday.com', 'newsweek.com', 'time.com',
    'foreignpolicy.com', 'theatlantic.com', 'slate.com', 'bloomberg.com',
    'militarytimes.com', 'stripes.com', 'airforcetimes.com', 'armytimes.com',
]);

define('COMPETITION_THRESHOLD', 3);

// ============================================================
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$referer       = $_SERVER['HTTP_REFERER'] ?? '';
$allowed_refs  = [ALLOWED_ORIGIN . '/', 'https://www.navybook.com/'];
$ref_ok        = array_filter($allowed_refs, fn($r) => str_starts_with($referer, $r));
if (!$ref_ok) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body       = json_decode(file_get_contents('php://input'), true);
$action     = isset($body['action'])     ? trim($body['action'])     : 'headlines';
$article    = isset($body['article'])    ? trim($body['article'])    : '';
$source_url = isset($body['source_url']) ? trim($body['source_url']) : '';

// Validate source_url — only allow clean http/https URLs
if (!preg_match('/^https?:\/\//i', $source_url)) $source_url = '';
$source_url = mb_substr($source_url, 0, 2000);

if (strlen($article) < 50) {
    http_response_code(400);
    echo json_encode(['error' => 'Article text too short (minimum 50 characters)']);
    exit;
}

if ($action === 'generate_social')  { handle_social($article, $source_url); exit; }
if ($action === 'email_subjects')   { handle_email_subjects($article); exit; }

$focus_kw = isset($body['focus_kw']) ? trim($body['focus_kw']) : '';
$tone     = isset($body['tone'])     ? trim($body['tone'])     : 'neutral';
handle_headlines($article, $focus_kw, $tone);
exit;


// ============================================================
// HANDLER: Email subject lines
// ============================================================
function handle_email_subjects(string $article): void {

    $prompt = <<<PROMPT
You are an email editor for Defense One, a specialist defense and national security news publication. Generate 5 email alert subject lines for the article below.

SUBJECT LINE RULES:
- Target length: 40–50 characters (fully visible on most mobile clients)
- Absolute maximum: 75 characters
- Sentence case; no trailing punctuation
- No question-form subjects — they underperform for news alerts
- Do NOT open with "Defense One:", a publication name, or "BREAKING"
- Specificity beats vague intrigue — lead with the news (names, numbers, outcomes)
- No clickbait; every claim must be directly supported by the article
- Active voice, past tense for completed events

Generate exactly 5 subject lines with varied approaches: straight news, key number or name, implication for defense/policy, urgency/consequence, and curiosity/contrast. Label each with a short approach tag (2–4 words).

ARTICLE:
---
$article
---

Return ONLY a valid JSON array with no extra text or markdown fences:
[
  {"subject": "...", "approach": "straight news"},
  {"subject": "...", "approach": "key number"},
  ...
]
PROMPT;

    $raw  = call_claude($prompt, 600, 0.4);
    $raw  = preg_replace('/^```(?:json)?\s*/m', '', $raw);
    $raw  = preg_replace('/```\s*$/m', '', $raw);
    $subjects = json_decode(trim($raw), true);

    if (!is_array($subjects)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not parse email subject response', 'raw' => $raw]);
        return;
    }

    log_usage('email_subjects', ['article_chars' => strlen($article)]);
    echo json_encode(['subjects' => $subjects]);
}


// ============================================================
// HANDLER: Social media posts
// ============================================================
function handle_social(string $article, string $source_url = ''): void {

    $facts_prompt = <<<PROMPT
Read the following article and return a JSON array of 6-8 of the most interesting, surprising, or reader-grabbing facts from ANYWHERE in the article — not just the lede. These will be used for social media posts, which don't need to reflect the main point; they just need to hook a reader.

Each fact should be a short declarative sentence using only information explicitly present in the text — no inference, no embellishment.

Return ONLY a valid JSON array, no extra text, no markdown fences:
["fact one", "fact two", ...]

ARTICLE:
---
$article
---
PROMPT;

    $facts_raw = call_claude($facts_prompt, 300, 0.2);
    $facts_raw = preg_replace('/^```(?:json)?\s*/m', '', $facts_raw);
    $facts_raw = preg_replace('/```\s*$/m', '', $facts_raw);
    $key_facts = json_decode(trim($facts_raw), true);
    if (!is_array($key_facts)) $key_facts = [];

    $facts_block = '';
    if (!empty($key_facts)) {
        $facts_list  = implode("\n", array_map(fn($f) => '- ' . $f, $key_facts));
        $facts_block = <<<FACTS

KEY FACTS FROM THE ARTICLE (all posts must be grounded in these — do not add anything not listed here):
$facts_list

FACTS;
    }

    // Build the URL instruction block
    if ($source_url !== '') {
        $url_instruction = <<<URL

ARTICLE URL: $source_url

Each post must end with this URL on its own line. Do not fabricate or alter it.

URL;
    } else {
        $url_instruction = "\nNo article URL was provided — do not include or fabricate one.\n";
    }

    $prompt = <<<PROMPT
You are a social media editor for Defense One, a specialist defense and national security news publication. Generate social media posts for three platforms based on the article below.

Social posts do NOT need to reflect the main point of the article. Instead, lead with whatever fact, detail, or angle from anywhere in the article is most likely to make a reader stop scrolling and click.

ARTICLE:
---
$article
---
$facts_block
$url_instruction
ACCURACY RULES:
- Every claim must be directly supported by a specific fact explicitly stated in the article.
- Do not infer, speculate, editorialize, or add drama not present in the text.
- Do not use superlatives ("massive", "explosive", "shocking") unless the article uses them.

PLATFORM GUIDELINES:
- Facebook (3 posts): 1-3 sentences, conversational but authoritative. No hashtags. Each post leads with a different hook. End each post with the article URL on its own line (if provided).
- X / Twitter (3 posts): Under 280 characters each INCLUDING the URL (if provided). Punchy, direct. One hashtag maximum. Each post leads with a different hook. Include the URL at the end.
- LinkedIn (3 posts): 2-4 sentences, professional tone, defense/policy audience. Each post leads with a different hook. End each post with the article URL on its own line (if provided).

Format your response as a JSON object with this exact structure (no extra text, no markdown fences):
{
  "facebook": ["post one", "post two", "post three"],
  "x":        ["post one", "post two", "post three"],
  "linkedin": ["post one", "post two", "post three"]
}
PROMPT;

    $raw_text = call_claude($prompt, 1400, 0.3);
    $raw_text = preg_replace('/^```(?:json)?\s*/m', '', $raw_text);
    $raw_text = preg_replace('/```\s*$/m', '', $raw_text);
    $social   = json_decode(trim($raw_text), true);

    if (!is_array($social)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not parse social media response', 'raw' => $raw_text]);
        return;
    }

    log_usage('social', ['article_chars' => strlen($article), 'has_url' => $source_url !== '']);
    echo json_encode(['social' => $social]);
}


// ============================================================
// HANDLER: SEO Headlines
// ============================================================
function handle_headlines(string $article, string $focus_kw, string $tone): void {

    // STEP 1: Extract key facts + search query
    $facts_prompt = <<<PROMPT
Read the following article carefully. It is written in inverted-pyramid structure.

Return a JSON object with three fields:

1. "lede_facts": An array of 3-5 specific, verifiable facts drawn only from the FIRST THREE PARAGRAPHS. These must drive the headline.

2. "supporting_facts": An array of 3-5 interesting facts from the REST of the article. These can be used in subheds but not headlines.

3. "search_query": A single short search query (4-7 words) capturing the main news topic.

Return ONLY valid JSON, no extra text, no markdown fences:
{
  "lede_facts": ["fact one", "fact two", ...],
  "supporting_facts": ["fact one", "fact two", ...],
  "search_query": "query here"
}

ARTICLE:
---
$article
---
PROMPT;

    $facts_raw  = call_claude($facts_prompt, 400, 0.2);
    $facts_raw  = preg_replace('/^```(?:json)?\s*/m', '', $facts_raw);
    $facts_raw  = preg_replace('/```\s*$/m', '', $facts_raw);
    $facts_data = json_decode(trim($facts_raw), true);

    $key_facts        = $facts_data['lede_facts']       ?? [];
    $supporting_facts = $facts_data['supporting_facts'] ?? [];
    $search_query     = trim(strip_tags($facts_data['search_query'] ?? ''));

    if (!$search_query) {
        $query_prompt = <<<PROMPT
Read the following article and return a single short search query (4-7 words) capturing the main news topic. Return ONLY the query text, nothing else.

ARTICLE:
---
$article
---
PROMPT;
        $search_query = trim(strip_tags(call_claude($query_prompt, 50, 0.2)));
    }

    $facts_block = '';
    if (!empty($key_facts) || !empty($supporting_facts)) {
        $lede_list = !empty($key_facts)
            ? implode("\n", array_map(fn($f) => '- ' . $f, $key_facts))
            : '(none extracted)';
        $supp_list = !empty($supporting_facts)
            ? implode("\n", array_map(fn($f) => '- ' . $f, $supporting_facts))
            : '(none extracted)';
        $facts_block = <<<FACTS

LEDE FACTS — from the first three paragraphs (headlines must come from here):
$lede_list

SUPPORTING FACTS — from lower in the article (subheds may draw from here):
$supp_list

FACTS;
    }

    // STEP 2: Search Brave for competing headlines
    $competition       = [];
    $competition_found = false;

    if ($search_query) {
        $brave_results = brave_search($search_query);
        if ($brave_results && isset($brave_results['results'])) {
            foreach ($brave_results['results'] as $result) {
                $url    = $result['url']   ?? '';
                $title  = $result['title'] ?? '';
                $source = $result['meta_url']['hostname'] ?? parse_url($url, PHP_URL_HOST) ?? '';
                $source = preg_replace('/^www\./', '', $source);
                $age    = $result['age']   ?? '';
                foreach (COMPETITOR_DOMAINS as $domain) {
                    if (str_contains($source, $domain) || str_contains($url, $domain)) {
                        $competition[] = ['title' => $title, 'source' => $source, 'url' => $url, 'age' => $age];
                        break;
                    }
                }
            }
        }
        $competition_found = count($competition) >= COMPETITION_THRESHOLD;
    }

    // STEP 3: Build headline prompt
    $kw_instruction = $focus_kw
        ? "The editor's target keyword/phrase is: \"$focus_kw\". Prioritize including it naturally, but only if it fits the facts."
        : "Identify the most searchable keyword or phrase from the article and use it.";

    $competition_block = '';
    if ($competition_found) {
        $comp_list = implode("\n", array_map(
            fn($c) => '- "' . $c['title'] . '" (' . $c['source'] . ')',
            array_slice($competition, 0, 8)
        ));
        $competition_block = <<<COMP

COMPETITIVE CONTEXT:
The following headlines from major outlets are already covering this topic:
$comp_list

Defense One is a specialist defense and national security publication. Given the above competition, craft headlines that stand out by:
- Finding the specific detail, implication, or angle the major outlets are glossing over
- Foregrounding what this means for the military, defense policy, or national security specifically
- Using more precise, expert language rather than broad consumer-news framing
- Avoiding any phrasing already used by the competing headlines above
At least 4 of the 6 headlines should take a noticeably different angle from the competing headlines.
COMP;
    }

    $prompt = <<<PROMPT
You are an expert SEO editor for Defense One, a specialist defense and national security news publication. Generate headline + subhed + slug combinations optimized for search ranking and human readers.

This article is written in inverted-pyramid structure. The main point is in the first three paragraphs.

ARTICLE TEXT:
---
$article
---
$facts_block
TONE PREFERENCE: $tone

$kw_instruction
$competition_block

Generate exactly 6 headline + subhed + slug combinations. For each provide:
1. The headline
2. A complementary subhed
3. An SEO-optimized URL slug
4. A one-sentence rationale
5. Primary keyword used

HEADLINE RULES:
- Must reflect the main point — draw only from LEDE FACTS above
- Sentence case (capitalize only first word and proper nouns)
- Ideal length: 50-60 characters
- Front-load the most important keyword when natural
- Use numbers only when the article explicitly supports them
- Prefer active voice

SUBHED RULES:
- Must NOT repeat any words or phrases from its paired headline
- Can draw from SUPPORTING FACTS to add an interesting detail
- One or two sentences maximum, sentence case
- Ideal length: 80-160 characters
- Active voice, no opening colon

SLUG RULES:
- Lowercase, hyphens only (no underscores, no special characters)
- 3-5 words maximum — extract the most searchable nouns, drop stop words and verbs
- Must share the core keyword(s) with its paired headline
- No dates
- Examples: "navy-robots-ship-inspection", "pentagon-civilian-workforce-cuts"

ACCURACY RULE: Every claim must be traceable to a specific sentence in the article.

Format your response as a JSON array with this exact structure (no extra text, no markdown fences):
[
  {
    "headline": "...",
    "subhed": "...",
    "slug": "...",
    "rationale": "...",
    "keyword": "..."
  }
]
PROMPT;

    // STEP 4: Generate headlines
    $raw_text = call_claude($prompt, 1400, 0.3);
    $raw_text = preg_replace('/^```(?:json)?\s*/m', '', $raw_text);
    $raw_text = preg_replace('/```\s*$/m', '', $raw_text);
    $headlines = json_decode(trim($raw_text), true);

    if (!is_array($headlines)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not parse AI response', 'raw' => $raw_text]);
        return;
    }

    // STEP 5: Score and sort headlines (best first, score not exposed to client)
    foreach ($headlines as &$h) {
        $h['_score'] = score_headline($h, $focus_kw);
    }
    unset($h);
    usort($headlines, fn($a, $b) => $b['_score'] <=> $a['_score']);
    foreach ($headlines as &$h) {
        unset($h['_score']);
    }
    unset($h);

    log_usage('headlines', [
        'tone'              => $tone,
        'focus_kw'          => $focus_kw !== '' ? 'yes' : 'no',
        'article_chars'     => strlen($article),
        'competition_found' => $competition_found,
    ]);

    echo json_encode([
        'headlines'         => $headlines,
        'competition_found' => $competition_found,
        'competition'       => array_slice($competition, 0, 8),
        'search_query'      => $search_query,
    ]);
}


// ============================================================
// HEADLINE SCORING
// ============================================================
function score_headline(array $h, string $focus_kw): float {
    $score = 0.0;
    $hed   = $h['headline'] ?? '';
    $len   = mb_strlen($hed);

    if ($len >= 50 && $len <= 60)      { $score += 30; }
    elseif ($len >= 45 && $len < 50)   { $score += 20; }
    elseif ($len > 60 && $len <= 70)   { $score += 15; }
    elseif ($len >= 40 && $len < 45)   { $score += 10; }
    else                                { $score += 5;  }

    $kw = strtolower($focus_kw ?: ($h['keyword'] ?? ''));
    if ($kw) {
        $pos = mb_strpos(strtolower($hed), $kw);
        if ($pos !== false) {
            $score += max(0, 25 - ($pos * 0.5));
        }
    }

    if (preg_match('/\b(is being|are being|was|were|has been|have been|will be)\b/i', $hed)) {
        $score -= 10;
    }
    if (preg_match('/\d/', $hed))                                              { $score += 8; }
    if (str_ends_with(trim($hed), '?'))                                        { $score -= 5; }
    if (preg_match('/^(here\'s|this is|why you|what you|you need|the reason)/i', $hed)) { $score -= 8; }

    return $score;
}


// ============================================================
// HELPERS
// ============================================================

function call_claude(string $prompt, int $max_tokens, float $temperature = 1.0): string {
    $payload = json_encode([
        'model'       => 'claude-sonnet-4-20250514',
        'max_tokens'  => $max_tokens,
        'temperature' => $temperature,
        'messages'    => [['role' => 'user', 'content' => $prompt]]
    ]);

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . ANTHROPIC_API_KEY,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_TIMEOUT => 30,
    ]);

    $response    = curl_exec($ch);
    $http_status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_error  = curl_error($ch);
    curl_close($ch);

    if ($curl_error) { http_response_code(502); echo json_encode(['error' => 'API connection failed: ' . $curl_error]); exit; }

    $api_data = json_decode($response, true);
    if ($http_status !== 200 || !isset($api_data['content'][0]['text'])) {
        http_response_code(502);
        echo json_encode(['error' => 'Anthropic API error', 'details' => $api_data['error']['message'] ?? 'Unknown error']);
        exit;
    }

    return $api_data['content'][0]['text'];
}

function brave_search(string $query): ?array {
    $url = 'https://api.search.brave.com/res/v1/news/search?q=' . urlencode($query) . '&count=10&freshness=pd';
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json', 'Accept-Encoding: gzip', 'X-Subscription-Token: ' . BRAVE_API_KEY],
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_ENCODING       => 'gzip',
    ]);
    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200 || !$response) return null;
    return json_decode($response, true);
}

function log_usage(string $action, array $data = []): void {
    $log_file = '/home/bradwu/headline-lab-usage.log';
    $entry = implode("\t", [date('Y-m-d H:i:s'), $action, $_SERVER['REMOTE_ADDR'] ?? '-', json_encode($data)]) . "\n";
    file_put_contents($log_file, $entry, FILE_APPEND | LOCK_EX);
}
