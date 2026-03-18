// ============================================================
// content/main.js  —  Athena Tools
// ============================================================
(function () {
  'use strict';

  const HL_API_URL = 'https://www.navybook.com/D1/seo/seo-api.php';

  applyDOMTweaks();
  injectHeaderButton();
  injectPanel();
  waitForCKEditor(function() { updateBtnState(); });

  // ============================================================
  // DOM TWEAKS
  // ============================================================
  function applyDOMTweaks() {
    var slugRow   = document.querySelector('.grp-row.slug');
    var subhedRow = document.querySelector('.grp-row.subheader');
    if (slugRow && subhedRow) slugRow.insertAdjacentElement('afterend', subhedRow);

    var statusRow = document.querySelector('.grp-row.status');
    var pubRow    = document.querySelector('.grp-row.date_published');
    var expRow    = document.querySelector('.grp-row.expiration_date');
    if (statusRow && pubRow && expRow) {
      var dateBar = document.createElement('div');
      dateBar.id = 'hl-date-bar';
      statusRow.insertAdjacentElement('beforebegin', dateBar);
      dateBar.appendChild(statusRow);
      dateBar.appendChild(pubRow);
      dateBar.appendChild(expRow);
    }

    var riverRow    = document.querySelector('.grp-row.suppress_from_river');
    var insightsRow = document.querySelector('.grp-row.suppress_from_insights_river');
    var googleRow   = document.querySelector('.grp-row.suppress_from_google_search');
    var sponsorRow  = document.querySelector('.grp-row.is_sponsored');
    if (riverRow && insightsRow && googleRow && sponsorRow) {
      var checkBar = document.createElement('div');
      checkBar.id = 'hl-check-bar';
      riverRow.insertAdjacentElement('beforebegin', checkBar);
      checkBar.appendChild(sponsorRow);
      checkBar.appendChild(riverRow);
      checkBar.appendChild(insightsRow);
      checkBar.appendChild(googleRow);
    }
  }

  // ============================================================
  // WAIT FOR CKEDITOR
  // ============================================================
  function waitForCKEditor(callback, attempts) {
    attempts = attempts || 0;
    if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances['id_content'] && CKEDITOR.instances['id_content'].status === 'ready') {
      callback(); return;
    }
    if (attempts > 40) { callback(); return; }
    setTimeout(function() { waitForCKEditor(callback, attempts + 1); }, 100);
  }

  // ============================================================
  // HEADLINE LAB BUTTON
  // ============================================================
  function injectHeaderButton() {
    if (document.getElementById('hl-header-btn')) return;
    var titleC2 = document.querySelector('.grp-row.title .c-2');
    if (!titleC2) return;

    var btn = document.createElement('a');
    btn.id          = 'hl-header-btn';
    btn.href        = '#';
    btn.textContent = 'Headline Lab';
    btn.title       = 'Generate SEO headline options (requires content)';
    btn.classList.add('hl-btn-disabled');
    titleC2.appendChild(btn);

    setInterval(updateBtnState, 2000);

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      if (btn.classList.contains('hl-btn-disabled')) return;
      var panel = document.getElementById('hl-panel');
      if (panel) panel.classList.toggle('hl-open');
    });
  }

  function updateBtnState() {
    var btn = document.getElementById('hl-header-btn');
    if (!btn) return;
    var text = '';
    try { var inst = CKEDITOR.instances['id_content']; if (inst) text = inst.getData(); } catch(e) {}
    if (!text) { var ta = document.getElementById('id_content'); if (ta) text = ta.value; }
    var hasContent = text && text.replace(/<[^>]+>/g, '').trim().length > 50;
    btn.classList.toggle('hl-btn-disabled', !hasContent);
  }

  // ============================================================
  // HEADLINE LAB PANEL
  // ============================================================
  function injectPanel() {
    if (document.getElementById('hl-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'hl-panel';
    panel.innerHTML =
      '<div id="hl-panel-header">' +
        '<h2>Headline Lab</h2>' +
        '<button id="hl-close-btn" title="Close">&#x2715;</button>' +
      '</div>' +
      '<div id="hl-panel-body">' +
        '<div class="hl-fields-row">' +
          '<div class="hl-field hl-field-kw">' +
            '<label class="hl-field-label" for="hl-kw">Target keyword (optional)</label>' +
            '<input type="text" id="hl-kw" placeholder="e.g., federal workers, F-35" />' +
          '</div>' +
          '<div class="hl-field hl-field-tone">' +
            '<label class="hl-field-label" for="hl-tone">Tone</label>' +
            '<select id="hl-tone">' +
              '<option value="neutral">Neutral</option>' +
              '<option value="urgent">Urgent</option>' +
              '<option value="analytical">Analytical</option>' +
              '<option value="authoritative">Authoritative</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<button id="hl-generate-btn">' +
          '<span class="hl-spinner" id="hl-spinner"></span>' +
          '<span id="hl-btn-label">Generate Headlines</span>' +
        '</button>' +
        '<hr class="hl-rule">' +
        '<div id="hl-results">' +
          '<div class="hl-placeholder"><span class="hl-glyph">&#8546;</span></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);

    document.getElementById('hl-close-btn').addEventListener('click', function() { panel.classList.remove('hl-open'); });
    document.getElementById('hl-generate-btn').addEventListener('click', generateHeadlines);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panel.classList.contains('hl-open')) panel.classList.remove('hl-open');
    });
  }

  // ============================================================
  // READ ARTICLE TEXT
  // ============================================================
  function getArticleText() {
    var text = '';
    try {
      var inst = CKEDITOR.instances['id_content'];
      if (inst) { var tmp = document.createElement('div'); tmp.innerHTML = inst.getData(); text = (tmp.innerText || tmp.textContent || '').trim(); }
    } catch(e) {}
    if (!text) {
      var ta = document.getElementById('id_content');
      if (ta && ta.value) { var tmp2 = document.createElement('div'); tmp2.innerHTML = ta.value; text = (tmp2.innerText || tmp2.textContent || '').trim(); }
    }
    var title  = (document.getElementById('id_title')     || {value:''}).value.trim();
    var subhed = (document.getElementById('id_subheader') || {value:''}).value.trim();
    return [title, subhed, text].filter(Boolean).join('\n\n');
  }

  // ============================================================
  // GENERATE HEADLINES
  // ============================================================
  async function generateHeadlines() {
    var article = getArticleText();
    if (article.length < 50) {
      showResults('<div class="hl-error">&#9888; Not enough article text. Make sure the Content field has body copy.</div>');
      return;
    }
    var focusKw    = document.getElementById('hl-kw').value.trim();
    var toneSelect = document.getElementById('hl-tone');
    var tone       = toneSelect ? toneSelect.value : 'neutral';
    setLoading(true);
    try {
      var res  = await fetch(HL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: article, focus_kw: focusKw, tone: tone }),
      });
      var data = await res.json();
      if (!res.ok || data.error) {
        showResults('<div class="hl-error">&#9888; ' + escHtml(data.error || 'Server error ' + res.status) + '</div>');
        return;
      }
      renderResults(data);
    } catch(err) {
      showResults('<div class="hl-error">&#9888; Network error: ' + escHtml(err.message) + '</div>');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // RENDER RESULTS
  // ============================================================
  function renderResults(data) {
    var headlines = data.headlines;
    if (!headlines || !headlines.length) {
      showResults('<div class="hl-error">&#9888; No headlines returned — try again.</div>');
      return;
    }
    var html = '';

    if (data.competition_found && data.competition && data.competition.length) {
      var items = data.competition.map(function(c) {
        return '<li><span class="hl-comp-source">' + escHtml(c.source) + '</span>' +
               '<a href="' + escHtml(c.url) + '" target="_blank" rel="noopener">' + escHtml(c.title) + '</a></li>';
      }).join('');
      html += '<div class="hl-comp-panel" id="hl-comp">' +
        '<button class="hl-comp-toggle" onclick="this.closest(\'.hl-comp-panel\').classList.toggle(\'open\')">' +
        '&#9889; Competition detected — headlines adjusted &#9660;</button>' +
        '<div class="hl-comp-body">' +
        '<div style="font-family:Arial,sans-serif;font-size:11px;color:#aaa;margin-bottom:0.5rem;">Search: <em>' + escHtml(data.search_query) + '</em></div>' +
        '<ul class="hl-comp-list">' + items + '</ul></div></div>';
    }

    html += '<div class="hl-instructions">Hover to show justification | Click a hed or sub to add to post</div>';

    html += headlines.map(function(h) {
      var len      = h.headline ? h.headline.length : 0;
      var lenClass = (len >= 50 && len <= 60) ? 'ok' : (len > 60 ? 'long' : '');
      var lenLabel = len + ' chars' + (len < 50 ? '' : (len > 60 ? ' (long)' : ' \u2713'));
      var safeH    = escHtml(h.headline  || '');
      var safeS    = escHtml(h.subhed    || '');
      var safeR    = escHtml(h.rationale || '');
      var safeK    = escHtml(h.keyword   || '');
      var safeSlug = escHtml(h.slug      || '');

      return '<div class="hl-card">' +
        '<div class="hl-text">' +
          '<a class="hl-use-hed" href="#" data-headline="' + safeH + '">' + safeH + '</a>' +
        '</div>' +
        (safeS ? '<div class="hl-subhed">' +
          '<a class="hl-use-sub" href="#" data-subhed="' + safeS + '">' + safeS + '</a>' +
        '</div>' : '') +
        (safeSlug ? '<div class="hl-slug">' +
          '<a class="hl-copy-slug" href="#" data-copy="' + safeSlug + '">' + safeSlug + '</a>' +
        '</div>' : '') +
        '<div class="hl-meta">' +
          '<span class="hl-badge hl-badge-kw">&#128273; ' + safeK + '</span>' +
          '<span class="hl-badge hl-badge-len ' + lenClass + '">' + lenLabel + '</span>' +
        '</div>' +
        (safeR ? '<div class="hl-rationale">' + safeR + '</div>' : '') +
      '</div>';
    }).join('');

    showResults(html);

    document.querySelectorAll('.hl-use-hed').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var tf = document.getElementById('id_title');
        if (tf) {
          tf.value = a.dataset.headline;
          tf.dispatchEvent(new Event('input',  { bubbles: true }));
          tf.dispatchEvent(new Event('change', { bubbles: true }));
          var orig = a.dataset.headline;
          a.textContent = '\u2713 Applied!';
          setTimeout(function() { a.textContent = orig; }, 1800);
        }
      });
    });

    document.querySelectorAll('.hl-use-sub').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var sf = document.getElementById('id_subheader');
        if (sf) {
          sf.value = a.dataset.subhed;
          sf.dispatchEvent(new Event('input',  { bubbles: true }));
          sf.dispatchEvent(new Event('change', { bubbles: true }));
          var orig = a.dataset.subhed;
          a.textContent = '\u2713 Applied!';
          setTimeout(function() { a.textContent = orig; }, 1800);
        }
      });
    });

    document.querySelectorAll('.hl-copy-slug').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        navigator.clipboard.writeText(a.dataset.copy).then(function() {
          var orig = a.textContent;
          a.textContent = '\u2713 Copied!';
          setTimeout(function() { a.textContent = orig; }, 1500);
        });
      });
    });
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function showResults(html) { var el = document.getElementById('hl-results'); if (el) el.innerHTML = html; }
  function setLoading(on) {
    var btn = document.getElementById('hl-generate-btn');
    var label = document.getElementById('hl-btn-label');
    var spinner = document.getElementById('hl-spinner');
    if (btn) btn.disabled = on;
    if (label) label.textContent = on ? 'Generating\u2026' : 'Generate Headlines';
    if (spinner) spinner.style.display = on ? 'block' : 'none';
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();