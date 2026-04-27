#!/usr/bin/env node
// =============================================================
// scripts/apply-trending.js
// Nightly Trending Topics auto-apply for all enabled GE360 pubs.
// Per-pub config (CMS paths, GA4 IDs, Slack emails, etc.) is
// read from a Google Sheet via pub-config.php.
//
// Usage:
//   node apply-trending.js --setup     Log in and save CMS session
//   node apply-trending.js             Apply topics (all enabled pubs)
//   node apply-trending.js --dry-run   Fetch only, no CMS writes
// =============================================================

'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');

// ── Config ────────────────────────────────────────────────────
const SESSION_FILE   = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const META_FILE      = path.join(process.env.HOME, 'headline-lab', '.session-meta.json');
const LOG_FILE       = path.join(process.env.HOME, 'headline-lab', 'logs', 'trending-apply.log');
const PUB_CONFIG_URL  = 'https://www.navybook.com/D1/seo/pub-config.php';
const TRENDING_API_URL = 'https://www.navybook.com/D1/seo/trending-topics.php';
const CMS_BASE       = 'https://admin.govexec.com';
const LABEL          = 'Topics';

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

// ── Slack ─────────────────────────────────────────────────────
async function sendSlackEmail(subject, body, env, slackEmail) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s+/g, '') },
    });
    await transporter.sendMail({
      from: `Athena Tools <${env.SMTP_USER}>`,
      to:   slackEmail,
      subject,
      text: body,
    });
    log('Slack notification sent.');
  } catch (e) {
    log(`Slack email error: ${e.message}`);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const sep = url.includes('?') ? '&' : '?';
    https.get(`${url}${sep}bust=${Date.now()}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchPubConfig() {
  const data = await fetchJSON(PUB_CONFIG_URL);
  if (data.error) throw new Error(`pub-config.php: ${data.error}`);
  return data;
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

// ── Setup mode ────────────────────────────────────────────────
async function runSetup() {
  console.log('\n=== CMS Session Setup ===');
  console.log('A browser window will open. Log in normally (including 2FA).');
  console.log('Once you are logged into the CMS, come back here and press Enter.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto(`${CMS_BASE}/athena/`);

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write('Press Enter once you are logged in to the CMS…');
    process.stdin.once('data', () => resolve());
  });

  if (!page.url().includes('admin.govexec.com')) {
    console.log(`Warning: current URL is ${page.url()} — expected admin.govexec.com.`);
    console.log('Session saved anyway, but you may need to re-run --setup.');
  }

  await context.storageState({ path: SESSION_FILE });
  await browser.close();

  const meta = loadMeta();
  saveMeta({ ...meta, loginDate: new Date().toISOString(), lastWarningSent: null });

  console.log(`\nSession saved to ${SESSION_FILE}`);
  console.log('This session covers all GE360 publications (same CMS domain).');
  console.log('Re-run --setup if the session expires.');
  logStream.end();
}

// ── Apply topics for one publication ─────────────────────────
async function applyTrendingForPub(page, pub, topics, env) {
  const itemSlug = pub.trending_cms_path.replace(/\/$/, '').split('/').pop();

  log(`--- ${pub.pub_name} (${itemSlug}) ---`);
  log(`  Topics: ${topics.map(t => t.label).join(', ')}`);

  await page.goto(`${CMS_BASE}${pub.trending_cms_path}`, { waitUntil: 'domcontentloaded' });

  const { items: liveItems, sponsoredCount } = await page.evaluate(itemSlug => {
    const items = [];
    let sponsoredCount = 0;
    document.querySelectorAll('#result_list tbody tr').forEach(row => {
      const cells  = Array.from(row.querySelectorAll('td'));
      const isLive = cells.some(td => td.textContent.trim() === 'Live');
      if (!isLive) return;

      const editLink = row.querySelector(`th a[href*="/${itemSlug}/"]`);
      const idMatch  = editLink?.getAttribute('href')
        ?.match(new RegExp(`/${itemSlug}/(\\d+)/`));
      if (!idMatch) return;

      const title = (editLink?.textContent || '').trim();
      if (title.startsWith('Sponsored:')) { sponsoredCount++; return; }
      items.push({ id: idMatch[1], title });
    });
    return { items, sponsoredCount };
  }, itemSlug);

  log(`  Found ${liveItems.length} editable Live slots, ${sponsoredCount} sponsored (skipped).`);

  if (!liveItems.length) {
    log('  No editable slots found — nothing to update.');
    await sendSlackEmail(`${LABEL}: Problem`, 'No editable Live slots found in CMS — nothing was updated.', env, pub.slack_email);
    return;
  }

  const count     = Math.min(liveItems.length, topics.length);
  const oldLabels = liveItems.slice(0, count).map(i => i.title);
  const newLabels = topics.slice(0, count).map(t => t.label);
  let applied     = 0;
  let failed      = 0;
  const errors    = [];

  for (let i = 0; i < count; i++) {
    const item  = liveItems[i];
    const topic = topics[i];
    log(`  [${i+1}/${count}] "${item.title}" → "${topic.label}"…`);

    try {
      const editUrl = `${CMS_BASE}/athena/curate/${itemSlug}/${item.id}/`;

      const result = await page.evaluate(
        async ({ editUrl, topicLabel, cmsBase, grappelliModel, grappelliAppLabel, topicContentType }) => {
          const pageRes = await fetch(editUrl, { credentials: 'include' });
          if (!pageRes.ok) return { error: `GET returned ${pageRes.status}` };
          const html = await pageRes.text();
          const doc  = new DOMParser().parseFromString(html, 'text/html');

          const csrf = doc.querySelector('[name="csrfmiddlewaretoken"]')?.value;
          if (!csrf) return { error: 'No CSRF token found — session may have expired' };

          const liveDate    = doc.querySelector('[name="live_date"]')?.value || '';
          const statusSelect = doc.querySelector('select[name="status"]');
          const liveVal     = Array.from(statusSelect?.options || [])
            .find(o => o.text.trim() === 'Live')?.value ?? 'live';

          const acUrl = `${cmsBase}/grappelli/lookup/autocomplete/?` +
            `term=${encodeURIComponent(topicLabel)}&app_label=${grappelliAppLabel}` +
            `&model_name=${grappelliModel}&query_string=t=id`;
          const acRes  = await fetch(acUrl, { credentials: 'include' });
          if (!acRes.ok) return { error: `Grappelli returned ${acRes.status}` };
          const acData = await acRes.json();
          if (!acData[0]?.value) return { error: `Topic not found in Grappelli: "${topicLabel}"` };
          const objectId = acData[0].value;

          const formData = new FormData();
          formData.append('csrfmiddlewaretoken', csrf);
          formData.append('content_type',        String(topicContentType));
          formData.append('object_id',           String(objectId));
          formData.append('status',              liveVal);
          formData.append('live_date',           liveDate);
          formData.append('expiration_date',     '');
          formData.append('is_sponsored_content', '');
          formData.append('url',                 '');
          formData.append('title_override',      '');

          const saveRes = await fetch(editUrl, {
            method: 'POST', body: formData, credentials: 'include',
          });
          if (!saveRes.ok) return { error: `POST returned ${saveRes.status}` };
          if (saveRes.url?.includes('/change/') || saveRes.url === editUrl) {
            return { error: 'Stayed on edit page after POST — validation error' };
          }
          return { objectId };
        },
        { editUrl, topicLabel: topic.label, cmsBase: CMS_BASE,
          grappelliModel: pub.grappelli_topic_model,
          grappelliAppLabel: pub.grappelli_app_label,
          topicContentType: pub.topic_content_type }
      );

      if (result.error) throw new Error(result.error);
      log(`    ✓ Applied "${topic.label}" (object_id=${result.objectId})`);
      applied++;
    } catch (err) {
      log(`    ✗ Failed for item ${item.id}: ${err.message}`);
      errors.push(`Slot ${item.id}: ${err.message}`);
      failed++;
    }
  }

  log(`  ${pub.pub_name}: ${applied} applied, ${failed} failed, ${sponsoredCount} sponsored skipped`);

  const unchanged    = failed === 0 && newLabels.every((l, i) => l === oldLabels[i]);
  const status       = failed > 0 ? 'Problem' : unchanged ? 'Unchanged' : 'Changes';
  const oldSet       = new Set(oldLabels);
  const formattedNew = newLabels.map(l => oldSet.has(l) ? l : `*${l}*`);
  let body           = `New: ${formattedNew.join(', ')}\nOld: ${oldLabels.join(', ')}`;
  if (errors.length) body += `\n\nErrors:\n${errors.map(e => `  ${e}`).join('\n')}`;
  await sendSlackEmail(`${LABEL}: ${status}`, body, env, pub.slack_email);
}

// ── Main apply ────────────────────────────────────────────────
async function runApply() {
  log(`=== Trending apply start${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
  const env = loadEnv();

  if (!fs.existsSync(SESSION_FILE)) {
    die('No session file found. Run with --setup first.');
  }

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
  const pubs = (configResult.pubs || []).filter(p => p._valid && p.trending_enabled);
  if (!pubs.length) die('No valid trending-enabled publications found in config.');
  log(`Enabled pubs: ${pubs.map(p => p.pub_name).join(', ')}`);

  // 2. Fetch topic recommendations for each pub
  const pubTopics = {};
  for (const pub of pubs) {
    log(`Fetching topics for ${pub.pub_name}…`);
    try {
      const data = await fetchJSON(`${TRENDING_API_URL}?pub=${pub.pub_key}`);
      if (data.error) throw new Error(data.error);
      pubTopics[pub.pub_key] = data.topics;
      log(`  Got ${data.topics.length}: ${data.topics.map(t => t.label).join(', ')}`);
    } catch (e) {
      log(`  API fetch failed for ${pub.pub_name}: ${e.message}`);
      await sendSlackEmail(`${LABEL}: Problem`, `API fetch failed: ${e.message}`, env, pub.slack_email);
      pubTopics[pub.pub_key] = null;
    }
  }

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
    await page.goto(`${CMS_BASE}${pubs[0].trending_cms_path}`, { waitUntil: 'domcontentloaded' });
    const pageTitle = await page.title();
    if (page.url().includes('/accounts/login/') || page.url().includes('/saml/') ||
        page.url().includes('/sso/')            || page.url().includes('/login/') ||
        pageTitle.toLowerCase().includes('log in') || pageTitle.toLowerCase().includes('sign in')) {
      const meta = loadMeta();
      if (meta.loginDate && !meta.knownTimeoutDays) {
        const elapsed = daysSince(meta.loginDate);
        log(`Session expired after ${elapsed} days — saving as known timeout.`);
        saveMeta({ ...meta, knownTimeoutDays: elapsed });
      }
      const msg = 'The Air is logged out of the CMS.\n\nvnc://100.117.250.37\n\nexport PATH=/opt/homebrew/bin:$PATH\ncd ~/headline-lab\nnode scripts/apply-trending.js --setup';
      for (const pub of pubs) await sendSlackEmail(`${LABEL}: Problem`, msg, env, pub.slack_email);
      die('Session has expired — notifications sent.');
    }

    log('Session valid.');

    // 5. Session age warning (once, shared across all pubs)
    const meta        = loadMeta();
    const elapsed     = meta.loginDate ? daysSince(meta.loginDate) : 0;
    const timeoutDays = meta.knownTimeoutDays || 30;
    const warnAt      = timeoutDays - 5;
    const todayStr    = new Date().toISOString().slice(0, 10);
    if (elapsed >= warnAt && meta.lastWarningSent !== todayStr) {
      saveMeta({ ...meta, lastWarningSent: todayStr });
      const daysLeft = timeoutDays - elapsed;
      const warnMsg  = `The CMS session is ${elapsed} days old and may expire in ~${daysLeft} day${daysLeft === 1 ? '' : 's'}.\n\nRun --setup before it fails:\n\nvnc://100.117.250.37\n\nexport PATH=/opt/homebrew/bin:$PATH\ncd ~/headline-lab\nnode scripts/apply-trending.js --setup`;
      await sendSlackEmail(`${LABEL}: Session expiring soon`, warnMsg, env, pubs[0].slack_email);
      log(`Session age warning sent (${elapsed} days old, timeout expected at ~${timeoutDays}).`);
    }

    // 6. Apply for each pub
    for (const pub of pubs) {
      const topics = pubTopics[pub.pub_key];
      if (!topics) { log(`Skipping ${pub.pub_name} — API fetch failed earlier.`); continue; }
      await applyTrendingForPub(page, pub, topics, env);
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
  runSetup().catch(e => { console.error(e); process.exit(1); });
} else {
  runApply().catch(e => { log(`Unhandled error: ${e.message}`); logStream.end(); process.exit(1); });
}
