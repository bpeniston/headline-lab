#!/usr/bin/env node
// =============================================================
// scripts/apply-box.js
// Nightly Earthbox + Skybox auto-apply for all enabled GE360 pubs.
// Per-pub config is read from the GE360 Pub Config Google Sheet.
//
// By default runs both box types. Use flags to restrict:
//   node apply-box.js                  Apply earthbox + skybox
//   node apply-box.js --earthbox       Earthbox only
//   node apply-box.js --skybox         Skybox only
//   node apply-box.js --dry-run        Fetch only, no CMS writes
//   node apply-box.js --setup          Log in and save CMS session
// =============================================================

'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const {
  CMS_BASE, createLogger, loadMeta, saveMeta, daysSince,
  loadEnv, isSessionExpired, makeSetupMsg, makeWarnMsg,
  sendSlackEmail, fetchJSON, fetchPubConfig,
  saveUpdate, pubLabel, runSetup,
} = require('./lib');

// ── Config ────────────────────────────────────────────────────
const SESSION_FILE  = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const META_FILE     = path.join(process.env.HOME, 'headline-lab', '.session-meta.json');
const LOG_FILE      = path.join(process.env.HOME, 'headline-lab', 'logs', 'box-apply.log');
const POSTS_API_URL = 'https://www.navybook.com/D1/seo/earthbox-posts.php';
const SCRIPT_NAME   = 'apply-box.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SETUP   = process.argv.includes('--setup');

const { log, die, logStream } = createLogger(LOG_FILE);

// Box type definitions — drives all field-name lookups
const BOX = {
  earthbox: {
    enabledField:  'earthbox_enabled',
    cmsPathField:  'earthbox_cms_path',
    postModeField: 'earthbox_post_mode',
    type:          'earthbox',
    label:         'Earthboxes',
  },
  skybox: {
    enabledField:  'skybox_enabled',
    cmsPathField:  'skybox_cms_path',
    postModeField: 'skybox_post_mode',
    type:          'skybox',
    label:         'Skyboxes',
  },
};

const hasEarthbox = process.argv.includes('--earthbox');
const hasSkybox   = process.argv.includes('--skybox');
const BOX_TYPES   = (hasEarthbox || hasSkybox)
  ? [hasEarthbox && 'earthbox', hasSkybox && 'skybox'].filter(Boolean)
  : ['earthbox', 'skybox'];

