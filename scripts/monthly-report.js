#!/usr/bin/env node
// =============================================================
// scripts/monthly-report.js
// Runs on the 1st of each month via launchd (6:00am).
// Fetches previous month's click counts from GA4 for every
// automation-enabled pub in the GE360 Google Sheet, then sends
// one combined email to bpeniston@defenseone.com.
//
// Per-pub data comes from pub-stats.php (?pub=&type=topics|earthbox|skybox).
// Baselines and automation_start_date come from the sheet itself.
// =============================================================

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const PUB_CONFIG_URL = 'https://www.navybook.com/D1/seo/pub-config.php';
const PUB_STATS_URL  = 'https://www.navybook.com/D1/seo/pub-stats.php';
const STATS_TOKEN    = 'e46ac3a0976b1fb6a6e14cf61f5bfb1438dc8768412e7dc7';
const REPORT_EMAIL   = 'bpeniston@defenseone.com, edit-editors-aaaadtyvmussep4z4h5xl7nobi@govexec.slack.com';
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

// ── Fetch stats for one pub/type over an explicit date range ──
// type: topics | earthbox | skybox | total  (total = all site pageviews)
function fetchPubStats(pubKey, type, start, end) {
  let url = `${PUB_STATS_URL}?pub=${pubKey}&type=${type}&token=${STATS_TOKEN}`;
  if (start && end) url += `&start=${start}&end=${end}`;
  return fetchJSON(url).catch(e => ({ views: null, error: e.message }));
}

// ── Date helpers ──────────────────────────────────────────────
function fmtDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
// Previous full calendar month relative to today, and the same
// month one year earlier (the year-over-year anchor).
function reportPeriods() {
  const now       = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
  const yoyStart  = new Date(prevStart.getFullYear() - 1, prevStart.getMonth(), 1);
  const yoyEnd    = new Date(prevStart.getFullYear() - 1, prevStart.getMonth() + 1, 0);
  return {
    cur: { start: fmtDate(prevStart), end: fmtDate(prevEnd) },
    yoy: { start: fmtDate(yoyStart),  end: fmtDate(yoyEnd) },
  };
}
function shareOf(clicks, total) { // ‰: clicks per 1,000 site pageviews
  if (clicks === null || total === null || !total) return null;
  return (clicks / total) * 1000;
}
// Baselines may arrive comma-formatted from the sheet (e.g. "5,611");
// plain parseInt would stop at the comma and return 5.
function parseBaseline(v) {
  return parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10) || 0;
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

