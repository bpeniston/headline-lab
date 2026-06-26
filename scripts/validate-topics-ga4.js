// validate-topics-ga4.js
// Run on server: node ~/validate-topics-ga4.js
// Validates the GA4 query for oref=d1-article-topics click counts

const fs   = require('fs');
const path = require('path');

const OAUTH_PATH    = '/home/bradwu/navybook.com/D1/auto-updater/ga4-oauth.json';
const GA4_PROPERTY  = '353836589';
const OREF          = 'd1-article-topics';

async function getAccessToken(creds) {
  const params = new URLSearchParams({
    client_id:     creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type:    'refresh_token',
  });
  const res  = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function queryGA4(token, startDate, endDate, label) {
  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePathPlusQueryString' }],
    metrics:    [{ name: 'screenPageViews' }],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePathPlusQueryString',
        stringFilter: { matchType: 'CONTAINS', value: `oref=${OREF}` }
      }
    },
    limit: 1,
    metricAggregations: ['TOTAL'],
  };

  const res  = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();

  if (data.error) throw new Error(`GA4 error: ${JSON.stringify(data.error)}`);

  const total = data.totals?.[0]?.metricValues?.[0]?.value ?? '0';
  console.log(`${label} (${startDate} → ${endDate}): ${parseInt(total).toLocaleString()} clicks`);
  return parseInt(total);
}

(async () => {
  try {
    const creds = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    const token = await getAccessToken(creds);
    console.log('✓ OAuth token obtained\n');

    const now   = new Date();
    const y     = now.getFullYear();
    const m     = now.getMonth(); // 0-indexed

    // Current month to date
    const mtdStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const mtdEnd   = now.toISOString().slice(0, 10);

    // Prior full month
    const priorDate  = new Date(y, m - 1, 1);
    const priorStart = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, '0')}-01`;
    const priorEnd   = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;

    // Two months prior (for trend context)
    const prior2Date  = new Date(y, m - 2, 1);
    const prior2Start = `${prior2Date.getFullYear()}-${String(prior2Date.getMonth() + 1).padStart(2, '0')}-01`;
    const prior2End   = `${prior2Date.getFullYear()}-${String(prior2Date.getMonth() + 1).padStart(2, '0')}-${new Date(y, m - 1, 0).getDate()}`;

    await queryGA4(token, mtdStart,   mtdEnd,   'May MTD  ');
    await queryGA4(token, priorStart, priorEnd, 'April    ');
    await queryGA4(token, prior2Start, prior2End, 'March    ');

  } catch (err) {
    console.error('✗', err.message);
    process.exit(1);
  }
})();