// ── Apply one box type for one pub ────────────────────────────
async function applyBoxForPub(page, pub, posts, env, box) {
  const cmsPath  = pub[box.cmsPathField];
  const itemSlug = cmsPath.replace(/\/$/, '').split('/').pop();

  log(`--- ${pub.pub_name} ${box.label} (${itemSlug}) ---`);

  await page.goto(`${CMS_BASE}${cmsPath}`, { waitUntil: 'domcontentloaded' });

  const liveItems = await page.evaluate(itemSlug => {
    const items = [];
    document.querySelectorAll('#result_list tbody tr').forEach(row => {
      const cells  = Array.from(row.querySelectorAll('td'));
      const isLive = cells.some(td => td.textContent.trim() === 'Live');
      if (!isLive) return;

      const editLink = row.querySelector(`a[href*="/${itemSlug}/"]`);
      const idMatch  = editLink?.getAttribute('href')
        ?.match(new RegExp(`/${itemSlug}/(\\d+)/`));
      if (!idMatch) return;

      items.push({ id: idMatch[1], title: (editLink?.textContent || '').trim() });
    });
    return items;
  }, itemSlug);

  log(`  Found ${liveItems.length} Live slots.`);

  if (!liveItems.length) {
    log('  No editable slots found — nothing to update.');
    await saveUpdate(pub.pub_key, box.type, 'Problem', [], [], ['No editable Live slots found in CMS'], env, log);
    await sendSlackEmail(`${pubLabel(pub)} ${box.label}: Problem`, 'No editable Live slots found in CMS — nothing was updated.', env, pub.slack_email, log);
    return;
  }

  if (!posts.length) {
    const reason = 'API returned no post recommendations';
    log(`  ${reason} — nothing to update.`);
    await saveUpdate(pub.pub_key, box.type, 'Problem', [], [], [reason], env, log);
    await sendSlackEmail(`${pubLabel(pub)} ${box.label}: Problem`, `${reason} — nothing was updated.`, env, pub.slack_email, log);
    return;
  }

  const count      = Math.min(liveItems.length, posts.length);
  let applied      = 0;
  let failed       = 0;
  let skipped      = 0;
  const errors     = [];
  const displayOld = [];
  const displayNew = [];
  const appliedOld = [];
  const appliedNew = [];

  for (let i = 0; i < count; i++) {
    const item = liveItems[i];
    const post = posts[i];

    log(`  [${i+1}/${count}] "${item.title}" → "${post.title}" (post_id=${post.post_id})…`);

    try {
      const editUrl = `${CMS_BASE}/athena/curate/${itemSlug}/${item.id}/`;

      const result = await page.evaluate(async ({ editUrl, postId, itemSlug }) => {
        const pageRes = await fetch(editUrl, { credentials: 'include' });
        if (!pageRes.ok) return { error: `GET returned ${pageRes.status}` };
        const html = await pageRes.text();
        const doc  = new DOMParser().parseFromString(html, 'text/html');

        const csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
        if (!csrf) return { error: 'No CSRF token — session may have expired' };

        if (doc.querySelector('[name="_is_sponsored_content"]')?.checked) {
          return { skipped: true, reason: 'sponsored' };
        }

        const liveDate0     = doc.querySelector('[name="live_date_0"]')?.value || '';
        const liveDate1     = doc.querySelector('[name="live_date_1"]')?.value || '';
        const imgId         = doc.querySelector('[name="image_override-0-id"]')?.value || '';
        const hasImg        = !!imgId;
        const suppressLabel = doc.querySelector('[name="suppress_label"]')?.checked;
        const statusSelect  = doc.querySelector('select[name="status"]');
        const liveVal       = Array.from(statusSelect?.options || [])
          .find(o => o.text.trim() === 'Live')?.value ?? 'live';

        const fd = new FormData();
        fd.append('csrfmiddlewaretoken', csrf);
        fd.append('content_type',        '22'); // Post, same across all GE360 pubs
        fd.append('object_id',           String(postId));
        fd.append('status',              liveVal);
        fd.append('live_date_0',         liveDate0);
        fd.append('live_date_1',         liveDate1);
        fd.append('expiration_date_0',   '');
        fd.append('expiration_date_1',   '');
        fd.append('url_override',        '');
        fd.append('title_override',      '');
        fd.append('label_override',      '');
        if (suppressLabel) fd.append('suppress_label', 'on');

        fd.append('image_override-TOTAL_FORMS',   '1');
        fd.append('image_override-INITIAL_FORMS', hasImg ? '1' : '0');
        fd.append('image_override-MAX_NUM_FORMS', '1');
        if (hasImg) {
          fd.append('image_override-0-id',     imgId);
          fd.append('image_override-0-DELETE', 'on');
        }

        fd.append('base-trackingpixel-content_type-object_id-TOTAL_FORMS',   '1');
        fd.append('base-trackingpixel-content_type-object_id-INITIAL_FORMS', '0');
        fd.append('base-trackingpixel-content_type-object_id-MAX_NUM_FORMS', '1');
        fd.append('base-trackingpixel-content_type-object_id-0-pixel_html',  '');
        fd.append('base-trackingpixel-content_type-object_id-0-id',          '');
        fd.append('_save', 'Save');

        const saveRes = await fetch(editUrl, {
          method: 'POST', body: fd, credentials: 'include',
        });
        if (!saveRes.ok) {
          const errText  = await saveRes.text().catch(() => '');
          const errMatch = errText.match(/<pre class="exception_value">([\s\S]*?)<\/pre>/) ||
                           errText.match(/<title>(.*?)<\/title>/);
          const detail   = errMatch ? errMatch[1].trim().slice(0, 300) : errText.slice(0, 300);
          return { error: `POST returned ${saveRes.status}: ${detail}` };
        }

        const landed = saveRes.url;
        if (landed.includes(`/${itemSlug}/`) && !landed.match(new RegExp(`/${itemSlug}/\\d+/`))) {
          return { ok: true };
        }
        return { error: 'Stayed on edit page after save — possible validation error' };

      }, { editUrl, postId: post.post_id, itemSlug });

      if (result.error) throw new Error(result.error);
      if (result.skipped) {
        log(`    ↷ Skipped slot ${item.id} (${result.reason})`);
        displayOld.push(`SPONSORED: ${item.title}`);
        displayNew.push(`SPONSORED: ${item.title}`);
        skipped++;
        continue;
      }

      log(`    ✓ Applied "${post.title}"`);
      displayOld.push(item.title);
      displayNew.push(post.title);
      appliedOld.push(item.title);
      appliedNew.push(post.title);
      applied++;

    } catch (err) {
      log(`    ✗ Failed for slot ${item.id}: ${err.message}`);
      errors.push(`Slot ${item.id}: ${err.message}`);
      failed++;
    }
  }

  log(`  ${pub.pub_name} ${box.label}: ${applied} applied, ${failed} failed, ${skipped} skipped (sponsored)`);

  const unchanged = failed === 0 && appliedNew.every((t, i) => t === appliedOld[i]);
  const status    = failed > 0 ? 'Problem' : unchanged ? 'Unchanged' : 'Changed';
  const oldSet    = new Set(displayOld);
  const numbered  = (titles, markNew) => titles
    .map((t, i) => (markNew && !oldSet.has(t)) ? `>> ${i+1}. ${t}` : `${i+1}. ${t}`)
    .join('\n');
  let body;
  if (unchanged) {
    body = `UNCHANGED:\n\n${numbered(displayNew, false)}`;
  } else {
    body = `NEW:\n\n${numbered(displayNew, true)}\n\nOLD:\n\n${numbered(displayOld, false)}`;
  }
  if (errors.length) body += `\n\nErrors:\n${errors.map(e => `  ${e}`).join('\n')}`;
  await saveUpdate(pub.pub_key, box.type, status, displayNew, displayOld, errors, env, log);
  await sendSlackEmail(`${pubLabel(pub)} ${box.label}: ${status}`, body, env, pub.slack_email, log);
}

