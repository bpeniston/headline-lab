<?php
// ============================================================
// seo-api.php  —  Private SEO Headline & Social Generator
// Place this file in the SAME directory as index.php on DreamHost
// NEVER commit your API key to a public git repo
// ============================================================

// --- CONFIGURATION ---
$config = parse_ini_file('/home/bradwu/.headline-lab-config.ini');
define('ANTHROPIC_API_KEY', $config['anthropic_key']);
define('BRAVE_API_KEY',     $config['brave_key']);
define('ALLOWED_ORIGIN',    '');                          // optional: e.g. 'https://www.navybook.com'

// Major outlets to flag as competition
define('COMPETITOR_DOMAINS', [
    'nytimes.com', 'washingtonpost.com', 'cnn.com', 'bbc.com', 'bbc.co.uk',
    'reuters.com', 'apnews.com', 'theguardian.com', 'nbcnews.com', 'cbsnews.com',
    'abcnews.go.com', 'foxnews.com', 'politico.com', 'thehill.com', 'axios.com',
    'npr.org', 'wsj.com', 'usatoday.com', 'newsweek.com', 'time.com',
    'foreignpolicy.com', 'theatlantic.com', 'slate.com', 'bloomberg.com',
    'militarytimes.com', 'stripes.com', 'airforcetimes.com', 'armytimes.com',
]);

// Minimum number of major-outlet results to trigger competition mode
define('COMPETITION_THRESHOLD', 3);

// --- BASIC AUTH (optional but recommended) ---
// define('BASIC_AUTH_USER', 'newsroom');
// define('BASIC_AUTH_PASS', 'changeme123');

// ============================================================
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

if (ALLOWED_ORIGIN !== '' && isset($_SERVER['HTTP_ORIGIN'])) {
    if ($_SERVER['HTTP_ORIGIN'] !== ALLOWED_ORIGIN) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden origin']);
        exit;
    }
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
}

if (defined('BASIC_AUTH_USER')) {
    if (
        !isset($_SERVER['PHP_AUTH_USER']) ||
        $_SERVER['PHP_AUTH_USER'] !== BASIC_AUTH_USER ||
        $_SERVER['PHP_AUTH_PW']   !== BASIC_AUTH_PASS
    ) {
        header('WWW-Authenticate: Basic realm="SEO Tool"');
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$body    = json_decode(file_get_contents('php://input'), true);
$action  = isset($body['action'])  ? trim($body['action'])  : 'headlines';
$article = isset($body['article']) ? trim($body['article']) : '';

if (strlen($article) < 50) {
    http_response_code(400);
    echo json_encode(['error' => 'Article text too short (minimum 50 characters)']);
    exit;
}

// ============================================================
// Route to the correct action
// ============================================================
if ($action === 'generate_social') {
    handle_social($article);
    exit;
}

// Default: headline generation
$focus_kw = isset($body['focus_kw']) ? trim($body['focus_kw']) : '';
$tone     = isset($body['tone'])     ? trim($body['tone'])     : 'neutral';
handle_headlines($article, $focus_kw, $tone);
exit;


// ============================================================
// HANDLER: Social media posts
// ============================================================
function handle_social(string $article): void {

    // STEP 1: Find the most compelling facts from anywhere in the article
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

    $facts_raw  = call_claude($facts_prompt, 300, 0.2);
    $facts_raw  = preg_replace('/^```(?:json)?\s*/m', '', $facts_raw);
    $facts_raw  = preg_replace('/```\s*$/m', '', $facts_raw);
    $key_facts  = json_decode(trim($facts_raw), true);
    if (!is_array($key_facts)) $key_facts = [];

    $facts_block = '';
    if (!empty($key_facts)) {
        $facts_list  = implode("\n", array_map(fn($f) => '- ' . $f, $key_facts));
        $facts_block = <<<FACTS

KEY FACTS FROM THE ARTICLE (all posts must be grounded in these — do not add anything not listed here):
$facts_list

FACTS;
    }

    // STEP 2: Generate social posts
    $prompt = <<<PROMPT
You are a social media editor for Defense One, a specialist defense and national security news publication. Generate social media posts for three platforms based on the article below.

Social posts do NOT need to reflect the main point of the article. Instead, lead with whatever fact, detail, or angle from anywhere in the article is most likely to make a reader stop scrolling and click. Surprising statistics, striking quotes, unexpected consequences, and specific details often outperform the main news point on social.

ARTICLE:
---
$article
---
$facts_block
ACCURACY RULES — READ CAREFULLY:
- Every claim must be directly supported by a specific fact explicitly stated in the article.
- Do not infer, speculate, editorialize, or add drama not present in the text.
- Do not use superlatives ("massive", "explosive", "shocking") unless the article uses them.

PLATFORM GUIDELINES:
- Facebook (3 posts): 1-3 sentences, conversational but authoritative. Can include a brief setup sentence for context. No hashtags. Each post should lead with a different hook or angle.
- X / Twitter (3 posts): Under 280 characters each. Punchy, direct. One hashtag maximum, only if it adds real value. Each post should lead with a different hook or angle.
- LinkedIn (3 posts): 2-4 sentences, professional tone, defense/policy audience. Frame the significance for industry or policy professionals. Each post should lead with a different hook or angle.

Format your response as a JSON object with this exact structure (no extra text, no markdown fences):
{
  "facebook": ["post one", "post two", "post three"],
  "x":        ["post one", "post two", "post three"],
  "linkedin": ["post one", "post two", "post three"]
}
PROMPT;

    $raw_text = call_claude($prompt, 1200, 0.3);
    $raw_text = preg_replace('/^```(?:json)?\s*/m', '', $raw_text);
    $raw_text = preg_replace('/```\s*$/m', '', $raw_text);

    $social = json_decode(trim($raw_text), true);

    if (!is_array($social)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not parse social media response', 'raw' => $raw_text]);
        return;
    }

    echo json_encode(['social' => $social]);
}


// ============================================================
// HANDLER: SEO Headlines
// ============================================================
function handle_headlines(string $article, string $focus_kw, string $tone): void {

    // STEP 1: Extract key facts + search query
    $facts_prompt = <<<PROMPT
Read the following article carefully. It is written in inverted-pyramid structure, meaning the most important information comes first.

Return a JSON object with three fields:

1. "lede_facts": An array of 3-5 specific, verifiable facts drawn only from the FIRST THREE PARAGRAPHS of the article. These represent the main point of the story and must drive the headline.

2. "supporting_facts": An array of 3-5 interesting, verifiable facts from the REST of the article (below the first three paragraphs). These can be used in subheds but not headlines.

3. "search_query": A single short search query (4-7 words) capturing the main news topic, suitable for a news search engine.

Each fact should be a short declarative sentence using only information explicitly present in the text — no inference, no embellishment.

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

    $key_facts        = isset($facts_data['lede_facts'])       ? $facts_data['lede_facts']       : [];
    $supporting_facts = isset($facts_data['supporting_facts']) ? $facts_data['supporting_facts'] : [];
    $search_query     = isset($facts_data['search_query'])     ? $facts_data['search_query']     : '';
    $search_query     = trim(strip_tags($search_query));

    // Fallback query extraction
    if (!$search_query) {
        $query_prompt = <<<PROMPT
Read the following article and return a single short search query (4-7 words) that captures the main news topic. Return ONLY the query text, nothing else - no punctuation, no explanation.

ARTICLE:
---
$article
---
PROMPT;
        $search_query = trim(strip_tags(call_claude($query_prompt, 50, 0.2)));
    }

    // Build facts blocks
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
                        $competition[] = [
                            'title'  => $title,
                            'source' => $source,
                            'url'    => $url,
                            'age'    => $age,
                        ];
                        break;
                    }
                }
            }
        }

        $competition_found = count($competition) >= COMPETITION_THRESHOLD;
    }

    // STEP 3: Build the headline prompt
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
You are an expert SEO editor for Defense One, a specialist defense and national security news publication. Your job is to generate headline + subhed pairs that are optimized for search engine ranking AND compelling for human readers.

