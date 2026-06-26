#!/usr/bin/env node
// =============================================================
// scripts/pull-impact-report.js
// Before/after impact report for the GE360 automation project
// (Topics / Earthbox / Skybox auto-updaters, launched Apr 2026).
//
// For every pub + feature it reports, per month:
//   • absolute clicks (screenPageViews where the destination URL
//     CONTAINS oref=<oref>) — matches server/pub-stats.php exactly,
//     so figures are comparable to previously published numbers.
//   • SHARE = clicks per 1,000 total site pageviews (‰) for that
//     pub/month — normalizes out overall traffic swings, so we see
//     the widget's share of traffic, not just raw counts.
//
// Baseline = the 12 months Apr 2025–Mar 2026 (pre-automation).
//   Reported as the monthly average plus the min–max band.
// Year-over-year (YoY) = each 2026 month vs the same calendar
//   window in 2025 (the strongest seasonality control). The June
//   YoY anchor uses the same 1–25 partial window as June 2026.
//
// Node compatibility: written for old DreamHost-era Node (v12).
// No fetch(), no optional chaining (?.), no nullish coalescing.
// Uses require('https') with a manual httpsPost helper.
//
// Usage:  node scripts/pull-impact-report.js   (stdout only)
// =============================================================

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CONCURRENCY = 6; // parallel GA4 requests

// ── Pubs and their GA4 property IDs (from CLAUDE.md) ──────────
const PUBS = [
  { key: 'd1', name: 'Defense One',           property: '353836589' },
  { key: 'wt', name: 'Washington Technology', property: '358726868' },
  { key: 'ge', name: 'GovExec',               property: '353164424' },
  { key: 'ng', name: 'Nextgov',               property: '353764914' },
  { key: 'rf', name: 'Route Fifty',           property: '353766084' }
];

// ── Features and their oref suffix ────────────────────────────
// oref = `${pub.key}-${orefSuffix}`. All verified against the
// sheet's topic_oref / earthbox_oref / skybox_oref columns.
//   Topics:   {prefix}-article-topics
//   Earthbox: {prefix}-earthbox-post
//   Skybox:   {prefix}-skybox-hp   (homepage — NOT -skybox-post)
const FEATURES = [
  { label: 'Topics',   orefSuffix: 'article-topics' },
  { label: 'Earthbox', orefSuffix: 'earthbox-post' },
  { label: 'Skybox',   orefSuffix: 'skybox-hp' }
];

const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function fullMonth(year, month) { // month 1-12
  const last = new Date(year, month, 0).getDate();
  return {
    start: year + '-' + pad2(month) + '-01',
    end:   year + '-' + pad2(month) + '-' + pad2(last),
    label: MON[month] + " '" + String(year).slice(2)
  };
}

// ── 12-month pre-automation baseline window (Apr 2025–Mar 2026)
const BASELINE = [];
for (let i = 0; i < 12; i++) {
  const d = new Date(2025, 3 + i, 1); // start at Apr 2025 (month index 3)
  BASELINE.push(fullMonth(d.getFullYear(), d.getMonth() + 1));
}

// ── Post-launch windows ───────────────────────────────────────
const POST = [
  { start: '2026-04-01', end: '2026-04-30', label: "Apr '26" },
  { start: '2026-05-01', end: '2026-05-31', label: "May '26" },
  { start: '2026-06-01', end: '2026-06-25', label: "Jun '26*", mtd: true }
];

// ── YoY anchor for each post-launch window (same window, 2025) ─
// Keyed by post-window label. June anchor matches the 1–25 partial.
const YOY = {
  "Apr '26":  { start: '2025-04-01', end: '2025-04-30', label: "Apr '25" },
  "May '26":  { start: '2025-05-01', end: '2025-05-31', label: "May '25" },
  "Jun '26*": { start: '2025-06-01', end: '2025-06-25', label: "Jun '25*" }
};

function winKey(w) { return w.start + '|' + w.end; }

// All unique month windows we need data for (baseline + post + YoY)
const ALL_WINDOWS = (function () {
  const seen = {};
  const out  = [];
  BASELINE.concat(POST, Object.keys(YOY).map(function (k) { return YOY[k]; }))
    .forEach(function (w) {
      const k = winKey(w);
      if (!seen[k]) { seen[k] = true; out.push(w); }
    });
  return out;
})();

