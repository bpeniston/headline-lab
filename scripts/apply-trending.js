#!/usr/bin/env node
// =============================================================
// scripts/apply-trending.js
// Nightly Trending Topics auto-apply for Defense One.
//
// Authentication: uses a saved Playwright browser session
// (cookies + storage) so 2FA only needs to happen once.
// Run `node apply-trending.js --setup` to log in and save
// the session interactively. After that, nightly runs reuse it.
//
// Usage:
//   node apply-trending.js --setup     Log in and save session
//   node apply-trending.js             Apply topics (uses saved session)
//   node apply-trending.js --dry-run   Fetch only, no CMS writes
// =============================================================

'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');

// ── Config ────────────────────────────────────────────────────
const SESSION_FILE  = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const META_FILE     = path.join(process.env.HOME, 'headline-lab', '.session-meta.json');
const LOG_FILE      = path.join(process.env.HOME, 'headline-lab', 'logs', 'trending-apply.log');
const API_URL       = 'https://www.navybook.com/D1/seo/trending-topics.php';
const CMS_BASE      = 'https://admin.govexec.com';
const LIST_URL      = `${CMS_BASE}/athena/curate/defenseonetrendingitem/`;
const SLACK_EMAIL   = 'u5q8h4r0o7x8o9l7@govexec.slack.com';
const LABEL         = 'Topics';

const DRY_RUN = process.argv.includes('--dry-run');
const SETUP   = process.argv.includes('--setup');

// ── Session metadata (login date + learned timeout) ───────────
function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return {}; }
}
function saveMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}
function daysSince(isoDate) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

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

// ── Send status email to Slack via Gmail SMTP ────────────────
async function sendSlackEmail(subject, body, env) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS.replace(/\s+/g, ''),
      },
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

