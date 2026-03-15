<?php
session_start();
$prefill = '';
if (!empty($_SESSION['prefill'])) {
    $prefill = $_SESSION['prefill'];
    unset($_SESSION['prefill']); // consume it — one use only
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
<!-- test4 -->
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SEO Headline Generator · Newsroom</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="headline-lab.css">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<style>
/* ── Dual action buttons ── */
.btn-row {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.5rem;
}
.btn-primary, .btn-social {
  box-sizing: border-box;
  cursor: pointer;
  border: none;
  margin: 0;
  font-family: var(--mono);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border-radius: 3px;
  font-size: 0.65rem;
  line-height: 1;
  padding: 0.9rem 0.5rem;
  flex: 1;
  text-align: center;
  transition: all 0.15s;
  white-space: nowrap;
  vertical-align: top;
}
.btn-primary {
  background: var(--ink);
  color: var(--paper);
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent);
  box-shadow: 3px 3px 0 var(--ink);
  transform: translate(-1px,-1px);
}
.btn-social {
  background: var(--green);
  color: #fff;
}
.btn-social:hover:not(:disabled) {
  background: #1e4f34;
  box-shadow: 3px 3px 0 var(--ink);
  transform: translate(-1px,-1px);
}
/* ── Paired subhed inside headline card ── */
.headline-subhed {
  font-family: var(--sans);
  font-size: 0.88rem;
  color: #555;
  line-height: 1.5;
  margin: 0 0 0.6rem;
  padding: 0.35rem 0.6rem;
  background: #faf8f4;
  border-left: 2px solid var(--rule);
  border-radius: 0 2px 2px 0;
}
.badge-subhed-len { background: #f0ebe0; color: #888; border: 1px solid var(--rule); }
.badge-subhed-len.ok   { background: #e8f4ea; color: var(--green); border-color: #b2d8bc; }
.badge-subhed-len.long { background: #fde8e8; color: var(--accent); border-color: #f5b7b1; }

/* ── Social tabs & cards ── */
.social-tabs {
  display: flex;
  border-bottom: 2px solid var(--rule);
  margin-bottom: 1.25rem;
}
.social-tab {
  font-family: var(--mono);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 0.55rem 1.1rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 3px 3px 0 0;
  background: none;
  color: #999;
  cursor: pointer;
  margin-bottom: -2px;
  transition: color 0.15s, background 0.15s;
}
.social-tab:hover { color: var(--ink); }
.social-tab.active {
  background: var(--paper);
  color: var(--ink);
  border-color: var(--rule);
  border-bottom-color: var(--paper);
}
.social-panel { display: none; }
.social-panel.active { display: block; }

.social-post-card {
  background: #fff;
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 0.85rem 1rem;
  margin-bottom: 0.65rem;
  transition: box-shadow 0.15s, transform 0.15s;
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--ink);
}
.social-post-card:hover {
  box-shadow: 3px 3px 0 var(--ink);
  transform: translate(-1px,-1px);
}
.social-post-meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.6rem;
  border-top: 1px solid #f0ebe0;
  padding-top: 0.5rem;
}
.social-char-badge {
  font-family: var(--mono);
  font-size: 0.6rem;
  padding: 0.12rem 0.4rem;
  border-radius: 2px;
  background: #f0ebe0;
  color: #999;
  border: 1px solid var(--rule);
}
.social-char-badge.x-ok   { background: #e8f4ea; color: var(--green); border-color: #b2d8bc; }
.social-char-badge.x-long { background: #fde8e8; color: var(--accent); border-color: #f5b7b1; }
.social-copy-btn {
  background: transparent;
  border: 1px solid var(--rule) !important;
  color: #999;
  font-size: 0.58rem;
  padding: 0.2rem 0.5rem;
  margin-left: auto;
  font-family: var(--mono);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s;
}
.social-copy-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink) !important; }
</style>
</head>
<body>

<header>
  <h1><a href="index.php">Headline Lab</a></h1>
  <span class="kicker">SEO & Social-Media Tool</span>
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

  </div><!-- end left panel -->

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
  const articleEl      = document.getElementById('articleText');
  const charCountEl    = document.getElementById('charCount');
  const generateBtn    = document.getElementById('generateBtn');
  const spinner        = document.getElementById('spinner');
  const btnLabel       = document.getElementById('btnLabel');
  const socialBtn      = document.getElementById('socialBtn');
  const socialSpinner  = document.getElementById('socialSpinner');
  const socialBtnLabel = document.getElementById('socialBtnLabel');
  const resultsEl      = document.getElementById('results');
  const resultsLabel   = document.getElementById('resultsLabel');
  
  // ── Load usage stats ────────────────────────────────────────
  fetch('stats.php')
    .then(r => r.json())
    .then(d => {
      document.getElementById('statHedToday').textContent = d.headlines_today.toLocaleString();
      document.getElementById('statHedAll').textContent   = d.headlines_alltime.toLocaleString();
      document.getElementById('statSocToday').textContent = d.social_today.toLocaleString();
      document.getElementById('statSocAll').textContent   = d.social_alltime.toLocaleString();
    })
    .catch(() => {
      document.getElementById('usageStats').style.display = 'none';
    });

  // Read text pre-filled by bookmarklet via PHP session
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

  // ── Generate Headlines ──────────────────────────────────────
  generateBtn.addEventListener('click', async () => {
    const article = articleEl.value.trim();
    const focusKw = document.getElementById('focusKw').value.trim();
    const tone    = document.getElementById('tone').value;

    if (article.length < 50) {
      showError('Please paste at least 50 characters of article text.');
      return;
    }

    setLoading(generateBtn, spinner, btnLabel, 'Generating…', true);

    try {
      const res = await fetch('seo-api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'headlines', article, focus_kw: focusKw, tone }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        showError(data.error || `Server error (${res.status})`);
        return;
      }

      resultsLabel.textContent = 'Headline Suggestions';
      renderHeadlines(data.headlines, data);

    } catch (err) {
      showError('Network error — is the server reachable? ' + err.message);
    } finally {
      setLoading(generateBtn, spinner, btnLabel, 'Generate Heds', false);
    }
  });

  // ── Generate Social Posts ───────────────────────────────────
  socialBtn.addEventListener('click', async () => {
    const article = articleEl.value.trim();

    if (article.length < 50) {
      showError('Please paste at least 50 characters of article text.');
      return;
    }

    setLoading(socialBtn, socialSpinner, socialBtnLabel, 'Generating…', true);

    try {
      const res = await fetch('seo-api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_social',
          article,
          headlines: [], // no headlines required; prompt works without them
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        showError(data.error || `Server error (${res.status})`);
        return;
      }

      resultsLabel.textContent = 'Social Copy';
      renderSocialPosts(data.social);

    } catch (err) {
      showError('Network error — is the server reachable? ' + err.message);
    } finally {
      setLoading(socialBtn, socialSpinner, socialBtnLabel, 'Generate SM Posts', false);
    }
  });

  // ── Shared loading helper ───────────────────────────────────
  function setLoading(btn, spinnerEl, labelEl, idleLabel, on) {
    btn.disabled           = on;
    spinnerEl.style.display = on ? 'block' : 'none';
    labelEl.textContent    = on ? 'Generating…' : idleLabel;
  }

  function showError(msg) {
    resultsEl.innerHTML = `<div class="error-box">⚠ ${escHtml(msg)}</div>`;
  }

  // ── Render headlines (with paired subheds) ─────────────────
  function renderHeadlines(headlines, data) {
    if (!headlines || !headlines.length) {
      showError('No headlines returned — try again.');
      return;
    }

    const competitionHTML = renderCompetition(data);

    resultsEl.innerHTML = competitionHTML + headlines.map((h, i) => {
      const safeH    = escHtml(h.headline || '');
      const len      = (h.headline || '').length;
      const lenClass = len >= 50 && len <= 60 ? 'ok' : len > 60 ? 'long' : '';
      const lenLabel = `Hed: ${len} chars${len < 50 ? ' (short)' : len > 60 ? ' (long)' : ''}`;
      const safeS = escHtml(h.subhed    || '');
      const safeR = escHtml(h.rationale || '');
      const safeK = escHtml(h.keyword   || '');

      const sLen   = h.subhed ? h.subhed.length : 0;
      const sClass = sLen >= 80 && sLen <= 160 ? 'ok' : sLen > 160 ? 'long' : '';
      const sLabel = `Subhed: ${sLen} chars${sLen < 80 ? ' (short)' : sLen > 160 ? ' (long)' : ''}`;

      const subhedBlock = safeS ? `<div class="headline-subhed">${safeS}</div>` : '';

      const subhedMeta = safeS ? `
            <span class="badge badge-subhed-len ${sClass}">${sLabel}</span>
            <button class="badge copy-btn" onclick="copyHL(this, ${JSON.stringify(safeS)})">Copy</button>` : '';

      return `
        <div class="headline-card">
          <span class="headline-rank">#${i + 1}</span>
          <div class="headline-text">${safeH}</div>
          ${subhedBlock}
          <div class="headline-meta">
            <span class="badge badge-len ${lenClass}">${lenLabel}</span>
            <button class="badge copy-btn" onclick="copyHL(this, ${JSON.stringify(safeH)})">Copy</button>
            ${subhedMeta}
          </div>
          <div class="headline-meta headline-meta-kw">
            <span class="badge badge-kw">🔑 ${safeK}</span>
          </div>
          ${safeR ? `<div class="headline-rationale">${safeR}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ── Render social posts ─────────────────────────────────────
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
        let charBadge = '';
        if (p.charLimit) {
          const cls = len <= p.charLimit ? 'x-ok' : 'x-long';
          const lbl = len <= p.charLimit ? `${len} / ${p.charLimit} chars ✓` : `${len} chars — too long`;
          charBadge = `<span class="social-char-badge ${cls}">${lbl}</span>`;
        } else {
          charBadge = `<span class="social-char-badge">${len} chars</span>`;
        }
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

    resultsEl.innerHTML = `
      <div class="social-tabs">${tabs}</div>
      ${panels}`;
  }

  function switchTab(key) {
    document.querySelectorAll('.social-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.social-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + key).classList.add('active');
    document.getElementById('panel-' + key).classList.add('active');
  }

  // ── Competition panel ───────────────────────────────────────
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

  function toggleComp() {
    document.getElementById('compPanel').classList.toggle('open');
  }

  function copyHL(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  }

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
