# Monitoring

**Status: CURRENT (D146).** What we send to PostHog and what PostHog does with it. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Our code instruments. PostHog does everything else (D146).

The API Worker, the call Durable Object, the web app, both mobile apps and the
rig tools send exceptions and a small set of events to the Loonext PostHog
project. PostHog groups the exceptions into issues, its dashboards show health,
and its alerts email the project owner. No code of ours decides that something
is broken, sends an alert email, throttles one, or keeps a ledger of what
should have happened.

Sentry, the ops email and the liveness checker are gone from the code. The
Worker secrets `SENTRY_DSN`, `OPS_ALERT_EMAIL` and `OPS_ALERT_WEBHOOK_SECRET`
are deleted by hand in Cloudflare.

## What we send

Every event carries `environment` (`production`, `rig`, `synthetic`, `local`)
and `$process_person_profile: false`. System events use the distinct id
`loonext-api`; workspace events use the workspace UUID, as the product funnels
already do (D8). Alerts only read `environment = 'production'`.

| Event | Sent by | Properties | When |
|---|---|---|---|
| `$exception` | every client, through PostHog's SDKs | `$exception_list`, `$exception_level`, `source`, `release`, and `route`, `cron`, `job` or `company_id` where they apply | every caught or uncaught error |
| `$exception` (ops notice) | API Worker and Durable Object | the above plus `$exception_fingerprint`, `ops_key`, `detail`, `action` | a condition the product handles that a person must act on: a chargeback, a port-out, a carrier suspension, a cost cap nearing or reached |
| `ops_heartbeat` | API Worker and Durable Object | `key` (`cron:<expr>` with underscores for spaces, `channel:<name>`), `grace_minutes` | a cron trigger fired; a channel carried something (the Telnyx channels at most once every ten minutes per isolate; every Resend send, because the bounce rate divides by them); the Durable Object answered its six-hourly ping |
| `ops_gauge` | API Worker crons | `key`, `value`, `limit`, `unit` | a number only we can read: Telnyx spend against its daily limit, worst-case call legs against the concurrency limit, stored bytes against the included storage |
| `webhook_rejected` | API Worker webhook routes | `provider` | a provider's request failed its signature check, at most once per provider every five minutes per isolate, because the routes are public and one script must not be able to spend the month's quota |
| `message_outcome` | API Worker, Telnyx status webhook | `status` (`delivered`, `failed`), `country` (two letters) | an outbound text reached a final status |
| `email_bounced` | API Worker, Resend webhook | `kind` (`bounce`, `complaint`) | Resend reported a bounce or a complaint |
| `ring_push_sent`, `ring_beacon` | API Worker | `platform`, `app_version`, and `stage` on a beacon | a ring push went out; a device reported a ring stage |
| `call_received` | API Worker | none | an inbound call reached a workspace; the alert reads a workspace that took eight calls and then none for 14 days |
| `aup_signals` | API Worker, daily cron | the counts and ratios `api_aup_signals` returns, never content or names | once a day for each workspace that sent texts that day |
| `usage_threshold_crossed`, `overage_projected` | API Worker crons | `threshold` on the first | the existing customer warnings fired |

The funnel events from D8 (`checkout_completed`, `first_outbound_sent`,
`registration_submitted`, `registration_approved`) are otherwise unchanged,
and now carry `environment` too. Earlier ones do not, and the rules read a
missing `environment` as production.

### Fingerprints

An ops notice sets `$exception_fingerprint` to `ops:<key>`: `key` is lowercase
words joined by hyphens, names the problem and never an id, an amount or a
date, so every occurrence of one problem is one PostHog issue. Ids go in
properties. Ordinary errors set no fingerprint and PostHog groups them by stack. Source
maps are uploaded for the web app, the API Worker and both mobile apps, so
their frames read as source. The API Worker is deployed as built, with the
chunk ids `posthog-cli sourcemap inject` adds, and its maps are uploaded under
release `loonext-api` at `GIT_SHA`. Every upload needs `POSTHOG_CLI_TOKEN`;
without it the step warns and the frames are the bundle's. A token that is set
but revoked or wrong fails the step without failing the deploy, so look for the
step's annotation on a release run.

A notice is sent once, when the condition starts: the request that reaches a
cap, the transition into a bad state. Requests refused after that send nothing.
The one standing state with no event to start from, a Telnyx number outside the
environment's partition, is reported on the first sweep of every sixth hour.

### What never leaves

