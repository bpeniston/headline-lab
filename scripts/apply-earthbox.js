#!/usr/bin/env node
// =============================================================
// scripts/apply-earthbox.js
// Nightly Earthbox auto-apply for Defense One.
//
// Fetches the most-read articles from GA4 (day/week/month,
// recency-weighted) and fills the 5 editorial Earthbox slots.
// Slots where _is_sponsored_content is checked are skipped.
// The existing image_override is cleared so each slot uses
// the article's own featured image.
//
// Uses the same saved Playwright session as apply-trending.js —
// no separate --setup needed if you've already run that.
//
// Usage:
//   node apply-earthbox.js --setup     Log in and save session
//   node apply-earthbox.js             Apply posts (saved session)
//   node apply-earthbox.js --dry-run   Fetch only, no CMS writes
// =============================================================

'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');

// ── Config ────────────────────────────────────────────────────
const SESSION_FILE = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const LOG_FILE     = path.join(process.env.HOME, 'headline-lab', 'logs', 'earthbox-apply.log');
const API_URL      = 'https://www.navybook.com/D1/seo/earthbox-posts.php';
const CMS_BASE     = 'https://admin.govexec.com';
const LIST_URL     = `${CMS_BASE}/athena/curate/defenseoneearthboxitem/`;
const SLACK_EMAIL  = 'u5q8h4r0o7x8o9l7@govexec.slack.com';
const LABEL        = 'Earthbox';

const DRY_RUN = process.argv.includes('--dry-run');
const SETUP   = process.argv.includes('--setup');

// ── Logging ───────────────────────────────────────────────────
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

function die(msg) {
  log(`FATAL: ${msg}`);
  logStream.end();
  process.exit(1);
}

// ── Slack notification ────────────────────────────────────────
async function sendSlackEmail(subject, body, env) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s+/g, '') },
    });
    await transporter.sendMail({
      from: `Athena Tools <${env.SMTP_USER}>`,
      to:   SLACK_EMAIL,
      subject,
      text: body,
    });
    log('Slack notification sent.');
  } catch (e) {
    log(`Slack email error: ${e.message}`);
  }
}

