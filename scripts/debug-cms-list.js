#!/usr/bin/env node
// Quick diagnostic: dumps row data from the Trending and Earthbox CMS list pages.
// Usage: node scripts/debug-cms-list.js
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(process.env.HOME, 'headline-lab', '.cms-session.json');
const CMS_BASE     = 'https://admin.govexec.com';
const PAGES = [
  { name: 'Trending',  url: `${CMS_BASE}/athena/curate/defenseonetrendingitem/` },
  { name: 'Earthbox',  url: `${CMS_BASE}/athena/curate/defenseoneearthboxitem/` },
];

async function dumpList(page, name, url) {
  console.log(`\n=== ${name}: ${url} ===`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (page.url().includes('/accounts/login/') || page.url().includes('/saml/') || page.url().includes('/sso/')) {
    console.log('REDIRECTED TO LOGIN — session expired.');
    return;
  }

  const data = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#result_list tbody tr'));
    if (!rows.length) {
      // Check if the table exists at all
      const table = document.querySelector('#result_list');
      if (!table) return { error: 'No #result_list element found on page' };
      return { error: '#result_list found but tbody has no rows' };
    }

    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      return {
        cellTexts: cells.map(td => JSON.stringify(td.textContent.trim())),
        editHref:  row.querySelector('a')?.getAttribute('href') || null,
      };
    });
  });

  if (data.error) {
    console.log('ERROR:', data.error);
    // Dump page title and first 500 chars of body to help diagnose
    const info = await page.evaluate(() => ({
      title: document.title,
      bodySnippet: document.body?.innerText?.slice(0, 500),
    }));
    console.log('Page title:', info.title);
    console.log('Body snippet:', info.bodySnippet);
    return;
  }

  console.log(`Found ${data.length} rows:`);
  data.forEach((row, i) => {
    console.log(`  [${i+1}] href=${row.editHref}`);
    console.log(`       cells: ${row.cellTexts.join(' | ')}`);
  });
}

(async () => {
  if (!fs.existsSync(SESSION_FILE)) {
    console.error(`No session file at ${SESSION_FILE}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context  = await browser.newContext({ storageState: SESSION_FILE });
  const page     = await context.newPage();

  for (const { name, url } of PAGES) {
    await dumpList(page, name, url);
  }

  await browser.close();
})();
