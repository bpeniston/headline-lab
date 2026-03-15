# SEO Headline Generator — Setup Guide
Internal newsroom tool · Hosted on DreamHost

# Headline Lab — deploy cheatsheet

## Every time you make changes

**Step 1 — Edit files on your laptop**
Make your changes in whatever editor you're using.

**Step 2 — Open Terminal and go to the project folder**
```
cd ~/Documents/devstuff/headline-lab
```

**Step 3 — Commit and push to GitHub**
```
git add .
git commit -m "describe what you changed"
git push
```

**Step 4 — Deploy to the live server**
```
deploy
```

That's it. The site is live.

---

## If you need to SSH into the server manually
```
ssh bradwu@pdx1-shared-a1-08.dreamhost.com
cd navybook.com/D1/seo
```

## Project locations
- **Laptop:** `~/Documents/devstuff/headline-lab`
- **GitHub:** `https://github.com/bpeniston/headline-lab`
- **Server:** `bradwu@pdx1-shared-a1-08.dreamhost.com:~/navybook.com/D1/seo`

## TELL CLAUDE THIS BEFORE EACH NEW SESSION:
My development setup:

Project: Headline Lab — HTML/CSS/JS/PHP static-ish site
Laptop path: ~/Documents/devstuff/headline-lab
GitHub: https://github.com/bpeniston/headline-lab
Server: DreamHost shared hosting, pdx1-shared-a1-08.dreamhost.com
Server path: bradwu@pdx1-shared-a1-08.dreamhost.com:~/navybook.com/D1/seo
Deploy command: git add . && git commit -m "..." && git push && deploy
(The "deploy" alias runs: ssh bradwu@pdx1-shared-a1-08.dreamhost.com "cd navybook.com/D1/seo && git pull")

Files: about.html, bookmarklet.html, favicon.svg, headline-lab.css, index.php, prefill.php, seo-api.php

When helping me with this project:
- Give me edited file contents or specific diffs I can apply locally
- I'll handle the git add/commit/push/deploy myself
- Don't give me full file rewrites unless I ask — targeted edits are better

## Checking usage logs

SSH into the server, then:
```bash
# Show the last 50 entries
tail -50 ~/headline-lab-usage.log

# Live-tail as requests come in
tail -f ~/headline-lab-usage.log

# Count uses by action type
cut -f2 ~/headline-lab-usage.log | sort | uniq -c

# Show all entries from a specific date
grep "^2026-03-15" ~/headline-lab-usage.log

# Count total requests
wc -l ~/headline-lab-usage.log
```

Log location: `/home/bradwu/headline-lab-usage.log` (outside web root, not publicly accessible).

Each line is tab-separated: `timestamp`, `action`, `ip_address`, `json_data`.

## How it works

```
Editor's browser → index.html (DreamHost) → seo-api.php (DreamHost) → Anthropic API → back to browser
```

Your API key lives only in the PHP file on your server. Article text never touches any public AI product.

---

## Setup (5 steps)

### 1. Get an Anthropic API key
- Go to https://console.anthropic.com → API Keys → Create Key
- Copy the key (starts with `sk-ant-...`)

### 2. Edit seo-api.php
Open `seo-api.php` and replace the placeholder:
```php
define('ANTHROPIC_API_KEY', 'sk-ant-YOUR-KEY-HERE');
```

### 3. (Recommended) Add a password
Uncomment and set these lines in `seo-api.php` to require a login:
```php
define('BASIC_AUTH_USER', 'newsroom');
define('BASIC_AUTH_PASS', 'your-strong-password');
```
This adds browser-native HTTP Basic Auth — simple and effective for internal tools.

### 4. Upload to DreamHost
Upload **both files** to the same directory on your DreamHost server:
- `index.html`
- `seo-api.php`

Via FTP/SFTP, place them somewhere like:
```
/home/yourusername/yourdomain.com/seo-tool/
```
They'll be accessible at: `https://yourdomain.com/seo-tool/`

### 5. Make sure PHP curl is enabled
DreamHost shared hosting has curl enabled by default. If you hit errors, 
contact DreamHost support to confirm `php-curl` is active.

---

## Cost estimate
- Claude Sonnet: ~$0.003 per API call (1 article → 6 headlines)
- 100 uses/month ≈ $0.30

---

## Optional hardening
- **IP restriction**: In `.htaccess`, add `Allow from YOUR.OFFICE.IP` to limit access by IP
- **HTTPS only**: DreamHost provides free Let's Encrypt SSL — enable it in the panel
- **Locked subdirectory**: Put the tool in a non-guessable path like `/tools/hl-gen-x7/`