This article is written in inverted-pyramid structure. The main point is in the first three paragraphs.

ARTICLE TEXT:
---
$article
---
$facts_block
TONE PREFERENCE: $tone

$kw_instruction
$competition_block

Generate exactly 6 headline + subhed pairs. For each provide:
1. The headline
2. A complementary subhed
3. A one-sentence rationale (why this pair works for SEO/readers)
4. Primary keyword used

HEADLINE RULES:
- Headlines must reflect the main point of the story — draw only from the LEDE FACTS above
- Write in sentence case (capitalize only the first word and proper nouns — not title case)
- Ideal length: 50-60 characters (Google displays ~60 chars)
- Front-load the most important keyword when natural
- Use numbers only when the article explicitly supports them
- Prefer active voice
- Vary style where the article naturally supports it: straight news, question format, how/why framing, listicle — but never force a format that distorts the facts

SUBHED RULES:
- Must NOT repeat any words or phrases from its paired headline
- CAN draw from the SUPPORTING FACTS (lower in the article) to add an interesting angle or detail the headline couldn't fit
- One or two sentences maximum, written in sentence case
- Ideal length: 80–160 characters
- Active voice, no opening colon

ACCURACY RULE (applies to both):
- Every claim must be traceable to a specific sentence in the article. Do not infer, speculate, or embellish.

Format your response as a JSON array with this exact structure (no extra text, no markdown fences):
[
  {
    "headline": "...",
    "subhed": "...",
    "rationale": "...",
    "keyword": "..."
  }
]
PROMPT;

    // STEP 4: Generate headlines
    $raw_text = call_claude($prompt, 1200, 0.3);
    $raw_text = preg_replace('/^```(?:json)?\s*/m', '', $raw_text);
    $raw_text = preg_replace('/```\s*$/m', '', $raw_text);

    $headlines = json_decode(trim($raw_text), true);

    if (!is_array($headlines)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not parse AI response', 'raw' => $raw_text]);
        return;
    }

    // STEP 5: Return everything
    echo json_encode([
        'headlines'         => $headlines,
        'competition_found' => $competition_found,
        'competition'       => array_slice($competition, 0, 8),
        'search_query'      => $search_query,
    ]);
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

    if ($curl_error) {
        http_response_code(502);
        echo json_encode(['error' => 'API connection failed: ' . $curl_error]);
        exit;
    }

    $api_data = json_decode($response, true);

    if ($http_status !== 200 || !isset($api_data['content'][0]['text'])) {
        http_response_code(502);
        echo json_encode([
            'error'   => 'Anthropic API error',
            'details' => $api_data['error']['message'] ?? 'Unknown error'
        ]);
        exit;
    }

    return $api_data['content'][0]['text'];
}

function brave_search(string $query): ?array {
    $url = 'https://api.search.brave.com/res/v1/news/search?q='
         . urlencode($query)
         . '&count=10&freshness=pd';   // pd = past day; pw = past week

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Accept-Encoding: gzip',
            'X-Subscription-Token: ' . BRAVE_API_KEY,
        ],
        CURLOPT_TIMEOUT  => 10,
        CURLOPT_ENCODING => 'gzip',
    ]);

    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status !== 200 || !$response) return null;

    return json_decode($response, true);
}
