# Loonext — State Machines

**Status: CURRENT DIRECTION for #722, phase 1 (inventory, definitions, proof).** Phase 1 changes no runtime behaviour. The definitions live in `packages/shared/src/state-machines/` and are exported as `stateMachines` from `packages/shared/src/index.ts`. Facts here were read on 2026-11-10 from the migrations, `apps/api/src`, the three clients and a read-only look at production.

## How to use this

- To learn what a lifecycle allows, read its entry below, then its definition file. Do not infer it from a `.update({ status })` call.
- **Never write a status column directly.** Until phase 2 lands there is no transition function to call, so match the "Writers today" lines and keep to the edges listed. Phase 2 replaces each writer with one RPC per machine that refuses an illegal edge.
- **Effects belong to entering a state, never to a pass over it.** `entryEffectsFor(machine, from, to)` returns an empty list for `from === to`, and a test proves it for every machine. The 2026-11-10 push flood broke this rule: a held scheduled text was claimed every minute and its notice ran on every claim.
- `allowedActions(machine, state, role)` is the one reader for "what can this person do now". Phase 3 makes the UI and API read it. The action names and capabilities in the definitions are taken from the routes that perform them today; phase 3 re-verifies each against its route gate before wiring.

### Authority

| Value | Meaning | Illegal edge should be |
| --- | --- | --- |
| `internal` | our code decides | refused with a named error |
| `provider` | Stripe or a carrier already decided | recorded, effects skipped, never refused (refusing makes the provider retry for hours) |
| `derived` | no column; computed from timestamps | not writable; derive it in one SQL function |

## The machines (28)

"Pinned by" is what the database enforces today. `none` means the column is free text or there is no column; the test fails if a constraint ever appears without the definition changing.

| Id | Column(s) | States | Authority | Pinned by | Clients that render it |
| --- | --- | --- | --- | --- | --- |
| `call` | `calls.state` | 9 | internal | check (nullable) | web, Android, iOS |
| `call_leg` | `call_member_legs.state` | 3 | internal | check | server only (audit) |
| `scheduled_message` | `scheduled_messages.status` | 6 | internal | check | web, Android, iOS |
| `calendar_connection` | `calendar_connections.status` | 4 | internal | check | web only |
| `calendar_outbox` | `calendar_outbox.state` | 4 | internal | check | server only |
| `calendar_reminder_replan` | `calendar_reminder_replans.state` | 4 | internal | check | server only |
| `calendar_link` | `task_calendar_links.link_state` | 5 | internal | check | web only |
| `calendar_push_subscription` | `webhook_subscriptions.status` | 6 | internal | check | server only |
| `webhook_delivery` | `webhook_deliveries.status` | 4 | internal | check | web, Android, iOS (Webhooks settings) |
| `subscription` | `companies.subscription_status` | 6 | provider | enum | web, Android, iOS |
| `conversation` | `conversations.status` | 4 | internal | enum | web, Android, iOS |
| `conversation_visibility` | `conversations.is_spam`, `deleted_at` | 3 | derived | none | web, Android, iOS |
| `message` | `messages.status` | 5 | provider | enum | web, Android, iOS |
| `registration` | `messaging_registrations.status` | 6 | provider | enum | web, Android, iOS |
| `number_health` | `number_health.state` | 2 | internal | check | web, Android, iOS |
| `payment_request` | `payment_requests.status` | 4 | internal | check | web, Android, iOS |
| `phone_number` | `phone_numbers.status` | 6 | internal | enum | web, Android, iOS |
| `port` | `port_requests.status`, `phone_numbers.porting_status` | 9 | provider | enum | web, Android, iOS |
| `port_messaging` | `port_requests.messaging_port_status` | 5 | provider | enum | server (surfaced through `port`) |
| `quote` | `quotes.status` | 6 | internal | none (length check only) | web, Android, iOS |
| `text_enablement` | `text_enablement_orders.status` | 6 | provider | enum | web, Android, iOS |
| `data_export` | `data_exports.status` | 4 | internal | check | web, Android, iOS |
| `consent` | `contact_consent_events.state` | 3 | internal | check | server only |
| `geocode` | `contacts.geocode_status`, `tasks.geocode_status` | 4 | internal | check | server only |
| `billing_dispute` | `billing_disputes.status` | 7 | provider | none | server and ops only |
| `task` | `tasks.done_at`, `deleted_at` | 3 | derived | none | web, Android, iOS |
| `invite` | `invites.accepted_at`, `revoked_at`, `expires_at` | 4 | derived | none | web, Android, iOS (team) |
| `workspace` | `companies.paused_at`, `deleted_at`, `purged_at` | 4 | derived | none | pause on all three; closure and trash on web only |

Client columns are by search for the state's literal values in `apps/web/src`, `apps/android/app/src/main` and `apps/ios`; they say a client reads the value, not that it renders every state correctly. Phase 3 enumerates each client's switch.

---

## Entries

Each entry lists the transitions the definition allows, the guards that exist today, effects (**E** = must fire on entry only), the writers today and anything that bypasses the owner. Paths cite the file; migration function names are exact.

### call

