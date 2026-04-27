#!/usr/bin/env node
// =============================================================
// scripts/monthly-report.js
// Runs on the 1st of each month via launchd (6:00am).
// Fetches previous month's click counts from GA4 for every
// automation-enabled pub in the GE360 Google Sheet, then sends
// one combined email to bpeniston@defenseone.com.
//
// Per-pub data comes from pub-stats.php (?pub=&type=topics|earthbox).
// Baselines and automation_start_date come from the sheet itself.
// =============================================================

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const PUB_CONFIG_URL = 'https://www.navybook.com/D1/seo/pub-config.php';
const PUB_STATS_URL  = 'https://www.navybook.com/D1/seo/pub-stats.php';
const STATS_TOKEN    = 'e46ac3a0976b1fb6a6e14cf61f5bfb1438dc8768412e7dc7';
const REPORT_EMAIL   = 'bpeniston@defenseone.com';
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

// ── HTTP fetch → JSON ─────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
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

// ── Fetch stats for one pub/type ──────────────────────────────
function fetchPubStats(pubKey, type) {
  const url = `${PUB_STATS_URL}?pub=${pubKey}&type=${type}&token=${STATS_TOKEN}`;
  return fetchJSON(url).catch(e => ({ views: null, error: e.message }));
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
      to:      REPORT_EMAIL,
      subject,
      text:    body,
    });
    log(`Report sent to ${REPORT_EMAIL}.`);
  } catch (e) {
    log(`Email error: ${e.message}`);
  }
}

// ── Format a click count line with optional baseline comparison ──
function clickLine(label, views, baseline) {
  if (views === null) return `  ${label}: error fetching data`;
  const n = views.toLocaleString();
  if (!baseline) return `  ${label}: ${n} clicks (baseline not yet established)`;
  const diff = views - baseline;
  const pct  = Math.round((diff / baseline) * 100);
  const sign = diff >= 0 ? '+' : '';
  return `  ${label}: ${n} clicks (${sign}${diff.toLocaleString()}, ${sign}${pct}% vs pre-automation avg of ${baseline.toLocaleString()})`;
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  log('=== Monthly report ===');
  const env = loadEnv();

  // Fetch pub config
  let allPubs;
  try {
    const data = await fetchJSON(PUB_CONFIG_URL);
    allPubs = (data.pubs || []).filter(p => p._valid && (p.trending_enabled || p.earthbox_enabled));
  } catch (e) {
    log(`Failed to fetch pub config: ${e.message}`);
    logStream.end();
    process.exit(1);
  }

  if (!allPubs.length) {
    log('No enabled pubs found in config — nothing to report.');
    logStream.end();
    process.exit(0);
  }

  // Fetch stats for all pubs in parallel
  const statResults = await Promise.all(
    allPubs.map(pub => Promise.all([
      pub.trending_enabled && pub.topic_oref   ? fetchPubStats(pub.pub_key, 'topics')   : Promise.resolve(null),
      pub.earthbox_enabled && pub.earthbox_oref ? fetchPubStats(pub.pub_key, 'earthbox') : Promise.resolve(null),
    ]))
  );

  const month = statResults.flat().find(r => r && r.month)?.month || 'Unknown month';

  // Build report body
  const sections = [];
  let totalTopics   = 0;
  let totalEarthbox = 0;
  let hasTopics     = false;
  let hasEarthbox   = false;

  for (let i = 0; i < allPubs.length; i++) {
    const pub          = allPubs[i];
    const [tStats, eStats] = statResults[i];
    const startDate    = pub.automation_start_date || null;
    const startLabel   = startDate ? ` (automation since ${startDate})` : '';

    const lines = [`${pub.pub_name}${startLabel}`];

    if (tStats !== null) {
      const baseline = parseInt(pub.topics_baseline, 10) || 0;
      lines.push(clickLine('Topics', tStats.views, baseline));
      if (tStats.views !== null) { totalTopics += tStats.views; hasTopics = true; }
    }
    if (eStats !== null) {
      const baseline = parseInt(pub.earthbox_baseline, 10) || 0;
      lines.push(clickLine('Earthbox', eStats.views, baseline));
      if (eStats.views !== null) { totalEarthbox += eStats.views; hasEarthbox = true; }
    }

    sections.push(lines.join('\n'));
    log(`${pub.pub_name}: Topics=${tStats?.views ?? 'n/a'}, Earthbox=${eStats?.views ?? 'n/a'}`);
  }

  // Totals (only meaningful if there are multiple enabled pubs)
  if (allPubs.length > 1) {
    const totalLines = ['TOTALS'];
    if (hasTopics)   totalLines.push(`  Topics:   ${totalTopics.toLocaleString()} clicks`);
    if (hasEarthbox) totalLines.push(`  Earthbox: ${totalEarthbox.toLocaleString()} clicks`);
    if (hasTopics && hasEarthbox) {
      totalLines.push(`  Combined: ${(totalTopics + totalEarthbox).toLocaleString()} clicks`);
    }
    sections.push(totalLines.join('\n'));
  }

  const subject = `GE360 Monthly Report — ${month}`;
  const body    = sections.join('\n\n');

  await sendEmail(subject, body, env);
  logStream.end();
})();