// ── Main apply ────────────────────────────────────────────────
async function runApply() {
  log(`=== Box apply start${DRY_RUN ? ' (DRY RUN)' : ''} (${BOX_TYPES.join(', ')}) ===`);
  let env;
  try { env = loadEnv(); } catch (e) { die(e.message); }

  // 1. Fetch pub config
  log('Fetching pub config…');
  let configResult;
  try {
    configResult = await fetchPubConfig();
  } catch (e) {
    die(`Failed to fetch pub config: ${e.message}`);
  }
  if (configResult.errors?.length) {
    log(`Sheet validation errors (skipping affected rows):\n${configResult.errors.map(e => `  ${e}`).join('\n')}`);
  }

  // Build per-box-type pub lists
  const pubsByBox = {};
  for (const boxType of BOX_TYPES) {
    const box  = BOX[boxType];
    const pubs = (configResult.pubs || []).filter(p => p._valid && p[box.enabledField] !== 'OFF');
    pubsByBox[boxType] = pubs;
    if (pubs.length) log(`${box.label} enabled: ${pubs.map(p => p.pub_name).join(', ')}`);
  }

  // Deduplicated list of all enabled pubs (for session alerts)
  const allEnabledPubs = [...new Map(
    BOX_TYPES.flatMap(bt => pubsByBox[bt]).map(p => [p.pub_key, p])
  ).values()];
  if (!allEnabledPubs.length) die('No enabled pubs found for any box type.');

  // 2. Fetch post recommendations — all pub+box combos in parallel
  const pubPosts = {};
  await Promise.all(
    BOX_TYPES.flatMap(boxType =>
      pubsByBox[boxType].map(async pub => {
        const box = BOX[boxType];
        const key = `${pub.pub_key}:${boxType}`;
        log(`Fetching posts for ${pub.pub_name} ${box.label} (mode=${pub[box.postModeField]})…`);
        try {
          const data = await fetchJSON(`${POSTS_API_URL}?pub=${pub.pub_key}&mode=${pub[box.postModeField]}`);
          if (data.error) throw new Error(data.error);
          pubPosts[key] = data.posts;
          log(`  Got ${data.posts.length} recommendations.`);
          data.posts.forEach((p, i) =>
            log(`    [${i+1}] ${p.title} (post_id=${p.post_id}, score=${p.score})`));
        } catch (e) {
          log(`  API fetch failed for ${pub.pub_name} ${box.label}: ${e.message}`);
          await sendSlackEmail(`${pubLabel(pub)} ${box.label}: Problem`, `API fetch failed: ${e.message}`, env, pub.slack_email, log);
          pubPosts[key] = null;
        }
      })
    )
  );

  if (DRY_RUN) {
    log('Dry run — skipping CMS update.');
    log('=== Done ===');
    logStream.end();
    return;
  }

  // 3. Launch browser with saved session
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page    = await context.newPage();

  try {
    // 4. Session validity check (once — all pubs share the same CMS domain)
    const firstBoxType = BOX_TYPES.find(bt => pubsByBox[bt].length > 0);
    const firstPub     = pubsByBox[firstBoxType][0];
    await page.goto(`${CMS_BASE}${firstPub[BOX[firstBoxType].cmsPathField]}`, { waitUntil: 'domcontentloaded' });
    const pageTitle = await page.title();
    const todayStr  = new Date().toISOString().slice(0, 10);
    if (isSessionExpired(page.url(), pageTitle)) {
      const meta = loadMeta(META_FILE);
      if (meta.loginDate && !meta.knownTimeoutDays) {
        const elapsed = daysSince(meta.loginDate);
        log(`Session expired after ${elapsed} days — saving as known timeout.`);
        saveMeta(META_FILE, { ...meta, knownTimeoutDays: elapsed });
      }
      if (meta.sessionExpiredAlertSent !== todayStr) {
        for (const pub of allEnabledPubs) await sendSlackEmail(`${pubLabel(pub)} Boxes: Problem`, makeSetupMsg(SCRIPT_NAME), env, pub.slack_email, log);
      } else {
        log('Session expired — alert already sent by pre-flight, skipping duplicate.');
      }
      die('Session has expired.');
    }

    log('Session valid.');

    // 5. Session age warning (once)
    const meta        = loadMeta(META_FILE);
    const elapsed     = meta.loginDate ? daysSince(meta.loginDate) : 0;
    const timeoutDays = meta.knownTimeoutDays || 30;
    const warnAt      = meta.knownTimeoutDays ? timeoutDays - 5 : 20;
    if (elapsed >= warnAt && meta.lastWarningSent !== todayStr) {
      saveMeta(META_FILE, { ...meta, lastWarningSent: todayStr });
      const daysLeft = timeoutDays - elapsed;
      await sendSlackEmail('Boxes: Session expiring soon', makeWarnMsg(SCRIPT_NAME, elapsed, daysLeft), env, allEnabledPubs[0].slack_email, log);
      log(`Session age warning sent (${elapsed} days old, timeout expected at ~${timeoutDays}).`);
    }

    // 6. Apply each box type for each enabled pub
    for (const boxType of BOX_TYPES) {
      const box = BOX[boxType];
      for (const pub of pubsByBox[boxType]) {
        const posts = pubPosts[`${pub.pub_key}:${boxType}`];
        if (!posts) { log(`Skipping ${pub.pub_name} ${box.label} — API fetch failed earlier.`); continue; }
        await applyBoxForPub(page, pub, posts, env, box);
      }
    }

    // 7. Persist updated session cookies
    await context.storageState({ path: SESSION_FILE });
    log('=== Done ===');

  } finally {
    await browser.close();
    logStream.end();
  }
}

// ── Entry point ───────────────────────────────────────────────
if (SETUP) {
  runSetup({ chromium, sessionFile: SESSION_FILE, metaFile: META_FILE, log, logStream })
    .catch(e => { console.error(e); process.exit(1); });
} else {
  runApply().catch(e => {
    log(`Unhandled error: ${e.message}`);
    logStream.end();
    process.exit(1);
  });
}
