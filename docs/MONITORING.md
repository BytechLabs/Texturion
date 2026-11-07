# Monitoring

**Status: CURRENT (D147).** What we send, and what the vendors do with it. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Our code instruments. The vendors do everything else (D146, D147).

The API Worker, the call Durable Object, the web app, both mobile apps and the
rig tools send exceptions and a small set of events to the Loonext PostHog
project, and both Workers keep their logs in Cloudflare Workers Logs. PostHog
groups the exceptions into issues, its dashboards show health, and its alerts
email the project owner. Cloudflare's monitors are meant to watch what Cloudflare
already records about the Workers, but none exists yet (see "In Cloudflare"). The other vendors send their own notices. No code
of ours decides that something is broken, schedules a check, keeps monitoring
state, throttles a notice or sends an alert email.

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
| `$exception` (ops notice) | API Worker and Durable Object | the above plus `$exception_fingerprint`, `ops_key`, `detail`, `action` | a condition the product handles that a person must act on: a chargeback, a port-out, a carrier suspension, a cost cap reached, the Telnyx messaging spend limit refusing a text |
| `message_sent` | API Worker, at the one send path (`dispatchOutbound`) | `direction` (`outbound`), `status` (`accepted`, `refused`), and when refused `error_code` (Telnyx's code, `rate_limited` for our own limiter, or null for a network failure) and `reason` (the carrier-failure reason); `country`, `segments` (as metered at submit, an MMS as 3), `media_count` | a text was submitted to Telnyx, or our rate limiter stopped it first |
| `message_received` | API Worker, inbound pipeline | `direction` (`inbound`), `country` (the sender's), `segments` (Telnyx's parts), `media_count` | an inbound text was threaded for the first time; a sweeper replay sends nothing |
| `message_outcome` | API Worker, Telnyx status webhook | `status` (`delivered`, `failed`), `country` (two letters) | an outbound text reached a final status |
| `email_sent` | API Worker | none | Resend accepted an email; the denominator of the bounce and complaint rates |
| `email_bounced` | API Worker, Resend webhook | `kind` (`bounce`, `complaint`) | Resend reported a bounce or a complaint |
| `push_attempt` | API Worker and Durable Object | `purpose` (`ring`, `call_end`, `alert`), `channel`, `platform`, `priority`, `response_class` (`accepted`, `gone`, `unauthorized`, `rejected`, `throttled`, `provider_error`, `transport_error`), `http_status`, `latency_ms`, `call_session_id`, `user_id` (not in production), `attempted_at` | every push the server sent, one event per device |
| `ring_beacon` | API Worker, relaying the apps | `platform`, `app_version`, `stage`, `call_session_id`, `user_id` (not in production), `occurred_at`, and the device state the app reports (`os`, `permissions`, `standby_bucket`, `power_save`, `device_idle`, `screen_locked`) | a device reported a ring stage; a Workers rate limiting binding bounds each member's beacons |
| `call_started` | call Durable Object | `direction` (`inbound`, `outbound`), `call_session_id` | the call engine took a new call: its session began |
| `call_ended` | call Durable Object | the above plus `outcome` (`answered`, `voicemail`, `missed`), `duration_seconds` (initiation to end, ring time included), `ended_by` (the engine event that ended it, such as `inbound-hangup`, `outbound-hangup`, `alarm-janitor`) | the call first reached an ended state |
| `call_outcome_revised` | call Durable Object | `direction`, `call_session_id`, `outcome`, `previous_outcome` | an ended call's outcome changed: a voicemail ends `missed` at the hangup and becomes `voicemail` when its recording is saved, and a hangup that proves an answer upgrades `missed` to `answered` |
| `aup_signals` | API Worker, daily cron | the counts and ratios `api_aup_signals` returns, never content or names | once a day for each workspace that sent texts that day |
| `usage_threshold_crossed`, `overage_projected` | API Worker crons | `threshold` on the first | the existing customer warnings fired |
| `$csp_violation` | browsers, to PostHog's CSP endpoint | PostHog's own CSP fields | dormant: no CSP header is sent, in any environment, until `CSP_STAGING=report-only` is set; then sampled at 10% |

The funnel events from D8 (`checkout_completed`, `first_outbound_sent`,
`registration_submitted`, `registration_approved`) are otherwise unchanged,
and now carry `environment` too. Earlier ones do not, and the rules read a
missing `environment` as production.

The call events come from the Durable Object because it owns every inbound and
outbound call's state: each is sent once, after the transition that caused it
is stored, and a journal resumed after a crash replays effects without
reporting again. `call_session_id` is the uuid `push_attempt` and
`ring_beacon` carry, so the three join. A call's latest outcome is its
`call_outcome_revised` if it has one, else its `call_ended`. `call_started`
replaced `call_received`, which the API Worker's webhook sent for each new
inbound call until the release after 2026-11-07; its events stay in PostHog,
and the queries that read call history (the call-silence rule and the two
inbound tiles on "Loonext calls") read `call_received` or an inbound
`call_started`, so a call is never counted under both names.

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
environment's partition, is reported on every sweep that finds it; PostHog
groups the repeats into one issue and its rate limits bound them.

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
addresses. `push_attempt` and `ring_beacon` carry UUIDs, codes and counts,
which D8 allows; never a token or a number.

The rig's API Worker holds the project key so its exceptions, filed under
environment `rig`, can be read back for R00; it sends no funnel events, and
no alert reads `rig`.

### Volume

PostHog's free tier is 1M events and 100k exceptions a month, and the free plan
stops ingesting at the limit rather than billing. Expected: a few thousand
events a month today, and well under 1k exceptions. At 200 active workspaces
(about 60k texts, 10k calls and 20k emails a month) the outcome, push, ring,
send and call events bring it to about 300k events; `push_attempt` adds
roughly one event per push, ring, call end or alert, to each device. The
lifecycle events add one `message_sent` or `message_received` per text and two
or three events per call, about 90k more, so near 400k in all. Ten
thousand exceptions a month would mean something is badly wrong.

Reaching the limit stops ingestion for the rest of the month, errors included,
so the "Limits and rates" alert fires at 70% of either quota, and PostHog's
error tracking rate limits drop a flooding issue before it can use up the
exception quota.

## In PostHog

Created through PostHog's API and kept there, not in this repository. Project
498129 on PostHog Cloud US, on the free plan with no billing subscription and
no custom limit, so ingestion stops at the quota instead of billing. The free
plan allows five alerts and all five are used (see "Alerts"); a sixth check
goes into an existing SQL alert, as stuck calls did.

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
| [Operations](https://us.posthog.com/project/498129/dashboard/2317534) | see below |
| [Loonext health](https://us.posthog.com/project/498129/dashboard/2296136) | open error issues, exceptions by source, free-tier use this month, activation funnel, texting registration |
| [Loonext errors](https://us.posthog.com/project/498129/dashboard/2296137) | top issues, ops notices, exceptions by release and source, new issues per week, cron job failures, exceptions per hour |
| [Loonext calls](https://us.posthog.com/project/498129/dashboard/2296139) | inbound calls per day and per workspace (`call_received` or an inbound `call_started`), ring pushes (`push_attempt` for rings, `gone` left out) against rings shown by platform, ring stages by platform and version |
| [Loonext texting](https://us.posthog.com/project/498129/dashboard/2296140) | outcomes per day, delivery rate by country, registrations waiting over seven days, AUP signals per workspace |
| [Loonext email](https://us.posthog.com/project/498129/dashboard/2296141) | sends per day (`email_sent`), bounces and complaints per day, bounce and complaint rates |
| [Loonext billing and spend](https://us.posthog.com/project/498129/dashboard/2296142) | usage thresholds crossed, cost warnings (dials, inbound volume, storage, projection), checkouts and plan changes |

The older [Loonext funnel and activation](https://us.posthog.com/project/498129/dashboard/2287762)
dashboard (D8) is unchanged; some of its insights are reused above.

#### Operations

What an operator watches, from the events the API Worker and the call Durable
Object send (#675). Pinned in the project. Rows, top to bottom:

| Row | Tiles (insight short id) |
|---|---|
| Now | calls in progress (`JVeKhsOD`): a `call_started` in the last 2 h 15 min with no `call_ended`; stuck calls, 7 days (`BxQ8jziJ`): started longer ago than that with no `call_ended`; active workspaces, 7 days (`NMIAikEO`); open error issues (`CMLHdkYf`, reused) |
| Calls | open calls with minutes running and in progress or stuck (`fgOVUlCb`); started and ended per hour, 48 hours (`SYEyjpJu`); outcome mix by direction, 7 days, each call's latest outcome (`hGWcS6fz`); length distribution, 7 days (`4728e7x5`); inbound and outbound per day, 30 days (`cNkDRTCN`); the 20 longest calls, 7 days (`eyx7AwTB`); ring pushes and rings shown, 14 days (`K45v7Jqq`, reused) |
| Texts | sent, refused and received per hour, 48 hours (`7uwR43uJ`); delivered and failed per day, 30 days (`SPaW2eEW`, reused); failure rate by country with refusals at submit, 7 days (`RjiW2Krr`); refusals at submit by reason and code, 7 days (`yWaayoz6`); segments sent and received per day, 30 days (`DhoWZj9X`) |
| Platform | active workspaces per day, 30 days (`bmeqVfZQ`); exceptions per hour, 7 days (`IF7x6iE1`, reused); ops notices, 30 days (`rmxHT9Ph`, reused); free-tier use this month (`1Qi3m3oS`, reused) |

Every tile ran without error when it was made (2026-11-07). The fourteen new
ones read `call_started`, `call_ended`, `call_outcome_revised`, `message_sent`
or `message_received`, which production does not send until the API release
after 2026-11-07 deploys, so they show zero or nothing until then; the
failure-rate tile's `message_outcome` columns and the reused tiles have data
now. Their logic was proven on events tagged `environment = 'synthetic'` (see
"Threshold tests").

"In progress" here is what the events say. The state of record, from the
database, is the Postgres source's (below); the two disagree only when an
event was lost. Webhook rejections and Telnyx spend have no tile: D147 moved
them to Cloudflare's monitor M3 and to Telnyx's own limit and notices.

### Alerts

Each alert is checked hourly, except the text failure rate, which is checked
daily, and emails the PostHog login of the project owner. The query behind
each is a saved insight named `Alert: ...`, which the alert link opens. Five
alerts, the free plan's limit.

| Alert | Fires when | Insight |
|---|---|---|
| [New or returning error issue](https://us.posthog.com/project/498129/insights/r0XtuRNs?alert_id=01a1a018-ca3b-0000-34f1-ae643b2cabaf) | an active issue's first production event, or its first after 24 quiet hours, was in the last 70 minutes; and for every ops notice (`ops_key`) in the last 70 minutes, since each one is something a person must act on | SQL over `$exception` joined to `system.error_tracking_issues`, one row per issue or notice |
| [Limits and rates](https://us.posthog.com/project/498129/insights/s980Sfcg?alert_id=01a1a016-711c-0000-7002-59894c7a1757) | every hour: a workspace's `aup_signals` crossing the AUP thresholds; a `voice_dials`, `inbound_volume`, `cost_projection` or `storage_abuse` warning; a registration submitted seven days ago and not approved; a workspace that took eight or more inbound calls (`call_received` or an inbound `call_started`) and none for 14 days; a call whose `call_started` is between 2 h 15 min and 3 h 25 min old with no `call_ended`, so each stuck call is reported in the hour it passes the API's two-hour ceiling; a workspace that paid ten days ago and has sent no text. Once a day, in the 07:00 UTC check, for conditions that stay true: a country's delivery rate under 80% (ten or more outcomes in a day); bounces over 2% or complaints over 0.05% of `email_sent` (a week, 100 or more sends); a platform's rings shown 15 points below its own previous seven days, counting `push_attempt` rows for rings that were not `gone` (30 or more in each); the month's events at 700k or exceptions at 70k | SQL, one row per breach |
| [Exception spike](https://us.posthog.com/project/498129/insights/MOIssrNk?alert_id=01a1a016-75c1-0000-e9bd-92c2192a47ae) | PostHog's z-score anomaly detector (threshold 0.95, window 72 hours) flags the last completed hour of production exceptions | trend of `$exception` per hour |
| [Call volume anomaly](https://us.posthog.com/project/498129/insights/PXO7yvDW?alert_id=01a1b5b3-894e-0000-70ae-b598823b4138) | the z-score detector (threshold 0.99, window 168 hours, so a week of the day's own rhythm is the baseline) flags the last completed hour of production `call_started` | trend of `call_started` per hour |
| [Text failure rate anomaly](https://us.posthog.com/project/498129/insights/pHckgm3W?alert_id=01a1b5b3-8aed-0000-c0ee-950399dc2982) | checked daily: the z-score detector (threshold 0.95, window 30 days) flags yesterday's share of production `message_outcome` events that failed | trend of failed over all `message_outcome`, per day |

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
that: the standing rules report once a day, and a one-off event (a notice, a
new issue, a cost warning) is reported once, or twice at most. A new breach
that appears while another is firing is in the next email, not a separate
one. Snoozing the alert in PostHog silences it for a while.

Anomaly detection is available on the free plan: the API accepted the
detector, simulating it over seven days of real data flagged the one burst in
it, and the threshold test below fired it. On a series that is mostly zero a
single exception scores low and a burst of several scores high, which is what
the alert is for; a first-ever error is the job of the "new" alert.

The same holds for the two lifecycle detectors. Call volume is near zero in
production today, so the first busy hours after the release will score as
anomalies until a week of real calls is the baseline. The text failure rate is
a daily series because an hour holds too few texts for a share to mean
anything; a day with no outcomes reads 0. A refusal at submit is not in it,
because a refused text never reaches a final status; the "Texts: refused at
submit" tile shows those.

#### Threshold tests (2026-11-03)

Each real alert was recreated with its threshold lowered so it fired on data
that exists, then the threshold was put back. Each check history keeps one
Firing check that sent its notification. No production events were made up.

| Alert | How it was made to fire | Result |
|---|---|---|
| New or returning error issue | the look-back widened from 70 minutes to 50 hours, which holds nine ops notices that already exist in the project: four test events from the old alert destination, four from the retired `channel:do-sentry` check and one email-authentication notice, none from live code | Firing, notification sent, rows labelled `ops notice: ...` |
| Limits and rates | lower bound 1 (no production breach existed to fire on, so the value was 0) | Firing, notification sent |
| Exception spike | threshold detector with a lower bound of one exception an hour | Firing, notification sent |

The query logic was proven separately on rows labelled `environment =
'synthetic'`, which no alert reads: every rule returned its row and no row for
the matching healthy case. What that proof did not cover:

- The registration rule was run on events named `synthetic_registration_submitted`
  and `synthetic_registration_approved`. The shipped query differs only in the
  event names, and production holds no registration event yet to run it on.
- Rules added after the first round (call silence, no first text, the storage
  warning, rings against their own baseline and the daily gate) were proven the
  same way, with the synthetic tag swapped in for the environment test. For the
  gate, the same query returned the daily rows with the hour set to 7 and not
  with it set to another.

The two rules D147 changed were proven the same way on 2026-11-07, each on its
own `synthetic_run` tag. The bounce rule returned "email bounce rate 3% of 100
sends" for 100 `email_sent` and 3 bounces, and nothing for 100 sends and one
bounce. The rings rule returned "rings shown fell: android 33% of 30 pushes,
was 100%" for a day of 30 ring pushes and 10 rings shown against a baseline of
30 and 30, and nothing for 30 pushes and 27 shown with 30 `gone` and 30
`call_end` attempts beside them; without its `purpose` and `response_class`
filters the same rows read 30% of 90 and breached. Both returned nothing with
the hour gate set to another hour.

The Operations tiles and the stuck-calls rule (#675) were proven the same way
on 2026-11-07, on fourteen events tagged `synthetic_run = 'ops675-a'`: five
calls (one open for 10 minutes, one open for 3 hours, an answered inbound call
of 300 seconds, a voicemail that ended `missed` at 80 seconds and was revised
to `voicemail`, and an answered outbound call of 45 seconds) and five texts.
Every tile gave the expected rows: one call in progress and one stuck, outcome
mix inbound answered 1, inbound voicemail 1, outbound answered 1, lengths
"30 s to 2 min" 2 and "5 to 15 min" 1, the longest calls with the voicemail's
revised outcome, and Canada at 50% failed over two outcomes beside one US text
refused with 40002 as `content_blocked`. The stuck rule returned the 3-hour call
alone, and on a second run (`ops675-b`) returned a call started 170 minutes ago
with no end and nothing for one started at the same time that had ended.
PostHog's alert simulator, run on the same synthetic series, flagged the two
hours of synthetic calls with the call-volume detector and the day of
synthetic failures with the failure-rate detector.

Every error issue that tests or retired checks left in the project is
suppressed, so none counts as open.

Changing an alert's threshold or config does not re-check it at once; the next
check is the hourly one. A newly created alert is checked within a minute.

### Postgres source

What is true right now, rather than what happened, is in the database: which
calls the record still shows open, and how many bytes the buckets hold. PostHog
reads it through its own Postgres source, live, from five views in the
`ops_metrics` schema (migration `20261108100400`), as the login
`posthog_reader`. No job of ours reads or stores anything: a view is computed
when PostHog queries it.

| View | Columns | Rows |
|---|---|---|
| `calls_in_progress` | `call_id`, `call_session_id`, `workspace_id`, `direction`, `state`, `started_at`, `answered_at`, `seconds_running` | calls with no outcome whose engine state is not ended |
| `stuck_calls` | the above plus `reason` | `open_past_ceiling`: still open 15 minutes past the API's two-hour hang-up ceiling; `ended_without_outcome`: the engine ended it and its outcome was never written, shown from 15 minutes after the call started until the hourly stale-call sweep fills it in |
| `storage_in_use` | `bucket_id`, `objects`, `bytes` | every Storage bucket, from `storage.objects` |
| `storage_added_by_day` | `day`, `bucket_id`, `objects`, `bytes` | bytes added per UTC day over 90 days that are still stored (a deleted object leaves its day's total) |
| `message_counts_by_hour` | `hour`, `direction`, `status`, `messages`, `segments` | texts per hour over 35 days, from the record |

The workspace and call ids are the ones PostHog's events already carry; no
view has a number, name, body, object path or payload.
`supabase/tests/posthog_reader.test.sql` holds every view in the schema to
that, and holds `posthog_reader` to `SELECT` on these views and nothing else:
no other table in any schema, no routine, no `CREATE` or `TEMP`, read-only by
default, at most five connections, and 30 s statements in 60 s transactions.
The migration gives it no password; production's was set on 2026-11-07.

**Connected on 2026-11-07.** The source is `loonext_ops` (PostHog id
`01a1b823-6368-0000-6ccf-69c2d7d928bc`), a live query (`access_method:
direct`) on the five views, as `posthog_reader.<project ref>` through the
session pooler (`aws-0-us-east-1.pooler.supabase.com:5432`, database
`postgres`, schema `ops_metrics`). Through PostHog,
`select count(*) from ops_metrics.storage_in_use` answered 3.

The password is 32 random bytes. It was set as a SCRAM-SHA-256 verifier rather
than as text, because production logs every DDL statement
(`log_statement = ddl`) and `alter role ... password '<text>'` would write it
to the log. It lives in PostHog and, as a recovery copy, in the GitHub
`production` environment secret `POSTHOG_READER_DB_PASSWORD`.

To rotate it: set a new verifier with `alter role posthog_reader password
'SCRAM-SHA-256$4096:...'`, then update the source's password in PostHog
(**Data pipelines → Sources → loonext_ops**) and the GitHub secret. Through the
API, the create call takes `payload` with `host`, `port`, `database`,
`user`, `password`, `schema`, `verify_server_certificate: "false"` and a
`schemas` list with `sync_type: "full_refresh"` for each view (the views have
no primary key). An `ssh_tunnel` key, even disabled, makes it report `host`
and `port` missing.

To withdraw it: `alter role posthog_reader nologin;` (or a new password), then
delete the source in PostHog.

**Tiles on Operations from the source.** Each is SQL sent as written to the
connection (PostHog's raw mode, `sendRawQuery`), so it is Postgres, not HogQL.
Through the API an insight is `{"kind": "DataVisualizationNode", "source":
{"kind": "HogQLQuery", "connectionId": "<source id>", "sendRawQuery": true,
"query": "..."}}`.

Storage in use against the 100 GB Supabase Pro includes:

```sql
select round(coalesce(sum(bytes), 0) / 1073741824.0, 2) as gib_in_use,
       round(100 * coalesce(sum(bytes), 0) / (100 * 1073741824.0), 1) as percent_of_included
from ops_metrics.storage_in_use
```

Storage by bucket:

```sql
select bucket_id, objects, round(bytes / 1073741824.0, 3) as gib
from ops_metrics.storage_in_use
order by bytes desc
```

Storage added per day, 90 days:

```sql
select day, round(sum(bytes) / 1073741824.0, 3) as gib_added, sum(objects) as objects_added
from ops_metrics.storage_added_by_day
group by day
order by day
```

Calls in progress now, from the record:

```sql
select call_session_id, direction, state, workspace_id, started_at,
       round(seconds_running / 60.0, 1) as minutes_running
from ops_metrics.calls_in_progress
order by started_at
```

Stuck calls, from the record:

```sql
select reason, call_session_id, direction, state, workspace_id, started_at,
       round(seconds_running / 60.0, 1) as minutes_running
from ops_metrics.stuck_calls
order by started_at
```

Texts per hour from the record, 48 hours:

```sql
select hour, direction, sum(messages) as messages, sum(segments) as segments
from ops_metrics.message_counts_by_hour
where hour > now() - interval '48 hours'
group by hour, direction
order by hour
```

Each ran as `posthog_reader` against the local database with the migration
applied, on 2026-11-07, then in PostHog against production, where all six
answered and became Operations tiles (insights 13815253, 13815255 to 13815259).

### Limits and caveats

- The funnel events sent before `environment` was added to them carry none,
  and the registration rule, the no-first-text rule and the registration tile
  read them as production. The rig sends no funnel events, so none of them is
  the rig's.
- "In progress" and "stuck" from events rest on `call_ended` arriving. A
  capture lost on the way (PostHog unreachable for the Durable Object) shows an
  ended call as stuck; the Postgres source's `stuck_calls` is the record. A
  call the Durable Object adopted from its database row, with no stored state
  of its own, sends `call_ended` and no `call_started`.
- An issue someone resolved and that comes back is active again and counts in
  "Open error issues", but "New or returning" cannot see a resolution, so it
  reports the return only if the issue had been quiet for 24 hours. A burst is
  caught by the spike alert.
- Error tracking drops events past its rate limits (100 an hour per issue,
  2,000 an hour for the project), and an ops notice is an exception like the
  rest, so a flood of ordinary exceptions can drop a notice that arrives in the
  same hour. The limits are there to protect the 100k monthly quota.
- A Telnyx webhook pointed at the wrong URL raises nothing until a customer's
  text or call goes missing: Cloudflare sees only the requests that arrive,
  and Telnyx sends no notice for undelivered webhooks.
- The email authentication check is gone with no replacement; Resend's
  dashboard shows domain authentication.
- A path that answers 200 and does nothing is caught only by the outcome
  events or a customer.
- CSP violation reporting is off. No CSP header is sent until the founder sets
  `CSP_STAGING=report-only`, so a policy break produces no event today. Once on,
  PostHog's endpoint samples it at 10%.
- Cron triggers are not watched until the Cloudflare monitors below are created
  (see "In Cloudflare").

Muting a problem is suppressing its issue in PostHog error tracking. Resolving
it there makes the next occurrence reopen it, which PostHog shows on the issue
(see the caveat above about the alert). An ops notice is reported even when its
issue is suppressed.

## In Cloudflare

Both Workers pin Workers Logs in their `wrangler.jsonc` (`observability`: logs
on and persisted, invocation logs, head sampling 1, traces off), so every
request, cron run and Durable Object call is in **Workers & Pages → Workers
Logs** and in the SQL API's `events.workersInvocations` and `logs.workersLogs`.

The Cloudflare monitors below are the planned watch and are **not live**.
A monitor (Notifications, alert type `custom_analytics`, source
`sql_api`, threshold detection) runs a SQL API query on a schedule and email
when the value crosses the threshold. With no timestamp in the query, Cloudflare
supplies a window that ends at the check and spans its interval. `<account>` is
the account tag. Each query below was run through the SQL API on 2026-11-07:
M1 counted 19 cron invocations in the last 15 minutes, and M2 and M3 counted 0
over the last seven days (in which the API's webhooks answered 200 ten times).

| Monitor | Query | Interval | Fires when |
|---|---|---|---|
| M1 loonext-api cron triggers stopped | `SELECT COUNT(*) AS value FROM events.workersInvocations WHERE accountTag = '<account>' AND scriptName = 'loonext-api' AND invocationType = 'cron'` | 15 minutes | `value < 1` |
| M2 Workers invocations the platform failed | `SELECT COUNT(*) AS value FROM events.workersInvocations WHERE accountTag = '<account>' AND scriptName IN ('loonext-api', 'loonext-web') AND status NOT IN ('success', 'clientDisconnected', 'responseStreamDisconnected') AND NOT (invocationType = 'cron' AND status = 'scriptThrewException')` | 1 hour | `value > 0` |
| M3 Webhook signature refusals | `SELECT COUNT(*) AS value FROM logs.workersLogs WHERE accountTag = '<account>' AND scriptName = 'loonext-api' AND logType = 'cf-worker-event' AND invocationType = 'fetch' AND url LIKE '%/webhooks/%' AND httpStatus IN (400, 503)` | 1 hour | `value >= 3` |

M1 replaces the cron heartbeats: the every-minute trigger alone runs 15 times
in its window. M2 leaves out a cron run whose script threw, because PostHog
already reports that exception; what it catches is the platform's own
refusals (exceeded CPU or memory, a script that would not load). M3 reads the
status the webhook routes answer a bad signature with (400) or an unset Resend
secret with (503). It is not a PostHog capture because the webhook URLs are
public (D147).

The fourth notification is a **Cloudflare Status incident alert**
(`incident_alert`), for minor, major and critical incidents on the Workers,
Durable Objects, Workers KV and Workers AI components (status page component
ids `57srcl8zcn7c`, `bty1yz6dhh0v`, `tmh50tx2nprs` and `zvm7mqn92xzc`). The
status page has no Cron Triggers component; it is part of Workers.

All four email the address the account's billing budget alerts use. Those
three `billing_budget_alert` policies ($1 and two at $10) are the warning
before the Workers AI bill grows.

**Not live.** Nothing described in this section exists on the account yet.
`CLOUDFLARE_API_TOKEN` can read notification policies but
not write them: the create call answered 403 on 2026-11-07. Until the founder
creates the four in the dashboard (**Notifications → Monitors → Create a
Monitor**, custom SQL, Threshold, with the queries above; **Notifications →
Add → Incident Alert** with the four components), nothing watches the cron
triggers: if they stop, or a job stops running without throwing, no one is told.

## Vendor notices

Each vendor below notifies the account owner by its own email, configured in
its own dashboard.

- **Telnyx.** A messaging profile's daily spend limit refuses further sends
  (429, error 40333). The API raises one ops notice, `telnyx-messaging-spend-limit`,
  on the first refused text, which the "New or returning error issue" alert
  reports; Telnyx has no notification for its spend limit. Enabled
  on the account on 2026-11-07: Low Available Credit, Account Disabled Due to
  Insufficient Balance, Suspicious Outbound Voice Traffic and the two call
  surcharge notices. Available but not enabled: Messaging Profile Activity (a
  profile changed or deleted), API Key Creation, API Keys Expiration, Port Out
  Notifications and Auto-Recharge Failure. Turning those on is a portal step
  (**Account → Notifications**).
- **Stripe.** Emails the account when a webhook endpoint keeps failing, and
  shows disputes in the Dashboard.
- **Supabase.** Emails the billing address when the organisation goes over a
  quota; the organisation's **Usage** page shows storage, egress and database
  size against the plan, and **Advisors** report security and performance
  findings. **Database → Backups** shows the backups.
- **Resend.** The Metrics page and API show bounce and complaint rates; Resend
  sends no alert for them, so the PostHog rule above does.
- **GitHub.** Actions emails the user who last changed a scheduled workflow
  when its run fails, and the person who triggered any other run (**Settings →
  Notifications → Actions**, "only notify for failed workflows"). Dependabot
  alerts and security updates are on, and dependency review fails a pull
  request that adds a high-severity advisory.
- **Crashes.** PostHog error tracking on every client, plus Google Play
  Console's Android vitals (crashes and ANRs) and App Store Connect and Xcode
  Organizer (crashes and hangs) for the apps.

## Where to look

- **Something broke**: PostHog, Error tracking. Filter by `source` or
  `ops_key`; the issue's history is the incident record.
- **Is everything running**: the Loonext health dashboard. Cloudflare's monitors
  would add the cron triggers once created.
- **What is happening now** (calls open and stuck, texts, workspaces): the
  Operations dashboard.
- **Raw logs for one request or cron run**: Cloudflare Workers Logs for the
  `loonext-api` and `loonext-web` Workers.
- **Vendor-side state**: the Telnyx, Resend, Stripe and Supabase dashboards
  and their notices above.
- **CI**: GitHub's own notifications for failed workflow runs.
- **A device**: logcat for the Android call trace (`adb logcat -s
  LoonextCallFlow`), and the apps' recent-error lines in a support email.

## What we deliberately do not have

No synthetic probes or canaries, no paging service, no alert email from our
own code, no status automation. The `/status` page is a line a person writes.
What that leaves uncovered, plainly:

- **Uptime.** Nothing polls `/health` or the site from outside. Cloudflare
  Health Checks would, with email, but need a Pro zone (about $20 a month
  billed yearly, $25 monthly; loonext.com is on Free). Any other uptime service
  is a new vendor account.
- **Status email.** No subscribe-by-email (D147 supersedes D105); customers
  get the `/status` line and direct email to owners.
- **Early spend warnings.** A messaging profile's daily limit raises an ops
  notice when it is reached, not before. Supabase emails once a quota is exceeded, not
  before. The AI, high-priority push and ring-beacon caps report only when
  reached; Cloudflare's billing budget alerts cover the Workers AI bill.
- **Call capacity.** Telnyx offers no API or alert for concurrent call legs;
  a refused leg shows as an exception from the call path. The Operations
  dashboard counts our own open calls, not the legs Telnyx allows.
- **Backups and the Postgres image.** No alert when Supabase backups stop and
  no notice when it changes its Postgres image: the Backups page is read by
  hand, and `scripts/pin-postgres-image.mjs` re-pins when Supabase
  announces an upgrade.
- **Deployments.** Cloudflare has no notification for a Worker deployed
  outside `ship.yml`, so the rig's guard is attested only when the rig runs.
- **Devices.** No crash history on a phone for a person to share, and no
  "call interrupted by a crash" line on Android 9 and 10, which keep no exit
  record.
- **A path that answers 200 and does nothing useful** is caught by the
  outcome events above or by a customer, not by a probe.
