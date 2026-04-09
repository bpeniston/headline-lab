// skybox.js — Push an article to skybox slot 1, cascading existing items down.
//
// Supports all five GE360 publications (Defense One, GovExec, Nextgov,
// Route Fifty, Washington Technology). Detects which pub from the URL path.
//
// Sponsored slots (title_override starting with "Sponsored:") act as walls —
// the cascade stops before the first sponsored slot, leaving it and everything
// below it untouched.
//
// Approach: sessionStorage carries cascade state across page navigations.
// fetch() is used only for GETs (reading current object_ids — works fine).
// POSTs use real browser form submission via saveBtn.click(), which sends
// sec-fetch-mode: navigate and satisfies Athena's server-side checks.
//
// Flow:
//   List page + #push=POSTID  → read edit URLs + current IDs, store plan,
//                               navigate to slot 1's edit page
//   Edit page (slot N)        → set object_id in form, click Save → list page
//   List page (returning)     → advance plan, navigate to slot N+1's edit page
//   List page (all done)      → clear plan, show success

'use strict';

const CASCADE_KEY = 'skyboxCascade';

// Matches any of the five pub skybox list or edit pages
const LIST_RE = /\/(?:defenseone|govexec|nextgov|routefifty|wt)skyboxitem\/$/;
const EDIT_RE = /\/(?:defenseone|govexec|nextgov|routefifty|wt)skyboxitem\/\d+\//;

const path = window.location.pathname;

if (LIST_RE.test(path)) {
  handleListPage();
} else if (EDIT_RE.test(path)) {
  handleEditPage();
}

// ── List page ─────────────────────────────────────────────────────────────────

