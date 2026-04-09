// skybox.js — Auto-cascade skybox items when #push=POSTID is in the URL
// Triggered by the "Push to Skybox" bookmarklet on a defenseone.com article page.
//
// Workflow:
//   1. Read edit URLs for slots 1–5 from the list page DOM
//   2. GET each edit page; capture resolved URL (after any redirect) + object_id + form fields
//   3. Cascade: slot 5 ← slot 4's ID, ..., slot 1 ← new post ID
//   4. Reload cleanly

(async function initSkyboxPush() {
  // Use hash (e.g. #push=412603) — query params get stripped by Django's redirect
  const hashMatch = window.location.hash.match(/^#push=(\d+)$/);
  const newPostId = hashMatch?.[1];
  if (!newPostId) return;

  const overlay = createOverlay();

  try {
    setStatus(overlay, 'Reading skybox items…');

    // Filter to rows that have a skybox item edit link (skip Grappelli drag-handle rows)
    const rows = Array.from(document.querySelectorAll('#result_list tbody tr'))
      .filter(row => row.querySelector('a[href*="/defenseoneskyboxitem/"]'));

    if (rows.length < 5) {
      throw new Error(`Only ${rows.length} skybox items found — expected at least 5.`);
    }

    const items = rows.slice(0, 5).map((row, i) => {
      const link = row.querySelector('a[href*="/defenseoneskyboxitem/"]');
      return { editUrl: new URL(link.href, location.href).href, slot: i + 1 };
    });

    // GET each edit page; use the resolved URL (after any redirect) as the POST target
    setStatus(overlay, 'Reading current post IDs…');
    for (const item of items) {
      const res = await fetch(item.editUrl, { credentials: 'include' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // The resolved URL is what we POST back to (handles any redirects from the list link)
      item.postUrl = res.url;

      item.csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
      if (!item.csrf) throw new Error(`No CSRF token for slot ${item.slot}.`);

      item.fields = extractFormFields(doc);
      item.objectId = item.fields['object_id'] || '';

      console.log(`Slot ${item.slot}: editUrl=${item.editUrl} postUrl=${item.postUrl} objectId=${item.objectId}`);
      if (!item.objectId) throw new Error(`Could not read object_id for slot ${item.slot}.`);
    }

    // Cascade: slot 5 ← slot 4's ID, …, slot 1 ← newPostId
    for (let i = 4; i >= 0; i--) {
      const targetId = i === 0 ? newPostId : items[i - 1].objectId;
      setStatus(overlay, `Updating slot ${i + 1} of 5…`);
      await postItem(items[i], targetId);
    }

    setStatus(overlay, `✓ Done — post ${newPostId} is now in skybox slot 1.`, 'success');
    setTimeout(() => {
      window.location.href = window.location.pathname;
    }, 3000);

  } catch (err) {
    setStatus(overlay, `✗ Error: ${err.message}`, 'error');
  }
})();

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractFormFields(doc) {
  const fields = {};
  doc.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (el.type === 'file') return; // skip — can't re-send file inputs; Django treats absent as "no change"
    if (el.type === 'checkbox') {
      if (el.checked) fields[el.name] = el.value || 'on';
    } else if (el.type === 'radio') {
      if (el.checked) fields[el.name] = el.value;
    } else {
      fields[el.name] = el.value;
    }
  });
  return fields;
}

async function postItem(item, newObjectId) {
  // Use FormData (multipart/form-data) to match what the browser sends,
  // which is required for Django to correctly process the image inline formset.
  const formData = new FormData();
  Object.entries(item.fields).forEach(([k, v]) => formData.append(k, v));
  formData.set('csrfmiddlewaretoken', item.csrf);
  formData.set('object_id', String(newObjectId));
  formData.set('_save', 'Save');

  console.log(`Slot ${item.slot}: POSTing to ${item.postUrl} with object_id=${newObjectId}`);

  const res = await fetch(item.postUrl, {
    method: 'POST',
    body: formData,   // no Content-Type header — browser sets multipart boundary automatically
    credentials: 'include',
    redirect: 'follow',
  });

  console.log(`Slot ${item.slot}: response URL = ${res.url}`);

  // Django redirects to the list on success; staying on the edit URL = validation error
  const itemId = item.postUrl.match(/\/(\d+)\/?$/)?.[1];
  if (itemId && res.url.includes(`/${itemId}/`)) {
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const errEl = doc.querySelector('.errornote, .errorlist li');
    throw new Error(errEl
      ? `Slot ${item.slot}: ${errEl.textContent.trim()}`
      : `Slot ${item.slot} save failed (stayed on edit page). Check console for details.`);
  }
}

// ── Overlay UI ───────────────────────────────────────────────────────────────

function createOverlay() {
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
