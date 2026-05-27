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
  loadEnv, isSessionExpired, makeSetupMsg, makeWarnMsg,
  sendSlackEmail, fetchPubConfig,
} = require('./lib');

const META_FILE    = path.join(process.env.HOME, 'headline-lab', '.session-meta.json');
const SESSION_FILE = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const LOG_FILE     = path.join(process.env.HOME, 'headline-lab', 'logs', 'pre-flight.log');

const { log, die, logStream } = createLogger(LOG_FILE);

async function runPreflight() {
  log('=== Pre-flight check ===');

  const env  = loadEnv();
  const data = await fetchPubConfig();
  const pubs = data.pubs.filter(p => p._valid && (p.trending_enabled || p.earthbox_enabled !== 'OFF'));
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
    const meta      = loadMeta(META_FILE);
    const todayStr  = new Date().toISOString().slice(0, 10);

    if (isSessionExpired(page.url(), pageTitle)) {
      const updatedMeta = { ...meta, sessionExpiredAlertSent: todayStr };
      if (meta.loginDate && !meta.knownTimeoutDays) {
        const elapsed = daysSince(meta.loginDate);
        log(`Session expired after ${elapsed} days — recording as known timeout.`);
        updatedMeta.knownTimeoutDays = elapsed;
      }
      saveMeta(META_FILE, updatedMeta);
      await sendSlackEmail('CMS: ACTION REQUIRED — Playwright session expired', makeSetupMsg('apply-trending.js'), env, slackEmail, log);
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
      await sendSlackEmail('CMS: Session expiring soon', makeWarnMsg('apply-trending.js', elapsed, daysLeft), env, slackEmail, log);
      log(`Session age warning sent (${elapsed} days old, timeout expected ~${timeoutDays}).`);
    }

    log('=== Pre-flight OK ===');

  } finally {
    await browser.close();
    logStream.end();
  }
}

const testAlertIdx = process.argv.indexOf('--test-alert');
if (testAlertIdx !== -1) {
  (async () => {
    const which = process.argv[testAlertIdx + 1];
    const env   = loadEnv();
    const data  = await fetchPubConfig();
    const slackEmail = (data.pubs.find(p => p._valid) || {}).slack_email;
    if (!slackEmail) { console.error('No slack_email found in config'); process.exit(1); }

    if (which === 'expired') {
      await sendSlackEmail(
        'CMS: ACTION REQUIRED — Playwright session expired [TEST]',
        makeSetupMsg('apply-trending.js'),
        env, slackEmail, console.log
      );
    } else if (which === 'warning') {
      await sendSlackEmail(
        'CMS: Session expiring soon [TEST]',
        makeWarnMsg('apply-trending.js', 9, 5),
        env, slackEmail, console.log
      );
    } else {
      console.error('Usage: node pre-flight.js --test-alert expired|warning');
      process.exit(1);
    }
    console.log('Test alert sent.');
  })().catch(e => { console.error(e.message); process.exit(1); });
} else {
  runPreflight().catch(e => { log(`Unhandled error: ${e.message}`); logStream.end(); process.exit(1); });
}