// ── Fetch recommendations from backend ───────────────────────
function fetchPosts() {
  return new Promise((resolve, reject) => {
    https.get(`${API_URL}?bust=${Date.now()}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) reject(new Error(data.error));
          else resolve(data.posts);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Setup mode ───────────────────────────────────────────────
async function runSetup() {
  console.log('\n=== CMS Session Setup ===');
  console.log('A browser window will open. Log in normally (including 2FA).');
  console.log('Once you can see the Earthbox Items list, press Enter here.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto(LIST_URL);

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write('Press Enter once logged in and on the Earthbox Items list…');
    process.stdin.once('data', () => resolve());
  });

  await context.storageState({ path: SESSION_FILE });
  await browser.close();
  console.log(`\nSession saved to ${SESSION_FILE}`);
  console.log('This session is shared with apply-trending.js.');
  logStream.end();
}

// ── Load .env ────────────────────────────────────────────────
function loadEnv() {
  const envFile = path.join(process.env.HOME, 'headline-lab', '.env');
  if (!fs.existsSync(envFile)) die(`.env not found at ${envFile}`);
  const env = {};
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

// ── Apply mode ───────────────────────────────────────────────
async function runApply() {
  log(`=== Earthbox apply start${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
  const env = loadEnv();

  if (!fs.existsSync(SESSION_FILE)) {
    await sendSlackEmail(`${LABEL}: Problem`, `No session file at ${SESSION_FILE}. Run with --setup first.`, env);
    die(`No session file at ${SESSION_FILE}. Run with --setup first.`);
  }

  // 1. Fetch recommended posts from backend
  log('Fetching post recommendations from API…');
  let posts;
  try {
    posts = await fetchPosts();
  } catch (e) {
    await sendSlackEmail(`${LABEL}: Problem`, `API fetch failed: ${e.message}`, env);
    die(`API fetch failed: ${e.message}`);
  }
  log(`Got ${posts.length} recommendations:`);
  posts.forEach((p, i) =>
    log(`  [${i+1}] ${p.title} (post_id=${p.post_id}, score=${p.score})`));

  if (DRY_RUN) {
    log('Dry run — skipping CMS update.');
    logStream.end();
    return;
  }

  // 2. Launch browser with saved session
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page    = await context.newPage();

  try {
    // 3. Load the Earthbox list page
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });

    // Detect session expiry (any login page variant)
    const earthboxTitle = await page.title();
    if (page.url().includes('/accounts/login/') ||
        page.url().includes('/saml/')           ||
        page.url().includes('/sso/')            ||
        page.url().includes('/login/')          ||
        earthboxTitle.toLowerCase().includes('log in') ||
        earthboxTitle.toLowerCase().includes('sign in')) {
      await sendSlackEmail(
        `${LABEL}: Problem`,
        'The Earthbox auto-apply script found an expired CMS session.\n\n' +
        'Use Screen Sharing to access the Air: vnc://100.117.250.37\n\n' +
        'Then in Terminal:\n\n' +
        'export PATH=/opt/homebrew/bin:$PATH\n' +
        'cd ~/headline-lab\n' +
        'node scripts/apply-earthbox.js --setup',
        env
      );
      die('Session has expired — Slack notification sent.');
    }

    log('Session valid — on Earthbox Items list page.');

    // 4. Read the list to find all Live slots.
    // Note: Athena's Earthbox list page does not include the _is_sponsored_content
    // column, so sponsored detection must happen on the individual edit page (step 5).
    const liveItems = await page.evaluate(() => {
      const items = [];

      document.querySelectorAll('#result_list tbody tr').forEach(row => {
        const cells  = Array.from(row.querySelectorAll('td'));
        const isLive = cells.some(td => td.textContent.trim() === 'Live');
        if (!isLive) return;

        const editLink = row.querySelector('a[href*="/defenseoneearthboxitem/"]');
        const idMatch  = editLink?.getAttribute('href')
          ?.match(/\/defenseoneearthboxitem\/(\d+)\//);
        if (!idMatch) return;

        items.push({
          id:    idMatch[1],
          title: (editLink?.textContent || '').trim(),
        });
      });

      return items;
    });

    log(`Found ${liveItems.length} Live slots.`);

    if (!liveItems.length) {
      log('No editable slots found — nothing to update.');
      await sendSlackEmail(`${LABEL}: Problem`, 'No editable Live slots found in CMS — nothing was updated.', env);
      return;
    }

    // 5. Apply each post to its slot
    const count      = Math.min(liveItems.length, posts.length);
    let applied      = 0;
    let failed       = 0;
    let skipped      = 0;
    const errors     = [];
    const displayOld = [];   // one entry per slot in order; sponsored prefixed
    const displayNew = [];   // one entry per slot in order; sponsored prefixed
    const appliedOld = [];   // applied slots only — used for unchanged comparison
    const appliedNew = [];   // applied slots only — used for unchanged comparison

    for (let i = 0; i < count; i++) {
      const item = liveItems[i];
      const post = posts[i];
      log(`[${i+1}/${count}] "${item.title}" → "${post.title}" (post_id=${post.post_id})…`);

      try {
        const editUrl = `${CMS_BASE}/athena/curate/defenseoneearthboxitem/${item.id}/`;

        const result = await page.evaluate(async ({ editUrl, postId }) => {
          // Step 1: GET edit page — read CSRF, live_date, image state,
          //         and double-check _is_sponsored_content in the form
          const pageRes = await fetch(editUrl, { credentials: 'include' });
          if (!pageRes.ok) return { error: `GET returned ${pageRes.status}` };
          const html = await pageRes.text();
          const doc  = new DOMParser().parseFromString(html, 'text/html');

          const csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
          if (!csrf) return { error: 'No CSRF token — session may have expired' };

          // Hard check: skip if this slot is marked sponsored
          if (doc.querySelector('[name="_is_sponsored_content"]')?.checked) {
            return { skipped: true, reason: 'sponsored' };
          }

          const liveDate0 = doc.querySelector('[name="live_date_0"]')?.value || '';
          const liveDate1 = doc.querySelector('[name="live_date_1"]')?.value || '';

          // Read existing image_override inline formset state
          const imgId  = doc.querySelector('[name="image_override-0-id"]')?.value || '';
          const hasImg = !!imgId;

          // Read suppress_label checkbox state to preserve it
          const suppressLabel = doc.querySelector('[name="suppress_label"]')?.checked;

          // Step 2: POST the updated form
          const fd = new FormData();
          fd.append('csrfmiddlewaretoken', csrf);
          fd.append('content_type',        '22');   // Post Manager - Post
          fd.append('object_id',           String(postId));
          fd.append('status',              'live');
          fd.append('live_date_0',         liveDate0);
          fd.append('live_date_1',         liveDate1);
          fd.append('expiration_date_0',   '');
          fd.append('expiration_date_1',   '');
          // _is_sponsored_content: omitted = unchecked
          fd.append('url_override',        '');
          fd.append('title_override',      '');
          fd.append('label_override',      '');
          if (suppressLabel) fd.append('suppress_label', 'on');

          // Image override formset — delete the existing image so the
          // post's own featured image is used instead
          fd.append('image_override-TOTAL_FORMS',   '1');
          fd.append('image_override-INITIAL_FORMS', hasImg ? '1' : '0');
          fd.append('image_override-MAX_NUM_FORMS', '1');
          if (hasImg) {
            fd.append('image_override-0-id',     imgId);
            fd.append('image_override-0-DELETE', 'on');
          }

          // Tracking pixel inline formset — required management form
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
            const errText = await saveRes.text().catch(() => '');
            // Extract Django error message from HTML if present
            const errMatch = errText.match(/<pre class="exception_value">([\s\S]*?)<\/pre>/) ||
                             errText.match(/<title>(.*?)<\/title>/);
            const detail = errMatch ? errMatch[1].trim().slice(0, 300) : errText.slice(0, 300);
            return { error: `POST returned ${saveRes.status}: ${detail}` };
          }

          // Success: Django redirects to the list page (no item ID in URL)
          const landed = saveRes.url;
          if (landed.includes('/defenseoneearthboxitem/') &&
              !landed.match(/\/defenseoneearthboxitem\/\d+\//)) {
            return { ok: true };
          }
          return { error: 'Stayed on edit page after save — possible validation error' };

        }, { editUrl, postId: post.post_id });

        if (result.error) throw new Error(result.error);
        if (result.skipped) {
          log(`  ↷ Skipped slot ${item.id} (${result.reason})`);
          const label = `SPONSORED: ${item.title}`;
          displayOld.push(label);
          displayNew.push(label);
          skipped++;
          continue;
        }

        log(`  ✓ Applied "${post.title}"`);
        displayOld.push(item.title);
        displayNew.push(post.title);
        appliedOld.push(item.title);
        appliedNew.push(post.title);
        applied++;

      } catch (err) {
        log(`  ✗ Failed for slot ${item.id}: ${err.message}`);
        errors.push(`Slot ${item.id}: ${err.message}`);
        failed++;
      }
    }

    // 6. Persist updated session cookies
    await context.storageState({ path: SESSION_FILE });

    log(`=== Done: ${applied} applied, ${failed} failed, ${skipped} skipped (sponsored) ===`);

    // 7. Notify via Slack
    const unchanged = failed === 0 && appliedNew.every((t, i) => t === appliedOld[i]);
    const status    = failed > 0 ? 'Problem' : unchanged ? 'Unchanged' : 'Changes';
    const bullets   = titles => titles.map(t => `* ${t}`).join('\n');
    let body;
    if (unchanged) {
      body = `UNCHANGED:\n\n${bullets(displayNew)}`;
    } else {
      body = `NEW:\n\n${bullets(displayNew)}\n\nOLD:\n\n${bullets(displayOld)}`;
    }
    if (errors.length) body += `\n\nErrors:\n${errors.map(e => `  ${e}`).join('\n')}`;
    await sendSlackEmail(`${LABEL}: ${status}`, body, env);

  } finally {
    await browser.close();
    logStream.end();
  }
}

// ── Entry point ──────────────────────────────────────────────
if (SETUP) {
  runSetup().catch(e => { console.error(e); process.exit(1); });
} else {
  runApply().catch(e => {
    log(`Unhandled error: ${e.message}`);
    logStream.end();
    process.exit(1);
  });
}