// ── Fetch recommendations from backend ────────────────────────
function fetchTopics() {
  return new Promise((resolve, reject) => {
    https.get(`${API_URL}?bust=${Date.now()}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) reject(new Error(data.error));
          else resolve(data.topics);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Setup mode: log in interactively and save session ─────────
async function runSetup() {
  console.log('');
  console.log('=== CMS Session Setup ===');
  console.log('A browser window will open. Log in normally (including 2FA).');
  console.log('Once you can see the Trending Items list, come back here and press Enter.');
  console.log('');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto(LIST_URL);

  // Wait for user to log in and confirm
  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write('Press Enter once you are logged in and can see the Trending Items list...');
    process.stdin.once('data', () => resolve());
  });

  // Verify we're actually on the right page
  const url = page.url();
  if (!url.includes('/defenseonetrendingitem/')) {
    console.log(`Warning: current URL is ${url} — expected the Trending Items list.`);
    console.log('Session saved anyway, but you may need to re-run --setup.');
  }

  // Save session state
  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  // Record login date; preserve knownTimeoutDays if already learned
  const meta = loadMeta();
  saveMeta({ ...meta, loginDate: new Date().toISOString(), lastWarningSent: null });

  console.log(`\nSession saved to ${SESSION_FILE}`);
  console.log('You can now run the script without --setup for nightly updates.');
  console.log('Re-run --setup if the session expires (usually after a few weeks).');
  logStream.end();
}

// ── Load .env ─────────────────────────────────────────────────
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

// ── Apply mode: use saved session to update CMS ───────────────
async function runApply() {
  log(`=== Trending apply start${DRY_RUN ? ' (DRY RUN)' : ''} ===`);

  const env = loadEnv();

  // 1. Check session file exists
  if (!fs.existsSync(SESSION_FILE)) {
    await sendSlackEmail(`${LABEL}: Problem`, `No session file found at ${SESSION_FILE}. Run with --setup first.`, env);
    die(`No session file found at ${SESSION_FILE}. Run with --setup first.`);
  }

  // 2. Fetch recommendations
  log('Fetching topic recommendations from API…');
  let topics;
  try {
    topics = await fetchTopics();
  } catch (e) {
    await sendSlackEmail(`${LABEL}: Problem`, `API fetch failed: ${e.message}`, env);
    die(`API fetch failed: ${e.message}`);
  }
  log(`Got ${topics.length} recommendations: ${topics.map(t => t.label).join(', ')}`);

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
    // 4. Load list page
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });

    // Detect session expiry — redirected to login (any login page variant)
    const trendingTitle = await page.title();
    if (page.url().includes('/accounts/login/') || page.url().includes('/saml/') || page.url().includes('/sso/') || page.url().includes('/login/') || trendingTitle.toLowerCase().includes('log in') || trendingTitle.toLowerCase().includes('sign in')) {
      // Learn the timeout duration on first observed expiry
      const meta = loadMeta();
      if (meta.loginDate && !meta.knownTimeoutDays) {
        const elapsed = daysSince(meta.loginDate);
        log(`Session expired after ${elapsed} days — saving as known timeout.`);
        saveMeta({ ...meta, knownTimeoutDays: elapsed });
      }
      await sendSlackEmail(
        `${LABEL}: Problem`,
        'The Air is logged out of the CMS.\n\nUse the Screen Sharing app to access the Air: vnc://100.117.250.37\n\nThen in Terminal:\n\nexport PATH=/opt/homebrew/bin:$PATH\ncd ~/headline-lab\nnode scripts/apply-trending.js --setup',
        env
      );
      die('Session has expired — Slack notification sent.');
    }

    log('Session valid — on Trending Items list page.');

    // Warn if session is approaching its known (or assumed) expiry
    const meta        = loadMeta();
    const elapsed     = meta.loginDate ? daysSince(meta.loginDate) : 0;
    const timeoutDays = meta.knownTimeoutDays || 30;
    const warnAt      = timeoutDays - 5;
    const todayStr    = new Date().toISOString().slice(0, 10);
    if (elapsed >= warnAt && meta.lastWarningSent !== todayStr) {
      saveMeta({ ...meta, lastWarningSent: todayStr });
      const daysLeft = timeoutDays - elapsed;
      await sendSlackEmail(
        `${LABEL}: Session expiring soon`,
        `The CMS session is ${elapsed} days old and may expire in ~${daysLeft} day${daysLeft === 1 ? '' : 's'}.\n\nRun --setup before it fails:\n\nvnc://100.117.250.37\n\nexport PATH=/opt/homebrew/bin:$PATH\ncd ~/headline-lab\nnode scripts/apply-trending.js --setup`,
        env
      );
      log(`Session age warning sent (${elapsed} days old, timeout expected at ~${timeoutDays}).`);
    }

    // 5. Find Live non-sponsored slots
    const { items: liveItems, sponsoredCount } = await page.evaluate(() => {
      const items = [];
      let sponsoredCount = 0;
      document.querySelectorAll('#result_list tbody tr').forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        const isLive = cells.some(td => td.textContent.trim() === 'Live');
        if (!isLive) return;

        const editLink = row.querySelector('th a[href*="/defenseonetrendingitem/"]');
        const idMatch  = editLink?.getAttribute('href')?.match(/\/defenseonetrendingitem\/(\d+)\//);
        if (!idMatch) return;

        const title = (editLink?.textContent || '').trim();

        if (title.startsWith('Sponsored:')) { sponsoredCount++; return; }
        items.push({ id: idMatch[1], title });
      });
      return { items, sponsoredCount };
    });

    log(`Found ${liveItems.length} editable Live slots, ${sponsoredCount} sponsored (skipped).`);

    if (!liveItems.length) {
      log('No editable slots found — nothing to update.');
      await sendSlackEmail(`${LABEL}: Problem`, 'No editable Live slots found in CMS — nothing was updated.', env);
      return;
    }

    // 6. Apply each topic
    const count     = Math.min(liveItems.length, topics.length);
    const oldLabels = liveItems.slice(0, count).map(i => i.title);
    const newLabels = topics.slice(0, count).map(t => t.label);
    let applied     = 0;
    let failed      = 0;
    const errors    = [];

    for (let i = 0; i < count; i++) {
      const item  = liveItems[i];
      const topic = topics[i];
      log(`[${i+1}/${count}] "${item.title}" → "${topic.label}"…`);

      try {
        const editUrl = `${CMS_BASE}/athena/curate/defenseonetrendingitem/${item.id}/`;

        // Use fetch() inside the browser context — same approach as the
        // Chrome extension's trending.js, which is known to work.
        const result = await page.evaluate(async ({ editUrl, topicLabel, cmsBase }) => {
          // Step 1: GET edit page for CSRF token and current live_date
          const pageRes = await fetch(editUrl, { credentials: 'include' });
          if (!pageRes.ok) return { error: `GET returned ${pageRes.status}` };
          const html = await pageRes.text();
          const doc  = new DOMParser().parseFromString(html, 'text/html');

          const csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
          if (!csrf) return { error: 'No CSRF token found — session may have expired' };

          const liveDate = doc.querySelector('[name="live_date"]')?.value || '';
          const statusSelect = doc.querySelector('select[name="status"]');
          const liveVal = Array.from(statusSelect?.options || [])
            .find(o => o.text.trim() === 'Live')?.value ?? 'live';

          // Step 2: Resolve topic label → integer ID via Grappelli
          const acUrl = `${cmsBase}/grappelli/lookup/autocomplete/?` +
            `term=${encodeURIComponent(topicLabel)}&app_label=post_manager&model_name=defenseonetopic&query_string=t=id`;
          const acRes  = await fetch(acUrl, { credentials: 'include' });
          if (!acRes.ok) return { error: `Grappelli returned ${acRes.status}` };
          const acData = await acRes.json();
          if (!acData[0]?.value) return { error: `Topic not found in Grappelli: "${topicLabel}"` };
          const objectId = acData[0].value;

          // Step 3: POST form data directly (bypasses widget UI entirely)
          const formData = new FormData();
          formData.append('csrfmiddlewaretoken', csrf);
          formData.append('content_type',        '382');
          formData.append('object_id',           String(objectId));
          formData.append('status',              liveVal);
          formData.append('live_date',           liveDate);
          formData.append('expiration_date',     '');
          formData.append('is_sponsored_content','');
          formData.append('url',                 '');
          formData.append('title_override',      '');

          const saveRes = await fetch(editUrl, {
            method: 'POST', body: formData, credentials: 'include',
          });
          if (!saveRes.ok) return { error: `POST returned ${saveRes.status}` };
          if (saveRes.url?.includes(`/defenseonetrendingitem/`) && saveRes.url?.includes(`/change/`) || saveRes.url === editUrl) {
            return { error: 'Stayed on edit page after POST — validation error' };
          }
          return { objectId };
        }, { editUrl, topicLabel: topic.label, cmsBase: CMS_BASE });

        if (result.error) throw new Error(result.error);

        log(`  ✓ Applied "${topic.label}" (object_id=${result.objectId})`);
        applied++;
      } catch (err) {
        log(`  ✗ Failed for item ${item.id}: ${err.message}`);
        errors.push(`Slot ${item.id}: ${err.message}`);
        failed++;
      }
    }

    // 7. Persist updated session cookies (keeps the session alive longer)
    await context.storageState({ path: SESSION_FILE });

    log(`=== Done: ${applied} applied, ${failed} failed, ${sponsoredCount} sponsored skipped ===`);

    // 8. Notify via Slack
    const unchanged = failed === 0 && newLabels.every((l, i) => l === oldLabels[i]);
    const status    = failed > 0 ? 'Problem' : unchanged ? 'Unchanged' : 'Changes';
    let body        = `New: ${newLabels.join(', ')}\nOld: ${oldLabels.join(', ')}`;
    if (errors.length) body += `\n\nErrors:\n${errors.map(e => `  ${e}`).join('\n')}`;
    await sendSlackEmail(`${LABEL}: ${status}`, body, env);

  } finally {
    await browser.close();
    logStream.end();
  }
}

// ── Entry point ───────────────────────────────────────────────
if (SETUP) {
  runSetup().catch(e => { console.error(e); process.exit(1); });
} else {
  runApply().catch(e => { log(`Unhandled error: ${e.message}`); logStream.end(); process.exit(1); });
}
