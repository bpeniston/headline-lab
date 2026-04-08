# Automated Trending Topics — Defense One

Like other GE360 pubs, I suspect, Defense One has only rarely updated the Trending Topics that appear in our site's navigation bar. That changes today.

Every morning at 5am, a script runs to automatically update our seven Trending Topics. It looks at the topics assigned to posts that have driven the most traffic to the site over the past day, week, and month (recent traffic counts more heavily than older traffic). It produces a ranked list of the top seven topics, updates the CMS accordingly, and Slacks me a confirmation message.

Notes:
- Sponsored slots are never touched. If a slot is rented out to an advertiser, the script skips it
- Every few weeks, the script's login session to the CMS expires. When that happens, it Slacks me and I log it back in.

If this seems to be working after a week or so, I can have the script do the same for other GE360 pubs that want it.

---

## How it works

The traffic data comes from Google Analytics 4. Three separate GA4 queries pull the most-viewed article URLs over the past 30 days, 7 days, and 1 day. For each of those articles, the script fetches the live page on defenseone.com and reads the topic tags from the HTML. Each topic accumulates a score equal to the sum of its monthly, weekly, and daily view counts across all the articles that carry it — so a topic spiking today ranks higher than one that peaked last week.

The CMS updates are handled by a Node.js script running on a dedicated MacBook Air. Rather than using the CMS's API (Athena doesn't expose one), the script maintains a logged-in browser session and submits the edit forms directly — the same sequence of clicks and form posts a human editor would make. Playwright, a browser automation library, handles the mechanics.

The script runs as a scheduled launchd job on the Air at 5am. After each run it sends a notification to my Slackbot with the applied topics in the subject line. If the CMS session has expired, it sends a different message with instructions for refreshing the login — a two-minute fix.