The existing scrubbers run before anything is sent: no message bodies, names,
addresses, phone numbers, email addresses, query strings or request bodies.
The API Worker and the web app run the full set (name keys, URL query cuts,
secret path segments, phone and email text). The mobile apps run with screen
views, lifecycle events, autocapture and session replay off, and redact in
their `beforeSend` hooks the text of each exception: URL query strings and
the token in a public link's path, email addresses and phone-shaped digit
runs. Their frames name classes and lines. The guard and edge Workers send
only notices their own code wrote, scrubbed of phone numbers and email
addresses.

The rig's API Worker holds the project key so its exceptions, filed under
environment `rig`, can be read back for R00; it sends no funnel events, and
no alert reads `rig`.

### Volume

PostHog's free tier is 1M events and 100k exceptions a month, and the free plan
stops ingesting at the limit rather than billing. Expected: about 60k events a
month today, almost all of them cron heartbeats, and well under 1k exceptions.
At 200 active workspaces (about 60k texts, 10k calls and 20k emails a month)
the outcome, ring, send and call events bring it to about 250k events. Ten
thousand exceptions a month would mean something is badly wrong.

Two sources could repeat without limit, so the sender caps them: a refused
webhook signature (a public route anyone can post to) and the Telnyx channel
heartbeats (one per webhook or text). Each sends at most one event per window
per isolate; see the table above.

Reaching the limit stops ingestion for the rest of the month, errors included,
so the "Limits and rates" alert fires at 70% of either quota, and PostHog's
error tracking rate limits drop a flooding issue before it can use up the
exception quota.

## In PostHog

Created through PostHog's API and kept there, not in this repository. Project
498129 on PostHog Cloud US, on the free plan with no billing subscription and
no custom limit, so ingestion stops at the quota instead of billing. The free
plan allows five alerts; four are used.

Error tracking has exception autocapture on, a rate limit of 100 events an hour
for each issue and 2,000 an hour for the whole project. Its own destinations
(Slack, Discord, Teams, webhook) are not used: the two webhook destinations
that pointed at `/webhooks/posthog-alert` are deleted, so no PostHog alert
calls our code.

### Dashboards

Each tile is a saved insight, mostly SQL over the events in the table above.
Each filters `environment = 'production'` except: the free-tier tile, which
counts everything; the two error-issue tiles (open issues, new issues per
week), because PostHog's issue table has no environment and the rig sends its
exceptions under `rig`; and the funnel tiles reused from the D8 dashboard,
which count every funnel event. The registration tile reads a missing
`environment` as production. Tiles for events the API has not sent yet are
empty until it deploys.

