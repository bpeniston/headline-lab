#!/usr/bin/env node
// =============================================================
// scripts/automation-lift.js   (one-off analysis)
// Answers: across all five pubs and all three features (Topics,
// Earthbox, Skybox), how many MORE clicks has the automation
// generated since it went into effect — and what is that as a
// percentage of total site traffic?
//
// Method (traffic-normalized, the only honest way):
//   counterfactual_clicks = baseline_share/1000 * total_pageviews
//   incremental_clicks    = actual_clicks - counterfactual_clicks
// i.e. "what the widget would have captured at its pre-automation
// SHARE of traffic, given this month's actual traffic" — so a
// site-wide traffic swing doesn't masquerade as an automation effect.
//
//   baseline_share = mean monthly share (‰) over the 12 pre-automation
//                    months Apr 2025–Mar 2026 (screenPageViews where
//                    fullPageUrl CONTAINS oref=, same metric as pub-stats.php).
//
// Scope: a pub×feature counts a post month only if the pub's
//   automation_start_date is on/before the 1st of that month (full
//   month under automation). Available post months: Apr/May 2026 (full),
//   Jun 1–25 2026 (partial MTD — numerator and denominator both 1–25).
//   The "% of total site traffic" denominator counts each pub-month's
//   total pageviews ONCE (not once per feature).
//
// A YoY counterfactual (same month last year's share) is computed as a
// cross-check on the baseline-share counterfactual.
//
// Old-Node safe (no fetch / optional chaining). Run on the server.
//   node automation-lift.js
// =============================================================

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CONCURRENCY    = 6;
const PUB_CONFIG_URL = 'https://www.navybook.com/D1/seo/pub-config.php';

// Post-launch months. firstDay is used for the "full month" test.
const POST_MONTHS = [
  { key: 'Apr 2026', start: '2026-04-01', end: '2026-04-30', firstDay: '2026-04-01' },
  { key: 'May 2026', start: '2026-05-01', end: '2026-05-31', firstDay: '2026-05-01' },
  { key: 'Jun 2026', start: '2026-06-01', end: '2026-06-25', firstDay: '2026-06-01', partial: true }
];
function yoyOf(m) { // same window, prior year
  return { start: (parseInt(m.start.slice(0, 4), 10) - 1) + m.start.slice(4),
           end:   (parseInt(m.end.slice(0, 4), 10) - 1) + m.end.slice(4) };
}

// 12-month pre-automation baseline window (Apr 2025–Mar 2026)
const BASELINE = [];
for (let i = 0; i < 12; i++) {
  const d = new Date(2025, 3 + i, 1);
  const y = d.getFullYear(), mo = d.getMonth() + 1;
  const last = new Date(y, mo, 0).getDate();
  const p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  BASELINE.push({ start: y + '-' + p2(mo) + '-01', end: y + '-' + p2(mo) + '-' + p2(last) });
}