// ── Credential loading (mirrors lib.js loadEnv, with file fallback)
function loadEnvFile() {
  const envFile = path.join(process.env.HOME, 'headline-lab', '.env');
  const env = {};
  let src;
  try { src = fs.readFileSync(envFile, 'utf8'); } catch (e) { return env; }
  src.split('\n').forEach(function (line) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

function loadGA4Creds() {
  const env = loadEnvFile();
  if (env.GA4_CLIENT_ID && env.GA4_CLIENT_SECRET && env.GA4_REFRESH_TOKEN) {
    return {
      client_id:     env.GA4_CLIENT_ID,
      client_secret: env.GA4_CLIENT_SECRET,
      refresh_token: env.GA4_REFRESH_TOKEN
    };
  }
  const candidates = [
    process.env.GA4_OAUTH_PATH,
    path.join(process.env.HOME, 'ga4-oauth.json'),
    '/home/bradwu/navybook.com/D1/auto-updater/ga4-oauth.json'
  ];
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    if (!p) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j.client_id && j.client_secret && j.refresh_token) return j;
    } catch (e) { /* try next */ }
  }
  throw new Error(
    'GA4 credentials not found. Add GA4_CLIENT_ID / GA4_CLIENT_SECRET / ' +
    'GA4_REFRESH_TOKEN to ~/headline-lab/.env, or place a ga4-oauth.json ' +
    'at ~/ga4-oauth.json (or set GA4_OAUTH_PATH).'
  );
}

// ── HTTP POST helper (https.request — no fetch) ───────────────
function httpsPost(hostname, reqPath, headers, bodyString) {
  return new Promise(function (resolve, reject) {
    const allHeaders = Object.assign(
      { 'Content-Length': Buffer.byteLength(bodyString) }, headers || {});
    const options = { hostname: hostname, path: reqPath, method: 'POST', headers: allHeaders };
    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + hostname + reqPath + ': ' + data.slice(0, 300))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('Request timeout: ' + hostname + reqPath)); });
    req.write(bodyString);
    req.end();
  });
}

function getAccessToken(creds) {
  const body =
    'client_id='      + encodeURIComponent(creds.client_id) +
    '&client_secret=' + encodeURIComponent(creds.client_secret) +
    '&refresh_token=' + encodeURIComponent(creds.refresh_token) +
    '&grant_type=refresh_token';
  return httpsPost('oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  ).then(function (data) {
    if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
    return data.access_token;
  });
}

