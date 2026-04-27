#!/usr/bin/env node
// =============================================================
// scripts/apply-earthbox.js
// Nightly Earthbox auto-apply for all enabled GE360 publications.
// Per-pub config (CMS paths, GA4 IDs, Slack emails, etc.) is
// read from a Google Sheet via pub-config.php.
//
// Slots where _is_sponsored_content is checked are skipped.
// Image overrides are cleared so each slot uses the post's own
// featured image.
//
// Usage:
//   node apply-earthbox.js --setup     Log in and save CMS session
//   node apply-earthbox.js             Apply posts (all enabled pubs)
//   node apply-earthbox.js --dry-run   Fetch only, no CMS writes
// =============================================================

'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');

// ── Config ────────────────────────────────────────────────────
const SESSION_FILE   = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const META_FILE      = path.join(process.env.HOME, 'headline-lab', '.session-meta.json');
const LOG_FILE       = path.join(process.env.HOME, 'headline-lab', 'logs', 'earthbox-apply.log');
const PUB_CONFIG_URL = 'https://www.navybook.com/D1/seo/pub-config.php';
const CMS_BASE       = 'https://admin.govexec.com';
const LABEL          = 'Earthbox';

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
  console.log('This session is shared with apply-trending.js.');
  logStream.end();
}

// ── Apply earthbox for one publication ────────────────────────
async function applyEarthboxForPub(page, pub, posts, env) {
  const itemSlug = pub.earthbox_cms_path.replace(/\/$/, '').split('/').pop();

  log(`--- ${pub.pub_name} (${itemSlug}) ---`);

  await page.goto(`${CMS_BASE}${pub.earthbox_cms_path}`, { waitUntil: 'domcontentloaded' });

  // Note: Earthbox list page does not expose _is_sponsored_content —
  // sponsored detection must happen on the individual edit page below.
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
    await sendSlackEmail(`${LABEL}: Problem`, 'No editable Live slots found in CMS — nothing was updated.', env, pub.slack_email);
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

        const fd = new FormData();
        fd.append('csrfmiddlewaretoken', csrf);
        fd.append('content_type',        '22');
        fd.append('object_id',           String(postId));
        fd.append('status',              'live');
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
        const label = `SPONSORED: ${item.title}`;
        displayOld.push(label);
        displayNew.push(label);
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

  log(`  ${pub.pub_name}: ${applied} applied, ${failed} failed, ${skipped} skipped (sponsored)`);

  const unchanged = failed === 0 && appliedNew.every((t, i) => t === appliedOld[i]);
  const status    = failed > 0 ? 'Problem' : unchanged ? 'Unchanged' : 'Changes';
  const oldSet    = new Set(displayOld);
  const bullets   = (titles, bold) => titles.map(t => `* ${bold && !oldSet.has(t) ? `*${t}*` : t}`).join('\n');
  let body;
  if (unchanged) {
    body = `UNCHANGED:\n\n${bullets(displayNew, false)}`;
  } else {
    body = `NEW:\n\n${bullets(displayNew, true)}\n\nOLD:\n\n${bullets(displayOld, false)}`;
  }
  if (errors.length) body += `\n\nErrors:\n${errors.map(e => `  ${e}`).join('\n')}`;
  await sendSlackEmail(`${LABEL}: ${status}`, body, env, pub.slack_email);
}

// ── Main apply ────────────────────────────────────────────────
async function runApply() {
  log(`=== Earthbox apply start${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
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
  const pubs = (configResult.pubs || []).filter(p => p._valid && p.earthbox_enabled);
  if (!pubs.length) die('No valid earthbox-enabled publications found in config.');
  log(`Enabled pubs: ${pubs.map(p => p.pub_name).join(', ')}`);

  // 2. Fetch post recommendations for each pub
  const pubPosts = {};
  for (const pub of pubs) {
    log(`Fetching posts for ${pub.pub_name}…`);
    try {
      const data = await fetchJSON(`${pub.earthbox_api_url}?pub=${pub.pub_key}`);
      if (data.error) throw new Error(data.error);
      pubPosts[pub.pub_key] = data.posts;
      log(`  Got ${data.posts.length} recommendations.`);
      data.posts.forEach((p, i) =>
        log(`    [${i+1}] ${p.title} (post_id=${p.post_id}, score=${p.score})`));
    } catch (e) {
      log(`  API fetch failed for ${pub.pub_name}: ${e.message}`);
      await sendSlackEmail(`${LABEL}: Problem`, `API fetch failed: ${e.message}`, env, pub.slack_email);
      pubPosts[pub.pub_key] = null;
    }
  }

  if (DRY_RUN) {
    log('Dry run — skipping CMS update.');
    logStream.end();
    return;
  }

  // 3. Launch browser with saved session
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page    = await context.newPage();

  try {
    // 4. Session validity check (once — all pubs share the same CMS domain)
    await page.goto(`${CMS_BASE}${pubs[0].earthbox_cms_path}`, { waitUntil: 'domcontentloaded' });
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
      const posts = pubPosts[pub.pub_key];
      if (!posts) { log(`Skipping ${pub.pub_name} — API fetch failed earlier.`); continue; }
      await applyEarthboxForPub(page, pub, posts, env);
    }

    // 7. Persist updated session cookies
    await context.storageState({ path: SESSION_FILE });
    log('=== Done ===');

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
