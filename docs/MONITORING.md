# Monitoring

**Status: CURRENT DIRECTION (D146).** What we send to PostHog and what PostHog does with it. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Our code instruments. PostHog does everything else (D146).

The API Worker, the call Durable Object, the web app, both mobile apps and the
rig tools send exceptions and a small set of events to the Loonext PostHog
project. PostHog groups the exceptions into issues, its dashboards show health,
and its alerts email the project owner. No code of ours decides that something
is broken, sends an alert email, throttles one, or keeps a ledger of what
should have happened.

The move is tracked in the epic "Monitoring: PostHog does it all, Sentry and
homemade alerting removed". Until it closes, Sentry, the ops email and the
liveness checker are still running; this page describes where they are going.

## What we send

Every event carries `environment` (`production`, `rig`, `synthetic`, `local`)
and `$process_person_profile: false`. System events use the distinct id
`loonext-api`; workspace events use the workspace UUID, as the product funnels
already do (D8). Alerts only read `environment = 'production'`.

| Event | Sent by | Properties | When |
|---|---|---|---|
| `$exception` | every client, through PostHog's SDKs | `$exception_list`, `$exception_level`, `source`, `release`, and `route`, `cron`, `job` or `company_id` where they apply | every caught or uncaught error |
| `$exception` (ops notice) | API Worker and Durable Object | the above plus `$exception_fingerprint`, `ops_key`, `detail`, `action` | a condition the product handles that a person must act on: a chargeback, a port-out, a carrier suspension, a cost cap nearing or reached |
| `ops_heartbeat` | API Worker and Durable Object | `key` (`cron:<expr>` with underscores for spaces, `channel:<name>`), `grace_minutes` | a cron trigger fired; a channel carried something; the Durable Object answered its six-hourly ping |
| `ops_gauge` | API Worker crons | `key`, `value`, `limit`, `unit` | a number only we can read: Telnyx spend against its daily limit, worst-case call legs against the concurrency limit, stored bytes against the included storage |
| `webhook_rejected` | API Worker webhook routes | `provider` | a provider's request failed its signature check |
| `message_outcome` | API Worker, Telnyx status webhook | `status` (`delivered`, `failed`), `country` (two letters) | an outbound text reached a final status |
| `email_bounced` | API Worker, Resend webhook | `kind` (`bounce`, `complaint`) | Resend reported a bounce or a complaint |
| `ring_push_sent`, `ring_beacon` | API Worker | `platform`, `app_version`, and `stage` on a beacon | a ring push went out; a device reported a ring stage |
| `call_received` | API Worker | none | an inbound call reached a workspace |
| `aup_signals` | API Worker, daily cron | the counts and ratios `api_aup_signals` returns, never content or names | once a day for each workspace that sent texts that day |
| `usage_threshold_crossed`, `overage_projected` | API Worker crons | `threshold` on the first | the existing customer warnings fired |

The funnel events from D8 (`checkout_completed`, `first_outbound_sent`,
`registration_submitted`, `registration_approved`) are unchanged.

### Fingerprints

An ops notice sets `$exception_fingerprint` to `ops:<key>`: `key` is lowercase
words joined by hyphens, names the problem and never an id, an amount or a
date, so every occurrence of one problem is one PostHog issue. Ids go in
properties. Ordinary errors set no fingerprint and PostHog groups them by stack,
which source maps make readable.

A notice is sent once, when the condition starts: the request that reaches a
cap, the transition into a bad state. Requests refused after that send nothing.

### What never leaves

The existing scrubbers run before anything is sent: no message bodies, names,
addresses, phone numbers, email addresses, query strings or request bodies.
Mobile SDKs run with screen views, lifecycle events, autocapture and session
replay off, and the same redaction in their `beforeSend` hooks.

### Volume

PostHog's free tier is 1M events and 100k exceptions a month, and the free plan
stops ingesting at the limit rather than billing. Expected: about 60k events a
month today, almost all of them cron heartbeats, and well under 1k exceptions.
At 200 active workspaces (about 60k texts, 10k calls and 20k emails a month)
the channel heartbeats and outcome events bring it to about 400k events. Ten
thousand exceptions a month would mean something is badly wrong.

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
Every one filters `environment = 'production'` except the free-tier tile, which
counts everything. Tiles for events the API has not sent yet are empty until it
deploys.

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
| [Heartbeat overdue](https://us.posthog.com/project/498129/insights/2nEDGd2v?alert_id=01a1a016-6c56-0000-622c-9eb2e7f7d0c7) | any `ops_heartbeat` key seen in the last 35 days has been silent longer than the largest `grace_minutes` it carried | SQL, one row per overdue key |
| [Limits and rates](https://us.posthog.com/project/498129/insights/s980Sfcg?alert_id=01a1a016-711c-0000-7002-59894c7a1757) | a gauge is at 70% of its limit, or its limit is missing or under the expected floor; three `webhook_rejected` from one provider in an hour; a country's delivery rate is under 80% (ten or more outcomes in a day); bounces over 2% or complaints over 0.05% of sends (a week, 100 or more sends); rings shown under 80% of pushes on a platform (a day, ten or more pushes); a registration submitted seven days ago and not approved; a workspace's `aup_signals` crossing the AUP thresholds; a `voice_dials`, `inbound_volume` or `cost_projection` warning; the month's events at 700k or exceptions at 70k | SQL, one row per breach |
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
does not skip an event; an event in the overlap can be reported twice.

#### How an alert notifies

Read from PostHog's open-source alert state machine (re-notify while firing,
no cool-down, no resolve notice): a check that finds a breach emails one
message listing every breaching row, and every following hourly check that
still finds a breach emails again. So a standing condition (an overdue
heartbeat, a gauge over 70%, a delivery rate that stays low) repeats hourly
until it is fixed, and a one-off event (a notice, a new issue, a rejection
burst) is reported once, or twice at most. A new breach that appears while
another is firing is in the next email, not a separate one. Snoozing the alert
in PostHog silences it for a while.

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
| New or returning error issue | the look-back widened from 70 minutes to 50 hours, which holds nine ops notices that already exist in the project | Firing, notification sent, rows labelled `ops notice: ...` |
| Heartbeat overdue | lower bound 1 (no production heartbeat exists before the API deploys, so the value is 0) | Firing, notification sent |
| Limits and rates | lower bound 1, same reason | Firing, notification sent |
| Exception spike | threshold detector with a lower bound of one exception an hour | Firing, notification sent |

The query logic was proven separately on rows labelled `environment =
'synthetic'`, which no alert reads: every rule above returned its row and no
row for the matching healthy case.

Changing an alert's threshold or config does not re-check it at once; the next
check is the hourly one. A newly created alert is checked within a minute.

### Limits and caveats

- `registration_submitted` and `registration_approved` are the D8 funnel
  events, which carry no `environment`, so the registration rule cannot tell
  rig events from production.
- A key not seen for 35 days drops out of the heartbeat alert, and a key never
  seen cannot be overdue. The longest grace (the monthly cron) is 33 days.
- The email authentication check is gone with no replacement; Resend's
  dashboard shows domain authentication.
- A path that answers 200 and does nothing is caught only by the outcome
  events or a customer.

Muting a problem is suppressing its issue in PostHog error tracking. Resolving
it there means the next occurrence reopens it. An ops notice is reported even
when its issue is suppressed.

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
