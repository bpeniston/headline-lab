#!/usr/bin/env node
// =============================================================
// scripts/monthly-report.js
// Runs on the 1st of each month via launchd.
// Fetches previous month's Trending Topics nav click count from
// GA4, compares to pre-automation baseline, and sends a summary
// to Slackbot via Gmail SMTP.
//
// Baseline (Oct 2025–Mar 2026, pre-automation): 3,005/month avg
// =============================================================

'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const STATS_URL      = 'https://www.navybook.com/D1/seo/monthly-stats.php';
const STATS_TOKEN    = 'e46ac3a0976b1fb6a6e14cf61f5bfb1438dc8768412e7dc7';
const BASELINE_AVG   = 3005;
const BASELINE_LABEL = 'Oct 2025–Mar 2026 avg';
const SLACK_EMAIL    = 'u5q8h4r0o7x8o9l7@govexec.slack.com';
const LOG_FILE       = path.join(process.env.HOME, 'headline-lab', 'logs', 'monthly-report.log');

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
function fetchStats() {
  return new Promise((resolve, reject) => {
    https.get(`${STATS_URL}?token=${STATS_TOKEN}`, res => {
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
  log('=== Monthly Trending Topics report ===');
  const env = loadEnv();

  let stats;
  try {
    stats = await fetchStats();
  } catch (e) {
    log(`Failed to fetch stats: ${e.message}`);
    logStream.end();
    process.exit(1);
  }

  const { month, views } = stats;
  const diff    = views - BASELINE_AVG;
  const pct     = Math.round((diff / BASELINE_AVG) * 100);
  const sign    = diff >= 0 ? '+' : '';
  const vs      = `${sign}${diff.toLocaleString()} (${sign}${pct}%) vs ${BASELINE_LABEL} of ${BASELINE_AVG.toLocaleString()}`;

  log(`${month}: ${views.toLocaleString()} views. ${vs}`);

  const subject = `D1 Trending Topics — ${month}: ${views.toLocaleString()} clicks`;
  const body    = `${month}: ${views.toLocaleString()} clicks on Trending Topics nav links\n${vs}`;

  await sendEmail(subject, body, env);
  logStream.end();
})();
