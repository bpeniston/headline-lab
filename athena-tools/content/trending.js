// ============================================================
// content/trending.js — Athena Tools: Trending Topics
// Injects into the D1-Trending items list page and provides
// a panel to fetch GA4-based topic recommendations and apply
// them to the CMS automatically.
// ============================================================
(function () {
  'use strict';

  if (!isTrendingListPage()) return;

  injectUI();

  // ── Page detection ──────────────────────────────────────────
  function isTrendingListPage() {
    return /\/athena\/curate\/defenseonetrendingitem\/?/.test(window.location.pathname);
  }

  // ── Inject button + panel + styles ──────────────────────────
  function injectUI() {
    injectButton();
    injectPanel();
  }

  function injectButton() {
    if (document.getElementById('tt-open-btn')) return;

    const btn = document.createElement('a');
    btn.id        = 'tt-open-btn';
    btn.href      = '#';
    btn.textContent = '⟳ Refresh Trending Topics';

    // Insert after the page <h1>
    const h1 = document.querySelector('#content h1, h1#site-name, h1');
    if (h1) {
      h1.insertAdjacentElement('afterend', btn);
    } else {
      document.body.prepend(btn);
    }

    btn.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('tt-panel').classList.add('tt-open');
    });
  }

  // ── Panel ───────────────────────────────────────────────────
  function injectPanel() {
    if (document.getElementById('tt-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tt-panel';
    panel.innerHTML = `
      <div id="tt-header">
        <h2>Trending Topics</h2>
        <button id="tt-close-btn" title="Close">&#x2715;</button>
      </div>
      <div id="tt-body">
        <p id="tt-status">Analyze GA4 traffic to find the top 7 topics driving readers to Defense One.</p>

        <div id="tt-fetch-row">
          <button id="tt-fetch-btn">
            <span class="tt-spinner" id="tt-spinner"></span>
            <span id="tt-fetch-label">Fetch Recommendations</span>
          </button>
          <button id="tt-force-btn" title="Bypass the 1-hour cache and re-run GA4 + article scraping now">↺ Force refresh</button>
        </div>

        <div id="tt-columns" style="display:none">
          <div class="tt-col">
            <h3>Current Live Topics</h3>
            <div id="tt-current-list"></div>
          </div>
          <div class="tt-col">
            <h3>Recommended <span id="tt-cache-note"></span></h3>
            <div id="tt-rec-list"></div>
            <div id="tt-score-key">
              <span class="tt-badge tt-day">▲ today</span>
              <span class="tt-badge tt-week">7-day</span>
              <span class="tt-badge tt-month">30-day</span>
              <span style="color:#999;font-size:11px;margin-left:4px">pageviews</span>
            </div>
          </div>
        </div>

        <div id="tt-action-row" style="display:none">
          <button id="tt-apply-btn">Apply These Topics to CMS</button>
        </div>

        <div id="tt-progress" style="display:none">
          <div id="tt-progress-track"><div id="tt-progress-fill"></div></div>
          <div id="tt-progress-text"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('tt-close-btn').addEventListener('click', () => {
      panel.classList.remove('tt-open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') panel.classList.remove('tt-open');
    });

    document.getElementById('tt-fetch-btn').addEventListener('click', () => fetchRecommendations(false));
    document.getElementById('tt-force-btn').addEventListener('click', () => fetchRecommendations(true));
    document.getElementById('tt-apply-btn').addEventListener('click', applyTopics);
  }

  // ── Fetch recommendations from backend ──────────────────────
  async function fetchRecommendations(forceRefresh = false) {
    setFetching(true);
    setStatus(forceRefresh
      ? 'Force-refreshing: re-querying GA4 and scraping articles… (~15–30 seconds).'
      : 'Querying GA4 and analyzing top articles… this may take 15–30 seconds on first run.');
    try {
      const params = forceRefresh ? 'nocache=1' : 'bust=' + Date.now();
      const url  = 'https://www.navybook.com/D1/seo/trending-topics.php?' + params;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error + (data.detail ? ' — ' + JSON.stringify(data.detail) : ''));
      renderResults(data);
    } catch (err) {
      setStatus('❌ ' + err.message);
    } finally {
      setFetching(false);
    }
  }

  function renderResults(data) {
    // Current live items
    const liveItems = getLiveItems();
    const currentEl = document.getElementById('tt-current-list');
    if (liveItems.length) {
      currentEl.innerHTML = liveItems.map(item =>
        `<div class="tt-row tt-row-current">${escHtml(item.title)}</div>`
      ).join('');
    } else {
      currentEl.innerHTML = '<div class="tt-row tt-row-empty">No Live items found</div>';
    }

    // Recommended topics
    const recEl = document.getElementById('tt-rec-list');
    recEl.innerHTML = data.topics.map((t, i) => `
      <div class="tt-row tt-row-rec" data-slug="${escHtml(t.slug)}" data-label="${escHtml(t.label)}">
        <span class="tt-rank">${i + 1}</span>
        <span class="tt-topic-name">${escHtml(t.label)}</span>
        <span class="tt-badges">
          <span class="tt-badge tt-day" title="Pageviews past 24h">▲${fmt(t.day)}</span>
          <span class="tt-badge tt-week" title="Pageviews past 7 days">${fmt(t.week)}</span>
          <span class="tt-badge tt-month" title="Pageviews past 30 days">${fmt(t.month)}</span>
        </span>
      </div>
    `).join('');

    // Cache timestamp note
    const ts = new Date(data.generated_at);
    document.getElementById('tt-cache-note').textContent =
      `(${ts.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})`;

    document.getElementById('tt-columns').style.display = 'flex';
    document.getElementById('tt-action-row').style.display = 'block';
    setStatus('Review the recommendations, then click Apply to update the CMS.');
  }

  // ── Read current Live items from the list table ──────────────
  function getLiveItems() {
    const items = [];
    document.querySelectorAll('#result_list tbody tr').forEach(row => {
      // Status cell text
      const cells = row.querySelectorAll('td');
      let isLive  = false;
      cells.forEach(td => {
        if (td.textContent.trim() === 'Live') isLive = true;
      });
      if (!isLive) return;

      const editLink = row.querySelector('a[href*="/defenseonetrendingitem/"]');
      const idMatch  = editLink?.getAttribute('href')?.match(/\/defenseonetrendingitem\/(\d+)\//);
      if (!idMatch) return;

      // Get the displayed title from the rendered-content mini-table, or the title link
      const titleCell = row.querySelector('td table td:last-child')
                     || editLink;
      items.push({
        id:    idMatch[1],
        title: (titleCell?.textContent || editLink?.textContent || '').trim(),
      });
    });
    return items;
  }

  // ── Apply recommended topics to CMS items ────────────────────
  async function applyTopics() {
    const liveItems  = getLiveItems();
    const recRows    = document.querySelectorAll('#tt-rec-list .tt-row-rec');

    if (!liveItems.length) {
      setStatus('❌ Could not find any Live items in the list. Reload the page and try again.');
      return;
    }
    if (!recRows.length) {
      setStatus('❌ No recommendations loaded yet.');
      return;
    }

    const topics = Array.from(recRows).map(r => ({
      slug:  r.dataset.slug,
      label: r.dataset.label,
    }));

    document.getElementById('tt-apply-btn').disabled    = true;
    document.getElementById('tt-action-row').style.display = 'block';
    document.getElementById('tt-progress').style.display   = 'block';

    const count = Math.min(liveItems.length, topics.length);
    let successCount = 0;

    for (let i = 0; i < count; i++) {
      const item  = liveItems[i];
      const topic = topics[i];
      setProgress(i, count, `Updating item ${i + 1}/${count}: "${topic.label}"…`);
      try {
        await updateTrendingItem(item.id, topic);
        successCount++;
      } catch (err) {
        setStatus(`❌ Stopped at item ${i + 1} ("${topic.label}"): ${err.message}`);
        document.getElementById('tt-apply-btn').disabled = false;
        return;
      }
    }

    setProgress(count, count, '');
    setStatus(`✅ Updated ${successCount} of ${count} trending topics. Reload this page to confirm.`);
    document.getElementById('tt-apply-btn').disabled = false;
  }

  // ── Update one trending item via background fetch ────────────
  async function updateTrendingItem(itemId, topic) {
    const editUrl = `/athena/curate/defenseonetrendingitem/${itemId}/`;

    // ── Step 1: GET the edit page for CSRF token + current form data
    const pageRes = await fetch(editUrl, { credentials: 'include' });
    if (!pageRes.ok) throw new Error(`GET edit page returned HTTP ${pageRes.status}`);
    const pageHtml = await pageRes.text();
    const doc = new DOMParser().parseFromString(pageHtml, 'text/html');

    const csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
    if (!csrf) throw new Error('Could not find CSRF token on edit page');

    // Read the current live_date to preserve it
    const existingLiveDate =
      doc.querySelector('[name="live_date"]')?.value || formatDatetime(new Date());

    // Detect the value Django uses for "Live" status
    const statusSelect = doc.querySelector('select[name="status"]');
    const liveOptValue = Array.from(statusSelect?.options || [])
      .find(o => o.text.trim() === 'Live')?.value ?? 'live';

    // ── Step 2: Look up the topic's integer ID via Grappelli autocomplete
    const acUrl  = `/grappelli/lookup/autocomplete/?` + new URLSearchParams({
      term:         topic.label,
      app_label:    'post_manager',
      model_name:   'defenseonetopic',
      query_string: 't=id',
    });
    const acRes  = await fetch(acUrl, { credentials: 'include' });
    if (!acRes.ok) throw new Error(`Grappelli autocomplete returned HTTP ${acRes.status}`);
    const acData = await acRes.json();
    const match  = acData[0]; // first result
    if (!match || !match.value) {
      throw new Error(`No topic found for "${topic.label}" in Grappelli autocomplete`);
    }
    const objectId = match.value; // integer

    // ── Step 3: POST updated form data
    const formData = new FormData();
    formData.append('csrfmiddlewaretoken', csrf);
    formData.append('content_type',        '382');          // Post Manager - Topic (Defense One)
    formData.append('object_id',           String(objectId));
    formData.append('status',              liveOptValue);
    formData.append('live_date',           existingLiveDate);
    formData.append('expiration_date',     '');
    formData.append('is_sponsored_content','');              // unchecked
    formData.append('url',                 '');              // no URL override
    formData.append('title_override',      '');              // no title override

    const saveRes = await fetch(editUrl, {
      method:      'POST',
      body:        formData,
      credentials: 'include',
    });

    // Django admin redirects to the list on success (status 200 after redirect follow).
    // Check that the response URL no longer contains the item ID = redirect occurred.
    if (!saveRes.ok) throw new Error(`POST save returned HTTP ${saveRes.status}`);
    const finalUrl = saveRes.url || '';
    if (finalUrl.includes(`/${itemId}/`)) {
      // Still on the edit page — likely a validation error
      throw new Error(`Form submission may have failed (stayed on edit page). Check item ${itemId} manually.`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────
  function setStatus(msg) {
    document.getElementById('tt-status').textContent = msg;
  }

  function setFetching(on) {
    document.getElementById('tt-fetch-btn').disabled      = on;
    document.getElementById('tt-force-btn').disabled      = on;
    document.getElementById('tt-spinner').style.display   = on ? 'inline-block' : 'none';
    document.getElementById('tt-fetch-label').textContent = on ? 'Fetching…' : 'Fetch Recommendations';
  }

  function setProgress(done, total, msg) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('tt-progress-fill').style.width = pct + '%';
    document.getElementById('tt-progress-text').textContent  = msg;
  }

  function fmt(n) {
    return Number(n).toLocaleString();
  }

  function formatDatetime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }


})();
