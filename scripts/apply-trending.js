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
const LOG_FILE      = path.join(process.env.HOME, 'headline-lab', 'logs', 'trending-apply.log');
const API_URL       = 'https://www.navybook.com/D1/seo/trending-topics.php';
const CMS_BASE      = 'https://admin.govexec.com';
const LIST_URL      = `${CMS_BASE}/athena/curate/defenseonetrendingitem/`;
const SLACK_EMAIL   = 'u5q8h4r0o7x8o9l7@govexec.slack.com';

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

// ── Send status email to Slack via Gmail SMTP ────────────────
function sendSlackEmail(subject, body, env) {
  return new Promise((resolve) => {
    const net = require('net');
    const tls = require('tls');

    const user = env.SMTP_USER;
    const pass = env.SMTP_PASS.replace(/\s+/g, ''); // strip spaces from app password
    const auth = Buffer.from(`\0${user}\0${pass}`).toString('base64');

    const lines = [
      `EHLO blotchy-macbook`,
      `AUTH PLAIN ${auth}`,
      `MAIL FROM:<${user}>`,
      `RCPT TO:<${SLACK_EMAIL}>`,
      `DATA`,
      `From: Athena Tools <${user}>`,
      `To: ${SLACK_EMAIL}`,
      `Subject: ${subject}`,
      ``,
      body,
      `.`,
      `QUIT`,
    ];

    let idx = 0;
    const send = (sock) => {
      if (idx < lines.length) { sock.write(lines[idx++] + '\r\n'); }
    };

    const sock = tls.connect({ host: 'smtp.gmail.com', port: 465 }, () => {
      // wait for server greeting before sending
    });

    sock.on('data', (d) => {
      const resp = d.toString();
      if (/^220 /.test(resp) || /^2\d\d /.test(resp) || /^334 /.test(resp)) send(sock);
      if (/^221 /.test(resp)) { sock.destroy(); log('Slack notification sent.'); resolve(); }
      if (/^[45]\d\d /.test(resp)) { sock.destroy(); log(`SMTP error: ${resp.trim()}`); resolve(); }
    });

    sock.on('error', (e) => { log(`SMTP connection error: ${e.message}`); resolve(); });
  });
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
    die(`No session file found at ${SESSION_FILE}. Run with --setup first.`);
  }

  // 2. Fetch recommendations
  log('Fetching topic recommendations from API…');
  let topics;
  try {
    topics = await fetchTopics();
  } catch (e) {
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

    // Detect session expiry — redirected to login
    if (page.url().includes('/accounts/login/') || page.url().includes('/saml/') || page.url().includes('/sso/')) {
      die('Session has expired. Re-run with --setup to log in again.');
    }

    log('Session valid — on Trending Items list page.');

    // 5. Find Live non-sponsored slots
    const { items: liveItems, sponsoredCount } = await page.evaluate(() => {
      const items = [];
      let sponsoredCount = 0;
      document.querySelectorAll('#result_list tbody tr').forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        const isLive = cells.some(td => td.textContent.trim() === 'Live');
        if (!isLive) return;

        const editLink = row.querySelector('a[href*="/defenseonetrendingitem/"]');
        const idMatch  = editLink?.getAttribute('href')?.match(/\/defenseonetrendingitem\/(\d+)\//);
        if (!idMatch) return;

        const titleCell = row.querySelector('td table td:last-child') || editLink;
        const title     = (titleCell?.textContent || '').trim();

        if (title.startsWith('Sponsored:')) { sponsoredCount++; return; }
        items.push({ id: idMatch[1], title });
      });
      return { items, sponsoredCount };
    });

    log(`Found ${liveItems.length} editable Live slots, ${sponsoredCount} sponsored (skipped).`);

    if (!liveItems.length) {
      log('No editable slots found — nothing to update.');
      return;
    }

    // 6. Apply each topic
    const count   = Math.min(liveItems.length, topics.length);
    let applied   = 0;
    let failed    = 0;

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
        failed++;
      }
    }

    // 7. Persist updated session cookies (keeps the session alive longer)
    await context.storageState({ path: SESSION_FILE });

    log(`=== Done: ${applied} applied, ${failed} failed, ${sponsoredCount} sponsored skipped ===`);

    // 8. Notify via Slack email
    const appliedLabels = topics.slice(0, count).map(t => t.label);
    await sendSlackEmail(
      'Updated D1 Trending Topics',
      appliedLabels.join(' | '),
      env
    );

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
