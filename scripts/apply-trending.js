#!/usr/bin/env node
// =============================================================
// scripts/apply-trending.js
// Nightly Trending Topics auto-apply for Defense One.
//
// 1. Fetches scored topic recommendations from the backend API
// 2. Logs into admin.govexec.com with Playwright (headless)
// 3. For each non-sponsored Live trending slot, applies the
//    recommended topic via Grappelli autocomplete + form POST
// 4. Logs results to ~/headline-lab/logs/trending-apply.log
//
// Usage: node apply-trending.js [--dry-run] [--visible]
//   --dry-run   Fetch and log recommendations without writing to CMS
//   --visible   Run with a visible browser window (for debugging)
//
// Secrets: ~/headline-lab/.env (CMS_USERNAME, CMS_PASSWORD)
// =============================================================

'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');

// ── Config ────────────────────────────────────────────────────
const ENV_FILE  = path.join(process.env.HOME, 'headline-lab', '.env');
const LOG_FILE  = path.join(process.env.HOME, 'headline-lab', 'logs', 'trending-apply.log');
const API_URL   = 'https://www.navybook.com/D1/seo/trending-topics.php';
const CMS_BASE  = 'https://admin.govexec.com';
const LIST_URL  = `${CMS_BASE}/athena/curate/defenseonetrendingitem/`;
const LOGIN_URL = `${CMS_BASE}/accounts/login/?next=/athena/curate/defenseonetrendingitem/`;

const DRY_RUN = process.argv.includes('--dry-run');
const VISIBLE = process.argv.includes('--visible');

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

// ── Load .env ─────────────────────────────────────────────────
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) die(`.env not found at ${ENV_FILE}`);
  const env = {};
  fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  if (!env.CMS_USERNAME || !env.CMS_PASSWORD) die('.env missing CMS_USERNAME or CMS_PASSWORD');
  return env;
}

// ── Fetch recommendations from backend ───────────────────────
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

// ── Main ──────────────────────────────────────────────────────
(async () => {
  log(`=== Trending apply start${DRY_RUN ? ' (DRY RUN)' : ''} ===`);

  const env = loadEnv();

  // 1. Fetch recommendations
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

  // 2. Launch browser
  const browser = await chromium.launch({ headless: !VISIBLE });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    // 3. Log in
    log('Logging into CMS…');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // Check if already logged in (redirected straight to list)
    if (!page.url().includes('/accounts/login/')) {
      log('Already logged in (session cookie present).');
    } else {
      await page.fill('input[name="username"]', env.CMS_USERNAME);
      await page.fill('input[name="password"]', env.CMS_PASSWORD);
      await page.click('input[type="submit"], button[type="submit"]');
      await page.waitForURL(url => !url.toString().includes('/accounts/login/'), { timeout: 15000 });
      log('Login successful.');
    }

    // 4. Load list page and find Live non-sponsored slots
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });

    const liveItems = await page.evaluate(() => {
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

        if (title.startsWith('Sponsored:')) {
          sponsoredCount++;
          return;
        }
        items.push({ id: idMatch[1], title });
      });
      return { items, sponsoredCount };
    });

    log(`Found ${liveItems.items.length} editable Live slots, ${liveItems.sponsoredCount} sponsored (skipped).`);

    if (!liveItems.items.length) {
      log('No editable slots found — nothing to update.');
      return;
    }

    // 5. Apply each topic
    const count   = Math.min(liveItems.items.length, topics.length);
    let applied   = 0;
    let failed    = 0;

    for (let i = 0; i < count; i++) {
      const item  = liveItems.items[i];
      const topic = topics[i];
      log(`[${i+1}/${count}] Updating slot "${item.title}" → "${topic.label}"…`);

      try {
        const editUrl = `${CMS_BASE}/athena/curate/defenseonetrendingitem/${item.id}/`;
        await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

        // Preserve existing live_date
        const liveDate = await page.inputValue('input[name="live_date"]').catch(() => '');

        // Resolve topic label → integer object ID via Grappelli
        const acUrl = `${CMS_BASE}/grappelli/lookup/autocomplete/?` +
          `term=${encodeURIComponent(topic.label)}&app_label=post_manager&model_name=defenseonetopic&query_string=t=id`;
        const acRes = await page.evaluate(async (url) => {
          const r = await fetch(url, { credentials: 'include' });
          return r.json();
        }, acUrl);

        if (!acRes[0]?.value) throw new Error(`Topic not found in Grappelli: "${topic.label}"`);
        const objectId = acRes[0].value;

        // Fill and submit form
        await page.fill('input[name="object_id"]', String(objectId));

        // Set content_type to 382 (Topic)
        const ctSelect = page.locator('select[name="content_type"]');
        if (await ctSelect.count()) {
          await ctSelect.selectOption({ value: '382' });
        }

        // Clear title_override and url
        await page.fill('input[name="title_override"]', '').catch(() => {});
        await page.fill('input[name="url"]', '').catch(() => {});

        // Set status to Live
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

        // Verify we left the edit page (= success)
        if (page.url().includes(`/${item.id}/`)) {
          throw new Error('Still on edit page after submit — possible validation error');
        }

        log(`  ✓ Applied "${topic.label}" (object_id=${objectId})`);
        applied++;
      } catch (err) {
        log(`  ✗ Failed: ${err.message}`);
        failed++;
      }
    }

    log(`=== Done: ${applied} applied, ${failed} failed, ${liveItems.sponsoredCount} sponsored slots skipped ===`);

  } finally {
    await browser.close();
    logStream.end();
  }
})();
