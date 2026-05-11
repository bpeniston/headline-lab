#!/usr/bin/env node
// =============================================================
// scripts/pre-flight.js
// Runs at 4:55am — validates the CMS session before nightly jobs.
//
// On expiry:  sends ONE consolidated Slack alert and records
//             sessionExpiredAlertSent in .session-meta.json so
//             apply-trending.js and apply-earthbox.js skip duplicates.
// On warning: sends "Session expiring soon" (deduped via lastWarningSent).
// On healthy:  exits 0 silently.
// =============================================================

'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const {
  CMS_BASE, createLogger, loadMeta, saveMeta, daysSince,
  loadEnv, sendSlackEmail, fetchPubConfig,
} = require('./lib');

const META_FILE    = path.join(process.env.HOME, 'headline-lab', '.session-meta.json');
const SESSION_FILE = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const LOG_FILE     = path.join(process.env.HOME, 'headline-lab', 'logs', 'pre-flight.log');

const { log, die, logStream } = createLogger(LOG_FILE);

async function runPreflight() {
  log('=== Pre-flight check ===');

  const env  = loadEnv();
  const data = await fetchPubConfig();
  const pubs = data.pubs.filter(p => p.trending_enabled || p.earthbox_enabled);
  if (!pubs.length) {
    log('No enabled pubs — nothing to check.');
    logStream.end();
    return;
  }

  const trendingPub = pubs.find(p => p.trending_enabled);
  const cmsPath     = trendingPub ? trendingPub.trending_cms_path : pubs[0].earthbox_cms_path;
  const slackEmail  = pubs[0].slack_email;

  const browser = await chromium.launch({ headless: true });
  const context  = await browser.newContext({ storageState: SESSION_FILE });
  const page     = await context.newPage();

  try {
    await page.goto(`${CMS_BASE}${cmsPath}`, { waitUntil: 'domcontentloaded' });
    const pageTitle = await page.title();
    const expired   =
      page.url().includes('/accounts/login/') || page.url().includes('/saml/') ||
      page.url().includes('/sso/')            || page.url().includes('/login/') ||
      pageTitle.toLowerCase().includes('log in') || pageTitle.toLowerCase().includes('sign in');

    const meta     = loadMeta(META_FILE);
    const todayStr = new Date().toISOString().slice(0, 10);

    if (expired) {
      const updatedMeta = { ...meta, sessionExpiredAlertSent: todayStr };
      if (meta.loginDate && !meta.knownTimeoutDays) {
        const elapsed = daysSince(meta.loginDate);
        log(`Session expired after ${elapsed} days — recording as known timeout.`);
        updatedMeta.knownTimeoutDays = elapsed;
      }
      saveMeta(META_FILE, updatedMeta);

      const msg = 'The Air is logged out of the CMS.\n\nvnc://100.117.250.37\n\nexport PATH=/opt/homebrew/bin:$PATH\ncd ~/headline-lab\nnode scripts/apply-trending.js --setup';
      await sendSlackEmail('CMS: Session Expired', msg, env, slackEmail, log);
      die('Session expired — alert sent. Nightly jobs will detect expiry and skip their own alerts.');
    }

    log('Session valid.');

    // Session age warning (deduped with main scripts via lastWarningSent)
    const elapsed     = meta.loginDate ? daysSince(meta.loginDate) : 0;
    const timeoutDays = meta.knownTimeoutDays || 30;
    const warnAt      = meta.knownTimeoutDays ? timeoutDays - 5 : 20;

    if (elapsed >= warnAt && meta.lastWarningSent !== todayStr) {
      saveMeta(META_FILE, { ...meta, lastWarningSent: todayStr });
      const daysLeft = timeoutDays - elapsed;
      const warnMsg  = `The CMS session is ${elapsed} days old and may expire in ~${daysLeft} day${daysLeft === 1 ? '' : 's'}.\n\nRun --setup before it fails:\n\nvnc://100.117.250.37\n\nexport PATH=/opt/homebrew/bin:$PATH\ncd ~/headline-lab\nnode scripts/apply-trending.js --setup`;
      await sendSlackEmail('CMS: Session expiring soon', warnMsg, env, slackEmail, log);
      log(`Session age warning sent (${elapsed} days old, timeout expected ~${timeoutDays}).`);
    }

    log('=== Pre-flight OK ===');

  } finally {
    await browser.close();
    logStream.end();
  }
}

runPreflight().catch(e => { log(`Unhandled error: ${e.message}`); logStream.end(); process.exit(1); });
