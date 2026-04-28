#!/usr/bin/env node
'use strict';

const fs         = require('fs');
const path       = require('path');
const https      = require('https');
const nodemailer = require('nodemailer');

const CMS_BASE       = 'https://admin.govexec.com';
const PUB_CONFIG_URL = 'https://www.navybook.com/D1/seo/pub-config.php';

// ── Logger factory ────────────────────────────────────────────
function createLogger(logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    stream.write(line + '\n');
  }
  function die(msg) {
    log(`FATAL: ${msg}`);
    stream.end();
    process.exit(1);
  }
  return { log, die, logStream: stream };
}

// ── Session metadata ──────────────────────────────────────────
function loadMeta(metaFile) {
  try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return {}; }
}
function saveMeta(metaFile, meta) {
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}
function daysSince(isoDate) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

// ── .env loader ───────────────────────────────────────────────
function loadEnv() {
  const envFile = path.join(process.env.HOME, 'headline-lab', '.env');
  let src;
  try { src = fs.readFileSync(envFile, 'utf8'); }
  catch { throw new Error(`.env not found at ${envFile}`); }
  const env = {};
  src.split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

// ── Slack ─────────────────────────────────────────────────────
async function sendSlackEmail(subject, body, env, slackEmail, log = console.log) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS.replace(/\s+/g, '') },
    });
    await transporter.sendMail({
      from: `Athena Tools <${env.SMTP_USER}>`,
      to:   slackEmail,
      subject,
      text: body,
    });
    log('Slack notification sent.');
  } catch (e) {
    log(`Slack email error: ${e.message}`);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const sep = url.includes('?') ? '&' : '?';
    const req = https.get(`${url}${sep}bust=${Date.now()}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error(`Request timeout: ${url}`)));
  });
}

async function fetchPubConfig() {
  const data = await fetchJSON(PUB_CONFIG_URL);
  if (data.error) throw new Error(`pub-config.php: ${data.error}`);
  return data;
}

// ── Pub label (first two chars of topic_oref, uppercased) ─────
function pubLabel(pub) {
  return pub.topic_oref.slice(0, 2).toUpperCase();
}

// ── CMS session setup (shared by all scripts) ─────────────────
async function runSetup({ chromium, sessionFile, metaFile, log, logStream }) {
  console.log('\n=== CMS Session Setup ===');
  console.log('A browser window will open. Log in normally (including 2FA).');
  console.log('Once you are logged into the CMS, come back here and press Enter.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto(`${CMS_BASE}/athena/`);

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write('Press Enter once you are logged in to the CMS…');
    process.stdin.once('data', () => resolve());
  });

  if (!page.url().includes('admin.govexec.com')) {
    console.log(`Warning: current URL is ${page.url()} — expected admin.govexec.com.`);
    console.log('Session saved anyway, but you may need to re-run --setup.');
  }

  await context.storageState({ path: sessionFile });
  await browser.close();

  const meta = loadMeta(metaFile);
  saveMeta(metaFile, { ...meta, loginDate: new Date().toISOString(), lastWarningSent: null });

  console.log(`\nSession saved to ${sessionFile}`);
  console.log('This session covers all GE360 publications (same CMS domain).');
  console.log('Re-run --setup if the session expires.');
  logStream.end();
}

module.exports = {
  CMS_BASE,
  createLogger,
  loadMeta, saveMeta, daysSince,
  loadEnv,
  sendSlackEmail,
  fetchJSON, fetchPubConfig,
  pubLabel,
  runSetup,
};
