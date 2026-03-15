# SEO Headline Generator — Setup Guide
Internal newsroom tool · Hosted on DreamHost

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
