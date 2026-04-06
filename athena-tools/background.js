// ============================================================
// background.js — Athena Tools service worker
// Handles nightly auto-apply of trending topics via chrome.alarms.
// Captures previous state before applying so the user can undo.
// ============================================================
'use strict';

const CMS_BASE      = 'https://admin.govexec.com';
const TRENDING_LIST = `${CMS_BASE}/athena/curate/defenseonetrendingitem/`;
const API_URL       = 'https://www.navybook.com/D1/seo/trending-topics.php';
const NOTIF_RESULT  = 'tt-result';
const NOTIF_UNDO    = 'tt-undo-done';
const UNDO_TTL_MS   = 8 * 60 * 60 * 1000; // undo available for 8 hours

// ── Alarm scheduling ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(()   => scheduleAlarm());

chrome.storage.onChanged.addListener((changes) => {
  if ('autoApply' in changes || 'applyTime' in changes) scheduleAlarm();
});

function scheduleAlarm() {
  chrome.storage.sync.get({ autoApply: false, applyTime: '02:00' }, ({ autoApply, applyTime }) => {
    chrome.alarms.clear('trending-nightly', () => {
      if (!autoApply) return;
      const [h, m] = applyTime.split(':').map(Number);
      const now  = new Date();
      const next = new Date();
      next.setHours(h, m, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      chrome.alarms.create('trending-nightly', {
        when:            next.getTime(),
        periodInMinutes: 1440,
      });
    });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'trending-nightly') runAutoApply();
});

// ── Notification button clicks ────────────────────────────────
chrome.notifications.onButtonClicked.addListener((notifId, btnIdx) => {
  if (notifId === NOTIF_RESULT && btnIdx === 0) runUndo();
  chrome.notifications.clear(notifId);
});

// ── Auto-apply flow ───────────────────────────────────────────
async function runAutoApply() {
  try {
    // 1. Read Live non-sponsored slots from the CMS list page
    const { items: liveItems, sponsoredCount } = await fetchLiveItems();
    if (!liveItems.length) {
      showNotif(NOTIF_RESULT, 'Trending Topics', 'No editable Live slots found — nothing updated.', []);
      chrome.storage.local.set({ lastAutoRun: Date.now(), lastRunError: 'No Live slots found' });
      return;
    }

    // 2. Fetch scored recommendations from backend
    const apiRes  = await fetch(API_URL + '?bust=' + Date.now(), { credentials: 'include' });
    const apiData = await apiRes.json();
    if (apiData.error) throw new Error(apiData.error);
    const topics = apiData.topics;

    // 3. For each slot: save current state for undo, then apply new topic
    const count     = Math.min(liveItems.length, topics.length);
    const undoState = [];
    let   applied   = 0;

    for (let i = 0; i < count; i++) {
      const item  = liveItems[i];
      const topic = topics[i];

      // Fetch edit page → CSRF token + current field values (saved for undo)
      const prev = await fetchItemState(item.id);
      undoState.push({ itemId: item.id, state: prev });

      // Resolve topic name → integer object ID, then POST
      await applyTopic(item.id, topic, prev.csrf, prev.liveDate, prev.statusValue);
      applied++;
    }

    // 4. Persist undo snapshot
    chrome.storage.local.set({
      undoState,
      undoTimestamp:  Date.now(),
      lastAutoRun:    Date.now(),
      lastRunSummary: topics.slice(0, count).map(t => t.label),
      lastRunError:   null,
    });

    // 5. Notify — Undo button stays live for UNDO_TTL_MS
    const parts = [`${applied} topic${applied !== 1 ? 's' : ''} applied`];
    if (sponsoredCount) parts.push(`${sponsoredCount} sponsored slot${sponsoredCount !== 1 ? 's' : ''} skipped`);
    showNotif(
      NOTIF_RESULT,
      '✅ Trending Topics Updated',
      parts.join(' · '),
      [{ title: 'Undo' }, { title: 'Dismiss' }],
      true   // requireInteraction — stays until you act on it
    );

  } catch (err) {
    chrome.storage.local.set({ lastAutoRun: Date.now(), lastRunError: err.message });
    showNotif(NOTIF_RESULT, '❌ Trending Auto-apply Failed', err.message, []);
  }
}

// ── Undo flow ─────────────────────────────────────────────────
async function runUndo() {
  try {
    const { undoState, undoTimestamp } = await chrome.storage.local.get(['undoState', 'undoTimestamp']);

    if (!undoState?.length) {
      showNotif(NOTIF_UNDO, 'Trending Topics', 'Nothing to undo.', []);
      return;
    }
    if (Date.now() - undoTimestamp > UNDO_TTL_MS) {
      showNotif(NOTIF_UNDO, 'Trending Topics', 'Undo window has expired (8 hours).', []);
      return;
    }

    for (const { itemId, state } of undoState) {
      const fresh = await fetchItemState(itemId); // fresh CSRF for each POST
      await restoreItem(itemId, state, fresh.csrf);
    }

    chrome.storage.local.remove(['undoState', 'undoTimestamp']);
    showNotif(NOTIF_UNDO, '↩ Trending Topics Restored', 'Previous topics have been reinstated.', []);

  } catch (err) {
    showNotif(NOTIF_UNDO, '❌ Undo Failed', err.message, []);
  }
}

// ── CMS helpers ───────────────────────────────────────────────

// Parse the list page → Live non-sponsored items + sponsored count
async function fetchLiveItems() {
  const res = await fetch(TRENDING_LIST, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not load CMS list page (HTTP ${res.status}). Are you logged in?`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

  const items = [];
  let   sponsoredCount = 0;

  doc.querySelectorAll('#result_list tbody tr').forEach(row => {
    const cells = row.querySelectorAll('td');

    // Must be Live
    let isLive = false;
    cells.forEach(td => { if (td.textContent.trim() === 'Live') isLive = true; });
    if (!isLive) return;

    // Edit link → item ID
    const editLink = row.querySelector('a[href*="/defenseonetrendingitem/"]');
    const idMatch  = editLink?.getAttribute('href')?.match(/\/defenseonetrendingitem\/(\d+)\//);
    if (!idMatch) return;

    // Detect sponsored slot: title_override beginning with "Sponsored:"
    const titleCell = row.querySelector('td table td:last-child') || editLink;
    const titleText = (titleCell?.textContent || '').trim();
    if (titleText.startsWith('Sponsored:')) {
      sponsoredCount++;
      return;
    }

    items.push({ id: idMatch[1], title: titleText });
  });

  return { items, sponsoredCount };
}

// Fetch one item's edit page and return all field values + CSRF
async function fetchItemState(itemId) {
  const editUrl = `${CMS_BASE}/athena/curate/defenseonetrendingitem/${itemId}/`;
  const res     = await fetch(editUrl, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not load edit page for item ${itemId} (HTTP ${res.status})`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

  const csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
  if (!csrf) throw new Error(`No CSRF token found for item ${itemId} — session may have expired`);

  const statusSelect = doc.querySelector('select[name="status"]');
  const statusValue  = Array.from(statusSelect?.options || [])
    .find(o => o.text.trim() === 'Live')?.value ?? 'live';

  return {
    csrf,
    objectId:       doc.querySelector('[name="object_id"]')?.value       || '',
    contentType:    doc.querySelector('[name="content_type"]')?.value     || '382',
    statusValue,
    liveDate:       doc.querySelector('[name="live_date"]')?.value        || formatDatetime(new Date()),
    expirationDate: doc.querySelector('[name="expiration_date"]')?.value  || '',
    titleOverride:  doc.querySelector('[name="title_override"]')?.value   || '',
    url:            doc.querySelector('[name="url"]')?.value              || '',
  };
}

// Resolve topic label → integer ID via Grappelli, then POST
async function applyTopic(itemId, topic, csrf, liveDate, statusValue) {
  const acRes = await fetch(
    `${CMS_BASE}/grappelli/lookup/autocomplete/?` + new URLSearchParams({
      term:         topic.label,
      app_label:    'post_manager',
      model_name:   'defenseonetopic',
      query_string: 't=id',
    }),
    { credentials: 'include' }
  );
  if (!acRes.ok) throw new Error(`Grappelli autocomplete failed for "${topic.label}"`);
  const acData = await acRes.json();
  if (!acData[0]?.value) throw new Error(`Topic not found in Grappelli: "${topic.label}"`);

  await postItemForm(itemId, {
    csrf,
    contentType:    '382',
    objectId:       String(acData[0].value),
    statusValue,
    liveDate,
    expirationDate: '',
    titleOverride:  '',
    url:            '',
  });
}

// Re-post previous values to restore a slot
async function restoreItem(itemId, state, freshCsrf) {
  await postItemForm(itemId, { ...state, csrf: freshCsrf });
}

// POST form data to a trending item edit page
async function postItemForm(itemId, { csrf, contentType, objectId, statusValue, liveDate, expirationDate, titleOverride, url }) {
  const editUrl  = `${CMS_BASE}/athena/curate/defenseonetrendingitem/${itemId}/`;
  const formData = new FormData();
  formData.append('csrfmiddlewaretoken',  csrf);
  formData.append('content_type',         contentType);
  formData.append('object_id',            String(objectId));
  formData.append('status',               statusValue);
  formData.append('live_date',            liveDate);
  formData.append('expiration_date',      expirationDate || '');
  formData.append('is_sponsored_content', '');
  formData.append('url',                  url || '');
  formData.append('title_override',       titleOverride || '');

  const res = await fetch(editUrl, { method: 'POST', body: formData, credentials: 'include' });
  if (!res.ok) throw new Error(`POST for item ${itemId} returned HTTP ${res.status}`);
  if (res.url?.includes(`/${itemId}/`)) {
    throw new Error(`Submission may have failed for item ${itemId} — check manually`);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function showNotif(id, title, message, buttons, requireInteraction = false) {
  const opts = { type: 'basic', iconUrl: 'icons/icon48.png', title, message, requireInteraction };
  if (buttons.length) opts.buttons = buttons;
  chrome.notifications.create(id, opts);
}

function formatDatetime(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
