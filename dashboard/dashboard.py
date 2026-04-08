#!/usr/bin/env python3
"""
dashboard/dashboard.py
Job health dashboard for blotchy-macbook — stdlib only, no dependencies.
Runs on port 9000; accessible at http://100.117.250.37:9000

To add a new job: append one dict to JOBS and write a parser function.
"""

import re
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT     = 9000
LOG_BASE = os.path.expanduser("~/headline-lab/logs")


# ── Helpers ────────────────────────────────────────────────────

def read_log(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.readlines()
    except OSError:
        return []


def parse_iso_ts(line):
    m = re.match(r"\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\]", line)
    if not m:
        return None
    try:
        return datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_ts(dt):
    if dt is None:
        return "unknown"
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def age_str(dt):
    if dt is None:
        return ""
    delta = datetime.now(timezone.utc) - dt
    total = int(delta.total_seconds())
    if total < 60:   return "just now"
    if total < 3600: return f"{total // 60}m ago"
    if total < 86400:
        h, m = divmod(total // 60, 60)
        return f"{h}h {m}m ago"
    d, rem = divmod(total, 86400)
    return f"{d}d {rem // 3600}h ago"


def last_run_block(lines, start_pattern):
    """Return (timestamp, lines) for the most recent run."""
    if not lines:
        return None, []
    starts = [i for i, l in enumerate(lines) if re.search(start_pattern, l)]
    if not starts:
        return None, []
    block = lines[starts[-1]:]
    return parse_iso_ts(block[0]), block


def tail_lines(block, n=8):
    stripped = [l.rstrip("\n") for l in block if l.strip()]
    return stripped[-n:]


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── Job parsers ────────────────────────────────────────────────

def parse_trending_apply(lines):
    ts, block = last_run_block(lines, r"=== Trending apply start")
    if not block:
        return dict(status="NEVER RUN", last_run=None, summary="No runs recorded.", tail=[])

    text = "".join(block)
    done_m    = re.search(r"=== Done: (\d+) applied, (\d+) failed, (\d+) sponsored skipped ===", text)
    fatal     = re.search(r"FATAL: (.+)", text)
    expired   = "Session has expired" in text
    recs_m    = re.search(r"Got \d+ recommendations?: (.+)", text)
    topic_str = recs_m.group(1).strip() if recs_m else None

    if expired:
        status  = "FAILED"
        summary = "Session expired — re-login required via Screen Sharing."
    elif fatal:
        status  = "FAILED"
        summary = f"Fatal: {fatal.group(1).strip()}"
    elif done_m:
        applied, failed, sponsored = done_m.group(1), done_m.group(2), done_m.group(3)
        if int(failed) > 0:
            status  = "FAILED"
            summary = f"{applied} applied, {failed} FAILED, {sponsored} sponsored skipped."
        else:
            status  = "OK"
            summary = (f"{applied} topics applied: {topic_str}" if topic_str
                       else f"{applied} applied, {sponsored} sponsored skipped.")
    else:
        status  = "FAILED"
        summary = "Run started but did not complete."

    return dict(status=status, last_run=ts, summary=summary, tail=tail_lines(block))


def parse_monthly_report(lines):
    ts, block = last_run_block(lines, r"=== Monthly Trending Topics report ===")
    if not block:
        return dict(status="NEVER RUN", last_run=None, summary="No runs recorded.", tail=[])

    text       = "".join(block)
    sent       = "Report sent." in text
    fetch_fail = re.search(r"Failed to fetch stats: (.+)", text)
    email_err  = re.search(r"Email error: (.+)", text)
    data_m     = re.search(r"\] (.+: [\d,]+ views\..+)", text)

    if fetch_fail:
        status  = "FAILED"
        summary = f"Stats fetch failed: {fetch_fail.group(1).strip()}"
    elif email_err:
        status  = "FAILED"
        summary = f"Email error: {email_err.group(1).strip()}"
    elif sent and data_m:
        status  = "OK"
        summary = data_m.group(1).strip()
    elif data_m:
        status  = "FAILED"
        summary = f"Got data but report not sent: {data_m.group(1).strip()}"
    else:
        status  = "FAILED"
        summary = "Run started but no report data found."

    return dict(status=status, last_run=ts, summary=summary, tail=tail_lines(block))


# ── Job registry ───────────────────────────────────────────────
# To add a job: append a dict with name, log, parser, schedule.

JOBS = [
    dict(
        name     = "Trending Topics auto-apply",
        log      = os.path.join(LOG_BASE, "trending-apply.log"),
        parser   = parse_trending_apply,
        schedule = "Nightly at 5:00 AM",
    ),
    dict(
        name     = "Monthly Trending Topics report",
        log      = os.path.join(LOG_BASE, "monthly-report.log"),
        parser   = parse_monthly_report,
        schedule = "1st of each month at 6:00 AM",
    ),
]


# ── HTML rendering ─────────────────────────────────────────────

STATUS_STYLE = {
    "OK":        ("#d4edda", "#155724", "#28a745"),
    "FAILED":    ("#f8d7da", "#721c24", "#dc3545"),
    "NEVER RUN": ("#e2e3e5", "#383d41", "#6c757d"),
}

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f0f2f5; color: #212529;
  padding: 28px 24px; font-size: 15px;
}
h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; }
.updated { color: #6c757d; font-size: 0.8rem; margin-bottom: 24px; }
.card {
  border-radius: 8px; padding: 18px 20px; margin-bottom: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,.09);
}
.card-header {
  display: flex; justify-content: space-between;
  align-items: flex-start; margin-bottom: 8px;
}
.job-name { font-size: 1.05rem; font-weight: 700; display: block; }
.schedule { font-size: 0.78rem; color: #6c757d; margin-top: 2px; display: block; }
.badge {
  color: #fff; font-size: 0.73rem; font-weight: 700;
  padding: 4px 10px; border-radius: 20px; white-space: nowrap; margin-left: 12px;
}
.meta { font-size: 0.82rem; color: #495057; margin-bottom: 6px; }
.age { margin-left: 8px; color: #868e96; }
.summary { font-size: 0.92rem; font-weight: 500; margin-bottom: 10px; }
.tail-label {
  font-size: 0.7rem; text-transform: uppercase;
  letter-spacing: .07em; color: #868e96; margin-bottom: 4px;
}
.tail pre {
  background: rgba(0,0,0,.06); border-radius: 4px;
  padding: 10px 12px; font-size: 0.74rem; line-height: 1.55;
  overflow-x: auto; white-space: pre-wrap; word-break: break-all;
}
.tail pre span { display: block; }
.footer { margin-top: 28px; font-size: 0.75rem; color: #adb5bd; text-align: center; }
"""

def render_card(job, result):
    s               = result["status"]
    bg, txt, badge  = STATUS_STYLE.get(s, STATUS_STYLE["NEVER RUN"])
    last_run_str    = fmt_ts(result["last_run"])
    age             = age_str(result["last_run"])

    tail_html = ""
    if result["tail"]:
        lines_html = "\n".join(f"<span>{esc(l)}</span>" for l in result["tail"])
        tail_html  = f'<div class="tail"><div class="tail-label">Recent log</div><pre>{lines_html}</pre></div>'

    return f"""
<div class="card" style="background:{bg};border-left:5px solid {badge};">
  <div class="card-header">
    <div>
      <span class="job-name">{esc(job['name'])}</span>
      <span class="schedule">{esc(job['schedule'])}</span>
    </div>
    <span class="badge" style="background:{badge};">{s}</span>
  </div>
  <div class="meta">
    Last run: <strong>{last_run_str}</strong>
    {f'<span class="age">{age}</span>' if age else ''}
  </div>
  <div class="summary" style="color:{txt};">{esc(result['summary'])}</div>
  {tail_html}
</div>"""


def render_page(jobs_data):
    now_str = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    cards   = "".join(render_card(job, result) for job, result in jobs_data)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Job Health — blotchy-macbook</title>
  <style>{CSS}</style>
</head>
<body>
  <h1>Job Health</h1>
  <div class="updated">Updated: {now_str} &mdash; refresh to reload</div>
  {cards}
  <div class="footer">blotchy-macbook &bull; 100.117.250.37:9000 &bull; headline-lab</div>
</body>
</html>"""


# ── HTTP server ────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_response(404); self.end_headers(); return
        jobs_data = [(job, job["parser"](read_log(job["log"]))) for job in JOBS]
        body      = render_page(jobs_data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # suppress per-request stderr noise


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Dashboard running on http://0.0.0.0:{PORT}")
    server.serve_forever()