// ── GA4 screenPageViews query ─────────────────────────────────
// orefValue === null → total site pageviews (no filter, the denominator).
// orefValue set      → clicks for that oref (the numerator).
function queryPageViews(token, property, start, end, orefValue) {
  const report = {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [],
    metrics:    [{ name: 'screenPageViews' }]
  };
  if (orefValue !== null) {
    report.dimensionFilter = {
      filter: {
        fieldName:    'fullPageUrl',
        stringFilter: { matchType: 'CONTAINS', value: 'oref=' + orefValue }
      }
    };
  }
  return httpsPost(
    'analyticsdata.googleapis.com',
    '/v1beta/properties/' + property + ':runReport',
    { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    JSON.stringify(report)
  ).then(function (data) {
    if (data.error) throw new Error('GA4 error (' + property + '): ' + JSON.stringify(data.error.message || data.error));
    const rows = data.rows;
    if (rows && rows.length && rows[0].metricValues && rows[0].metricValues.length) {
      const v = parseInt(rows[0].metricValues[0].value, 10);
      return isNaN(v) ? 0 : v;
    }
    return 0;
  });
}

// ── Bounded-concurrency pool (errors isolated per task) ───────
function runPool(items, worker, concurrency) {
  return new Promise(function (resolve) {
    let idx = 0, active = 0, done = 0;
    const results = new Array(items.length);
    if (!items.length) return resolve(results);
    function launch() {
      while (active < concurrency && idx < items.length) {
        const i = idx++; active++;
        Promise.resolve(worker(items[i], i)).then(function (r) {
          results[i] = r; active--; done++;
          if (done === items.length) resolve(results); else launch();
        });
      }
    }
    launch();
  });
}

// ── Number / share formatting ─────────────────────────────────
function fmtInt(n) {
  if (n === null || n === undefined || n === 'ERR') return n === 'ERR' ? 'ERR' : '—';
  return Number(n).toLocaleString('en-US');
}
function shareOf(clicks, total) { // ‰ : clicks per 1,000 pageviews
  if (clicks === null || clicks === 'ERR' || total === null || total === 'ERR' || !total) return null;
  return (clicks / total) * 1000;
}
function fmtShare(s) { return (s === null || s === undefined) ? '—' : s.toFixed(2); }
function mean(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }

function fmtShareDelta(cur, base) {
  if (cur === null || base === null) return '—';
  const diff  = cur - base;
  const arrow = diff >= 0 ? '▲' : '▼'; // ▲ / ▼
  const sign  = diff >= 0 ? '+' : '-';
  const pct   = base ? Math.round((Math.abs(diff) / base) * 100) : 0;
  return arrow + ' ' + sign + Math.abs(diff).toFixed(2) + '‰ (' + sign + pct + '%)';
}

function padL(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }
function padR(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }

// ── Main ──────────────────────────────────────────────────────
(function main() {
  let creds;
  try { creds = loadGA4Creds(); }
  catch (e) { console.error('✗ ' + e.message); process.exit(1); }

  getAccessToken(creds).then(function (token) {
    console.log('✓ GA4 OAuth token obtained');

    // Build task list:
    //   per pub:           total pageviews for each unique window  (denominator)
    //   per pub+feature:   oref clicks for each unique window       (numerator)
    const tasks = [];
    PUBS.forEach(function (pub) {
      ALL_WINDOWS.forEach(function (w) {
        tasks.push({ kind: 'total', pub: pub, win: w, oref: null });
      });
      FEATURES.forEach(function (feature) {
        const oref = pub.key + '-' + feature.orefSuffix;
        ALL_WINDOWS.forEach(function (w) {
          tasks.push({ kind: 'clicks', pub: pub, feature: feature, win: w, oref: oref });
        });
      });
    });
    console.log('Running ' + tasks.length + ' GA4 queries (concurrency ' + CONCURRENCY + ')…');

    // data.total[pubKey][winKey] = pageviews
    // data.clicks[pubKey][featureLabel][winKey] = clicks
    const data = { total: {}, clicks: {} };
    PUBS.forEach(function (p) {
      data.total[p.key] = {};
      data.clicks[p.key] = {};
      FEATURES.forEach(function (f) { data.clicks[p.key][f.label] = {}; });
    });

    return runPool(tasks, function (t) {
      return queryPageViews(token, t.pub.property, t.win.start, t.win.end, t.oref)
        .then(function (v) {
          if (t.kind === 'total') data.total[t.pub.key][winKey(t.win)] = v;
          else data.clicks[t.pub.key][t.feature.label][winKey(t.win)] = v;
        })
        .catch(function (err) {
          console.error('  ! ' + t.pub.key + (t.feature ? '/' + t.feature.label : '/total') +
            ' ' + t.win.label + ': ' + err.message);
          if (t.kind === 'total') data.total[t.pub.key][winKey(t.win)] = 'ERR';
          else data.clicks[t.pub.key][t.feature.label][winKey(t.win)] = 'ERR';
        });
    }, CONCURRENCY).then(function () {
      render(data);
    });
  }).catch(function (err) {
    console.error('✗ ' + err.message);
    process.exit(1);
  });
})();

// ── Rendering ─────────────────────────────────────────────────
function render(data) {
  console.log('');
  console.log('GE360 Auto-Updater impact — traffic-normalized');
  console.log('Baseline: 12-mo pre-automation avg (Apr 2025–Mar 2026). Launch ~Apr 8 2026.');
  console.log('SHARE (‰) = oref clicks per 1,000 total site pageviews for that pub/month.');
  console.log('* June windows are partial (1–25); YoY anchor uses the same 1–25 window.');

  const W_PUB = 22, W = 11, W_BAND = 16, W_DELTA = 20;

  FEATURES.forEach(function (feature) {
    console.log('');
    console.log('==================== ' + feature.label + ' ====================');

    // Gather per-pub computed values
    const rows = PUBS.map(function (pub) {
      const totals  = data.total[pub.key];
      const clicks  = data.clicks[pub.key][feature.label];

      // Baseline: per-month clicks and shares across the 12 baseline months
      const baseClicks = [], baseShares = [];
      BASELINE.forEach(function (w) {
        const c = clicks[winKey(w)], t = totals[winKey(w)];
        if (c !== 'ERR' && c !== undefined) baseClicks.push(c);
        const s = shareOf(c, t);
        if (s !== null) baseShares.push(s);
      });
      const baseClickAvg = baseClicks.length ? Math.round(mean(baseClicks)) : null;
      const baseShareAvg = baseShares.length ? mean(baseShares) : null;
      const baseShareMin = baseShares.length ? Math.min.apply(null, baseShares) : null;
      const baseShareMax = baseShares.length ? Math.max.apply(null, baseShares) : null;

      // Post-launch months + their YoY anchors
      const post = POST.map(function (w) {
        const c = clicks[winKey(w)], t = totals[winKey(w)];
        const yw = YOY[w.label];
        const yc = clicks[winKey(yw)], yt = totals[winKey(yw)];
        return {
          win: w, clicks: c, share: shareOf(c, t),
          yoyLabel: yw.label, yoyClicks: yc, yoyShare: shareOf(yc, yt)
        };
      });

      return { pub: pub, baseClickAvg: baseClickAvg, baseShareAvg: baseShareAvg,
               baseShareMin: baseShareMin, baseShareMax: baseShareMax, post: post };
    });

    // --- Table 1: absolute clicks ---
    console.log('');
    console.log('  CLICKS (absolute)');
    console.log('  ' + padR('Pub', W_PUB) + padL('Base avg', W) +
      POST.map(function (w) { return padL(w.label, W); }).join(''));
    rows.forEach(function (r) {
      console.log('  ' + padR(r.pub.name, W_PUB) + padL(fmtInt(r.baseClickAvg), W) +
        r.post.map(function (p) { return padL(fmtInt(p.clicks), W); }).join(''));
    });

    // --- Table 2: share (the normalized view) ---
    console.log('');
    console.log('  SHARE (‰ of total site pageviews)');
    console.log('  ' + padR('Pub', W_PUB) + padR('Base (min–max)', W_BAND) +
      POST.map(function (w) { return padL(w.label, W); }).join(''));
    rows.forEach(function (r) {
      const band = (r.baseShareAvg === null) ? '—'
        : fmtShare(r.baseShareAvg) + ' (' + fmtShare(r.baseShareMin) + '–' + fmtShare(r.baseShareMax) + ')';
      console.log('  ' + padR(r.pub.name, W_PUB) + padR(band, W_BAND) +
        r.post.map(function (p) { return padL(fmtShare(p.share), W); }).join(''));
    });

    // --- Table 3: May headline — share deltas vs baseline and YoY ---
    console.log('');
    console.log('  MAY 2026 share vs baseline & year-over-year');
    console.log('  ' + padR('Pub', W_PUB) + padL('May ‰', W) + padL("May'25 ‰", W) +
      '  ' + padR('Δ vs base', W_DELTA) + padR('Δ YoY', W_DELTA));
    rows.forEach(function (r) {
      const may = r.post[1]; // POST[1] === May '26
      console.log('  ' + padR(r.pub.name, W_PUB) +
        padL(fmtShare(may.share), W) +
        padL(fmtShare(may.yoyShare), W) + '  ' +
        padR(fmtShareDelta(may.share, r.baseShareAvg), W_DELTA) +
        padR(fmtShareDelta(may.share, may.yoyShare), W_DELTA));
    });
  });

  console.log('');
  console.log('Reading the report:');
  console.log('  • SHARE controls for site-wide traffic swings: a rising share means the');
  console.log('    widget captured more of total traffic, even if raw clicks fell.');
  console.log('  • Δ vs base compares May share to the 12-mo pre-automation average share.');
  console.log('  • Δ YoY compares May 2026 share to May 2025 share (seasonality control).');
  console.log('  • ▲ above / ▼ below. June is partial (1–25); GA4 backfills ~72h.');
  console.log('');
}
