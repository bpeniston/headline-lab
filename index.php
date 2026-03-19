<?php
// CARD UI: Keep in sync with athena-tools/content/main.js renderResults()
// Only legitimate difference: click copies to clipboard (no Athena fields here)
session_start();
$prefill = '';
if (!empty($_SESSION['prefill'])) {
    $prefill = $_SESSION['prefill'];
    unset($_SESSION['prefill']);
}

$prefill_url = '';
if (!empty($_SESSION['prefill_url'])) {
    $prefill_url = $_SESSION['prefill_url'];
    unset($_SESSION['prefill_url']);
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SEO Headline Generator · Newsroom</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="headline-lab.css?v=2">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
</head>
<body>

<header>
  <h1><a href="index.php">Headline Lab</a></h1>
  <span class="kicker">SEO &amp; Social-Media Tool</span>
  <nav>
    <a href="index.php" class="active">The Tool</a>
    <a href="about.html">About</a>
    <a href="bookmarklet.html">Bookmarklet</a>
    <a href="mailto:bpeniston@defenseone.com?subject=Headline%20Lab">Contact</a>
  </nav>
</header>

<div class="layout">

  <!-- LEFT: Input -->
  <div class="panel">
    <div class="section-label">Article Input</div>

    <div class="row">
      <label for="articleText">Paste article text or summary</label>
      <textarea id="articleText" placeholder="Paste the full article or a detailed summary here. The more context, the better the headline suggestions…"></textarea>
      <div class="char-counter"><span id="charCount">0</span> characters</div>
    </div>

    <div class="two-col row">
      <div>
        <label for="focusKw">Target keyword <span style="color:#bbb">(optional)</span></label>
        <input type="text" id="focusKw" placeholder="e.g., federal workers" />
      </div>
      <div>
        <label for="tone">Tone / Voice</label>
        <select id="tone">
          <option value="neutral">Neutral / Straight news</option>
          <option value="urgent">Urgent / Breaking</option>
          <option value="analytical">Analytical / In-depth</option>
          <option value="conversational">Conversational</option>
          <option value="authoritative">Authoritative / Expert</option>
        </select>
      </div>
    </div>

    <div class="btn-row">
      <button id="generateBtn" class="btn-primary">
        <span class="spinner" id="spinner"></span>
        <span id="btnLabel">Generate Heds</span>
      </button>
      <button id="socialBtn" class="btn-social">
        <span class="spinner" id="socialSpinner"></span>
        <span id="socialBtnLabel">Generate SM Posts</span>
      </button>
    </div>

    <hr class="divider" />

    <div class="section-label">Tips</div>
    <div style="font-size:0.78rem;color:#888;line-height:1.7;font-family:var(--sans)">
      <strong style="color:var(--ink)">50–60 chars</strong> is Google's sweet spot — badges turn green when you're in range.<br>
      <strong style="color:var(--ink)">Front-load keywords</strong> — search engines weight the first few words more heavily.<br>
      <strong style="color:var(--ink)">Paste full text</strong> — more context = more accurate keyword extraction.<br>
      <strong style="color:var(--ink)">Nothing is stored</strong> — requests go directly to Anthropic's API and are not retained.
    </div>

    <hr class="divider" />

    <div class="section-label">Generated</div>
    <div id="usageStats" style="font-size:0.78rem;color:#888;line-height:1.7;font-family:var(--sans)">
      <strong style="color:var(--ink)">Headlines:</strong> <span id="statHedToday">–</span> today, <span id="statHedAll">–</span> all-time<br>
      <strong style="color:var(--ink)">Social posts:</strong> <span id="statSocToday">–</span> today, <span id="statSocAll">–</span> all-time
    </div>
  </div>

  <!-- RIGHT: Results -->
  <div class="panel">
    <div class="section-label" id="resultsLabel">Results</div>
    <div id="results">
      <div class="placeholder-msg">
        <div class="big-glyph">Ⅱ</div>
        <p>Suggestions will appear here</p>
      </div>
    </div>
  </div>

</div>

<script>
  const articleEl     = document.getElementById('articleText');
  const charCountEl   = document.getElementById('charCount');
  const generateBtn   = document.getElementById('generateBtn');
  const spinner       = document.getElementById('spinner');
  const btnLabel      = document.getElementById('btnLabel');
  const socialBtn     = document.getElementById('socialBtn');
  const socialSpinner = document.getElementById('socialSpinner');
  const socialBtnLabel = document.getElementById('socialBtnLabel');
  const resultsEl     = document.getElementById('results');
  const resultsLabel  = document.getElementById('resultsLabel');
  const prefillUrl = <?php echo json_encode($prefill_url); ?>;

  // ── Load usage stats ──────────────────────────────────────
  fetch('stats.php')
    .then(r => r.json())
    .then(d => {
      document.getElementById('statHedToday').textContent = d.headlines_today.toLocaleString();
      document.getElementById('statHedAll').textContent   = d.headlines_alltime.toLocaleString();
      document.getElementById('statSocToday').textContent = d.social_today.toLocaleString();
      document.getElementById('statSocAll').textContent   = d.social_alltime.toLocaleString();
    })
    .catch(() => { document.getElementById('usageStats').style.display = 'none'; });

  // ── Pre-fill from bookmarklet session ────────────────────
  (function() {
    const prefill = <?php echo json_encode($prefill); ?>;
    if (prefill && prefill.length > 10) {
      articleEl.value = prefill;
      charCountEl.textContent = prefill.length.toLocaleString();
      const banner = document.createElement('div');
      banner.style.cssText = 'background:#e8f4ea;border:1px solid #b2d8bc;border-radius:3px;padding:0.5rem 0.75rem;font-family:var(--mono);font-size:0.68rem;color:#2c6e49;margin-bottom:0.75rem;';
      banner.textContent = '✓ Article text loaded from Athena. Ready to generate.';
      articleEl.parentNode.insertBefore(banner, articleEl);
      setTimeout(() => banner.remove(), 4000);
    }
  })();

  articleEl.addEventListener('input', () => {
    charCountEl.textContent = articleEl.value.length.toLocaleString();
  });

  // ── Generate Headlines ────────────────────────────────────
  generateBtn.addEventListener('click', async () => {
    const article = articleEl.value.trim();
    const focusKw = document.getElementById('focusKw').value.trim();
    const tone    = document.getElementById('tone').value;
    if (article.length < 50) { showError('Please paste at least 50 characters of article text.'); return; }
    setLoading(generateBtn, spinner, btnLabel, 'Generating…', true);
    try {
      const res  = await fetch('seo-api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'headlines', article, focus_kw: focusKw, tone }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { showError(data.error || `Server error (${res.status})`); return; }
      resultsLabel.textContent = 'Headline Suggestions';
      renderHeadlines(data.headlines, data);
    } catch (err) {
      showError('Network error — is the server reachable? ' + err.message);
    } finally {
      setLoading(generateBtn, spinner, btnLabel, 'Generate Heds', false);
    }
  });

  // ── Generate Social Posts ─────────────────────────────────
  socialBtn.addEventListener('click', async () => {
    const article = articleEl.value.trim();
    if (article.length < 50) { showError('Please paste at least 50 characters of article text.'); return; }
    setLoading(socialBtn, socialSpinner, socialBtnLabel, 'Generating…', true);
    try {
      const res  = await fetch('seo-api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_social', article, source_url: prefillUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { showError(data.error || `Server error (${res.status})`); return; }
      resultsLabel.textContent = 'Social Copy';
      renderSocialPosts(data.social);
    } catch (err) {
      showError('Network error — is the server reachable? ' + err.message);
    } finally {
      setLoading(socialBtn, socialSpinner, socialBtnLabel, 'Generate SM Posts', false);
    }
  });

  function setLoading(btn, spinnerEl, labelEl, idleLabel, on) {
    btn.disabled = on;
    spinnerEl.style.display = on ? 'block' : 'none';
    labelEl.textContent = on ? 'Generating…' : idleLabel;
  }
  function showError(msg) { resultsEl.innerHTML = `<div class="error-box">⚠ ${escHtml(msg)}</div>`; }

  // ── Render headline cards ─────────────────────────────────
  // SYNC NOTE: Keep in sync with main.js renderResults()
  // Only difference: clicking hed/sub copies to clipboard instead of applying to Athena fields
  function renderHeadlines(headlines, data) {
    if (!headlines || !headlines.length) { showError('No headlines returned — try again.'); return; }

    resultsEl.innerHTML = renderCompetition(data) +
      '<div class="hl-instructions">Hover to show justification | Click a hed or sub to copy</div>' +
      headlines.map((h) => {
        const len      = h.headline ? h.headline.length : 0;
        const lenClass = (len >= 50 && len <= 60) ? 'ok' : (len > 60 ? 'long' : '');
        const lenLabel = len + ' chars' + (len < 50 ? '' : (len > 60 ? ' (long)' : ' ✓'));
        const safeH    = escHtml(h.headline  || '');
        const safeS    = escHtml(h.subhed    || '');
        const safeR    = escHtml(h.rationale || '');
        const safeK    = escHtml(h.keyword   || '');
        const safeSlug = escHtml(h.slug      || '');

        return `
          <div class="headline-card">
            <div class="headline-text">
              <a class="hl-copy-hed" href="#" data-copy="${safeH}">${safeH}</a>
            </div>
            ${safeS ? `<div class="headline-subhed">
              <a class="hl-copy-sub" href="#" data-copy="${safeS}">${safeS}</a>
            </div>` : ''}
            ${safeSlug ? `<div class="headline-slug">
              <a class="hl-copy-slug" href="#" data-copy="${safeSlug}">${safeSlug}</a>
            </div>` : ''}
            <div class="headline-meta">
              <span class="badge badge-kw">🔑 ${safeK}</span>
              <span class="badge badge-len ${lenClass}">${lenLabel}</span>
            </div>
            ${safeR ? `<div class="headline-rationale">${safeR}</div>` : ''}
          </div>`;
      }).join('');

    // Click hed or sub → copy to clipboard
    document.querySelectorAll('.hl-copy-hed, .hl-copy-sub, .hl-copy-slug').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        navigator.clipboard.writeText(a.dataset.copy).then(() => {
          const orig = a.textContent;
          a.textContent = '✓ Copied!';
          setTimeout(() => a.textContent = orig, 1500);
        });
      });
    });
  }

  // ── Render social posts ───────────────────────────────────
  function renderSocialPosts(social) {
    const platforms = [
      { key: 'facebook', label: '📘 Facebook', charLimit: null },
      { key: 'x',        label: '𝕏 X',         charLimit: 280  },
      { key: 'linkedin', label: '💼 LinkedIn',  charLimit: null },
    ];
    const tabs = platforms.map((p, i) =>
      `<button class="social-tab${i === 0 ? ' active' : ''}" onclick="switchTab('${p.key}')" id="tab-${p.key}">${p.label}</button>`
    ).join('');
    const panels = platforms.map((p, i) => {
      const posts = (social[p.key] || []).map((text) => {
        const len = text.length;
        let charBadge = p.charLimit
          ? `<span class="social-char-badge ${len <= p.charLimit ? 'x-ok' : 'x-long'}">${len <= p.charLimit ? `${len} / ${p.charLimit} chars ✓` : `${len} chars — too long`}</span>`
          : `<span class="social-char-badge">${len} chars</span>`;
        const safeText = escHtml(text);
        return `
          <div class="social-post-card">
            <div>${safeText}</div>
            <div class="social-post-meta">
              ${charBadge}
              <button class="social-copy-btn" onclick="copySocial(this, ${JSON.stringify(safeText)})">Copy</button>
            </div>
          </div>`;
      }).join('');
      return `<div class="social-panel${i === 0 ? ' active' : ''}" id="panel-${p.key}">${posts}</div>`;
    }).join('');
    resultsEl.innerHTML = `<div class="social-tabs">${tabs}</div>${panels}`;
  }

  function switchTab(key) {
    document.querySelectorAll('.social-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.social-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + key).classList.add('active');
    document.getElementById('panel-' + key).classList.add('active');
  }

  // ── Competition panel ─────────────────────────────────────
  function renderCompetition(data) {
    if (!data.competition_found || !data.competition || !data.competition.length) return '';
    const items = data.competition.map(c => `
      <li>
        <span class="cl-source"><strong>${escHtml(c.source)}:</strong></span>
        <a href="${escHtml(c.url)}" target="_blank" rel="noopener">${escHtml(c.title)}</a>
      </li>`).join('');
    return `
      <div class="competition-panel" id="compPanel">
        <button class="competition-toggle" onclick="toggleComp()">
          <span class="ct-icon">⚡</span>
          <span class="ct-label">Competition detected:</span>
          <span class="ct-chevron">▼</span>
        </button>
        <div class="competition-body">
          <div class="competition-query"><em>Search query used: <span>${escHtml(data.search_query)}</span></em></div>
          <ul class="competition-list">${items}</ul>
          <div class="competition-footer">⚡ Headlines adjusted to differentiate</div>
        </div>
      </div>`;
  }

  function toggleComp() { document.getElementById('compPanel').classList.toggle('open'); }

  function copySocial(btn, text) {
    const raw = text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    navigator.clipboard.writeText(raw).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
</script>
</body>
</html>