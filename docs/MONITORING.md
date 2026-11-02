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
| `ops_heartbeat` | API Worker and Durable Object | `key`, `grace_minutes` | a cron trigger fired; a channel carried something; the Durable Object answered its six-hourly ping |
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

Created through PostHog's API and kept there, not in this repository. The
free plan allows five alerts in total; four are used.

Error tracking has exception autocapture on, a per-issue rate limit and a
project-wide one.

### Dashboard: Loonext health

Exceptions by source, open error issues, overdue heartbeats, gauges against
their limits, webhook rejections by provider, message delivery by country,
email bounce and complaint rates, rings delivered by platform, calls per
workspace, the activation and registration funnels, and usage and overage
warnings.

### Alerts

Each alert emails the project owner and shows in PostHog's in-app
notifications.

| Alert | Insight | Fires when | Checked |
|---|---|---|---|
| New or returning error issue | SQL over `$exception` and `system.error_tracking_issues`, one row per issue or notice | an active issue's first production event, or its first after a quiet day, in the last hour; and every ops notice in the last hour, since each one is something a person must act on | hourly |
| Heartbeat overdue | SQL over `ops_heartbeat` in the last 35 days | any key's last event is older than its `grace_minutes` | hourly |
| Limits and rates | SQL, one row per breach | a gauge at 70% of its limit, a Telnyx limit missing or lowered, three signature rejections from one provider in an hour, a country's delivery rate under 80%, bounce rate over 2% or complaints over 0.05% of sends, rings shown under 80% of pushes per platform, a registration submitted seven days ago and not approved, a workspace whose `aup_signals` cross the AUP thresholds, the month's events or exceptions at 70% of the free tier | hourly |
| Exception spike | trend of `$exception` | volume far above its baseline | hourly |

Muting a problem is suppressing its issue in PostHog error tracking. Resolving
it there means the next occurrence reopens it.

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