async function handleListPage() {
  const hashMatch = window.location.hash.match(/^#push=(\d+)$/);

  if (hashMatch) {
    history.replaceState({}, '', window.location.pathname);
    await startCascade(hashMatch[1]);
    return;
  }

  const plan = readPlan();
  if (plan) advanceCascade(plan);
}

async function startCascade(newPostId) {
  const overlay = createOverlay();
  try {
    setStatus(overlay, 'Reading skybox items…');

    const rows = Array.from(document.querySelectorAll('#result_list tbody tr'))
      .filter(row => row.querySelector('a[href*="skyboxitem/"]'));

    if (rows.length < 5) throw new Error(`Only ${rows.length} items found — expected at least 5.`);

    const editUrls = rows.slice(0, 5).map(row =>
      new URL(row.querySelector('a[href*="skyboxitem/"]').href, location.href).href
    );

    // GET each edit page to read object_id + override fields
    setStatus(overlay, 'Reading current post IDs and overrides…');
    const current = []; // [{oid, urlOverride, titleOverride, labelOverride}]
    for (const url of editUrls) {
      const res = await fetch(url, { credentials: 'include' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const oid = doc.querySelector('[name="object_id"]')?.value;
      if (!oid) throw new Error(`Could not read object_id from ${url}`);
      current.push({
        oid,
        urlOverride:   doc.querySelector('[name="url_override"]')?.value   || '',
        titleOverride: doc.querySelector('[name="title_override"]')?.value || '',
        labelOverride: doc.querySelector('[name="label_override"]')?.value || '',
      });
    }

    // Sponsored slots act as a wall — find the first one (0-based index)
    const wallIndex = current.findIndex(c => c.titleOverride.startsWith('Sponsored:'));
    const cascadeCount = wallIndex === -1 ? current.length : wallIndex;

    if (cascadeCount === 0) {
      throw new Error('Slot 1 is a sponsored slot — cannot push here.');
    }

    // Plan: slot 1 ← newPostId + empty overrides
    //       slot N ← slot N-1's object + overrides (they travel together)
    //       slots at or beyond the wall are untouched
    const plan = {
      newPostId,
      items: editUrls.slice(0, cascadeCount).map((url, i) => ({
        editUrl:       url,
        newObjectId:   i === 0 ? newPostId          : current[i - 1].oid,
        urlOverride:   i === 0 ? ''                 : current[i - 1].urlOverride,
        titleOverride: i === 0 ? ''                 : current[i - 1].titleOverride,
        labelOverride: i === 0 ? ''                 : current[i - 1].labelOverride,
        slot: i + 1,
      })),
      nextIndex: 0,
      // 1-based slot number of the wall (null if no sponsored slot found)
      wallSlot: wallIndex === -1 ? null : wallIndex + 1,
    };

    savePlan(plan);
    setStatus(overlay, 'Navigating to slot 1…');
    setTimeout(() => { window.location.href = plan.items[0].editUrl; }, 600);

  } catch (err) {
    clearPlan();
    setStatus(overlay, `✗ ${err.message}`, 'error');
  }
}

function advanceCascade(plan) {
  if (plan.nextIndex >= plan.items.length) {
    clearPlan();
    const overlay = createOverlay();
    const wallNote = plan.wallSlot ? ` (stopped before sponsored slot ${plan.wallSlot})` : '';
    setStatus(overlay, `✓ Done — post ${plan.newPostId} is now in slot 1${wallNote}.`, 'success');
    setTimeout(() => overlay.remove(), 5000);
    return;
  }

  const overlay = createOverlay();
  const completed = plan.nextIndex;
  setStatus(overlay,
    completed === 0
      ? `Navigating to slot 1 of ${plan.items.length}…`
      : `Slot ${completed} saved — navigating to slot ${plan.nextIndex + 1}…`
  );
  setTimeout(() => { window.location.href = plan.items[plan.nextIndex].editUrl; }, 600);
}

// ── Edit page ─────────────────────────────────────────────────────────────────

function handleEditPage() {
  const plan = readPlan();
  if (!plan) return;

  const item = plan.items[plan.nextIndex];
  if (!item) return;

  // Confirm we're on the right item's edit page
  const expectedId = item.editUrl.match(/\/(\d+)\//)?.[1];
  if (!expectedId || !window.location.pathname.includes(`/${expectedId}/`)) return;

  // Wait for Grappelli JS to finish initialising before touching the form
  setTimeout(() => applyAndSave(item, plan), 1000);
}

function applyAndSave(item, plan) {
  const overlay = createOverlay();
  setStatus(overlay, `Slot ${item.slot}: setting post ID to ${item.newObjectId}…`);

  try {
    const objectIdField = document.querySelector('[name="object_id"]');
    if (!objectIdField) throw new Error('object_id field not found.');

    objectIdField.removeAttribute('readonly');
    objectIdField.removeAttribute('disabled');
    objectIdField.value = String(item.newObjectId);

    // Set override fields — travel with the object, cleared for slot 1
    const setField = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) el.value = value;
    };
    setField('url_override',   item.urlOverride);
    setField('title_override', item.titleOverride);
    setField('label_override', item.labelOverride);

    // Advance the plan BEFORE submitting so the list page knows what's next
    plan.nextIndex++;
    savePlan(plan);

    // Click Save — real browser form submission (sec-fetch-mode: navigate)
    const saveBtn = document.querySelector('[name="_save"]');
    if (!saveBtn) throw new Error('Save button not found.');
    saveBtn.click();

  } catch (err) {
    clearPlan();
    setStatus(overlay, `✗ ${err.message}`, 'error');
  }
}

// ── SessionStorage helpers ────────────────────────────────────────────────────

function savePlan(plan)  { sessionStorage.setItem(CASCADE_KEY, JSON.stringify(plan)); }
function readPlan()      { try { return JSON.parse(sessionStorage.getItem(CASCADE_KEY)); } catch { return null; } }
function clearPlan()     { sessionStorage.removeItem(CASCADE_KEY); }

// ── Overlay UI ────────────────────────────────────────────────────────────────

function createOverlay() {
  document.getElementById('skybox-push-overlay')?.remove();
  const div = document.createElement('div');
  div.id = 'skybox-push-overlay';
  div.innerHTML = `
    <div id="skybox-push-box">
      <strong>⬆ Skybox Push</strong>
      <p id="skybox-push-status">Starting…</p>
    </div>
  `;
  document.body.appendChild(div);
  return div;
}

function setStatus(overlay, msg, state) {
  const p = overlay.querySelector('#skybox-push-status');
  if (p) p.textContent = msg;
  if (state) overlay.querySelector('#skybox-push-box').dataset.state = state;
}