- **States:** `dialing` (outbound only), `ringing`, `answered`, `voicemail_greeting`, `voicemail_recording`, and four terminals `ended_answered`, `ended_voicemail`, `ended_missed`, `ended_rejected`. NULL is a pre-v3 row.
- **Events and edges:** the full diagram is section 3.1 of `docs/CALLS-V3.md`. Two upgrade edges leave a terminal: `ended_missed -> ended_voicemail` (late recording saved) and `ended_missed -> ended_answered` (late bri-tagged hangup). Every inbound-leg hangup is terminal from every non-terminal state (T17).
- **Guards:** replay guard at T1, leg-status guards at T2/T3, ring-me never cancels a live leg, VM-entry only on the listed conditions.
- **Effects (E):** ringing: push, ring alarm, dials; answered: bridge, cancel siblings, thread; voicemail_greeting: vmi answer, speak, cancel legs; terminal merge (text-back, crew alert, billing anchor) once per terminal.
- **Owner:** `reduce()` in `apps/api/src/calls/transitions.ts`, executed by the Durable Object in `apps/api/src/calls/session-do.ts`; the mirror write to `calls` is `apps/api/src/calls/runtime.ts:524,534,692,1040`.
- **Other writers of `calls`:** `apps/api/src/messaging/inbound-ring.ts:385`, `apps/api/src/messaging/voice-webhook.ts:1141`, `apps/api/src/routes/live-calls.ts:820,847`, `apps/api/src/routes/calls.ts:523,570`, `apps/api/src/workspace/retention-enforce.ts:290`, the backfill in `supabase/migrations/20260717000000_calls_v3_state.sql`.
- **Clients:** `apps/web/src/components/calls/ongoing-call-card.tsx`, `apps/android/app/src/main/kotlin/com/loonext/android/core/model/Calls.kt`, `apps/ios/Loonext/Core/Model/Calls.swift`. The web softphone has its own reducer, `apps/web/src/lib/softphone/state.ts` (not inventoried here).
- **Production:** see "Production check". Eight terminal rows have no `ended_at`, one `ended_voicemail` row has outcome `missed`.

### call_leg

- **States:** `ringing`, `answered`, `failed`. Edges `ringing -> answered`, `ringing -> failed`.
- **Guards:** `api_claim_ring_answer` answers only a ringing ring leg when no other ring leg is answered; `api_ring_leg_failed` locks the session's ring legs and reports whether any is still live.
- **Writers today:** `apps/api/src/messaging/live-call.ts:213,310,403,504,533` (direct updates for transfer and consult legs), `apps/api/src/calls/runtime.ts:541` (insert only), SQL `api_claim_ring_answer` in `supabase/migrations/20260712000500_calls_v2_hardening2.sql` and `api_ring_leg_failed` in `supabase/migrations/20260712000400_calls_v2_hardening.sql`.
- **Flag:** in v3 the ledger is audit-only, so ring legs stay `ringing` forever: 125 rows on production are `ringing` on a call that has ended. Phase 2 either closes them when the call ends or retires the state column for ring legs.

### scheduled_message

- **States:** `pending`, `held`, `sent`, `canceled`, `expired`, `failed`. `pending` and `held` are live.
- **Edges:** `pending -> held | sent | canceled | expired | failed | pending (edit)`; `held -> held (re-claimed) | pending (rescheduled) | sent | canceled | expired | failed`.
- **Guards:** every RPC is guarded by `status in ('pending','held')`, so a concurrent cancel wins. A claim is a lease (`claimed_at`), not a state change.
- **Effects (E):** held: owner notice; failed and expired: owner notice; sent: the outbound message row is created in the same statement as the state change.
- **Writers today (SQL):** `api_fire_scheduled_message` (latest `supabase/migrations/20261111170000_automatic_text_settings.sql:226,291,316`), `api_hold_scheduled_message` and `api_fail_scheduled_message` (latest `supabase/migrations/20260817000000_a_held_message_says_why_in_the_readers_language.sql:47,79`), `api_cancel_scheduled_message`, `api_expire_scheduled_messages`, `api_cancel_scheduled_for_company` (`supabase/migrations/20260803090000_scheduled_messages.sql:506,558,601`), and cancelling from `api_sync_task_reminders` (`supabase/migrations/20261110150000_standalone_tasks.sql:507`), `calendar_task_before_schedule_change` (`supabase/migrations/20260825020000_two_way_calendar_sync_outbox.sql:799`) and `api_trash_conversations` (`supabase/migrations/20261110180000_trash_hides_tasks.sql:80`).
- **Owner module:** `apps/api/src/messaging/scheduled-send.ts` (claim at line 615, hold 507, fail 546, expire 576, fire 695).
- **Entry-only status (phase 2 done):** `api_hold_scheduled_message` and the held branch of `api_fire_scheduled_message` return `entered`, true only when the row was not already held for that reason, and `apps/api/src/messaging/scheduled-send.ts` tells the owner only then. The caller-side comparison is gone.
- **Enforced (phase 2 done):** the trigger `scheduled_messages_transition_guard` (`supabase/migrations/20261111240000_scheduled_messages_enforce_their_lifecycle.sql`) refuses any status change outside the edges above, whoever writes it; `packages/shared/src/state-machines/enforced.test.ts` fails if the trigger and the shared definition differ. The reschedule in `apps/api/src/routes/scheduled-messages.ts` now also clears `held_reason_key`.
- **Clients:** `apps/web/src/components/scheduled/scheduled-view.tsx`, `apps/android/app/src/main/kotlin/com/loonext/android/features/inbox/ScheduledSheet.kt`, `apps/ios/Loonext/Core/Model/Messaging.swift`. Reason texts are rostered by `packages/shared/src/scheduled-send.ts`.

### calendar_connection

