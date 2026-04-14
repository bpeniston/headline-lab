#!/usr/bin/env node
// =============================================================
// scripts/monthly-report.js
// Runs on the 1st of each month via launchd.
// Fetches previous month's click counts from GA4 for:
//   - Trending Topics nav links (oref=d1-article-topics)
//   - Earthbox article links   (oref=d1-earthbox-post)
// Sends a combined summary to Slackbot via Gmail SMTP.
//
// Topics baseline (Oct 2025–Mar 2026, pre-automation): 3,005/month avg
// Earthbox baseline: TBD (auto-update launched Apr 2026)
// =============================================================

'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const TOPICS_STATS_URL   = 'https://www.navybook.com/D1/seo/monthly-stats.php';
const EARTHBOX_STATS_URL = 'https://www.navybook.com/D1/seo/earthbox-stats.php';
const STATS_TOKEN        = 'e46ac3a0976b1fb6a6e14cf61f5bfb1438dc8768412e7dc7';
const TOPICS_BASELINE    = 3005;
const TOPICS_BASELINE_LABEL = 'Oct 2025–Mar 2026 avg';
const SLACK_EMAIL        = 'u5q8h4r0o7x8o9l7@govexec.slack.com';
const LOG_FILE           = path.join(process.env.HOME, 'headline-lab', 'logs', 'monthly-report.log');

// ── Logging ───────────────────────────────────────────────────
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

// ── Load .env ─────────────────────────────────────────────────
function loadEnv() {
  const envFile = path.join(process.env.HOME, 'headline-lab', '.env');
  const env = {};
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

// ── Fetch monthly stats from DreamHost ───────────────────────
function fetchStats(url) {
  return new Promise((resolve, reject) => {
    https.get(`${url}?token=${STATS_TOKEN}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Send email via Gmail SMTP ─────────────────────────────────
async function sendEmail(subject, body, env) {
  try {
    const nodemailer  = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS.replace(/\s+/g, ''),
      },
    });
    await transporter.sendMail({
      from:    `Athena Tools <${env.SMTP_USER}>`,
      to:      SLACK_EMAIL,
      subject,
      text:    body,
    });
    log('Report sent.');
  } catch (e) {
    log(`Email error: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  log('=== Monthly report ===');
  const env = loadEnv();

  let topicsStats, earthboxStats;
  try {
    [topicsStats, earthboxStats] = await Promise.all([
      fetchStats(TOPICS_STATS_URL),
      fetchStats(EARTHBOX_STATS_URL),
    ]);
  } catch (e) {
    log(`Failed to fetch stats: ${e.message}`);
    logStream.end();
    process.exit(1);
  }

  const { month } = topicsStats;

  // Topics line
  const tViews = topicsStats.views;
  const tDiff  = tViews - TOPICS_BASELINE;
  const tPct   = Math.round((tDiff / TOPICS_BASELINE) * 100);
  const tSign  = tDiff >= 0 ? '+' : '';
  const tVs    = `${tSign}${tDiff.toLocaleString()} (${tSign}${tPct}%) vs ${TOPICS_BASELINE_LABEL} of ${TOPICS_BASELINE.toLocaleString()}`;

  // Earthbox line
  const eViews = earthboxStats.views;

  log(`Topics: ${tViews.toLocaleString()} clicks. ${tVs}`);
  log(`Earthbox: ${eViews.toLocaleString()} clicks.`);

  const subject = `D1 Monthly Report — ${month}`;
  const body    = [
    `Trending Topics nav clicks: ${tViews.toLocaleString()}`,
    tVs,
    '',
    `Earthbox clicks: ${eViews.toLocaleString()}`,
    '(auto-update launched Apr 2026 — baseline TBD)',
  ].join('\n');

  await sendEmail(subject, body, env);
  logStream.end();
})();
