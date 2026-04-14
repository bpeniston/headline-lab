#!/usr/bin/env node
// =============================================================
// scripts/earthbox-baseline.js
// One-off script to pull pre-automation monthly click counts
// from GA4 for both Topics and Earthbox (Oct 2025–Mar 2026).
// Run once from the Air to establish the Earthbox baseline.
//
// Usage: node scripts/earthbox-baseline.js
// =============================================================

'use strict';

const https = require('https');
const path  = require('path');
const fs    = require('fs');

const TOPICS_URL   = 'https://www.navybook.com/D1/seo/monthly-stats.php';
const EARTHBOX_URL = 'https://www.navybook.com/D1/seo/earthbox-stats.php';
const TOKEN        = 'e46ac3a0976b1fb6a6e14cf61f5bfb1438dc8768412e7dc7';

// Oct 2025 – Mar 2026 (pre-automation window)
const MONTHS = [
  { start: '2025-10-01', end: '2025-10-31' },
  { start: '2025-11-01', end: '2025-11-30' },
  { start: '2025-12-01', end: '2025-12-31' },
  { start: '2026-01-01', end: '2026-01-31' },
  { start: '2026-02-01', end: '2026-02-28' },
  { start: '2026-03-01', end: '2026-03-31' },
];

function fetchStats(baseUrl, start, end) {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}?token=${TOKEN}&start=${start}&end=${end}`;
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

(async () => {
  console.log('Fetching pre-automation baseline (Oct 2025–Mar 2026)…\n');
  console.log('Month'.padEnd(16), 'Topics'.padStart(8), 'Earthbox'.padStart(10));
  console.log('─'.repeat(36));

  let topicsTotal = 0, earthboxTotal = 0;

  for (const { start, end } of MONTHS) {
    const [t, e] = await Promise.all([
      fetchStats(TOPICS_URL,   start, end),
      fetchStats(EARTHBOX_URL, start, end),
    ]);
    topicsTotal   += t.views;
    earthboxTotal += e.views;
    console.log(t.month.padEnd(16), String(t.views.toLocaleString()).padStart(8), String(e.views.toLocaleString()).padStart(10));
  }

  const topicsAvg   = Math.round(topicsTotal   / MONTHS.length);
  const earthboxAvg = Math.round(earthboxTotal / MONTHS.length);

  console.log('─'.repeat(36));
  console.log('Total'.padEnd(16), String(topicsTotal.toLocaleString()).padStart(8),   String(earthboxTotal.toLocaleString()).padStart(10));
  console.log('Monthly avg'.padEnd(16), String(topicsAvg.toLocaleString()).padStart(8), String(earthboxAvg.toLocaleString()).padStart(10));
  console.log('');
  console.log(`Topics baseline (already set):  ${topicsAvg.toLocaleString()}/month`);
  console.log(`Earthbox baseline (new):        ${earthboxAvg.toLocaleString()}/month`);
  console.log('');
  console.log(`Update monthly-report.js: EARTHBOX_BASELINE = ${earthboxAvg}`);
})();