// ── creds / http (same as pull-impact-report.js) ──────────────
function loadEnvFile() {
  const envFile = path.join(process.env.HOME, 'headline-lab', '.env');
  const env = {}; let src;
  try { src = fs.readFileSync(envFile, 'utf8'); } catch (e) { return env; }
  src.split('\n').forEach(function (line) {
    const m = line.match(/^([^#=]+)=(.*)$/); if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}
function loadGA4Creds() {
  const env = loadEnvFile();
  if (env.GA4_CLIENT_ID && env.GA4_CLIENT_SECRET && env.GA4_REFRESH_TOKEN) {
    return { client_id: env.GA4_CLIENT_ID, client_secret: env.GA4_CLIENT_SECRET, refresh_token: env.GA4_REFRESH_TOKEN };
  }
  const cands = [process.env.GA4_OAUTH_PATH, path.join(process.env.HOME, 'ga4-oauth.json'), '/home/bradwu/ga4-oauth.json'];
  for (let i = 0; i < cands.length; i++) {
    if (!cands[i]) continue;
    try { const j = JSON.parse(fs.readFileSync(cands[i], 'utf8'));
      if (j.client_id && j.client_secret && j.refresh_token) return j; } catch (e) {}
  }
  throw new Error('GA4 credentials not found (see pull-impact-report.js).');
}
function httpsPost(hostname, reqPath, headers, body) {
  return new Promise(function (resolve, reject) {
    const h = Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers || {});
    const req = https.request({ hostname: hostname, path: reqPath, method: 'POST', headers: h }, function (res) {
      let d = ''; res.on('data', function (c) { d += c; });
      res.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad JSON ' + hostname + reqPath + ': ' + d.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('timeout ' + hostname + reqPath)); });
    req.write(body); req.end();
  });
}
function httpsGetJSON(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      let d = ''; res.on('data', function (c) { d += c; });
      res.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function getAccessToken(creds) {
  const body = 'client_id=' + encodeURIComponent(creds.client_id) +
    '&client_secret=' + encodeURIComponent(creds.client_secret) +
    '&refresh_token=' + encodeURIComponent(creds.refresh_token) + '&grant_type=refresh_token';
  return httpsPost('oauth2.googleapis.com', '/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, body)
    .then(function (d) { if (!d.access_token) throw new Error('token refresh failed: ' + JSON.stringify(d)); return d.access_token; });
}
function queryPV(token, property, start, end, oref) { // oref null → total pageviews
  const report = { dateRanges: [{ startDate: start, endDate: end }], dimensions: [], metrics: [{ name: 'screenPageViews' }] };
  if (oref !== null) report.dimensionFilter = { filter: { fieldName: 'fullPageUrl', stringFilter: { matchType: 'CONTAINS', value: 'oref=' + oref } } };
  return httpsPost('analyticsdata.googleapis.com', '/v1beta/properties/' + property + ':runReport',
    { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, JSON.stringify(report))
    .then(function (d) {
      if (d.error) throw new Error('GA4 ' + property + ': ' + JSON.stringify(d.error.message || d.error));
      if (d.rows && d.rows.length && d.rows[0].metricValues && d.rows[0].metricValues.length) {
        const v = parseInt(d.rows[0].metricValues[0].value, 10); return isNaN(v) ? 0 : v;
      }
      return 0;
    });
}
function runPool(items, worker, concurrency) {
  return new Promise(function (resolve) {
    let idx = 0, active = 0, done = 0; const out = new Array(items.length);
    if (!items.length) return resolve(out);
    function launch() {
      while (active < concurrency && idx < items.length) {
        const i = idx++; active++;
        Promise.resolve(worker(items[i])).then(function (r) { out[i] = r; active--; done++; if (done === items.length) resolve(out); else launch(); });
      }
    }
    launch();
  });
}
function k(start, end) { return start + '|' + end; }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(3) + '%'; }

// ── Main ──────────────────────────────────────────────────────
(function main() {
  let creds; try { creds = loadGA4Creds(); } catch (e) { console.error('✗ ' + e.message); process.exit(1); }

  Promise.all([getAccessToken(creds), httpsGetJSON(PUB_CONFIG_URL)]).then(function (res) {
    const token = res[0];
    const cfg   = res[1];
    const pubs  = (cfg.pubs || []).filter(function (p) { return p._valid; });

    // Build automated pub×feature units + each pub's in-scope full post months.
    const units = []; // {pubName, property, label, oref, startDate}
    const pubMonths = {}; // pubName -> [postMonth,...] in scope (full automation)
    pubs.forEach(function (p) {
      const start = p.automation_start_date || '';
      const months = POST_MONTHS.filter(function (m) { return start && start <= m.firstDay; });
      if (!months.length) return;
      pubMonths[p.pub_name] = months;
      const feats = [
        { label: 'Topics',   oref: p.topic_oref,    on: p.trending_enabled && p.topic_oref },
        { label: 'Earthbox', oref: p.earthbox_oref, on: p.earthbox_enabled !== 'OFF' && p.earthbox_oref },
        { label: 'Skybox',   oref: p.skybox_oref,   on: p.skybox_enabled   !== 'OFF' && p.skybox_oref }
      ];
      feats.forEach(function (f) {
        if (f.on) units.push({ pubName: p.pub_name, property: String(p.ga4_property_id), label: f.label, oref: f.oref, startDate: start });
      });
    });

    // ── Assemble all GA4 queries ──
    // clicks: per unit, for baseline(12) + its post months + YoY of those
    // totals: per pub, for the union of months any of its units needs
    const tasks = [];
    const clicks = {}; // unitId -> {winKey: value}
    const totals = {}; // pubName -> {winKey: value}
    function unitId(u) { return u.pubName + '::' + u.label; }

    Object.keys(pubMonths).forEach(function (pubName) { totals[pubName] = {}; });
    units.forEach(function (u) {
      clicks[unitId(u)] = {};
      const months = pubMonths[u.pubName];
      const wins = BASELINE.slice();
      months.forEach(function (m) { wins.push({ start: m.start, end: m.end }); const y = yoyOf(m); wins.push({ start: y.start, end: y.end }); });
      wins.forEach(function (w) {
        tasks.push({ kind: 'clicks', u: u, start: w.start, end: w.end });
        // ensure pub total for the same window
        tasks.push({ kind: 'total', pubName: u.pubName, property: u.property, start: w.start, end: w.end });
      });
    });

    // de-dupe tasks
    const seen = {}; const uniq = [];
    tasks.forEach(function (t) {
      const id = t.kind + '|' + (t.kind === 'clicks' ? unitId(t.u) + '|' + t.u.oref : t.pubName) + '|' + t.start + '|' + t.end;
      if (!seen[id]) { seen[id] = true; uniq.push(t); }
    });
    console.log('✓ token + config. Running ' + uniq.length + ' GA4 queries…');

    return runPool(uniq, function (t) {
      const oref = t.kind === 'clicks' ? t.u.oref : null;
      const prop = t.kind === 'clicks' ? t.u.property : t.property;
      return queryPV(token, prop, t.start, t.end, oref).then(function (v) {
        if (t.kind === 'clicks') clicks[unitId(t.u)][k(t.start, t.end)] = v;
        else totals[t.pubName][k(t.start, t.end)] = v;
      }).catch(function (e) {
        console.error('  ! ' + (t.kind === 'clicks' ? unitId(t.u) : t.pubName) + ' ' + t.start + ': ' + e.message);
        if (t.kind === 'clicks') clicks[unitId(t.u)][k(t.start, t.end)] = null;
        else totals[t.pubName][k(t.start, t.end)] = null;
      });
    }, CONCURRENCY).then(function () {
      compute(units, pubMonths, clicks, totals, unitId);
    });
  }).catch(function (e) { console.error('✗ ' + e.message); process.exit(1); });

  function baselineShare(unitClicks, pubTotals) { // mean monthly ‰ over baseline window
    const shares = [];
    BASELINE.forEach(function (w) {
      const c = unitClicks[k(w.start, w.end)], t = pubTotals[k(w.start, w.end)];
      if (c !== null && c !== undefined && t) shares.push((c / t) * 1000);
    });
    if (!shares.length) return null;
    return shares.reduce(function (a, b) { return a + b; }, 0) / shares.length;
  }

  function compute(units, pubMonths, clicks, totals, unitId) {
    // Per-feature and overall accumulators (cumulative = all in-scope full months)
    const featAgg = {}; // label -> {actual, cfBase, cfYoy}
    let grandActual = 0, grandCfBase = 0, grandCfYoy = 0;
    // denominator: total site pageviews counted once per (pub, month)
    const denomSeen = {}; let denom = 0;
    // June steady-state accumulators (all pubs live in June)
    let juneIncr = 0, juneDenom = 0; const juneDenomSeen = {};
    const rows = [];

    units.forEach(function (u) {
      const uc = clicks[unitId(u)], pt = totals[u.pubName];
      const bShare = baselineShare(uc, pt);
      pubMonths[u.pubName].forEach(function (m) {
        const total = pt[k(m.start, m.end)];
        const actual = uc[k(m.start, m.end)];
        if (actual === null || total === null || !total || bShare === null) return;
        const cfBase = (bShare / 1000) * total;
        // YoY counterfactual
        const y = yoyOf(m);
        const yc = uc[k(y.start, y.end)], yt = pt[k(y.start, y.end)];
        const yShare = (yc !== null && yc !== undefined && yt) ? (yc / yt) * 1000 : null;
        const cfYoy = yShare === null ? cfBase : (yShare / 1000) * total;

        if (!featAgg[u.label]) featAgg[u.label] = { actual: 0, cfBase: 0, cfYoy: 0 };
        featAgg[u.label].actual += actual;
        featAgg[u.label].cfBase += cfBase;
        featAgg[u.label].cfYoy  += cfYoy;
        grandActual += actual; grandCfBase += cfBase; grandCfYoy += cfYoy;

        // denominator (once per pub-month)
        const dk = u.pubName + '|' + m.key;
        if (!denomSeen[dk]) { denomSeen[dk] = true; denom += total; }
        if (m.key === 'Jun 2026' && !juneDenomSeen[dk]) { juneDenomSeen[dk] = true; juneDenom += total; }
        if (m.key === 'Jun 2026') juneIncr += (actual - cfBase);

        rows.push({ pub: u.pubName, feat: u.label, month: m.key, actual: actual,
          share: (actual / total) * 1000, bShare: bShare, incr: actual - cfBase });
      });
    });

    // ── Output ──
    console.log('\nSCOPE (full months under automation; Jun is 1–25 MTD):');
    const byPub = {};
    rows.forEach(function (r) { (byPub[r.pub] = byPub[r.pub] || {})[r.feat] = (byPub[r.pub][r.feat] || []); byPub[r.pub][r.feat].push(r.month); });
    Object.keys(byPub).forEach(function (p) {
      const parts = Object.keys(byPub[p]).map(function (f) { return f + ' [' + byPub[p][f].map(function (mm) { return mm.slice(0, 3); }).join(',') + ']'; });
      console.log('  ' + p + ': ' + parts.join('  '));
    });

    console.log('\nPER-FEATURE (cumulative incremental clicks vs counterfactual):');
    console.log('  ' + 'Feature'.padEnd(10) + 'Actual'.padStart(12) + 'Counterfact'.padStart(14) + 'Incremental'.padStart(14) + '   vs baseline-share');
    ['Topics', 'Earthbox', 'Skybox'].forEach(function (lbl) {
      const a = featAgg[lbl]; if (!a) return;
      const incr = a.actual - a.cfBase;
      const rel = a.cfBase ? (incr / a.cfBase) * 100 : 0;
      console.log('  ' + lbl.padEnd(10) + fmt(a.actual).padStart(12) + fmt(a.cfBase).padStart(14) + (incr >= 0 ? '+' : '') + fmt(incr).padStart(13) + '   ' + (rel >= 0 ? '+' : '') + rel.toFixed(1) + '%');
    });

    const incrBase = grandActual - grandCfBase;
    const incrYoy  = grandActual - grandCfYoy;
    console.log('\n================= HEADLINE =================');
    console.log('Automated widget clicks (actual):        ' + fmt(grandActual));
    console.log('Counterfactual at pre-automation share:  ' + fmt(grandCfBase));
    console.log('INCREMENTAL clicks from automation:      ' + (incrBase >= 0 ? '+' : '') + fmt(incrBase) +
      '  (' + (grandCfBase ? (incrBase / grandCfBase * 100 >= 0 ? '+' : '') + (incrBase / grandCfBase * 100).toFixed(1) + '% vs expected' : '') + ')');
    console.log('Total site traffic over same scope:      ' + fmt(denom) + ' pageviews');
    console.log('>> Incremental clicks as % of total site traffic:  ' + pct(incrBase / denom * 100));
    console.log('   (YoY-counterfactual cross-check:                ' + pct(incrYoy / denom * 100) + ')');

    console.log('\n----- Steady-state (June 1–25, all 5 pubs live) -----');
    console.log('Incremental clicks (vs baseline share):  ' + (juneIncr >= 0 ? '+' : '') + fmt(juneIncr));
    console.log('June site traffic (in scope):            ' + fmt(juneDenom) + ' pageviews');
    console.log('>> June incremental as % of site traffic: ' + pct(juneIncr / juneDenom * 100));
    console.log('');
    console.log('Notes: counterfactual = baseline_share × actual_pageviews (normalizes out');
    console.log('traffic swings). Partial first months (pre-full-automation) are excluded, so');
    console.log('the cumulative figure is conservative. Attribution assumes the pre-automation');
    console.log('share is the right counterfactual; secular trends are only partly controlled');
    console.log('(YoY cross-check shown). Denominator counts each pub-month once.');
  }
})();