- **States:** `active`, `reauth_required`, `disconnected`, `revoked`. **`disconnected` means "cleaning up", not disconnected.**
- **Edges:** `active -> reauth_required | disconnected | revoked`; `reauth_required -> active | disconnected | revoked`; `disconnected -> revoked`. `revoked` is terminal; a new Connect creates a new row after it.
- **Guards:** `calendar_connections_live_shape_ck` ties `revoked` to `revoked_at` and to null credentials. `calendar_finalize_disconnected_connection` refuses until no live subscription and no queued or leased outbox row remains.
- **Effects (E):** disconnected: cancel queued outbox rows, mark push subscriptions `revoking`, record the cleanup action; revoked: null credentials, stamp `revoked_at`, unlink task links.
- **Writers (all SQL, one file):** `calendar_begin_connection_disconnect` (`supabase/migrations/20260825020000_two_way_calendar_sync_outbox.sql:2170`), `calendar_finalize_disconnected_connection` (2133), `api_retry_calendar_credential_refresh` (2558), `api_abandon_calendar_cleanup` (4594), `api_retry_calendar_webhook_renewal` (3300), `api_retry_calendar_outbox` (4807), `purge_workspace_step` (latest `supabase/migrations/20261102200000_monitoring_tables_go_to_posthog.sql:167`), and `active` again from `api_complete_calendar_connection` (`supabase/migrations/20261111140000_task_assignees_readers.sql:1157`, reconnect).
- **Route and worker:** disconnect is `api_revoke_calendar_connection` called at `apps/api/src/routes/calendar-connections.ts:885`; connect completes at `apps/api/src/routes/calendar-oauth.ts:328`; the retry and cleanup RPCs are called from `apps/api/src/calendar/worker.ts:2077,2132,2210,2255`.
- **Clients:** web only, `apps/web/src/components/settings/calendar-connections-card.tsx` (lines 180, 189, 198: `cleaningUp = status === "disconnected"`). Android and iOS do not render it.
- **Flag:** four files to learn when Connect returns. `allowedActions(calendarConnectionMachine, state, role)` answers it: `connect` only at `revoked`.

### calendar_outbox and calendar_reminder_replan

- **States:** `queued`, `leased`, `completed`, `cancelled`. **Edges:** `queued -> leased | completed | cancelled`; `leased -> leased (lease expired, re-claimed) | queued (retry) | completed | cancelled`.
- **Guards:** `calendar_outbox_lease_shape_ck` and `..._terminal_shape_ck` tie state to lease fields and to `completed_at` / `cancelled_at`; every commit checks `lease_owner` and `lease_expires_at`.
- **Effects (E):** completed advances the task link; no notice fires from these tables.
- **Writers (SQL only):** claim `api_claim_calendar_outbox` (`supabase/migrations/20260825020000_two_way_calendar_sync_outbox.sql:4029`), `api_commit_calendar_outbox_created/sent/scrubbed`, `api_retry_calendar_outbox`, `api_cancel_calendar_outbox`, `api_apply_calendar_provider_snapshot`, `calendar_reconcile_number_access`, and for replans `api_claim_calendar_reminder_replans` (4918), `api_complete_calendar_reminder_replan`, `api_retry_calendar_reminder_replan`. Later versions are in `supabase/migrations/20261111140000_task_assignees_readers.sql`.
- **Implicit machines on the same rows:** `lease_owner` + `lease_expires_at` + `lease_generation` (lease), `attempts` (retry counter, no cap in the table), `provider_effect_ambiguous` (an uncertain provider write that gates re-send).

### calendar_link

- **States:** `active`, `conflict`, `event_removed`, `refused`, `unlinked`; new links start `active` or `conflict`.
- **Edges:** `active -> conflict | event_removed | refused | unlinked`; `conflict -> active | unlinked`; `event_removed -> active | unlinked`; `refused -> active | event_removed | unlinked`; `unlinked -> active` (relinked).
- **Writers (SQL only):** `api_apply_calendar_provider_snapshot`, `api_mark_calendar_conflict` (`supabase/migrations/20260825020000_two_way_calendar_sync_outbox.sql:5547`), `api_mark_calendar_event_removed`, `api_mark_calendar_refusal` (5970), `api_resolve_calendar_conflict`, `api_resolve_calendar_event_removed`, `api_commit_calendar_outbox_*`.
- **Routes:** `apps/api/src/routes/calendar-connections.ts:632,729,771` (resolve). **Client:** web card only.
- **Derived from the edge table, not from a single guard:** the edges above are what the SQL writes; no function checks the from-state against a table. Phase 2 adds that check.

### calendar_push_subscription

- **States:** `active`, `renewing`, `error`, `expired`, `revoking`, `revoked`. **`renewing` and `expired` are in the constraint and written by nothing**; the definition marks them `unwritten`. Renewal is tracked with `renewal_lease_owner` and `renewal_attempts`.
- **Edges:** `active -> error | revoking | revoked`; `error -> active | revoking | revoked`; `revoking -> revoked`.
- **Writers (SQL only):** `api_retry_calendar_webhook_renewal` (`supabase/migrations/20260825020000_two_way_calendar_sync_outbox.sql:3322,3332`), `api_commit_calendar_webhook_revocation` (3425), `calendar_begin_connection_disconnect` (2191), `api_complete_calendar_connection` (`supabase/migrations/20261111140000_task_assignees_readers.sql:1138`).
- **Name trap:** the table `webhook_subscriptions` is the calendar push channel. Our outbound webhooks are `webhook_deliveries`.

### webhook_delivery

