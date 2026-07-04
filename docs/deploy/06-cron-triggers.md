# 06 — Cron Triggers

The API Worker's Cron Triggers are declared in `apps/api/wrangler.jsonc:11-21`
(9 expressions) and mapped to jobs in `apps/api/src/index.ts:157-198`. Deploying
the api Worker (`wrangler deploy`) registers them — **no separate operator
action, no dashboard schedule entry.** They run only after the Worker's env
validates; a misconfigured Worker fails loudly on its first trigger
(`apps/api/src/index.ts:210-211`).

The two lists must stay in lockstep — an unmapped cron throws
(`apps/api/src/index.ts:213-217`), and `src/mount.test.ts` asserts the map matches
`wrangler.jsonc`.

| Cron (UTC) | Frequency | Job(s) | Source |
|---|---|---|---|
| `*/5 * * * *` | every 5 min | webhook sweeper — replay unprocessed `webhook_events` (both providers) | `index.ts:159` |
| `*/15 * * * *` | every 15 min | `reconcileNumbers` (resume provisioning, adopt crash-after-buy orphans) + `retryCampaignAssignments` (re-run failed §4.4 R3) + `sweepDeletedAttachments` (reclaim soft-deleted attachment objects) + `reconcileTextEnablement` (poll in-flight keep-your-number hosted-SMS orders) + `reconcileVoiceEnablement` (bind voice on numbers whose company has missed-call text-back on) | `index.ts:165-176` |
| `0 * * * *` | hourly | `reportUnreportedUsage` then `runUsageAlertsJob` (usage re-report + 80%/100% alerts) | `index.ts:179` |
| `30 * * * *` | hourly | `nudgeSoleProprietorOtp` (one nudge at +12h per brand submission) | `index.ts:181` |
| `20 * * * *` | hourly | `geocodeContactsJob` (D25 contact-geocoding backfill via Nominatim, rate-limited 1 req/s) | `index.ts:185` |
| `0 13 * * *` | daily 13:00 | `pollRegistrations` (10DLC brand/campaign poll — D2 fallback to webhooks; also migrates already-approved campaigns' declared content, once per campaign) | `index.ts:187`, `telnyx/registration.ts:790-823` |
| `10 13 * * *` | daily 13:10 | `pollPortRequests` (port reconcile & resume — PORTING.md §5.2 fallback to webhooks) | `index.ts:191` |
| `0 14 * * *` | daily 14:00 | `runGraceJob` (day 1/15/27 warnings; day-30 release + campaign deactivation) | `index.ts:194` |
| `0 15 * * *` | daily 15:00 | `runSubscriptionReconcileJob` (re-mirror non-active companies from Stripe; stale-invite report) | `index.ts:197` |

Jobs sharing a trigger run sequentially but fail independently; the run still
rejects on any failure so Sentry records it (`apps/api/src/index.ts:219-233`).
Times are UTC (Cloudflare cron is UTC). These schedules are the exact SPEC §11
set (`apps/api/wrangler.jsonc:8-10`, `SPEC.md:1081`).
