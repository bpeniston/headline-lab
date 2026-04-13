#!/bin/bash
# heartbeat.sh — pings navybook.com/D1/seo/heartbeat.php every 10 minutes
# to record that the Air is alive.
# Installed as launchd job: com.navybook.heartbeat
# Checked at 4:50am by air-check.py on DreamHost before nightly jobs run.

curl -s --max-time 10 \
  "https://www.navybook.com/D1/seo/heartbeat.php?key=hl-heartbeat-2026" \
  > /dev/null
