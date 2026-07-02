# 06 — Cron Triggers

The API Worker's Cron Triggers are declared in `apps/api/wrangler.jsonc:7-20` and
mapped to jobs in `apps/api/src/index.ts:142-162`. Deploying the api Worker
(`wrangler deploy`) registers them — **no separate operator action, no dashboard
schedule entry.** They run only after the Worker's env validates; a misconfigured
Worker fails loudly on its first trigger (`apps/api/src/index.ts:174-175`).

The two lists must stay in lockstep — an unmapped cron throws
(`apps/api/src/index.ts:176-181`), and `src/mount.test.ts` asserts the map matches
`wrangler.jsonc`.

| Cron (UTC) | Frequency | Job(s) | Source |
|---|---|---|---|
| `*/5 * * * *` | every 5 min | webhook sweeper — replay unprocessed `webhook_events` (both providers) | `index.ts:144` |
| `*/15 * * * *` | every 15 min | `reconcileNumbers` (resume provisioning, adopt crash-after-buy orphans, flag unknown Telnyx numbers) + `retryCampaignAssignments` (re-run failed §4.4 R3) | `index.ts:148` |
| `0 * * * *` | hourly | `reportUnreportedUsage` then `runUsageAlertsJob` (usage re-report + 80%/100% alerts) | `index.ts:151` |
| `30 * * * *` | hourly | `nudgeSoleProprietorOtp` (one nudge at +12h per brand submission) | `index.ts:153` |
| `0 13 * * *` | daily 13:00 | `pollRegistrations` (10DLC brand/campaign poll — D2 fallback to webhooks) | `index.ts:155` |
| `0 14 * * *` | daily 14:00 | `runGraceJob` (day 1/15/27 warnings; day-30 release + campaign deactivation) | `index.ts:158` |
| `0 15 * * *` | daily 15:00 | `runSubscriptionReconcileJob` (re-mirror non-active companies from Stripe; stale-invite report) | `index.ts:161` |

Jobs sharing a trigger run sequentially but fail independently; the run still
rejects on any failure so Sentry records it (`apps/api/src/index.ts:184-197`).
Times are UTC (Cloudflare cron is UTC). These schedules are the exact SPEC §11
set (`apps/api/wrangler.jsonc:8-9`, `SPEC.md:1081`).