- **States:** `pending`, `delivering`, `succeeded`, `failed`. **Edges:** `pending -> delivering`; `delivering -> delivering (re-claimed after a dead worker) | pending (backoff) | succeeded | failed`.
- **Guard:** `api_claim_webhook_deliveries` claims `pending` and `delivering` rows whose `next_attempt_at` has passed, with `for update skip locked` (`supabase/migrations/20260814060000_a_workspace_can_be_told_when_something_happens.sql:186`).
- **Writers:** `apps/api/src/webhooks/outbound-deliver.ts:175,207,220,232,248` (direct updates; one owner file, not an RPC). Retry spacing is `webhookRetryDelaySeconds`; `attempts` is the counter.
- **Delivery is at-least-once by design.** A re-claimed `delivering` row re-sends the POST.

### subscription

- **States:** `incomplete`, `incomplete_expired`, `active`, `past_due`, `unpaid`, `canceled` (the Postgres enum; Stripe `trialing` and `paused` are not mapped).
- **Authority:** Stripe. `syncSubscription` (`apps/api/src/webhooks/stripe.ts:1109`) overwrites the column on every Stripe event, so every edge is accepted today; the definition is Stripe's lifecycle. `canceled` is written at `apps/api/src/webhooks/stripe.ts:1340`.
- **Entry-only done right:** a portal cancellation notice fires once because the code compares against the status already held before the mirror overwrites it (`isNewCancellation`, called near `apps/api/src/webhooks/stripe.ts:1100`).
- **Other writers of the company row's billing state:** `apps/api/src/routes/billing.ts:466,740,1032,1635,1754`, `apps/api/src/billing/prepay.ts:659`. Pause is the separate `paused_at` column (`workspace`).

### conversation

- **States:** `new`, `open`, `waiting`, `closed`. **No transition rule exists.** `PATCH` validates the enum only (`apps/api/src/routes/conversations.ts:186,231,975,1210`), `api_bulk_conversations` accepts any target (`supabase/migrations/20261110170000_deletion_and_trash.sql:2124`), and an inbound text or missed call reopens a thread with `new` or `open` (`thread_inbound_message`, `claim_missed_call_text`, same file lines 2367, 2394, 2714, 2734).
- The definition is therefore the full mesh. Phase 2 starts with a product decision on which edges are real (is `closed -> waiting` valid?).
- `closed_at` is set for every closed row on production (3 of 3).
- **Other writers:** `apps/api/src/messaging/spam-flag.ts:63` (closes on spam), `apps/api/src/messaging/inbound.ts:455`, `apps/api/src/messaging/off-ramp.ts:128`, `apps/api/src/messaging/auto-send.ts:171`, `apps/api/src/routes/compose.ts:330` (insert `open`).
- **Clients:** `apps/web/src/components/inbox/filter-bar.tsx`, `apps/android/app/src/main/kotlin/com/loonext/android/core/model/Messaging.kt`, `apps/ios/Loonext/Core/Model/Messaging.swift`.

### conversation_visibility (derived)

- `live`, `spam` (`is_spam`), `trashed` (`deleted_at`). Trash remembers the status in `deleted_prior_status` so restore puts it back; trashing cancels the thread's scheduled texts and hides its tasks (`api_trash_conversations`, `supabase/migrations/20261110180000_trash_hides_tasks.sql:80`). Marking spam closes the thread.
- Snooze and mute: there is no snooze column anywhere; mute is per member in `conversation_member_prefs.muted` and `muted_until`, a preference, not a lifecycle. Not modelled.

### message

- **States:** `received` (inbound), `queued`, `sent`, `delivered`, `failed`. NULL on internal notes (17 rows on production).
- **Edges:** `queued -> sent | delivered | failed`; `sent -> delivered | failed`; `failed -> queued` (retry claim, `claim_message_retry` in `supabase/migrations/20260805060000_paid_pause.sql:369,387`). `fail_stuck_outbound_sends` flips a queued row with no carrier id to `failed` (`supabase/migrations/20260707130000_send_retry_hardening.sql:213`).
- **Writers:** `apps/api/src/messaging/status.ts:54` (`message.sent`, guarded by `.eq("status","queued")`), `apps/api/src/messaging/status.ts:128` (`message.finalized`, **keyed on `telnyx_message_id` with no from-state guard**: a late replay can regress `delivered` to `sent`), `apps/api/src/messaging/send.ts:604,854,875` (persist patch, interrupted sends), `apps/api/src/messaging/media.ts:319`.
- **Effects (E):** PostHog outcome and the `message.failed` webhook fire only when the row read earlier differs from the final status (`apps/api/src/messaging/status.ts:150,163`). That is read-then-act, not a claim: two concurrent finalized deliveries can both read `queued`. Usage metering is idempotent through a unique key (`usage_events_message_uq`).

### registration