// ── Format one feature line ───────────────────────────────────
// Headline metric is traffic SHARE (‰ of total site pageviews),
// normalized so site-wide traffic swings don't distort the read.
// YoY compares this month's share to the same month last year
// (seasonality control). The corrected click baseline from the
// sheet is shown as secondary context.
function fmtShare(s) { return s === null ? 'n/a' : s.toFixed(2) + '‰'; }
function pctArrow(cur, prev) {
  if (cur === null || prev === null || !prev) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return (pct >= 0 ? '▲' : '▼') + ' ' + (pct >= 0 ? '+' : '') + pct + '%';
}
function featureLine(label, clicks, share, yoyShare, baselineClicks) {
  if (clicks === null) return `  ${label}: error fetching data`;
  let line = `  ${label}: ${clicks.toLocaleString()} clicks · ${fmtShare(share)} share`;
  const yoy = pctArrow(share, yoyShare);
  if (yoy) line += ` · YoY ${yoy} (was ${fmtShare(yoyShare)})`;
  if (baselineClicks) {
    const diff = clicks - baselineClicks;
    const pct  = Math.round((diff / baselineClicks) * 100);
    line += ` · vs base ${baselineClicks.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct}%)`;
  } else {
    line += ` · baseline not set`;
  }
  return line;
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  log('=== Monthly report ===');
  const env = loadEnv();

  // Fetch pub config. earthbox_enabled/skybox_enabled are the strings
  // OFF/GA4/RECENT_STAFF — 'OFF' is truthy in JS, so test !== 'OFF',
  // not plain truthiness. trending_enabled is a real boolean.
  let allPubs;
  try {
    const data = await fetchJSON(PUB_CONFIG_URL);
    allPubs = (data.pubs || []).filter(p => p._valid &&
      (p.trending_enabled || p.earthbox_enabled !== 'OFF' || p.skybox_enabled !== 'OFF'));
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

  const { cur, yoy } = reportPeriods();
  log(`Current month: ${cur.start}…${cur.end}  |  YoY anchor: ${yoy.start}…${yoy.end}`);

  // For each pub, fetch: total site pageviews (current + YoY) once, plus
  // per-enabled-feature clicks (current + YoY). Share = clicks / total.
  const statResults = await Promise.all(allPubs.map(async pub => {
    const feats = [
      { key: 'topics',   label: 'Topics',   on: pub.trending_enabled        && pub.topic_oref,    base: parseBaseline(pub.topics_baseline)   },
      { key: 'earthbox', label: 'Earthbox', on: pub.earthbox_enabled !== 'OFF' && pub.earthbox_oref, base: parseBaseline(pub.earthbox_baseline) },
      { key: 'skybox',   label: 'Skybox',   on: pub.skybox_enabled   !== 'OFF' && pub.skybox_oref,   base: parseBaseline(pub.skybox_baseline)   },
    ].filter(f => f.on);

    const [totCur, totYoy] = await Promise.all([
      fetchPubStats(pub.pub_key, 'total', cur.start, cur.end),
      fetchPubStats(pub.pub_key, 'total', yoy.start, yoy.end),
    ]);

    const features = await Promise.all(feats.map(async f => {
      const [c, y] = await Promise.all([
        fetchPubStats(pub.pub_key, f.key, cur.start, cur.end),
        fetchPubStats(pub.pub_key, f.key, yoy.start, yoy.end),
      ]);
      return {
        label: f.label, base: f.base,
        clicks:   c ? c.views : null,
        share:    shareOf(c ? c.views : null, totCur ? totCur.views : null),
        yoyShare: shareOf(y ? y.views : null, totYoy ? totYoy.views : null),
      };
    }));

    return { totCur, features };
  }));

  const withMonth = statResults.find(r => r.totCur && r.totCur.month);
  const month = withMonth ? withMonth.totCur.month : 'Unknown month';

  // Build report body
  const sections = [];
  const totals   = { Topics: 0, Earthbox: 0, Skybox: 0 };
  const has       = { Topics: false, Earthbox: false, Skybox: false };

  for (let i = 0; i < allPubs.length; i++) {
    const pub        = allPubs[i];
    const startDate  = pub.automation_start_date || null;
    const startLabel = startDate ? ` (automation since ${startDate})` : '';
    const lines      = [`${pub.pub_name}${startLabel}`];

    for (const f of statResults[i].features) {
      lines.push(featureLine(f.label, f.clicks, f.share, f.yoyShare, f.base));
      if (f.clicks !== null) { totals[f.label] += f.clicks; has[f.label] = true; }
    }

    sections.push(lines.join('\n'));
    log(`${pub.pub_name}: ` + statResults[i].features.map(f => `${f.label}=${f.clicks ?? 'n/a'}`).join(', '));
  }

  // Totals (clicks only — shares use different per-pub denominators and don't sum)
  if (allPubs.length > 1) {
    const totalLines = ['TOTALS (clicks)'];
    ['Topics', 'Earthbox', 'Skybox'].forEach(k => {
      if (has[k]) totalLines.push(`  ${k}: ${totals[k].toLocaleString()}`);
    });
    const combined = totals.Topics + totals.Earthbox + totals.Skybox;
    if (Object.values(has).filter(Boolean).length > 1) {
      totalLines.push(`  Combined: ${combined.toLocaleString()}`);
    }
    sections.push(totalLines.join('\n'));
  }

  const intro = `Share = clicks per 1,000 total site pageviews (normalizes out traffic swings).\n` +
    `YoY compares this month's share to the same month last year (seasonality control).\n` +
    `"vs base" compares clicks to the 12-mo pre-automation average (Apr 2025–Mar 2026).`;
  const subject = `GE360 Monthly Report — ${month}`;
  const body    = [intro, ...sections].join('\n\n');

  if (process.argv.includes('--dry-run')) {
    log(`DRY RUN — would send "${subject}". Body:\n\n${body}\n`);
    logStream.end();
    return;
  }

  await sendEmail(subject, body, env);
  logStream.end();
})();
