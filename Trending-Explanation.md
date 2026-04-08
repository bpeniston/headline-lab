# Automated Trending Topics — Defense One

Like other GE360 pubs, I suspect, Defense One has only rarely updated the Trending Topics that appear in our site's navigation bar. That changes today.

Every morning at 5am, a script runs to automatically update our seven Trending Topics. It looks at the topics assigned to posts that have driven the most traffic to the site over the past day, week, and month (recent traffic counts more heavily than older traffic). It produces a ranked list of the top seven topics, updates the CMS accordingly, and Slacks me a confirmation message.

Notes:
- Sponsored slots are never touched. If a slot is rented out to an advertiser, the script skips it
- Every few weeks, the script's login session to the CMS expires. When that happens, it Slacks me and I log it back in.

If this seems to be working after a week or so, I can have the script do the same for other GE360 pubs that want it.

---

## How it works

The traffic data comes from Google Analytics 4. Three separate GA4 queries pull the most-viewed article URLs over the past 30 days, 7 days, and 1 day. For each of those articles, the script fetches the live page on defenseone.com and reads the topic tags from the HTML — the same tags editors assign when they publish a story. Each topic then accumulates a score equal to the sum of its monthly, weekly, and daily view counts across all the articles that carry it, so a topic spiking today ranks higher than one that peaked last week. The top seven become the new Trending Topics.

Updating the CMS is the trickier part. Athena doesn't expose an API, so the script has to interact with the admin interface the same way a human editor would — loading each Trending Item's edit page, looking up the correct topic ID, filling in the form, and clicking Save. Playwright, a browser automation library, handles those mechanics. The whole update takes about ten seconds.

The script runs on a MacBook Air that sits in my server closet. It's set to wake at 5am, run the update, and go back about its business. Rather than logging into the CMS fresh each night — which would trigger two-factor authentication — it maintains a persistent browser session that stays valid for several weeks at a stretch.

After each run, the script sends a notification to my Slackbot. The applied topics appear directly in the subject line, so I can see what's running without opening anything. If the CMS session has expired, it sends a different message with instructions for refreshing the login — a two-minute fix via Screen Sharing to the closet machine.
