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
const SESSION_FILE = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const LOG_FILE     = path.join(process.env.HOME, 'headline-lab', 'logs', 'trending-apply.log');
const API_URL      = 'https://www.navybook.com/D1/seo/trending-topics.php';
const CMS_BASE     = 'https://admin.govexec.com';
const LIST_URL     = `${CMS_BASE}/athena/curate/defenseonetrendingitem/`;

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

// ── Apply mode: use saved session to update CMS ───────────────
async function runApply() {
  log(`=== Trending apply start${DRY_RUN ? ' (DRY RUN)' : ''} ===`);

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
        await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

        // Preserve existing live_date
        const liveDate = await page.inputValue('input[name="live_date"]').catch(() => '');

        // Resolve topic label → integer ID via Grappelli
        const acUrl = `${CMS_BASE}/grappelli/lookup/autocomplete/?` +
          `term=${encodeURIComponent(topic.label)}&app_label=post_manager&model_name=defenseonetopic&query_string=t=id`;
        const acRes = await page.evaluate(async (url) => {
          const r = await fetch(url, { credentials: 'include' });
          return r.json();
        }, acUrl);

        if (!acRes[0]?.value) throw new Error(`Topic not found in Grappelli: "${topic.label}"`);
        const objectId = acRes[0].value;

        // object_id is readonly (controlled by Grappelli) — set via JS
        await page.evaluate((val) => {
          const el = document.querySelector('input[name="object_id"]');
          if (el) { el.removeAttribute('readonly'); el.value = val; }
        }, String(objectId));

        const ctSelect = page.locator('select[name="content_type"]');
        if (await ctSelect.count()) await ctSelect.selectOption({ value: '382' });

        await page.fill('input[name="title_override"]', '').catch(() => {});
        await page.fill('input[name="url"]', '').catch(() => {});

        const statusSelect = page.locator('select[name="status"]');
        const liveVal = await statusSelect.evaluate(el =>
          Array.from(el.options).find(o => o.text.trim() === 'Live')?.value ?? 'live'
        );
        await statusSelect.selectOption({ value: liveVal });

        // Submit
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
          page.click('input[name="_save"], button[name="_save"]'),
        ]);

        if (page.url().includes(`/${item.id}/`)) {
          throw new Error('Still on edit page after submit — possible validation error');
        }

        log(`  ✓ Applied "${topic.label}" (object_id=${objectId})`);
        applied++;
      } catch (err) {
        log(`  ✗ Failed for item ${item.id}: ${err.message}`);
        failed++;
      }
    }

    // 7. Persist updated session cookies (keeps the session alive longer)
    await context.storageState({ path: SESSION_FILE });

    log(`=== Done: ${applied} applied, ${failed} failed, ${sponsoredCount} sponsored skipped ===`);

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