- **States:** `draft`, `submitted`, `pending`, `approved`, `rejected`, `suspended`. The table is `ALLOWED_TRANSITIONS` in `apps/api/src/telnyx/registration.ts:442`; the submit route moves `draft -> submitted` (line 1024). A test asserts the definition equals the table.
- **The model to copy:** the write is conditional on the status just judged (`applyTransitionPatch`, line 540) and effects run only for the delivery that won (#581), so an overlapping webhook and poller send one email.
- **Effects (E):** suspension notice to owner and ops (#423), rejection notice, approval push and the one-per-workspace PostHog capture, campaign submission after brand approval.
- **Open question (see Unclassified):** `rejected` is terminal in the table, yet clients have a fix form (`apps/android/app/src/main/kotlin/com/loonext/android/features/settings/RegistrationFixForm.kt`).
- **Writers:** `apps/api/src/telnyx/registration.ts:177,211,514,1832`, `apps/api/src/routes/registration.ts:155,161`.

### number_health

- **States:** `healthy`, `degraded`. `api_assess_number_health` returns only numbers whose state changed and the caller announces only those (`apps/api/src/messaging/number-health.ts`): the entry-only pattern already in place.

### payment_request

- **States:** `requested`, `paid`, `cancelled`, `expired`. `paid` by `api_mark_payment_request_paid` (`supabase/migrations/20260813060000_a_business_can_be_paid_over_the_thread.sql:248`), `expired` by `expire_payment_requests` (386), `cancelled` by two direct updates (`apps/api/src/routes/payments.ts:654,957`; **bypass**, the route does not use an RPC). Refund and dispute are thread events, not statuses.

### phone_number

- **States:** `provisioning`, `active`, `suspended`, `released`, `provision_failed`, `ported_out`.
- **Edges:** `provisioning -> active | provision_failed | released`; `provision_failed -> provisioning (remediate) | released`; `active -> suspended | released | ported_out`; `suspended -> active | released | ported_out`.
- **Writers (seven, no owner):** provisioning saga `apps/api/src/telnyx/provisioning.ts:446,545,756,917,1105,1201,1237`; remediation `apps/api/src/routes/numbers.ts:1506` (atomic re-arm guarded by `.eq("status","provision_failed")`); hosted number `apps/api/src/telnyx/text-enablement.ts:341,371`; port activation `apps/api/src/telnyx/porting.ts:867`; port-out `apps/api/src/telnyx/portout.ts:216`; billing suspension `apps/api/src/routes/billing.ts:2297` (**direct write**); SQL `claim_number_allowance` (`supabase/migrations/20260805120000_number_allowance_claim.sql:241`) and `close_out_dead_provisioning` (`supabase/migrations/20260805140000_close_out_dead_provisioning.sql:106`).
- `provisioning.ts` funnels most writes through a generic `updateNumberRow(db, rowId, patch)`, so the status is not visible at the call site.

### port and port_messaging

- `port` is the voice track, `port_messaging` the messaging track. The definitions equal `ALLOWED_STATUS_TRANSITIONS` and `ALLOWED_MESSAGING_TRANSITIONS` (`apps/api/src/telnyx/porting.ts:103,155`), asserted by test. `phone_numbers.porting_status` mirrors the port request's status.
- **The model to copy:** `claimPortRow` (`apps/api/src/telnyx/porting.ts:245`) updates only while the row still holds the values this run read and returns null to the loser, which then sends no email or push.
- **Effects (E):** `ported` activates the number and emails; `exception` emails; messaging `exception` sends the "texting is delayed" notice.
- **Writers:** `apps/api/src/telnyx/porting.ts:229,251`, `apps/api/src/routes/porting.ts:721,849`, `apps/api/src/webhooks/stripe.ts:1031`.
- **Clients:** `apps/web/src/components/porting/port-ui-state.ts`, `apps/ios/Loonext/Features/Settings/PortCards.swift`, Android in `apps/android/app/src/main/kotlin/com/loonext/android/features/foryou/ForYouTab.kt`.

### quote

- **States:** `draft`, `sent`, `viewed`, `accepted`, `declined`, `expired`. The vocabulary and `canTransitionQuote` are in `packages/shared/src/quotes.ts`; the definition is asserted equal edge by edge.
- **Writers:** `apps/api/src/routes/quotes.ts` (send, after the text goes), `apps/api/src/routes/quotes-public.ts:161` (viewed), `274` (accepted, guarded in the WHERE clause by `.in("status", ["sent","viewed"])`).
- **Fixed (phase 2):** a send claims the draft with a lease (`quotes.sending_at`, `supabase/migrations/20261111250000_quotes_claim_a_send_with_a_lease.sql`) and writes `sent` only after the text has gone, so nothing returns to draft. A failed send releases the lease; a lease older than two minutes can be taken over.
- **Gaps:** nothing writes `declined` or `expired` (expiry is folded in on read by `effectiveQuoteStatus`). Clients render `effective_status`, not `status`.

### text_enablement

- **States:** `pending`, `action-required`, `in-progress`, `completed`, `failed`, `cancelled`. `mapHostedStatus` maps Telnyx's order status; unknown values keep the current state and are reported. `cancelled` is guarded by `.neq("status","cancelled")`.
- **Writers:** `apps/api/src/telnyx/text-enablement.ts:123,283,311`, `apps/api/src/routes/text-enablement.ts:474,570` (resubmit reset, guarded against a double click), `apps/api/src/telnyx/provisioning.ts:1191` (cancel).
- **Lease on the same rows:** `provisioning_lease_until` (claim/release, `claim_text_enablement_lease`); `attempts` is the poll budget, `resubmit_count` the lifetime resubmits.

### data_export

- `pending -> running -> ready | failed`; `running -> running` on each resumable pass. All writes are in `apps/api/src/workspace/export.ts:198,220,309,335,354,382,400,419,437` (direct). `reaped_at` (bucket sweep) is a timestamp, not a state.

### consent

- The consent ledger: `implied`, `express`, `revoked`. Each row is the state a contact entered; the latest row wins. Revoked leaves only for `express`, and only the customer lifts a STOP (opt-out is carrier truth, gate in `runPreSendGates`). Written by `supabase/migrations/20260728002100_consent_ledger.sql` and its follow-ups; no client renders it.

### geocode

- `pending -> ok | failed | no_address`; editing an address returns to `pending`, clearing sets `no_address`. Writers `apps/api/src/geocode/geocode-contacts.ts:158,174`, `apps/api/src/geocode/geocode-tasks.ts:128,137`, `apps/api/src/routes/contacts.ts:978`, SQL in `supabase/migrations/20260724020000_task_geocode.sql`.

### billing_dispute

- Free text copied from Stripe through `record_billing_dispute` (`apps/api/src/billing/disputes.ts:76`). Seven Stripe statuses; losing a closed dispute revokes a prepaid year, once. No constraint, table empty on production.

### task, invite, workspace (derived)

- **task:** `open`, `done`, `trashed` (`deleted_at`, wins over done: one such row on production). Done is `task_done_at(tasks)`: the source message's `done_at` when the task was promoted from a message, else the task's own `done_at`, so two columns on two tables decide it. Restore returns to `open` or `done`. Writers: bulk and single changes go through `api_bulk_tasks` (`apps/api/src/routes/tasks.ts:1996`); `apps/api/src/tasks/due-notice.ts:179` and `apps/api/src/tasks/overdue-notice.ts:84` stamp notice timestamps, not state.
- **invite:** `pending`, `accepted`, `revoked`, `expired` from `accepted_at`, `revoked_at`, `expires_at`. Writers `apps/api/src/routes/team.ts:886,1071,1113` (accept, resend, revoke). Resend extends `expires_at`, so `expired -> pending`.
- **workspace:** `active`, `paused` (`paused_at`; subscription status stays `active` on purpose, `apps/api/src/billing/pause.ts`), `closed` (`deleted_at` + `purge_after`, `close_workspace` in `supabase/migrations/20260726000400_workspace_closure.sql:49`, `reopen_workspace` at 123), `purged` (`purged_at`, `purge_workspace_step`). Pause writers: `apps/api/src/routes/billing.ts:1635` and `apps/api/src/webhooks/stripe.ts:1170,1198` (the Stripe mirror also sets and clears `paused_at`, so two writers share one flag).

---

## Not machines, and implicit ones left as notes

| Item | Why it is not a definition |
| --- | --- |
| `tags.pipeline_stage` (`quote_sent`, `scheduled`, `won`, `lost`, NULL) | A label set on a tag, seeded by `seed_pipeline` (`supabase/migrations/20260801110000_pipeline_stages.sql`); a conversation's stage is derived from quotes and tags, not stored. |
| `messages.work_phase` (`before`, `after`) | A photo label on notes, not a lifecycle. |
| `messages.done_at` | A done flag with `message_done` / `message_undone` thread events; 15 rows on production. It feeds `task`, not a vocabulary of its own. |
| `number_port_outs` | A dedup ledger keyed `(portout_id, status, phone_e164)` so a webhook replay is a no-op (`supabase/migrations/20260728000500_number_port_out.sql`). The statuses are Telnyx's; there is no state to hold. Empty on production. |
| Leases | `calendar_connections.pull_lease_*`, `credential_refresh_lease_*`, `owner_disclosure_lease_*`; `webhook_subscriptions.renewal_lease_*`; `calendar_outbox` and `calendar_reminder_replans` `lease_*`; `scheduled_messages.claimed_at`; `text_enablement_orders.provisioning_lease_until`; `outbound_dial_leases`. All are "claim for N seconds" with an owner and an expiry; none carries a lifecycle of its own. Phase 2 gives them one shared claim helper. |
| Retry counters | `messages.auto_retry_count`, `calendar_outbox.attempts`, `calendar_reminder_replans.attempts`, `calendar_connections.owner_disclosure_attempts`, `webhook_deliveries.attempts`, `webhook_subscriptions.renewal_attempts`, `phone_numbers.provision_attempts`, `text_enablement_orders.attempts`, `ownership_confirmations.attempts`, `widget_verifications.attempts`. The cap is in code, not in the table, except where noted per machine. |
| Company registration fee | `registration_fee_charge_started_at` then `registration_fee_paid_at`: a charge claim, then done. |

Not inventoried in phase 1: the Android and iOS controllers and view models that switch on these values (only whether each client reads a value, above), invite and OTP flows beyond `invite`, the onboarding step machine (`apps/web/src/app/onboarding/steps.ts`), the web softphone reducer, and upload flows. They consume the machines above; phase 3 lists each client's switch when it wires `allowedActions`.

## Effects that fire on every pass, and writes that bypass the owner

**Every-pass effects found**

1. `scheduled_message` hold notice: the 2026-11-10 incident. Mitigated in the caller (`alreadyHeldFor`); still depends on every caller remembering. Highest priority for phase 2.
2. `message` finalize: PostHog outcome and `message.failed` webhook compare against a row read before the write, so concurrent deliveries of the same finalized event can both emit. Not reproduced.
3. `webhook_delivery`: re-sends by design after a dead worker (at-least-once), so receivers must dedupe. Documented, not a defect.

I did not audit every cron in `apps/api/src/index.ts` for repeat notices; the ones above are the ones the writers' code showed. The incident class is "a retry loop notifies on each pass", and phase 4's per-transition row makes a repeat visible as two rows with the same `from` and `to`.

**Writes that bypass the owner**

| Where | What |
| --- | --- |
| `apps/api/src/routes/scheduled-messages.ts:335,342` | held to pending by a direct table update; leaves `held_reason_key` set |
| `apps/api/src/routes/quotes.ts:136` | `unsend` writes sent to draft, an edge the shared table forbids |
| `apps/api/src/routes/payments.ts:654,957` | cancel by direct update while paid and expired use RPCs |
| `apps/api/src/routes/billing.ts:2297` | suspends a phone number directly, one of seven writers |
| `apps/api/src/messaging/status.ts:128` | `message.finalized` writes with no from-state guard |
| `apps/api/src/messaging/live-call.ts:213,310,403,504,533` | leg state by direct updates beside the RPCs |
| `apps/api/src/routes/conversations.ts:975,1210` | status patched with an enum check only |
| `apps/api/src/webhooks/stripe.ts:1109` | unconditional subscription overwrite (acceptable: Stripe is the authority; record, do not refuse) |
| `apps/api/src/workspace/export.ts` | nine direct writes in one file; no RPC |
| `apps/api/src/webhooks/outbound-deliver.ts:175-248` | five direct writes in one file; no RPC |

## Production check (read-only, 2026-11-10)

One `SELECT` per column inside a rolled-back transaction, counting rows per state. Only counts and state names were read; the single id list returned is in the call row below. The same numbers are stored in `packages/shared/src/state-machines/prod-snapshot-2026-11-10.ts` and a test asserts every observed state is one its machine defines.

**No row is in a state its definition forbids.** The database enforces the vocabulary through a check constraint or enum for 22 of the 24 column-backed machines (the other two, `quote` and `billing_dispute`, are free text), which is why. The constraints on production were read back with `pg_get_constraintdef` and equal the migration-derived lists the tests use.

| Machine | Counts (state: rows) |
| --- | --- |
| `call` | ended_answered 51, ended_missed 98, ended_voicemail 9, NULL 7 |
| `call_leg` | ringing 125, answered 7, failed 51 |
| `scheduled_message` | canceled 1, sent 1 |
| `calendar_connection` | active 2, revoked 1 |
| `calendar_outbox` | cancelled 1, completed 10 |
| `calendar_reminder_replan` | no rows |
| `calendar_link` | unlinked 3 |
| `calendar_push_subscription` | active 2, revoked 1 |
| `webhook_delivery` | no rows |
| `subscription` | active 1, incomplete 5 |
| `conversation` | closed 3, new 5, open 1, waiting 2 (one trashed closed thread, prior status new) |
| `conversation_visibility` | live 10, trashed 1, spam 0 |
| `message` | received 28, delivered 31, failed 3, NULL 17 (all notes) |
| `registration` | draft 4 (2 brand, 2 campaign) |
| `number_health` | healthy 1 |
| `payment_request` | no rows |
| `phone_number` | active 1; `porting_status` NULL 1 |
| `port`, `port_messaging` | no rows |
| `quote` | draft 1 |
| `text_enablement` | no rows |
| `data_export` | ready 3 |
| `consent` | express 5, implied 6, revoked 1 |
| `geocode` | contacts ok 2, pending 11; tasks no_address 17 |
| `billing_dispute` | no rows |
| `task` | open 4, done 2, trashed 11 (one of the trashed is also done) |
| `invite` | accepted 3, revoked 3 |
| `workspace` | active 6; paused 0, closed 0, purged 0 |

**Invariant violations (rows that are in a legal state but break an implied rule)**

| Machine | Rows | What |
| --- | --- | --- |
| `call` | 8 | terminal state with `ended_at` NULL (ended_answered 3, ended_missed 5) |
| `call` | 1 | `state = ended_voicemail` but `outcome = missed` (call `cc03b042-fe2b-4641-8b32-bea35ac663bb`) |
| `call` | 7 | `state` NULL, legacy: outcome answered 5, missed 2 (the constraint admits NULL) |
| `call_leg` | 125 | leg `ringing` on a call that has ended (ended_answered 52, ended_missed 65, ended_voicemail 8) |

Also checked and clean: every closed conversation has `closed_at`; every `calendar_connections` revoked row satisfies the live-shape constraint; no expired lease is still held (calendar pull, credential refresh, owner disclosure, subscription renewal, scheduled claims, text-enablement lease, dial leases: 0 each); no scheduled message is claimed while live; no message has been auto-retried; every done task has `done_by_user_id`; no workspace is paused, closed or purged.

Production is small (6 companies, 1 number, 1 active subscription), so zero rows in a machine proves the vocabulary, not the transitions. The graphs for the provider machines are checked against the code tables, not against history.

## Migration plan for phases 2 to 4

Expand and contract throughout: add the RPC beside the old write, move one writer at a time, then add the guard that fails the build on a direct write. Each machine ships alone, with the "second pass fires nothing" test, a transition-matrix fixture and the production re-check below.

**Per-machine recipe (phase 2).** (1) Re-run the production count for the column. (2) Add `api_<machine>_transition(id, to, cause)` that locks the row, checks the edge against the definition's table, raises a named error `illegal_transition` carrying machine, from and to, and returns `{ from, to, entered }`. `entered` is false for a self edge. (3) Move writers onto it; callers fire effects only when `entered` is true. (4) Add the guard script that fails when a file outside the allowlist writes the column directly, proven by breaking it once. (5) For `provider` machines the RPC records an unexpected edge and returns `entered = false` instead of raising.

**Order, risk-ranked (incident-prone first)**

1. **`scheduled_message` hold and notify.** Caused the 2026-11-10 flood. Add `entered` to `api_hold_scheduled_message`, `api_fail_scheduled_message` and the held branch of `api_fire_scheduled_message`; move the reschedule (held to pending) at `apps/api/src/routes/scheduled-messages.ts:335` into an RPC that also clears `held_reason_key`; delete `alreadyHeldFor`. Smallest change, highest incident value, and no production rows to backfill.
2. **Calendar family** (`calendar_connection`, `calendar_link`, `calendar_outbox`, `calendar_reminder_replan`, `calendar_push_subscription`). **Done (phase 2):** `supabase/migrations/20261111350000_the_calendar_keeps_its_lifecycles.sql` raises on any move off the five definitions, pinned by `enforced.test.ts`; the link definition gained `event_removed -> refused`, which the sync already takes. Still open from this item: exposing a `cleaning_up` phase for `disconnected`, and deciding `renewing` and `expired`.
3. **`message`.** **Done (phase 2):** `supabase/migrations/20261111310000_messages_never_go_backwards.sql` keeps a text's status on the machine's edges (a late or replayed carrier event leaves it where it is, since the carrier owns this machine), `enforced.test.ts` pins the trigger to the definition, and `message.finalized` in `apps/api/src/messaging/status.ts` updates only a queued or sent row and fires its outcome event and `message.failed` webhook only when that update moved one. `supabase/tests/message_lifecycle.test.sql` pins the guard.
4. **`phone_number` and `port`/`port_messaging`.** A wrong write loses a customer's line. **`phone_number` done (phase 2):** `supabase/migrations/20261111330000_a_number_keeps_its_lifecycle.sql` raises on any move off the definition, pinned by `enforced.test.ts`; all seven writers already kept to the edges. The port tables stay guarded in code by `claimPortRow`.
5. **`registration`, `text_enablement`.** **Done (phase 2):** `supabase/migrations/20261111340000_registrations_and_text_enablement_keep_their_lifecycles.sql` keeps each status on its edges (a move off them keeps the current status, as the code already did, since the carrier owns both), pinned by `enforced.test.ts`. Decided: a rejected registration is resubmitted after a fix (`rejected -> submitted`), a suspended one is reactivated the same way, and releasing a number cancels its hosted order even once completed (`completed -> cancelled`).
6. **`subscription` and `workspace` pause.** Provider-owned mirror: record illegal edges and add the dunning and pause entry effects through the RPC. Two writers share `paused_at` today. **Recording done:** every subscription move Stripe reports (`customer.subscription.updated`, from its `previous_attributes`) is sent to PostHog as `state_transition` with `expected: false` when it is off the definition (`apps/api/src/webhooks/stripe.ts`, `apps/api/src/analytics/state-transition.ts`). The mirror still takes Stripe's word. Still open: the pause entry effects through one writer.
7. **`payment_request`, `quote`, `webhook_delivery`, `data_export`.** **Done (phase 2):** `supabase/migrations/20261111320000_payments_quotes_exports_and_webhooks_keep_their_lifecycles.sql` gives each table a transition trigger that raises on a move off its definition, pinned by `enforced.test.ts`. Every existing writer already kept to the edges (the two payment cancels are guarded by `status = 'requested'`; `unsend` is gone since the quote send lease). The payment definition gained `cancelled -> paid` and `expired -> paid`, the rule `api_mark_payment_request_paid` already applied: money that lands after a cancel is recorded.
8. **`conversation`, `conversation_visibility`, `task`, `invite`, derived `workspace` states.** **Done (phase 2):** `supabase/migrations/20261111360000_derived_states_have_one_definition.sql` gives each derived machine one SQL function (`task_state`, `invite_state`, `workspace_state`, `conversation_visibility`), checked by `enforced.test.ts` to return exactly the machine's states, and adds the invariants an invite cannot be both accepted and revoked and a workspace is purged only once closed. Decided: `conversations.status` keeps its full mesh, because it is a workflow label a member moves freely.
9. **`call` and `call_leg`.** The call machine is already enforced by the reducer. **Done (phase 2):** `supabase/migrations/20261111300000_a_finished_call_closes_its_rings.sql` closes every leg still ringing when its call ends, stamps an end time when a call turns terminal (with a CHECK that an ended call has one), and backfills the 125 legs, the 8 end times and the 7 legacy NULL states. The one `ended_voicemail` call with outcome `missed` is correct (the caller hung up in the greeting). `supabase/tests/call_lifecycle_cleanup.test.sql` pins both rules.

**Phase 3, `allowedActions` on all three clients.** The API returns `allowed_actions` on each record it serves (computed from the shared definition and the caller's role) and validates a mutation against the same call. Web reads it directly. Kotlin and Swift get ported tables with vectors in `packages/shared/vectors` and a roster test like `scheduled-send-parity.test.ts`. Order: scheduled messages, calendar connection (the "when does Connect return" question), conversation actions, quote and payment, then numbers and ports. Verify each action's capability against the route's `requireCapability` before wiring, and drop any the route does not enforce.

**Phase 4, observability.** The transition RPC returns `{ from, to, entered, cause }`; its caller writes one activity row through the existing audit path (#714) and one PostHog event `state_transition` with `machine`, `from`, `to`, `cause`. No new monitoring table: monitoring is PostHog only. "Why is this stuck" becomes one PostHog query on the record id, and a repeat notice shows as two events with the same `from` and `to`.

## Unclassified

- **`text_enablement` `failed -> pending`:** inferred from the resubmit route resetting the row, not from a transition table.
- **Android and iOS controllers** and the web softphone reducer: read the values, not inventoried (above).
- **Provider vocabularies I could not confirm against a live source:** the Stripe dispute status list in `billing_dispute` is from Stripe's documentation, not from production (table empty).