| Dashboard | Tiles |
|---|---|
| [Loonext health](https://us.posthog.com/project/498129/dashboard/2296136) | open error issues, exceptions by source, heartbeats against their grace, gauges against their limits, webhook rejections by provider, free-tier use this month, activation funnel, texting registration |
| [Loonext errors](https://us.posthog.com/project/498129/dashboard/2296137) | top issues, ops notices, exceptions by release and source, new issues per week, cron job failures, exceptions per hour |
| [Loonext calls](https://us.posthog.com/project/498129/dashboard/2296139) | calls per day and per workspace, ring pushes against rings shown by platform, ring stages by platform and version, concurrent call legs against the Telnyx limit |
| [Loonext texting](https://us.posthog.com/project/498129/dashboard/2296140) | outcomes per day, delivery rate by country, Telnyx channel heartbeats, registrations waiting over seven days, AUP signals per workspace |
| [Loonext email](https://us.posthog.com/project/498129/dashboard/2296141) | sends per day, bounces and complaints per day, bounce and complaint rates |
| [Loonext billing and spend](https://us.posthog.com/project/498129/dashboard/2296142) | Telnyx daily spend against its limit, stored bytes against the included storage, usage thresholds crossed, cost warnings (dials, inbound volume, storage, projection), checkouts and plan changes |

The older [Loonext funnel and activation](https://us.posthog.com/project/498129/dashboard/2287762)
dashboard (D8) is unchanged; some of its insights are reused above.

### Alerts

Each alert is checked hourly and emails the PostHog login of the project owner.
The query behind each is a saved insight named `Alert: ...`, which the alert
link opens.

| Alert | Fires when | Insight |
|---|---|---|
| [New or returning error issue](https://us.posthog.com/project/498129/insights/r0XtuRNs?alert_id=01a1a018-ca3b-0000-34f1-ae643b2cabaf) | an active issue's first production event, or its first after 24 quiet hours, was in the last 70 minutes; and for every ops notice (`ops_key`) in the last 70 minutes, since each one is something a person must act on | SQL over `$exception` joined to `system.error_tracking_issues`, one row per issue or notice |
| [Heartbeat overdue](https://us.posthog.com/project/498129/insights/2nEDGd2v?alert_id=01a1a016-6c56-0000-622c-9eb2e7f7d0c7) | a scheduled `ops_heartbeat` key (`cron:*`, `channel:call-session-do`) has been silent longer than the largest `grace_minutes` it carried, for up to 48 hours past it (a key retired on purpose stops on its own) | SQL, one row per overdue key |
| [Limits and rates](https://us.posthog.com/project/498129/insights/s980Sfcg?alert_id=01a1a016-711c-0000-7002-59894c7a1757) | every hour: a gauge at 90% of its limit, or with its limit missing or under the expected floor; three `webhook_rejected` from one provider in an hour; a workspace's `aup_signals` crossing the AUP thresholds; a `voice_dials`, `inbound_volume`, `cost_projection` or `storage_abuse` warning; a registration submitted seven days ago and not approved; a workspace that took eight or more calls and none for 14 days; a workspace that paid ten days ago and has sent no text. Once a day, in the 07:00 UTC check, for conditions that stay true: a gauge at 70%; a country's delivery rate under 80% (ten or more outcomes in a day); bounces over 2% or complaints over 0.05% of sends (a week, 100 or more sends); a platform's rings shown 15 points below its own previous seven days (30 or more pushes in each); the month's events at 700k or exceptions at 70k | SQL, one row per breach |
| [Exception spike](https://us.posthog.com/project/498129/insights/MOIssrNk?alert_id=01a1a016-75c1-0000-e9bd-92c2192a47ae) | PostHog's z-score anomaly detector (threshold 0.95, window 72 hours) flags the last completed hour of production exceptions | trend of `$exception` per hour |

The AUP thresholds are the ones the old `aup-watch.ts` used: 100 or more sent
in 24 hours with a baseline above zero, five times that baseline and a fresh
recipient ratio of 0.8 or more; 5 or more carrier spam blocks; 10 or more
opt-outs; or, with 50 or more sent, opt-outs at 3% or spam blocks at 2%.

Rules for editing these queries, learned from the first run: an SQL alert
reads a plain `SELECT` with a constant `LIMIT`, at most 50 rows, with one
numeric column (`breach`) and one label column (`label`). A bare `UNION ALL`
at the top made the check error, so each query wraps its unions in an outer
select. No rows is a pass.

Event rows look back 70 minutes, not 60, so a check that runs a little late
does not skip an event; an event in the overlap can be reported twice. The
once-a-day rules test the hour of the check (`toHour(now()) = 7`), so a
standing condition emails once a day instead of every hour.

The rings rule compares a platform with its own past rather than with a fixed
80%: pushes to devices that cannot send beacons (web, old app builds) never
show a ring, and a fixed share would stay in breach for ever. Only a fall
against the platform's own previous week reports.

The call-silence and no-first-text rules are simpler than the per-workspace
reports they replace. The no-first-text rule cannot tell a US workspace waiting
on its carrier from a stalled one, so it waits ten days, past the carrier's
promised seven; the registration rule reports a registration the carrier has
not approved.

#### How an alert notifies

Read from PostHog's open-source alert state machine, and not observed over two
consecutive firing checks (re-notify while firing, no cool-down, no resolve
notice): a check that finds a breach emails one message listing every
breaching row, and every following hourly check that still finds a breach
emails again. So what stays true repeats until it stops, and the queries bound
that. An overdue heartbeat reports for 48 hours past its grace and then
stops. A gauge between 70% and 90% and the rate rules report once a day. Only
a gauge at 90% or with a missing limit repeats hourly. A one-off event (a
notice, a new issue, a rejection burst) is reported once, or twice at most. A
new breach that appears while another is firing is in the next email, not a
separate one. Snoozing the alert in PostHog silences it for a while.

Anomaly detection is available on the free plan: the API accepted the
detector, simulating it over seven days of real data flagged the one burst in
it, and the threshold test below fired it. On a series that is mostly zero a
single exception scores low and a burst of several scores high, which is what
the alert is for; a first-ever error is the job of the "new" alert.

#### Threshold tests (2026-11-03)

Each real alert was recreated with its threshold lowered so it fired on data
that exists, then the threshold was put back. Each check history keeps one
Firing check that sent its notification. No production events were made up.

| Alert | How it was made to fire | Result |
|---|---|---|
| New or returning error issue | the look-back widened from 70 minutes to 50 hours, which holds nine ops notices that already exist in the project: four test events from the old alert destination, four from the retired `channel:do-sentry` check and one email-authentication notice, none from live code | Firing, notification sent, rows labelled `ops notice: ...` |
| Heartbeat overdue | lower bound 1 (no production heartbeat exists before the API deploys, so the value is 0) | Firing, notification sent |
| Limits and rates | lower bound 1, same reason | Firing, notification sent |
| Exception spike | threshold detector with a lower bound of one exception an hour | Firing, notification sent |

The query logic was proven separately on rows labelled `environment =
'synthetic'`, which no alert reads: every rule returned its row and no row for
the matching healthy case. What that proof did not cover:

- The registration rule was run on events named `synthetic_registration_submitted`
  and `synthetic_registration_approved`. The shipped query differs only in the
  event names, and production holds no registration event yet to run it on.
- Rules added after the first round (call silence, no first text, the storage
  warning, rings against their own baseline, the 48-hour heartbeat bound and
  the daily gate) were proven the same way, with the synthetic tag swapped in
  for the environment test. For the gate, the same query returned the daily
  rows with the hour set to 7 and not with it set to another.

Every error issue that tests or retired checks left in the project is
suppressed, so none counts as open.

Changing an alert's threshold or config does not re-check it at once; the next
check is the hourly one. A newly created alert is checked within a minute.

### Limits and caveats

- The funnel events sent before `environment` was added to them carry none,
  and the registration rule, the no-first-text rule and the registration tile
  read them as production. The rig sends no funnel events, so none of them is
  the rig's.
- "Heartbeat overdue" reads only the keys that beat on a schedule: every
  `cron:` key and `channel:call-session-do`. The traffic channels
  (`channel:telnyx-send`, `channel:telnyx-webhook`, `channel:resend-send`) beat
  only when they carry something, and production carried no texts in the 30
  days to 2026-11-07, so their silence cannot tell a broken path from a quiet
  one. They are on the dashboard; a send that fails is an exception, and failed
  outcomes count in "Limits and rates".
- A key reports as overdue for up to 48 hours past its grace, and a key never
  seen cannot be overdue. The longest grace (the monthly cron) is 33 days and
  the alert looks back 35.
- An issue someone resolved and that comes back is active again and counts in
  "Open error issues", but "New or returning" cannot see a resolution, so it
  reports the return only if the issue had been quiet for 24 hours. A burst is
  caught by the spike alert.
- Error tracking drops events past its rate limits (100 an hour per issue,
  2,000 an hour for the project), and an ops notice is an exception like the
  rest, so a flood of ordinary exceptions can drop a notice that arrives in the
  same hour. The limits are there to protect the 100k monthly quota.
- The Telnyx wiring check (webhook URLs and number settings in Telnyx's portal)
  is gone. A webhook that stops arriving shows on the dashboard as
  `channel:telnyx-webhook` going quiet, and texts that stop leaving as
  `channel:telnyx-send` going quiet, but neither alerts: a webhook pointed at
  the wrong URL raises nothing until a customer's text or call goes missing.
- The email authentication check is gone with no replacement; Resend's
  dashboard shows domain authentication.
- A path that answers 200 and does nothing is caught only by the outcome
  events or a customer.

Muting a problem is suppressing its issue in PostHog error tracking. Resolving
it there makes the next occurrence reopen it, which PostHog shows on the issue
(see the caveat above about the alert). An ops notice is reported even when its
issue is suppressed.

## Where to look

- **Something broke**: PostHog, Error tracking. Filter by `source` or
  `ops_key`; the issue's history is the incident record.
- **Is everything running**: the Loonext health dashboard.
- **Raw logs for one request or cron run**: Cloudflare Workers Logs for the
  `loonext-api` and `loonext-web` Workers.
- **Vendor-side state**: the Telnyx, Resend and Stripe dashboards. Telnyx
  enforces its own daily spend limits and emails the account owner when one is
  reached; Resend shows domain authentication.
- **CI**: scheduled workflow failures open GitHub issues (D140).

## What we deliberately do not have

No synthetic probes or canaries, no paging service, no alert email from our
own code, no status automation. The `/status` page is a line a person writes.
A path that answers 200 and does nothing useful is caught by the outcome
events above or by a customer, not by a probe.
