#!/usr/bin/env python3
# air-check.py — runs on DreamHost at 4:50am via cron.
# Checks ~/air-heartbeat.txt; if stale, sends a Slack alert before
# the 5:00am and 5:30am nightly jobs run on the Air.
#
# DreamHost cron entry:
#   50 4 * * * /usr/bin/python3 /home/bradwu/navybook.com/D1/seo/air-check.py

import os
import time
import subprocess

HEARTBEAT_FILE = os.path.expanduser('~/air-heartbeat.txt')
SLACK_EMAIL    = 'u5q8h4r0o7x8o9l7@govexec.slack.com'
FROM_EMAIL     = 'submissions@navybook.com'
MAX_AGE_SEC    = 20 * 60   # alert if no ping in 20 minutes


def send_alert(subject, body):
    msg = (
        f"From: Athena Tools <{FROM_EMAIL}>\r\n"
        f"To: {SLACK_EMAIL}\r\n"
        f"Subject: {subject}\r\n"
        f"\r\n"
        f"{body}"
    )
    subprocess.run(['/usr/sbin/sendmail', '-t'], input=msg.encode(), check=True)


def main():
    if not os.path.exists(HEARTBEAT_FILE):
        send_alert(
            'Air: Problem',
            'Heartbeat file not found at ~/air-heartbeat.txt.\n'
            'The Air may never have connected, the file was deleted, '
            'or the heartbeat job was never installed.\n\n'
            + recovery_instructions()
        )
        return

    try:
        last_beat = int(open(HEARTBEAT_FILE).read().strip())
    except (ValueError, OSError) as e:
        send_alert('Air: Problem', f'Could not read heartbeat file: {e}\n\n' + recovery_instructions())
        return

    age = time.time() - last_beat
    if age > MAX_AGE_SEC:
        age_min = int(age // 60)
        last_str = time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(last_beat))
        send_alert(
            'Air: Problem',
            f'No heartbeat from the Air in {age_min} minutes.\n'
            f'Last heartbeat: {last_str}\n\n'
            + recovery_instructions()
        )


def recovery_instructions():
    return (
        'Recovery checklist:\n'
        '1. Try VNC: open vnc://100.117.250.37\n'
        '2. If VNC fails, check Tailscale: login.tailscale.com/admin/machines\n'
        '   — If Air shows Offline, it may have lost network or Tailscale crashed\n'
        '3. On Air: System Settings → General → Sharing → Remote Login ON\n'
        '   — macOS updates can silently turn this off\n'
        '4. On Air: open Terminal and run: tailscale status\n'
        '   — If "Logged Out", sign back in via the menu bar icon\n'
        '5. Once reachable via SSH:\n'
        '   ssh brad-developer@100.117.250.37\n'
        '   cd ~/headline-lab && git pull\n'
        '   # If CMS session also expired:\n'
        '   node scripts/apply-trending.js --setup\n'
    )


if __name__ == '__main__':
    main()
