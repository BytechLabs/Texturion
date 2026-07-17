# Calls v3 — the inbound-call state machine (#170 phase 2)

Founder mandate (verbatim): *"This calling stuff needs full audit and proper
implementation, dont patch, fix the architecture and how we have set it up so
these issues arent even possible."*

This document is the binding design for the inbound-call redesign. It
supersedes the inbound half of docs/CALLS-V2.md (ring engine, voicemail entry,
ring-me, and every client contract those touch). The product invariants of
D36–D45 (billing anchors, #106 access, screening, the line model, MCTB,
transfer semantics, voicemail UX, forgery gates, idempotent webhooks) all
survive — §11 maps each one to where it now lives. Outbound calling and the
transfer/consult internals are NOT redesigned here; they are re-serialized
(§7.4) but keep their D43 logic.

Phase-1 evidence: the four-agent forensic audit archived on issue #170
(comment of 2026-07-17). Every design choice below cites the defect it kills.
This revision additionally folds in the two adversarial design reviews of
2026-07-17 (crash/replay consistency, DO serialization semantics, ring-me
assertion, intent registration, orphan legs, adoption of in-flight
voicemails, rollout ordering) AND the second-round reviews R1/R2 of the same
date (transition-table totality for untagged hangups, dead-caller terminal
discrimination, intent stand-down recovery, ring-me device-vs-member scope,
client_state forgeability, call_end push compat, edge dispatch liveness,
rollout re-ordering, cap arithmetic) — §16 records every review point that
was considered and resolved differently.

---

## 1. Why the current architecture cannot be patched

The audit proved the three founder scenarios are not three bugs — they are one
architectural property: **inbound-call state is smeared across two Postgres
tables, a Telnyx client_state tag, and an implicit "last ledgered leg" rule,
with no owner serializing writers.** Concretely:

| # | Structural defect (phase-1 evidence) | Why patching fails |
|---|---|---|
| 1 | ring-me's cancel→dial→ledger is non-atomic against `api_ring_leg_failed`'s last-leg decision (inbound-ring.ts:353–384 vs 20260712000400 §2) — the member's own re-ring voicemails the caller | Any REST-path Telnyx command + insert sequence races the webhook path; the advisory lock only sees ledgered rows. No lock ordering fixes an *unledgered in-flight dial*. |
| 2 | The wake push always chases the INVITE (fan-out starts before the dial loop, inbound-ring.ts:232 vs 254) and ring-me's first act kills the member's own live leg (:353) | The ledger has no device identity; "stale suspended-tab leg" and "leg presenting the banner right now" are indistinguishable rows. |
| 3 | No ring window exists: voicemail fires the instant the last SIP leg dies, at any elapsed time (inbound-ring.ts:627–645); `RING_TIMEOUT_SECS=45` is only Telnyx's per-leg dial timeout | There is no process anywhere that could hold a timer for a call. Workers webhook isolates are per-event. |
| 4 | "In voicemail" has no representation: the calls row is `outcome NULL, answered_at NULL` from ring through recording (live-calls.ts:649–654) — clients read voicemail-in-progress as RINGING | The state does not exist in any table; no read endpoint can serve what isn't stored. |
| 5 | Clients infer state from overloaded 4xx codes (409 = ringing OR ended OR voicemail OR uncontrollable; live-calls.ts:62–66, 643–701) and run heuristic kill probes (StaleRing.kt) | The epic bans inference; the fix is a state read, which needs defect 4 fixed, which needs an owner (defect 1–3). |
| 6 | INVITEs are answerable before their ledger rows exist (insert deferred behind the push await, inbound-ring.ts:287→300); an early answer is judged 'lost' and the server hangs up the answering member | Same non-atomicity class as defect 1. |

One construct removes the whole class: **a single Durable Object per call
session that owns the state machine.** Every webhook event, every ring-me,
every answer claim, every transfer intent, and the ring-window alarm execute
serialized inside one object — under an **explicit per-object FIFO** (§4.1;
DO input gates alone are NOT sufficient, see there). Races become impossible
by construction, the ring window becomes a real alarm, and "what state is
this call in" becomes a stored fact that one endpoint serves with a 200.

Two legacy defenses the audit's targets embodied are deliberately
**re-created, not discarded**, inside the DO — because removing the racy
mechanism must not remove the property it defended:

- the durable answer-claim verdict (`api_claim_ring_answer`'s
  'won/lost/already', inbound-ring.ts:461–508) disambiguated a replayed
  answer from a dead caller → v3 re-creates it as the **effect journal +
  4xx cause discrimination** (§4.1);
- the untyped legacy hangup path always ran the terminal merge, so a call
  could never be stranded outcome-null by a state mismatch → v3 re-creates
  it as the **inbound-hangup catch-all T17 (tagged OR untagged)** (§4).

---

## 2. Architecture overview

```
Telnyx ──POST /webhooks/telnyx──▶ verify Ed25519 ─▶ webhook_events ledger (dedup, unchanged)
                                        │
                                        ├─ inbound-family call.* ──▶ CallSessionDO.onTelnyxEvent()   ◀── serialized (FIFO, §4.1)
                                        └─ outbound (oc_*) ─────────▶ legacy voice-webhook path (unchanged)

App clients ─▶ /v1/calls/live/:session/state  (always-200 read; row + DO snapshot)
            ─▶ /v1/calls/live/:session/ring-me (auth in route → CallSessionDO.ringMe())
            ─▶ transfer/consult routes (auth in route → CallSessionDO.registerIntent() BEFORE any
                Telnyx command; owner changes via CallSessionDO.setOwner())

CallSessionDO ──▶ Telnyx commands (dial / answer / bridge / hangup / speak / record)
              ──▶ Postgres: calls.state + answered_* (sole writer), call_member_legs (audit),
                            terminal merge delegates (billing, threading, MCTB — existing functions)
              ──▶ push: kind:'call' wake + kind:'call_end' revocation (capability-gated, §9.2)
              ──▶ alarm: ring window (45s), journal-resume (§4.1), retry backoff, fanout-settle (§5.5),
                         intent-expiry (§7.4), janitor (4h), purge (+15m after end)
```

### 2.1 The Durable Object

- **Class**: `CallSessionDO` — `apps/api/src/calls/session-do.ts` (new dir
  `apps/api/src/calls/`; the pure reducer lives beside it in
  `transitions.ts`, see §15).
- **Binding**: `CALL_SESSIONS` on the `loonext-api` Worker.
- **Entry-module wiring** (deploy-time correctness, do not improvise):
  `Bindings` is `Record<string, unknown>` (env.ts:191) and `getEnv()`
  zod-parses with `envSchema`, which **strips unknown keys** — so adding the
  binding to a TS type alone would silently discard it. `CALL_SESSIONS` is
  added to `envSchema` via the existing `z.custom` pattern
  (`rateLimiterSchema`, env.ts:12–15), typed
  `DurableObjectNamespace`, and declared **`.optional()`** (required would
  break every existing test env fixture / `completeEnv`); the webhook router
  and the live-calls routes guard at runtime and fail loudly (Sentry) if the
  binding is absent in production. `CallSessionDO` is **re-exported as a
  named export from `src/index.ts`** — wrangler resolves DO classes from
  `main`'s named exports, NOT from the (Sentry-wrapped) default export.
  The export is wrapped with
  `Sentry.instrumentDurableObjectWithSentry(sentryOptions, CallSessionDO)`
  (@sentry/cloudflare 10.63.0 ships it): the Worker-level
  `Sentry.withSentry` (index.ts:382) wraps only fetch/scheduled, so an
  uninstrumented DO would make every §2.2 mirror-failure alert and §13
  cost-cap warning a silent no-op — and `alarm()` errors are the single
  highest-value capture (a repeatedly-throwing alarm is the ring window's
  single point of failure).
- **Id scheme**: `env.CALL_SESSIONS.idFromName(call_session_id)` where
  `call_session_id` is the Telnyx session id of the **inbound (customer)
  leg** — the same key the calls row uses. Member ring legs carry a different
  Telnyx session id; routing always keys on the session extracted from the
  parsed client_state tag (`brm|<session>|…`), falling back to
  `payload.call_session_id` for untagged/bri/vmi legs (§7.2).
- **wrangler.jsonc** additions:

```jsonc
"durable_objects": {
  "bindings": [{ "name": "CALL_SESSIONS", "class_name": "CallSessionDO" }]
},
"migrations": [
  { "tag": "calls-v3-1", "new_sqlite_classes": ["CallSessionDO"] }
]
```

(SQLite-backed DO storage; Workers Paid — already provisioned.)

### 2.2 What lives where

| Store | Contents | Lifetime |
|---|---|---|
| **DO storage** (hot machine) | `machine` record: state, companyId, phoneNumberId, callerE164, businessNumberE164, greeting, screening verdict, answeredByUserId/answeredAtIso, flags (rejectedForCap, wakeAttempted, unattended, ownerLegDeadDuringIntent §7.4, adopted §7.5), pushCapableUserIds, ringDeadlineMs, telnyxCommandCount, `intent` (live transfer/consult registration, §7.4), `answerIntent` (§4.1); **`journal`** record: {eventId, pendingEffects[], cursor} (§4.1); leg records — **`leg:pending:{uuid}`** at dial issue (userId, status `dialing`, dialedAtMs, source engine\|ring_me), **re-keyed to `leg:{ccid}`** the moment the dial POST returns a ccid (a leg record MUST exist before its dial is issued, and ccids are only known after — both are true with the two-phase key); statuses: dialing\|ringing\|canceling\|answered\|dead\|ambiguous (§7.7); `seen:{telnyx_event_id}` dedup marks (rolling, ≤256) | Purged 15 min after a terminal state, see §13. (Replay layers, honestly stated: the edge PK dedup means Telnyx's own 6 delivery attempts never run the DO transition twice for a PROCESSED event — but a pure ack-and-drop of duplicates would also convert those 6 fast retries into a single ≥2-min sweeper retry for any event lost between edge insert and DO admission, which for a `call.answered` is a member losing an answered call to the t+45 alarm. §7.2's dispatch contract exists to close that: inbound-family events are admitted BEFORE the 200 ack, and a duplicate POST for a still-UNSTAMPED row re-dispatches instead of pure-acking. The sweeper (2-min age gate, */5 cron, 5-attempt cap — verified crons.ts `SWEEP_MAX_ATTEMPTS`; replays can span ~25 min) is the LAST layer, not the second. Sweeper replays are safe AFTER the purge because adoption reads the ended row (§7.5) — post-purge safety comes from adoption, not from the purge window's length.) |
| **Postgres `calls` row** | The durable, queryable record. Gains a **`state` column** (§3) written **ONLY by DO transitions** (one documented backstop exception: the 4h stale sweeper, §7.6). `outcome`, `answered_at`, `answered_by_user_id`, voicemail columns, screening columns — all as today, all now written from the DO for inbound sessions. | Forever (the call log). |
| **Postgres `call_member_legs`** | Audit + `by-leg` resolution only. **It no longer decides any race** — `api_claim_ring_answer` and `api_ring_leg_failed` are retired (§12). Rows are written by the DO as legs dial/resolve. | As today. |

Rule of thumb: the DO is authoritative *during* the session; Postgres is the
authoritative record *of* the session. Every DO transition mirrors to
Postgres; a mirror-write failure retries via a short DO alarm (the DO's own
state never regresses), and terminal-state mirrors retry until they land
(bounded attempts + Sentry — a call must never be lost from the log).

### 2.3 Why each founder-mandated property now holds by construction

- **No ledger races**: dial, cancel, answer-claim, last-leg accounting,
  transfer intent, and the alarm all run on one object under one FIFO
  (§4.1). There is no "unledgered in-flight leg" — a leg exists in the
  machine (a `leg:pending:*` record, status `dialing`) *before* the Telnyx
  POST is issued.
- **A real ring window**: the DO alarm at `RING_WINDOW_SECS = 45` is the
  **only clock-based voicemail trigger** (§5).
- **Explicit state**: `calls.state` + the always-200 `/state` read (§8) —
  no client ever infers state from a 4xx again.
- **No client-initiated leg kills**: the server cancels every stale leg on
  every exit from `ringing`, so a late INVITE is followed by a server BYE
  within milliseconds; the client only ever *presents and stops presenting*
  (§10). `StaleRing.kt` is deleted, not repaired.
- **No stranded sessions**: every crash/eviction window is closed by the
  §4.1 journal (persist-then-execute, resume on next admission), and any
  window we failed to imagine is closed by T17 — an inbound-leg hangup,
  **tagged or untagged**, is terminal from EVERY non-terminal state, so a
  calls row can never sit outcome-null holding the line busy (§4). For the
  one ordering where the hangup event itself can be permanently lost (§7.5
  pre-mint drop), the T2/T9 dead-inbound discrimination branches are
  themselves terminal — the session never waits on an event that cannot
  arrive.

---

## 3. States

`calls.state` (text + CHECK constraint), written only by the DO:

| State | Meaning | `outcome` mirror |
|---|---|---|
| `ringing` | Caller hears ringback; nobody has answered; voicemail has not begun. Covers: legs ringing, zero-leg hold-for-wake (§5.3), and the unattended (suspended/inactive-subscription) ring-out. | `NULL` |
| `answered` | A member owns the call (bridged or in the answer/bridge handshake). `answered_by_user_id` + `answered_at` are set — and are **never reverted** (§4 T2: they are only written after the customer leg is successfully answered). | `NULL` |
| `voicemail_greeting` | Voicemail answered the caller; TTS greeting playing. | `NULL` |
| `voicemail_recording` | Beep played; recorder open (≤120s). | `NULL` |
| `ended_answered` | Terminal. Talk time billed from the bri anchor. | `answered` |
| `ended_voicemail` | Terminal. Recording stored + threaded. | `voicemail` |
| `ended_missed` | Terminal. Caller gave up / rang out / hung up in voicemail without a keepable message. MCTB + crew alert fire here. | `missed` |
| `ended_rejected` | Terminal. Server rejected the call (voice spending cap — USER_BUSY per D36). MCTB still fires (D36 binding). | `missed` |

`outcome` is retained unchanged for every existing consumer (line-busy claim,
`api_list_calls`, billing, sweepers). `state` is the granular truth; the
mapping above is enforced in one place (the transition mirror).

**Nullability (binding for every reader): `calls.state` is NULLABLE.**
`NULL` means "legacy or outbound" — every inbound row is minted by
`api_claim_inbound_line` (kept verbatim) with `state NULL` and mirrored
non-null only when T1 completes; every OUTBOUND row is `NULL` forever (the
legacy outbound path never writes state, and this vocabulary is
inbound-only). Consequences the implementer must honor: the §12.1 CHECK
constraint permits NULL (`state is null or state in (…)`); every consumer of
`api_list_calls` / `/mine` treats `NULL` as "derive from outcome/answered_at"
(the §8.1 derivation rule); the optional partial index
`where state not like 'ended%'` silently excludes NULL rows and must not be
used as the line-busy scan (the outcome-null scan remains primary). Client
code must never assume `state` is total.

Exactly two *terminal-to-terminal* edges are legal, both upgrades of a
provisional `ended_missed`:

- `ended_missed → ended_voicemail` — the existing recording-beats-hangup
  merge rule (D37), preserved because `call.recording.saved` can arrive
  after the vmi hangup.
- `ended_missed → ended_answered` — a **bri-tagged** inbound hangup
  surfacing after a T2 crash window already resolved the session
  `ended_missed` (T2's dead-inbound terminal branch, §4): the bri tag is
  proof our answer landed before the caller died; the retained
  `answerIntent` supplies the stamp, billing runs from the tag's anchor
  (~0s talk). MCTB may already have fired on the provisional missed —
  acceptable and even useful (the call genuinely dropped mid-answer; the
  text-back reaches a caller who got ~0 seconds of conversation).

### 3.1 State diagram

```mermaid
stateDiagram-v2
    [*] --> ringing : call.initiated (owned number, line free, not diverted)
    [*] --> voicemail_greeting : call.initiated (line busy | screening divert | zero-avenue exhaustion §5.3)
    ringing --> answered : brm call.answered (leg live) AND inbound answer succeeds
    ringing --> voicemail_greeting : ALARM at 45s | explicit exhaustion (no live legs AND no push-capable avenue)
    ringing --> ended_missed : caller hangup pre-answer (untagged) | vmi-tagged hangup (T17 catch-all)
    ringing --> ended_answered : bri-tagged hangup (T17 catch-all — crash-window resolution)
    ringing --> ended_rejected : hangup of a cap-rejected call
    answered --> ended_answered : bri (customer) leg hangup — billing anchor
    voicemail_greeting --> voicemail_recording : call.speak.ended (vmi)
    voicemail_greeting --> ended_missed : vmi OR UNTAGGED inbound hangup (bailed during greeting; failed-vm-answer window — T17)
    voicemail_recording --> ended_missed : vmi OR UNTAGGED inbound hangup (no keepable recording yet)
    voicemail_recording --> ended_voicemail : call.recording.saved (stored ≥2s)
    ended_missed --> ended_voicemail : call.recording.saved (late upgrade — D37 merge rule)
    ended_missed --> ended_answered : bri-tagged inbound hangup (late upgrade — T2 crash-window, §3)
    ended_answered --> [*]
    ended_voicemail --> [*]
    ended_missed --> [*]
    ended_rejected --> [*]
```

(Leg-level events that do NOT change session state — a loser leg dying while
avenues remain, a ring-me adding a leg, sibling dismissal — are the §4 table's
self-loops on `ringing`/`answered`. The T17 catch-all edges exist so that an
inbound-leg hangup — tagged or untagged — ALWAYS reaches a terminal state —
see §4.1.)

---

## 4. Transition table

Every transition runs inside the DO under the §4.1 FIFO. "Mirror" = write
`calls.state` (+ listed columns) to Postgres; every mirror fires the realtime
broadcast (§9.1). All Telnyx commands use the existing 4xx-swallow discipline
(`telnyxOnLiveLeg`) — a dead leg is a routine race — EXCEPT the
answer/bridge commands, whose 4xxs are cause-discriminated per §4.1 (an
undiscriminated swallow is exactly what turned one eviction into dead air in
the review's B1 sequence).

| # | Trigger | Guard | Effects (in order) | Broadcast / push |
|---|---|---|---|---|
| T0 | `call.initiated`, direction incoming, tagged or unowned number | — | Drop (as today: tagged inbound = forgery/our own leg family; unowned = released number). | — |
| T1 | `call.initiated`, owned number | DO has no machine AND calls row has no outcome (replay guard; else no-op) | `api_claim_inbound_line` (kept verbatim — line model). Then branch: **(a) line busy or (screening divert AND flagged)** → VM-ENTRY (T9) with state minted `voicemail_greeting`. **(b) suspended number / inactive subscription** → mint `ringing` with `unattended=true`; no dials, no push, no ring alarm (janitor alarm only); caller rings out → T5. (The caller-side bound here is the carrier's unanswered-call timeout — deliberate legacy parity for suspended lines; the janitor is the backstop. §16.) **(c) over voice cap** → Telnyx reject USER_BUSY, mint `ringing` with `rejectedForCap=true` → its hangup runs T5 into `ended_rejected`. **(d) otherwise RING-START**: compute dial targets (active members with a telephony credential + #106 'text' on the number — unchanged rule) and the **push audience** (all #106-'text'-eligible active members holding ANY push channel, credential or not — fixes "zero targets → no push ever" — **AND push-enabled per `notification_prefs` (#146)**: the delivery delegate filters prefs BEFORE sending (incoming-call.ts:113–128), so an audience computed without the pref filter counts members who will never receive a send, never hard-fail, and never get pruned — 45s of ringback to a provably empty room for a solo pref-disabled member, violating §5.3's own rule; the audience computation and the delegate must apply the SAME filter, §5.5). **Immediate-exhaustion check: if dial targets AND push audience are BOTH empty → VM-ENTRY (T9) now** — a fresh company whose only member has neither a credential nor a push token must get instant voicemail (legacy parity), never 45s of ringback to an empty room (§5.3 forbids dishonest ringback). If targets exceed `MAX_LEGS_PER_SESSION` → Sentry warning at RING-START (alert-before-the-cap mandate) and dial the first 24 by earliest membership (deterministic). Record each target leg as `leg:pending:{uuid}` `dialing`; issue the dials with **bounded parallelism** (batches of ~6; per-target try/catch; ambiguous outcomes per §7.7) — the invariant is per-leg (each pending record persisted before ITS OWN dial POST), NOT batch-serial: a 24-target serial loop at ~300–800ms/POST holds the single FIFO 10–20s, starving the §7.2 admission budget and queueing an early answerer behind the remaining dials; a Sentry **queue-latency signal** (warn when FIFO admission wait exceeds ~2s) is part of this row (alert-before-the-cap mandate). Re-key on ccid; write ledger rows; **push fan-out as a journaled effect**: the effect dispatches the sends AND arms the `fanout-settle` alarm (+10s); the settle re-enters as the internal `push-fanout-settled` event — §5.5 (a detached, unjournaled fan-out loses the settle to a mid-fanout eviction and §5.5 pruning never runs). Set `ringDeadlineMs = now + 45_000`, alarm; state `ringing`; mirror. | `call.updated` (state=ringing); `kind:'call'` push, TTL **45s** (§9.2) |
| T2 | `call.answered` on a `brm` leg | state=`ringing` AND leg status ∈ {dialing, ringing, canceling}. **The `canceling` case is NOT free** (review R1-B2): "if the cancel won at Telnyx this event never fires" is true only for cancel-BEFORE-answer — when the answer preceded our hangup at Telnyx, `call.answered` HAS fired and our hangup still killed the now-answered leg. So on a `canceling` leg this transition FIRST `GET`s the MEMBER leg: dead → treat as a leg death (T3 — leg→dead, run the avenue ladder; another live leg holds the ring) and do NOT answer the caller into a doomed bridge; alive → proceed (rare: our cancel truly lost). After the §6/T4 no-cancel rule, `canceling` legs in `ringing` should be unreachable — the branch is kept as defense-in-depth and §15.1 pins it. An unknown-ccid brm answer naming this session is first adopted per §7.7, then re-enters this guard. | Runs as a journaled sequence (§4.1): (1) persist `answerIntent {memberCcid, userId, answeredAtIso}` + seen-mark + pendingEffects atomically; (2) Telnyx **answer the inbound leg first** with the `bri\|<caller>\|<answeredAtIso>` tag (billing anchor, D36 — format unchanged). **On 4xx: DISCRIMINATE, never assume** — `GET /v2/calls/{inboundCcid}`: leg alive/answered (we already answered it — journal replay after a crash, or a raced duplicate) → treat as success and continue; leg dead/not-found (the caller died in the answer window) → **TERMINAL, never "stay"** (review R1-B3: the caller's own hangup event can have been permanently dropped pre-mint per §7.5 — waiting for it can wait forever): hang up the member leg + every live leg, state→`ended_missed` (`rejectedForCap`→`ended_rejected`) **provisional**, terminal merge, purge alarm — and **KEEP `answerIntent` persisted until purge** (do NOT clear it): if our answer actually landed before the caller died (crash-window replay ambiguity), the in-flight **bri-tagged** hangup later upgrades `ended_missed → ended_answered` via T17 with the retained stamp (§3's second terminal edge — review R1-I2 resolved without trusting Telnyx's GET to return `client_state`, §16.5). No stamp is written on the failure path, so no transient/reverted `answered_by` ever exists (kills the audit's stamp-revert defect). (3) On success: leg→answered; state→`answered`; mirror {state, answered_by_user_id, answered_at} in ONE update; clear answerIntent. (4) Bridge (4xx → same GET discrimination; genuinely dead → hang up both legs; the bri hangup runs T8/T17 — `ended_answered`, ~0s talk, honest). (5) Cancel all sibling legs (leg→canceling; hangup each). (6) Thread at answer (existing `threadCallSession`, best-effort). (7) Clear ring alarm; clear journal. | `call.updated` (state=answered, answered_by); `kind:'call_end'` push reason=`answered` (§9.2) |
| T3 | `call.hangup` on a `brm` leg, or a dial POST that threw with a KNOWN-dead outcome (§7.7) | state=`ringing`; leg known | leg→dead. **Avenue ladder (§5) — total, in order**: (1) any leg live (dialing/ringing/canceling) → stay. (2) `pushCapableUserIds` non-empty (after §5.5 pruning) → **stay `ringing`, hold ringback** (a ring-me can still add a leg). (3) else → explicit exhaustion → VM-ENTRY (T9). There is no fourth case — the ladder is exhaustive by construction (`wakeAttempted` is NOT part of the condition; it is a diagnostic flag and the trigger for the §5.5 settle re-check). | none (leg-level; no state change) or T9's |
| T4 | `ringMe(userId, sipUsername, noLocalLeg)` (RPC from the route, §8.4) | state=`ringing` (else return `{rang:false, state, reason:'not_ringing'}`) | **Additive — ring-me never cancels anything (§6).** Branch on the client's assertion (§6 — the assertion exists because within any time window the server CANNOT distinguish "push chasing a live INVITE" (must no-op) from "woken process holding no leg" (must dial); only the client knows which it is): **(a) `noLocalLeg` absent — pre-v3 client**: if this member has ANY live (dialing/ringing/canceling) leg — any age, any source — → NO-OP `{rang:false, reason:'live_leg'}`. An unasserted request can NEVER cancel a live leg — this kills the scenario-1 push-chase AND the slow-push (Doze, >4s) banner-flap for the entire shipped fleet in one rule. If all this member's legs are dead → proceed to (c): killed-app recovery still works for old clients on the first call — for ALIVE-process old clients only; a truly killed pre-v3 process never calls ring-me at all (§12.1 step 4's honest-fleet statement). **(b) `noLocalLeg:true` — v3 client** attests it presents no leg for this session (rule §10.1.3 makes calling ring-me *be* that attestation): debounce ONLY on a **ring_me-sourced** live leg for this member dialed within `RING_ME_DEBOUNCE_MS = 4_000` → `{rang:false, reason:'recent_leg'}` (absorbs double-push and the client retry; engine-sourced legs never debounce, so the first wake in scenarios 2 AND 3 dials on the FIRST call). **(c) dial**: record `leg:pending:{uuid}` `dialing` (source ring_me) → Telnyx dial (45s timeout, same brm tag) → re-key on ccid → ledger insert → return `{rang:true, state:'ringing'}`. **ring-me NEVER cancels a live leg — asserted or not** (review R2-B2): the attestation is **DEVICE**-scoped but legs are **MEMBER**-scoped (one durable credential per (company,user), webrtc.ts:84–127 — one engine leg forks its INVITE to ALL of the member's registered devices), so "nothing presents HERE" can never license killing a leg that is presenting a banner on the member's OTHER device (the founder's own desktop-web + Android setup — canceling would recreate scenario 1's vanish/reappear flap with fully-updated clients). The old and new legs COEXIST; superseded legs are reaped by T2/T9's exit sweeps and the per-leg 45s `timeout_secs`; devices suppress duplicate INVITEs for a session they already present (client rule §10.1.4). The fresh leg is in the machine before any other leg's death can be "last" — the voicemail race stays structurally impossible. | none |
| T5 | `call.hangup` on the inbound leg, untagged | state=`ringing` | Cancel every live leg; terminal state: `rejectedForCap` → `ended_rejected`, else `ended_missed` (covers the plain caller-gave-up case, the unattended ring-out, and the cap-reject — one deterministic row; the old T6 is merged here); terminal merge (existing `handleTerminalCallEvent` delegate: MCTB text-back, crew alert, threading, timeline — MCTB fires for the cap-reject too, D36). Clear alarms → set purge alarm. | `call.updated`; `kind:'call_end'` reason=`missed` |
| T6 | *(merged into T5 — number retained so external references stay valid)* | — | — | — |
| T7 | Winner's `brm` leg `call.hangup` | state=`answered` AND leg status=answered AND `answered_by_user_id` == leg.userId AND **no live `intent` record in DO storage** (§7.4 — the intent was registered on THIS object BEFORE the route issued any Telnyx command, so the guard can never miss an in-flight consult/transfer; reading Postgres rows here is FORBIDDEN — a row inserted by a route races this guard, review B3) | Hang up the customer leg (the #168C stranded-customer fix, now race-free: `setOwner` and `registerIntent` run on this same object, so consult/complete's stamp-before-steal ordering is *guaranteed* observed). State stays `answered`; the bri hangup runs T8. **A stood-down T7 (guard failed on a live intent) is NOT a silent no-op** (review R1-B4 — the event is edge-triggered and consumed; nothing else would ever observe the owner's death): it marks the owner leg `dead` in the leg map AND sets `ownerLegDeadDuringIntent`. `clearIntent()` and the **intent-expiry alarm** (§7.4 — a REAL alarm in the §2/§13 inventory) then **re-run this teardown** when state=`answered` ∧ owner unchanged ∧ the flag is set — a consult whose target never answers must NOT park the customer in dead air billed as talk time until they hang up or the 4h janitor (legacy's stand-down was `kind='transfer'` ONLY for exactly this reason, inbound-ring.ts:661–662/713–723: the blind-transfer flow owns its own recovery; consults have none — v3 broadened the stand-down to consult intents for review B3 and MUST carry the recovery obligation with it). | none |
| T8 | `call.hangup` on the `bri`-tagged inbound leg | state=`answered` | State→`ended_answered`; terminal merge delegate (billing from the bri anchor, journey lines, threading — unchanged code); cancel stragglers; purge alarm. | `call.updated` |
| T9 | **VM-ENTRY** (from T1a, T1d zero-avenue, T3-exhaustion, or the ALARM) | state=`ringing` or minting | Journaled (§4.1) — and the state ordering is **normative, resolving the T1a-vs-T9 wording contradiction the review caught (R1-B1)**: the reducer sets `state→voicemail_greeting` in `machine'`, which §4.1's persist-then-execute writes (with the mirror as an effect) BEFORE any Telnyx command runs — so on every VM-ENTRY path, including the direct-mint T1a/T1d/screening branches, the machine is in `voicemail_greeting` from the moment the transition is admitted; there is no "minting limbo" state the transition table lacks a row for. Effects, in order: Telnyx answer inbound with `vmi` tag. **On 4xx: DISCRIMINATE** — `GET` the inbound leg: alive/answered (our own earlier vmi answer, journal replay) → continue with speak; dead/not-found → **TERMINAL, never "stay"** (reviews R1-B1 + R1-B3: the hangup that "will arrive" is UNTAGGED — the vmi tag is attached only by the answer that just failed — and old-T5/T12/T17 had no row for an untagged hangup outside `ringing`, stranding the row outcome-null and the LINE BUSY for 4h; worse, §7.5's pre-mint drop means the hangup may never arrive at all): state→`ended_missed` (`rejectedForCap`→`ended_rejected`), cancel every live leg, terminal merge, purge alarm. On the success path: speak sanitized greeting; **cancel EVERY live leg from the DO's leg map** (exhaustive — no racy single read; a leg added later is impossible: ring-me guards on state; pending-ambiguous legs are reaped by §7.7); mirror; clear ring alarm. Even if this discrimination itself loses a window, the caller's UNTAGGED hangup is now terminal from `voicemail_greeting` via T17's extended catch-all. | `call.updated`; `kind:'call_end'` reason=`voicemail` |
| T10 | ALARM at `ringDeadlineMs` | state=`ringing` | T9. **The alarm is the ONLY clock-based voicemail trigger.** | — |
| T11 | `call.speak.ended` (vmi) | state=`voicemail_greeting` | record_start (beep, mp3, ≤120s, 15s silence stop — unchanged); state→`voicemail_recording`; mirror. | `call.updated` |
| T12 | `call.hangup` (vmi leg) | state ∈ {voicemail_greeting, voicemail_recording} | State→`ended_missed` (provisional); terminal merge (MCTB per today's missed path); purge alarm. | `call.updated` |
| T13 | `call.recording.saved` (vmi) | state ∈ {voicemail_recording, ended_missed} | Existing pipeline verbatim (hang leg, store to our bucket inside the 10-min window, stamp voicemail_path/seconds, thread, timeline event, delete Telnyx copy LAST); state→`ended_voicemail`; mirror outcome upgrade. | `call.updated` |
| T14 | Any event on an `ended_*` session | — | Dedup / state-guard no-op (except T13's upgrade edge). | — |
| T15 | Purge alarm (+15 min after terminal) | terminal state, mirror confirmed | `storage.deleteAlarm()` + `storage.deleteAll()` (deleteAll does NOT clear a pending alarm — §13); the object goes cold and free. A straggler event later finds an empty DO → adoption (§7.5) reads the ended row → drop. | — |
| T16 | Janitor alarm (started_at + 4h) | any non-terminal state | Forced resolution BY state: `ringing` → T5 semantics (`ended_missed`/`ended_rejected`); `answered` → T8 semantics (`ended_answered`, billed from the bri anchor); `voicemail_greeting`/`voicemail_recording` → **T12 semantics** (`ended_missed` provisional; a later recording.saved still upgrades via T13) — named explicitly so the §15.1 exhaustive tests have a licensed row for every state. Mirrors `api_sweep_stale_calls`, which is retained as the last-resort backstop (§7.6). | `call.updated` |
| **T17** | **`call.hangup` on the INBOUND leg — tagged OR untagged — in ANY non-terminal state not covered by T5/T8/T12** (catch-all — the guard is deliberately the complement of theirs) | state ∉ ended_*, PLUS the one upgrade exception: a `bri`-tagged inbound hangup arriving in `ended_missed` runs the §3 upgrade edge | **An inbound-leg hangup is ALWAYS terminal — the tag refines WHICH terminal, it is not the license.** (Review R1-B1 killed the tagged-only version: on the direct-VM-entry paths a caller who hangs up before T9's answer lands dies UNTAGGED — the vmi tag is attached BY the answer command that failed — and a tagged-only catch-all made that hangup a §15.1-mandated no-op, holding the line busy for 4h.) By tag: **`bri`** (we answered for a member; anchor + answeredAtIso are IN the tag) → state→`ended_answered`, terminal merge billed from the tag's anchor, `answered_by` from the retained `answerIntent` if present (else stamped unattributed + Sentry warning — an audit anomaly, never a stuck line); from `ended_missed` this is the §3 upgrade edge (re-merge as an outcome upgrade, T13-style). **`vmi`** (voicemail answered at Telnyx; the machine lost the transition) → state→`ended_missed` provisional, terminal merge (MCTB fires; a late recording.saved upgrades via T13). **Untagged** (caller died before any of our answers landed): from `voicemail_greeting`/`voicemail_recording` → `ended_missed` provisional (T12 semantics — the failed-vm-answer window); from `answered` → `ended_answered` per T8 semantics + Sentry warning (theoretically unreachable — the inbound leg always carries bri in `answered` — licensed anyway: totality beats optimism). Cancel every live leg; purge alarm. Without this row, one eviction between a successful answer and its persist leaves the calls row outcome-null FOREVER — `api_claim_inbound_line`'s busy scan then reports the line busy for 4h (review B1). §15.1 asserts this row makes inbound-hangup termination TOTAL: no (non-terminal state × inbound hangup, any tag state) pair may no-op. | `call.updated` |

Every transition is **idempotent**: Telnyx event ids are dedup-marked in DO
storage (`seen:{id}`), the edge `webhook_events` ledger already drops exact
duplicates, and every guard is a state check — a replay that passes dedup
still no-ops on the guard, EXCEPT that a seen-marked event whose journal
entry is unfinished resumes the journal instead of no-oping (§4.1).

### 4.1 Serialization & crash/replay consistency (normative — the DO shell contract)

Two platform facts this design must not hand-wave, and the protocol that
handles them. **An implementation that skips either reintroduces the
founder's races.**

**Fact 1 — input gates do NOT serialize across Telnyx fetches.** Cloudflare
input gates close only during *storage* awaits. While a transition awaits a
Telnyx REST call (~200–800ms), the runtime WILL deliver the next
webhook/RPC/alarm into the same object and interleave it — e.g. a member
answer at t+44.9s awaiting its answer POST when the t+45.0 ring alarm is
delivered mid-await: the alarm sees `state===ringing` (T2 hasn't written
yet) and runs T9, answering the caller into voicemail and canceling the
answering member's leg — the exact scenario-1 class this redesign exists to
kill (and the same interleaving breaks T2-vs-T5 and T2-vs-T4).

**Therefore: one explicit per-object FIFO.** Every entrypoint —
`onTelnyxEvent`, `ringMe`, `setOwner`, `registerIntent`, `clearIntent`,
`snapshot`, `alarm` — enqueues its ENTIRE body (including all Telnyx
fetches and Postgres mirrors) on a single promise-chain mutex
(`this.queue = this.queue.then(run)` with error isolation). A transition
runs to completion before the next event is admitted. `snapshot()` rides
the same queue — that is what makes its read-your-writes promise true.
(`ctx.blockConcurrencyWhile` is not used for transitions: it blocks even
reads globally and does not compose with the journal-resume rule below.)

**Fact 2 — the isolate can be evicted between any two awaits.** A
transition that has issued a Telnyx command but not yet persisted its
outcome can vanish; the 5-minute sweeper then replays the event into a
restarted DO (the edge `processed_at` stamp only lands after
`onTelnyxEvent` returns — telnyx.ts:72–92). A naive replay re-issues the
command, gets a 4xx (Telnyx already did it), and misdiagnoses "the caller
died" — hanging up a viable answering member and stranding the row
outcome-null (review B1's full sequence). The protocol:

1. **Persist-then-execute.** Admit the event under the FIFO; dedup-check;
   run the pure reducer → `{machine', effects[]}`; **atomically persist
   `{machine', journal:{eventId, pendingEffects, cursor:0}, seen:{eventId}}`
   in ONE storage batch** (input gates + write coalescing make the batch
   atomic); only then execute effects in order, advancing the persisted
   `cursor` after each; clear the journal when done. Arm a short
   **journal-resume alarm (+2s)** as part of every journal persist (cleared
   with the journal) so a crash with no follow-on event still resumes
   promptly — DO alarms survive eviction.
2. **Resume-on-admission.** The first admission after a restart (any event,
   RPC, or the resume alarm) checks for an unfinished journal and completes
   it BEFORE processing the new work. A seen-marked event with an
   unfinished journal for that id resumes; a seen-marked event with no
   journal no-ops (true duplicate).
3. **Effect idempotency + 4xx cause discrimination.** Re-executed effects
   must be safe: hangup/cancel/speak/record 4xxs are swallowed as today
   (dead leg = done); mirror writes are idempotent updates; push re-sends
   collapse (same collapse key). **answer and bridge are special**: on 4xx
   the executor issues `GET /v2/calls/{ccid}` — leg alive/answered → OUR
   earlier command succeeded (replay) → treat as success; leg dead/absent →
   the counterparty is really gone → the failure branch (T2.2/T9). This
   GET-on-4xx is the DO-era re-creation of legacy's durable 'already'
   verdict (inbound-ring.ts:477–500) — the one defense that made legacy
   survive exactly this window. **dial is special the other way**: it is
   not idempotent (a re-POST creates a second leg). A journaled dial
   re-executes with a FRESH pending uuid; if the first attempt did reach
   Telnyx, the duplicate leg announces itself via its brm-tagged webhooks
   and is adopted-then-reaped per §7.7 (bounded additionally by the leg's
   own 45s `timeout_secs`, which is load-bearing for exactly this case).
4. **The catch-all backstop — stated honestly.** If every layer above still
   loses a window, T17 guarantees the session terminates the moment the
   caller's leg-death event is ADMITTED (tagged or untagged). That is
   deliberately weaker than "the moment the caller hangs up": a hangup whose
   delivery died pre-mint can be permanently stamp-dropped (§7.5 — review
   R1-B3 proved the ordering exists), so no event-driven rule can promise
   termination on the caller's clock. The properties that DO hold: (a) every
   ADMITTED inbound hangup is terminal (T17 totality); (b) every answer
   attempt against a dead caller is terminal (T2/T9 discrimination
   branches) — so a session whose caller is gone survives at most until its
   own next answer attempt (the 45s alarm at the latest), never to the 4h
   janitor.

The pure reducer (§15.1) stays I/O-free: effect OUTCOMES that change state
(answer success/failure, fan-out settled) re-enter it as internal events
under the same FIFO, so the reducer remains exhaustively testable and the
shell owns exactly {queue, journal, effect execution, discrimination}.

---

## 5. Ring-window integrity (the founder's core demand)

`RING_WINDOW_SECS = 45`. Set as a DO alarm at RING-START. Rules:

1. **Leg death NEVER starts voicemail while an avenue remains.** An avenue is:
   a live (dialing/ringing) leg, OR a push-capable device (any member in
   `pushCapableUserIds`) that could still ring-me into the session.
2. **The alarm is the only clock-based trigger.** No elapsed-time check
   anywhere else may start voicemail.
3. **Explicit exhaustion may end early**: zero live legs AND
   `pushCapableUserIds` empty (after §5.5 pruning). This is the only
   pre-alarm voicemail from the ringing state — e.g. a company with one
   member, no push channels, whose browser leg dies at t+2s: holding
   ringback for 43 more seconds would be dishonest, nothing can ring. The
   degenerate case is checked at RING-START itself (T1d): zero targets AND
   zero push audience → voicemail immediately, never a 45s ring to an empty
   room.
4. **Zero-registration calls hold ringback**: no telephony credentials at
   RING-START → dial nothing, push immediately (the push audience is computed
   from #106 eligibility + push channels, NOT credentials — a member who has
   never opened the softphone still gets woken), set the alarm, stay
   `ringing`. A woken device's ring-me dials the first leg. Scenario 2
   becomes: phone rings via push → tap → app opens → ring-me → INVITE →
   answer — with the caller hearing ringback the whole time, up to 45s.
   The audience is #106 eligibility + push channels **+ the #146
   `notification_prefs.push_enabled` filter** (T1d — same filter the
   delivery delegate applies; computing the audience without it counts
   members who can never be woken and holds dishonest ringback, review
   R2-I1).
5. **Avenues don't expire on a clock — but provably dead channels are
   pruned.** A *delivered* push never "expires" mid-window: we deliberately
   do NOT decide "that woken device had its chance" — the alarm decides.
   But a push channel that HARD-fails (FCM 404/UNREGISTERED, web-push
   404/410 — the existing `gone` signal, fcm.ts:327–329 / the Web Push
   prune) is provably dead, not merely slow: the token row is pruned (as
   today) AND the channel is removed from the session's audience; a member
   with zero remaining channels leaves `pushCapableUserIds`. When the
   fan-out settles it re-enters the DO as the internal
   `push-fanout-settled` event (sets `wakeAttempted`), which **re-runs the
   T3 avenue ladder** — a company whose only member uninstalled the app
   reaches voicemail seconds after RING-START, not at t+45 (holding 45s of
   ringback to provably nobody is the same dishonesty rule 3 forbids).
   **The settle must survive eviction** (review R1-I4: a detached fan-out
   whose isolate dies mid-send loses the settle forever — pruning never
   runs and the ladder holds ringback for a provably-uninstalled audience
   until t+45): the fan-out is a JOURNALED effect (T1d) whose execution
   dispatches the sends and arms a **`fanout-settle` alarm (+10s)**; the
   real settle clears the alarm; if the alarm fires first (eviction, hung
   fan-out) it recomputes the audience from the current token/pref rows and
   synthesizes the settle — the ladder re-check is guaranteed to run, once,
   within ~10s of RING-START. **Contract change owned here** (it contradicts
   a naive "no delegate changes" reading of §7.3): `notifyIncomingCall`
   gains a per-user delivery-outcome report (sent / hard-failed / skipped-
   by-pref) — without it the DO cannot prune, and §5.5 is dead code.

`Telnyx timeout_secs` on member legs stays 45 as a leg-level bound. It is
not load-bearing for the ring window (leg timeouts just run T3) — but it IS
the bound on §7.7's ambiguous-dial orphans, so it must not be raised.

---

## 6. ring-me v2 — additive, atomic, and asserted

Server side (T4, all inside the DO):

- **Never cancel — at all.** The fresh leg exists in the machine (a pending
  record, status `dialing`) before any Telnyx command is issued, and ring-me
  issues **no hangup on any leg, ever** (review R2-B2). The original v3
  draft let an asserted request cancel the asserter's "own" older legs — but
  the attestation is DEVICE-scoped while legs are MEMBER-scoped: one durable
  credential per (company,user) (webrtc.ts:84–127) forks every engine leg's
  INVITE to ALL of the member's registered devices, so a woken phone that
  truthfully holds no leg can never prove the member's desktop isn't
  presenting that same leg's banner right now. Old and new legs coexist;
  T2/T9's exit sweeps and the per-leg 45s timeout reap the losers; §10.1.4
  keeps a device from double-presenting. The scenario-1 voicemail race stays
  structurally impossible: the "am I last?" question is answered by the DO's
  own leg map, which already contains the new leg.
- **The `no_local_leg` assertion (v2 wire change).** The request body gains
  `no_local_leg: boolean`. v3 clients ALWAYS send `true` — by client rule
  §10.1.3 they only call ring-me when holding no live leg, so the call *is*
  the attestation. This field exists because no server-side clock can
  distinguish scenario 1 (push chasing a live INVITE — must no-op) from
  scenario 3 (v3 wake holding no leg while a frozen INVITE sits in a dead
  socket — must dial): the deciding fact lives only on the device. What the
  assertion licenses is exactly one thing: **dialing a fresh leg DESPITE
  the member having a live one** (the unasserted path refuses that). It
  licenses no cancel — see above.
- **Unasserted requests (the entire pre-v3 fleet) can never cancel a live
  leg**: any live leg for the member, any age → `{rang:false,
  reason:'live_leg'}`. This kills scenario 1's push-chase AND the
  slow-push (Doze, push >4s behind the dial) flap outright — no shipped
  build can reproduce the founder's banner-vanish. With all the member's
  legs dead, an unasserted request still dials (killed-app recovery on the
  first call for old clients).
- **Debounce, not window-gate**: `RING_ME_DEBOUNCE_MS = 4_000` no-ops an
  asserted request only against a live **ring_me-sourced** leg for the same
  member (absorbs double-push and the retry-once). Engine-dialed legs never
  debounce an asserted request — that is what lets scenarios 2 and 3 dial
  on the FIRST ring-me (§14).
- The route (§8.4) keeps ALL auth exactly as today (member JWT, company
  scope, direction=inbound, #106 'text' via assertNumberLevel, requester
  credential/eligibility) — the DO trusts its callers on identity and owns
  only sequencing/state.
- The #168 "ledger says the ring is over" 409 gate is deleted — the DO's
  state guard (`state === 'ringing'`) replaces it with a truthful 200 body.

Client side (§10.2): ring-me is called ONLY when the client has no live leg
for the session — calling it (with `no_local_leg:true`) *is* the assertion
"nothing is presenting on THIS DEVICE," which is what licenses dialing a
fresh leg while an engine leg is still live somewhere.

---

## 7. The Durable Object interface

### 7.1 Class surface (Workers RPC)

```ts
export class CallSessionDO extends DurableObject<Env> {
  // Webhook router: every inbound-family call.* event for this session.
  async onTelnyxEvent(event: TelnyxEvent): Promise<void>;

  // POST /v1/calls/live/:session/ring-me (route has already authorized).
  async ringMe(input: {
    userId: string; sipUsername: string; noLocalLeg: boolean;
  }): Promise<{ rang: boolean; state: CallState; reason?: "not_ringing" | "live_leg" | "recent_leg" | "dial_failed" }>;

  // GET /v1/calls/live/:session/state — freshest machine view (read-your-writes:
  // rides the §4.1 FIFO behind any in-flight transition). Null = purged/never
  // existed → the route falls back to deriving from the calls row (§8.3).
  async snapshot(): Promise<SessionSnapshot | null>;

  // consult/complete stamps the new owner BEFORE the bridge-steal (D43 #168
  // ordering) — now serialized against T7 on the same object.
  async setOwner(input: { userId: string }): Promise<void>;

  // Transfer/consult INITIATION registers its intent HERE, BEFORE the route
  // issues any Telnyx command (§7.4) — T7's stand-down guard reads only this.
  // Returns the machine state: the route MUST abort (and dial nothing) unless
  // it is 'answered' — requireLiveCall's check can pass and T5/T8 land before
  // this call, and an intent recorded on an ended session would ring a
  // teammate for a dead call (review R1-m3).
  async registerIntent(input: { kind: "transfer" | "consult"; targetUserId: string }): Promise<{ state: CallState }>;
  async clearIntent(): Promise<void>;

  // Ring window / journal-resume / retry / janitor / purge.
  async alarm(): Promise<void>;
}
```

All entrypoints run under the §4.1 FIFO. `SessionSnapshot = { state,
answered_by_user_id, answered_at, started_at, caller_e164, phone_number_id,
legs: [{ call_control_id, user_id, status }] }`.

### 7.2 Webhook routing cutover

`handleCallEvent` (voice-webhook.ts) becomes a thin router for the inbound
family:

- Extract the session key: `parseMemberRingState(client_state)?.sessionId`
  (brm legs — their `payload.call_session_id` is the MEMBER leg's session,
  never usable) else `payload.call_session_id` (initiated / untagged inbound /
  bri / vmi / transfer / consult legs).
- Forgery posture (unchanged, now stronger), with the leg-map rule scoped
  precisely: the DO accepts an event only if its machine (or the adopted
  calls row) exists AND — **for `brm` leg events only** — the ccid is in
  its leg map **or adopts onto an existing pending/ambiguous record per
  §7.7 (never minted from the tag alone)**.
  `brc`/`brt` (consult/transfer) legs are dialed by the REST routes and by
  Telnyx's transfer command, so their ccids are structurally unknowable to
  the DO at dial time (a brt leg's ccid materializes only in its first
  webhook) — they keep the FULL D43 gates instead (nonce where applicable +
  calls-row proof + the kind='consult'/'transfer' ledger-row verification
  inside the delegates), now executed under the DO's FIFO. Requiring
  brc/brt ccids in the leg map would drop every consult/transfer leg event
  and strand customers on hold — the #168C class (review R2-B3).
- A forged brm tag naming a random session hits an empty DO → adoption finds
  no calls row → drop. A forged tag naming a REAL session presents a ccid
  with no pending/ambiguous record for the tag's userId → §7.7 defensively
  hangs it up + Sentry — it can never enter T2 (the tag is client-mintable
  via the outbound SDK path, calls.ts:407–408, so signature + tag are NOT
  proof of provenance; the leg-map/pending-record requirement is the
  forgery gate, review R2-B3). The D43 calls-row-exists gate for
  bri/vmi/untagged legs is preserved inside adoption.
- Outbound legs (`oc_agent`/`oc_customer`, and the dead legacy `forward`
  classification) keep the existing non-DO path verbatim.
- **Dispatch contract for inbound-family call.* events (changed from
  ACK-then-waitUntil — review R1-I1):** the edge AWAITS `stub.onTelnyxEvent`
  **in the request path**, stamps `processed_at`, and only then returns the
  200 — and `onTelnyxEvent` returns at ADMISSION (the §4.1 step-1 atomic
  persist), not after effect execution (the journal-resume alarm guarantees
  effects complete even if the object is evicted the instant after
  admission). Why: with pure ACK-then-waitUntil, an isolate death between
  edge insert and DO admission leaves the event to the ≥2-min sweeper — for
  a `call.answered` that means the t+45 alarm voicemails the caller and
  cancels a member who answered in good faith. Awaiting admission converts
  that loss back into Telnyx's own fast retry ladder (no ACK → redelivery in
  seconds). Companion rule at the edge: a duplicate POST whose ledger row is
  still **UNSTAMPED re-dispatches** (awaits admission again — DO dedup makes
  double-admission a no-op) instead of pure-acking `{duplicate:true}`
  forever (telnyx.ts:67–69 today). Admission latency is bounded by the T1d
  parallel-dial rule + the queue-latency Sentry signal; if the edge times
  out anyway, Telnyx's retry meets the unstamped-redispatch rule. Non-call
  events keep ACK-then-waitUntil verbatim. The 5-minute sweeper replay stays
  as the LAST layer: it re-enters the DO and no-ops on dedup/guards (or
  resumes an unfinished journal, §4.1).

### 7.3 Effects run FROM the DO

The DO issues Telnyx commands and calls the existing pure-function delegates
(`threadCallSession`, terminal merge, MCTB, voicemail storage pipeline,
`notifyIncomingCall`) with `env` + a service-role db client. Delegate logic
is unchanged with ONE owned exception: `notifyIncomingCall` gains the §5.5
per-user delivery-outcome report (sent / hard-failed / skipped-by-pref) —
the DO's pruning cannot exist without it. Everything else changes only in
that it is now invoked from a serialized context, with state guards proven
before entry.

### 7.4 Transfer / consult re-serialization

The REST routes keep their D43 logic and gates, with three changes:

- **Intent enters the DO before any external command** (review B3 — this is
  the same non-atomicity class as §1 defect 1, and "read serialized" does
  not fix it: serializing the READ of an intent row does nothing when the
  WRITER is an un-serialized route whose insert may not have committed when
  T7's guard runs; today the consult route even dials BOTH legs before its
  ledger insert, live-calls.ts:415–472). Sequence, binding: the route
  validates → `stub.registerIntent({kind, targetUserId})` (persisted on the
  object, FIFO-serialized; returns `{state}` — the route aborts and dials
  NOTHING unless it is `answered`, review R1-m3) → only then dials/issues
  the transfer → on dial failure or `/consult/cancel` → `stub.clearIntent()`.
  **Intent expiry is a real alarm** (`TRANSFER_TIMEOUT_SECS + 15s`, in the
  §2/§13 alarm inventory — review R1-B4 caught the original as an
  unenforced assertion: no alarm existed, so "a leaked intent delays T7 only
  briefly" was a wish). Both `clearIntent()` AND the expiry alarm run the
  §4-T7 stood-down-recovery check: if state=`answered` ∧ owner unchanged ∧
  `ownerLegDeadDuringIntent` → execute T7's teardown NOW (the owner died
  while the intent was live and the stand-down consumed the only event that
  would ever have observed it; without this re-run the customer sits in
  dead air billed as talk time until their own hangup or the 4h janitor).
  The delegates that complete/cancel the transfer or consult (running under
  the DO's FIFO per §7.2) clear it on their terminal edges — and clearing
  triggers the same check.
- `consult/complete` calls `stub.setOwner({userId: target})` instead of
  writing `answered_by_user_id` directly (the DO mirrors it) — the
  stamp-before-steal ordering is now enforced by object serialization, not by
  hoping the webhook loses a race.
- brm/brc/brt leg webhook events route through `onTelnyxEvent`, which
  delegates consult/transfer leg handling to the existing functions —
  serialized with T7, closing the transfer-vs-winner-death races the same
  way. (brc/brt forgery gates per §7.2 — the leg map is brm-only.)

T7's stand-down guard reads ONLY the DO's own `intent` record — never
Postgres. Transfer-leg guards (`requireLiveCall`'s answered-only rule) now
read `state === 'answered'`.

### 7.5 Adoption (empty DO, live session)

First event/RPC for a session with no `machine` in storage:

1. **`call.initiated` is exempt** — it is the event that MINTS the row
   (T1 runs `api_claim_inbound_line`); adoption's no-row-drop rule would
   otherwise drop the first event of every call. Any OTHER event: read the
   calls row (+ `call_member_legs`). No row → forged/unknown → drop
   (webhook) or 404 (route) — with ONE stamping exception (review R1-B3):
   a no-row drop of an inbound-family **`call.hangup`** returns WITHOUT
   stamping `processed_at`, so the sweeper can replay it against a machine
   a delayed `call.initiated` retry mints minutes later (the permanent
   stamp-drop is what turned a pre-mint hangup into a 45s ghost ring; the
   sweeper's 5-attempt cap bounds genuinely-forged junk). All other no-row
   drops stamp as today.
2. `outcome` set → reconstruct the matching `ended_*` state; process the
   event through T13/T14 semantics (late recording upgrade still works).
3. Live row → reconstruct by inspecting BOTH the row and the triggering
   event (the row alone cannot represent an in-flight legacy voicemail —
   phase-1 defect 4 bites the migration itself, review R2-B2):
   - triggering event is **vmi-family** (speak.ended / hangup /
     recording.saved with the vmi tag, verified against the D43 calls-row
     gate) → the session IS in voicemail regardless of what the row says:
     reconstruct `voicemail_greeting` (speak.ended pending) or
     `voicemail_recording` (recording.saved / hangup) and process through
     T11/T12/T13 — an in-flight legacy voicemail at cutover keeps its
     recording, threads it, and fires MCTB on time instead of being adopted
     as `ringing` and dropped;
   - triggering event is a **bri-tagged hangup** with `answered_at` null →
     T17 (the tag is the proof);
   - `answered_at` set → `answered`;
   - else → `ringing` with legs from the ledger, `ringDeadlineMs =
     started_at + 45s` (if already past, run the alarm logic on the next
     tick — a deliberate, cutover-only behavior change worth naming: legacy
     had NO window, so a legacy ring already past 45s at adoption goes to
     voicemail immediately even though a legacy-dialed leg may still be
     live-ringing; T9's exhaustive cancel sweep reaps that leg, and the
     class self-extinguishes with the pre-v3 fleet), push audience
     recomputed. Legacy legs whose ledger insert was still in flight at
     cutover (deferred behind the push await, inbound-ring.ts:287→300) are
     absent here — they announce themselves via their brm-tagged events and
     are adopted per §7.7.
4. Persist with the **`adopted` flag set** (it scopes §7.7's ledger-less
   orphan minting to cutover machines — nothing else may mint a leg from a
   tag alone) and continue with the triggering event.

This one mechanism covers the deploy cutover (calls in flight when v3 ships),
every kill-switch flip-back (§12.4), post-purge stragglers, and any storage
loss — no special deploy choreography.

### 7.6 The two non-DO writers, named

`calls.state` is written only by DO transitions, with exactly two documented
backstops (both idle in a healthy system):

- `api_sweep_stale_calls` (the 4h cron) also stamps
  `state = 'ended_missed'` where it flips outcome — a dead-DO last resort;
  the DO's own T16 janitor fires first at 4h. (It stamps outbound stale rows
  with the same inbound-vocabulary label — consistent with today's outcome
  flip and purely cosmetic; noted so nobody "fixes" it into a new enum.)
- The v3 **migration backfill** (§12) stamps historical rows once.

### 7.7 Orphan legs — ambiguous dials, unknown ccids, cutover legs

The class (review B4): a dial whose POST threw or timed out may STILL have
created a ringing leg at Telnyx; a legacy leg at cutover may exist with no
ledger row; a §4.1 journal-replayed dial may have a live predecessor. All of
these are legs the machine did not (yet) know — they must be neither
uncancellable (phone keeps ringing into a voicemail-owned call — the
scenario-1 relapse) nor unanswerable (member answers into dead air, the
legacy 'lost'-verdict cruelty).

Rules, normative:

1. **Pending-key discipline** (§2.2): every dial records `leg:pending:{uuid}`
   BEFORE the POST; the record is re-keyed to `leg:{ccid}` when the POST
   returns. A POST that returns a definite Telnyx error → the pending record
   dies (T3's "dial threw" trigger). A POST that threw
   ambiguously (network timeout / 5xx-after-create) → the record becomes
   status `ambiguous` — counted as NOT live for the T3 avenue ladder (it
   must not hold ringback open) but retained for reconciliation.
2. **Orphan brm events — adopt onto a RECORD, never mint from the tag.**
   The original v3 rule called these "self-authenticating" on the premise
   that "client_state is only ever attached by our own API commands; no
   third party can mint one." **That premise is FALSE against our own
   repo** (review R2-B3): `POST /v1/calls/browser` has the CLIENT stamp
   `client_state` on `newCall` (calls.ts:407–408), and the outbound nonce
   exists precisely because forged/omitted client_state is a live threat
   (calls.ts:434). Any credential-holding member can `newCall` with
   `brm|<victim-session>|<their-user-id>`; Telnyx signs the resulting
   webhooks — signature + tag prove NOTHING about who dialed the leg. A
   tag-minting adoption rule therefore hands a hostile/compromised member
   call interception: forge the tag on a dial to their own cell, let the
   "orphan answer" run T2, and the caller is bridged to the attacker with
   `answered_by` stamped to them, bypassing #106 dial-target filtering —
   strictly WEAKER than legacy's ledgered-ccid 'lost'-verdict gate, which
   was the actual anti-forgery defense. Binding rules:
   - **Adoption requires an existing `leg:pending:*`/`ambiguous` record for
     the tag's userId** (state=`ringing`): attach the ccid to that record,
     then process the event normally — this covers the REAL B4 targets
     (ambiguous dials, §4.1 journal-replay duplicate dials: both persist a
     pending record before any POST), and an orphan `call.answered` on such
     a record is a genuine member answer that runs T2 and connects the call
     (hanging up a real answering member would re-create the audit's
     condemned 'lost'-hangup, see §16.1).
   - **Ledger-less minting is confined to `adopted` (legacy-cutover)
     machines** (§7.5.4), and even there the tag's userId must be an
     ACTIVE member of the session's company holding a telephony credential
     AND #106-'text'-eligible on the session's number — the same gate T1d's
     dial targets pass.
   - **Anything else — no matching record, non-adopted machine — is a
     defensive hangup** of that ccid (best-effort, 4xx-swallowed), plus a
     Sentry warning naming the tag's userId (a forged tag is a security
     event, not noise). Never a state change, never a T2 entry.
   - Any non-`ringing` state: **defensive hangup** as before — the session
     has no use for the leg; this also reaps ambiguous-dial orphans and
     journal-replay duplicates; the leg's own 45s `timeout_secs` is the
     outer bound if even the hangup is lost.
3. **Cutover legs** are case 2 verbatim: a legacy-dialed leg whose ledger
   insert was in flight when v3 adopted the session announces itself with
   its first brm event and is adopted (ringing) or hung up (otherwise). No
   separate mechanism.

---

## 8. HTTP contracts — every calls endpoint, no overloaded codes

Envelope unchanged: errors are `{error:{code,message}}`; codes keep their
HTTP mappings (packages/shared/src/error-codes.ts). The rule that changes:
**state is never encoded in an error code.** 4xx now means only "you can't
see this" (404), "you asked wrong" (422), or "this verb doesn't apply and the
body says why" (transfer family, unchanged). The state read always 200s.

### 8.1 `GET /v1/calls/live/:sessionId/state` — NEW (the one state read)

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ call_session_id, state, direction, started_at, answered_at, answered_by_user_id, caller_e164, caller_name, conversation_id, phone_number_id, outcome, your_leg: { call_control_id, status } \| null }` | The session, in any state, live or ended. `your_leg` is the caller's own leg from the DO snapshot (null when none / purged). |
| 404 | not_found | No such session, another company, or the number is #106-hidden from this member (hidden ≠ 403 — no enumeration, unchanged posture). |
| 401/403 | auth envelope | Standard auth/role failures only. |

Implementation: route authorizes from the calls row (company + #106), then
`stub.snapshot()`; if the DO returns null (purged/legacy), state is derived
from the row (`outcome` → `ended_*`; `answered_at` → `answered`; else
`ringing`). **Kill-switch mode bypasses the DO entirely**: when
`CALLS_V3_LEGACY=1` the route goes STRAIGHT to row derivation and never
calls `snapshot()` — a DO still holding pre-flip state would otherwise serve
a stale snapshot forever while the legacy handlers advance the call (review
X1). Row derivation is explicitly DEGRADED truth (it cannot represent
voicemail-in-progress — that is phase-1 defect 4, unavoidable without the
DO writing the state column): client authors must treat legacy-mode `/state`
as "v2-grade", which is still strictly better than the 4xx inference it
replaces. Clients poll this at most on push receipt, on INVITE, and on
reconnect — steady-state updates arrive via realtime (§9.1).

### 8.2 `GET /v1/calls/live/:sessionId` — LEGACY, semantics frozen

Kept byte-for-byte as today (200 only when answered-and-controllable; 404;
409 "isn't live"/"can't be controlled") because shipped Android builds map
**HTTP 200 → ANSWERED → kill the ring** in StaleRing. Changing this endpoint
would make old clients kill live rings. New clients never call it; it is
removed when the pre-v3 fleet is gone. (Web's call bar may keep using it —
it only calls post-answer.)

### 8.3 `POST /v1/calls/live/:sessionId/ring-me` — v2 semantics

Request body gains `no_local_leg?: boolean` (§6). Absent = pre-v3 client.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok: true, rang: boolean, state, reason? }` | Always for an authorized request. `rang:true` = a fresh leg was dialed — an INVITE is coming. `rang:false` + `state` = why not: `not_ringing` (state is anything but `ringing` — including voicemail states, finally distinguishable), `live_leg` (unasserted request while a live leg exists — pre-v3 protection, §6), `recent_leg` (asserted-request debounce, §6), `dial_failed` (Telnyx refused; retryable). `ok:true` is retained so pre-v3 clients' decoder never breaks. |
| 404 | not_found | No session / other company / #106-hidden. |
| 409 | conflict | ONLY: direction ≠ inbound ("This call can't be rung" — outbound-probe defense #139, unchanged) and requester ineligibility ("Your device can't take calls yet." — no credential/eligibility). Both are properties of the REQUEST, not session state. |
| 422 | validation_failed | Malformed. |

Old-client compatibility: pre-v3 Android swallows 409/404 silently and
ignores the body — every new response shape (including the new `reason`
values) degrades safely for it.

### 8.4 Unchanged endpoints (enumerated so the cutover is total)

| Endpoint | Change |
|---|---|
| `GET /v1/calls/live/mine` | Shape unchanged; each row gains `state` (nullable — §3). |
| `GET /v1/calls/live/by-leg/:legCcid` | Contract unchanged (200 `{call_session_id}` / 404). The not-yet-ledgered window shrinks from "seconds behind a push await" to "one Postgres insert inside the dial handler" — the client's existing 6× backoff more than covers it. |
| `GET /v1/calls` | `api_list_calls` gains `state` in its projection (additive, nullable — §3). |
| `POST .../transfer`, `/consult`, `/consult/complete`, `/consult/cancel`, `GET .../targets` | Status/body contracts unchanged; guards now read `state==='answered'`; intent registration precedes any Telnyx command (§7.4); owner stamps go through `setOwner` (§7.4). |
| `POST /v1/calls/browser`, `POST /v1/webrtc/token` | Untouched (outbound + credentials out of scope). |

### 8.5 Web-visible contract changes (complete list)

1. New `/state` endpoint (web should adopt it for any ringing-phase UI; the
   legacy read keeps working for the post-answer call bar).
2. ring-me request gains `no_local_leg` (web sends `true` under the same
   §10.1.3 rule); response gains fields (web ignores the body today — safe);
   its "not ringing anymore" case moves from 409 to 200 `{rang:false}` (web
   swallowed the 409 — safe).
3. Realtime `call.updated` payload gains fields (§9.1) — additive.
4. New push kind `call_end` (§9.2) — **unknown kinds are NOT ignored by the
   web SW**: sw.js renders EVERY push ("a subscribed push should never be
   silently dropped", sw.js:52), and an unknown kind would render a generic
   "You have a new message." under tag `loonext:${url}` ≠ the ring alert's
   `loonext:call:<session>` (sw.js:87/102–108) — a stray notification that
   dismisses nothing. Hence §9.2's two binding rules: the sw.js `call_end`
   handler ships in the SAME deploy as the server change, and delivery is
   capability-gated so no un-updated subscription ever receives one.

Nothing else about the web softphone's wire surface moves.

---

## 9. Realtime and push

### 9.1 `call.updated` broadcast

The existing Postgres trigger (company topic) fires on every calls-row write —
i.e. on every DO mirror. Payload extended (additive):

```json
{ "call_id": "...", "conversation_id": "...", "call_session_id": "...",
  "state": "answered", "answered_by_user_id": "..." }
```

Still no PII (no caller number — clients refetch details, D44 rule bent only
for the state string + ids, deliberately: state changes are exactly the thing
clients must not have to poll for). Every transition broadcasts because every
transition mirrors. Note (review R2-m5): broadcasting `call_session_id` on
the company topic discloses live session ids to ALL members, including
#106-hidden ones — acceptable ONLY because the §7.7 pending-record gate
means a session id alone buys an attacker nothing (the `/state` and ring-me
routes keep their #106 404s); if §7.7 is ever weakened, this payload
extension must be revisited first.

### 9.2 Push

- `kind:'call'` wake push: unchanged payload; **TTL 45s** (was 30 — it must
  outlive the ring window, not undercut it). Fan-out from the DO at
  RING-START; audience per §5.4; hard-failure pruning + settle re-check per
  §5.5.
- **NEW `kind:'call_end'`** revocation push on every exit from `ringing`
  (answered / voicemail / missed); body carries
  `{url:"/calls?call=<session>", reason}`. Kills the "tray rings a dead call
  for 30s" ghost (scenario 2's second act). Best-effort like all push.
  **Dismissal mechanics, stated against the real code (review R2-B1 — the
  draft's two compat premises were both false):**
  - **Android**: FCM sends are DATA-ONLY and carry NO collapse key
    (fcm.ts:225 "takes no collapse key"; collapseId maps to
    apns-collapse-id ONLY, fcm.ts:260–263) — tray replacement is 100%
    client-side, keyed on the notification tag. The ONLY Android dismissal
    mechanism is the v3 client's explicit cancel-by-tag (`call:<session>`,
    §10.2). A pre-v3 client would parse `call_end` as a generic
    `notice:<url>`-tagged MESSAGES notification (PushPayload.kt:120–128 →
    LoonextMessagingService tray path) — a stray "new notification" on
    every call, fleet-wide, while the ring alert survives.
  - **Web**: sw.js renders every push (§8.5.4) — a pre-update SW shows a
    stray generic notification and dismisses nothing.
  - **Therefore delivery is capability-gated**: `device_push_tokens` /
    `push_subscriptions` rows gain a `caps` field (e.g. `["call_end"]`)
    written by the v3 client at token/subscription registration; the DO
    sends `call_end` ONLY to rows declaring the capability. The sw.js
    `call_end` handler ships in the SAME deploy as the server (SW
    soft-updates within ~a day; until a browser updates, its subscription
    row lacks the cap and receives nothing). iOS (future) may additionally
    use apns-collapse-id, which genuinely replaces in Notification Center —
    Android must never be claimed to.
- Android tray timeout aligns to 45s (LoonextMessagingService's 30s constant
  and its wrong "server ring window is ~30s" comment are corrected).

---

## 10. Client protocol

### 10.1 The three rules (both platforms)

1. **Present from facts**: an INVITE presents immediately (fast path,
   unchanged); state reads (`/state`) and `call.updated` events reconcile
   presentation. No heuristic probes — **StaleRing.kt and the probe plumbing
   in SoftphoneCore are deleted.**
2. **Never hang up a leg for staleness.** The server cancels stale legs on
   every exit from `ringing` (T2/T9's exhaustive cancels), so a late INVITE
   is followed by a server BYE within moments; the client's only teardown
   triggers are the user (decline/hangup) and SDK/telecom events. If state
   says a presenting session isn't `ringing`, the client may *stop
   presenting* (silence UI) while it waits for the BYE — it never sends one.
3. **ring-me only when holding no live leg for the session** (and never as a
   reflex to a push while an INVITE is ringing). v3 clients therefore always
   send `no_local_leg: true` — the call itself is the attestation (§6).
4. **One presentation per session per device** (new — the flip side of §6's
   no-cancel rule): legs coexist and one shared credential forks every
   INVITE to all of a member's devices, so a device may receive a second
   INVITE for a session it already presents (or has active). It HOLDS that
   INVITE silent — no UI, no ringtone, and **no signaling** (a decline on a
   forked leg is not provably scoped to this device) — and promotes it to
   presentation only if the currently-presented leg dies while `/state`
   still says `ringing`. Superseded legs are the server's to reap (T2/T9
   sweeps, 45s leg timeout).

### 10.2 Android (the concrete fixes this doc mandates)

- On `kind:'call'` push: if any local call is RINGING or ACTIVE whose caller
  matches the push hint (or any live leg exists at all for a solo-session
  situation), do nothing — the INVITE path owns presentation. Else
  `GET /state`; if `state === 'ringing'` → ring-me (`no_local_leg:true`) →
  present on the INVITE. If ring-me acks `rang:false` (`recent_leg`) and no
  INVITE arrives within ~4s, one retry is legal (it will pass the debounce
  if the ring_me leg truly died).
- On `kind:'call_end'` push: **explicitly cancel the tray notification by
  tag `call:<session>`** — this client-side cancel is the ONLY dismissal
  mechanism on Android (data-only FCM carries no collapse key, §9.2; there
  is no OS-side replacement to fall back on). The client also declares the
  `call_end` capability when registering its push token (§9.2's delivery
  gate).
- **Cold process**: `LoonextApp.onCreate` (or the messaging service itself)
  must install a call-wake path that works without UI — construct
  `SoftphoneManager` from the application context on a call push so
  `PushHooks.callWakeHandler` is never null in an FCM-woken process; and
  `parseDeepLink` must carry `?call=<session>` into `DeepLink.Calls` so the
  notification tap lands in ring-me. (Both were scenario-2 dead ends.)
- **One wake handler**: MainActivity's overwrite of SoftphoneManager's
  hardened handler is removed — SoftphoneManager's install (retry-once +
  tray fallback) is the only one.
- Answer flow, by-leg resolution, telecom/CallStyle presentation: unchanged.
- The 30s tray timeout → 45s.

### 10.3 Web

- Adopt `/state` + the extended `call.updated` for ringing-phase UI; keep the
  legacy live read for the answered call bar if convenient.
- SW: handle `call_end` by closing the `loonext:call:<session>`-tagged
  notification — **shipped in the SAME deploy as the server change** (§9.2);
  the page declares the `call_end` cap on (re)subscription.
- Apply §10.1.4 (suppress a duplicate INVITE for a session the softphone
  already presents — the shared credential forks INVITEs to web too).
- Web never had client-side leg kills — nothing to delete.

---

## 11. Product invariants preserved (D36–D45 traceability)

| Invariant | Where it lives in v3 |
|---|---|
| **D36 billing anchors** | Unchanged: talk time bills from the `bri\|caller\|answeredAtIso` tag the DO stamps at T2 (identical format, now written only after the customer leg answers — no revert path; T17 bills from the tag itself in the crash window); per-leg `call_records` + Stripe re-report untouched; ring time never bills; over-cap reject → USER_BUSY + MCTB (T1c/T5). |
| **#106 number access** | Dial targets + push audience filtered by 'text' level (T1d); ring-me and `/state` assert it in the route; hidden numbers 404/never enumerate (§8.1); `/mine` keeps its hidden-number filter. |
| **Screening (D43)** | Verdict stored at initiated as today; flag = label only; divert+flagged → T1a straight to `voicemail_greeting`. Fail-open vocabulary rule unchanged. |
| **Line model (D43, binding)** | `api_claim_inbound_line` kept verbatim (advisory-locked, outcome-null busy scan) — `outcome` semantics unchanged, so line-busy behavior is bit-identical. One live call per number; no conferences. T17 guarantees no crash window can hold the busy scan hostage. |
| **MCTB + crew alert (D39/D45)** | Terminal merge delegate unchanged, invoked from T5/T12/T16/T17; missed-call notifications remain push-only per D45. |
| **Transfer/consult (D43 phase 3)** | Logic unchanged; owner stamp via `setOwner` keeps (and now guarantees) stamp-before-steal; intent registered on the DO before any command (§7.4); T7 preserves the #168C stranded-customer teardown with the same three stand-down guards, now unmissable. |
| **Voicemail UX (D43)** | Greeting sanitation, TTS voice, beep, 120s cap, 15s silence stop, our-bucket storage inside the 10-min window, Telnyx copy deleted last, ≥2s keep rule, D37 merge-upgrade — all verbatim (T9/T11/T13), including in-flight legacy voicemails at cutover (§7.5.3). |
| **Forgery gates (D43 hardening)** | Signature verify + edge ledger unchanged; calls-row-exists proof preserved in adoption; brm leg events require ccid ∈ the DO's own leg map or adoption onto an existing pending/ambiguous record (§7.7 — signature + tag alone are NOT proof: the tag is client-mintable via the outbound SDK path, calls.ts:407–408; the record requirement is v3's re-creation of legacy's ledgered-ccid 'lost'-verdict gate, the actual anti-forgery defense); brc/brt keep the full D43 ledger gates (§7.2). Outbound nonce path untouched. |
| **Idempotent webhooks (D7/SPEC §7)** | Edge `webhook_events` dedup + sweeper unchanged; DO adds per-event dedup + state-guarded transitions + the §4.1 journal; replays no-op (or resume to completion) at three layers. |
| **Post-crash recovery (#168D)** | `/mine` unchanged; `answered` state + never-reverted stamps make it strictly more truthful. |
| **Cost mandate (memory: cap-and-drop)** | §13. |

---

## 12. Migration & rollout

### 12.1 Order

1. **Migration `2026xxxx_calls_v3_state.sql`**: `alter table calls add column
   state text` + CHECK on the §3 enum **permitting NULL** (§3 nullability —
   outbound and legacy rows are NULL by design); backfill:
   `outcome='answered'→'ended_answered'`, `'voicemail'→'ended_voicemail'`,
   `'missed'→'ended_missed'`; live inbound rows: `answered_at is not null →
   'answered'` else `'ringing'`; outbound rows left NULL. Extend the
   `call.updated` trigger payload (§9.1). Extend `api_list_calls` +
   `api_sweep_stale_calls` (state stamp). Partial index
   `on calls (phone_number_id) where state not like 'ended%'` if the busy
   scan wants it (optional; outcome scan remains primary — the partial
   index excludes NULL rows and must never replace it, §3).
2. **Worker deploy** with the DO (wrangler migration `calls-v3-1`, entry
   wiring per §2.1), the webhook router cutover, the new/changed routes,
   ring-me v2, push TTL/kind changes. **The legacy inbound handlers — WITH
   their `api_claim_ring_answer` / `api_ring_leg_failed` call sites — stay
   in-tree**, reachable only behind the §12.4 kill switch. (They cannot be
   deleted in this deploy: the kill switch restores them, and code cannot be
   both gone and restorable.) The primary path no longer calls the RPCs.
3. **In-flight calls during the deploy**: nothing special — the next event
   for a pre-v3 session hits an empty DO and is adopted (§7.5, including
   in-flight voicemails and unledgered legs). A call that ends entirely on
   old code before its first v3 event just has its state backfilled/derived.
4. **Android release** with §10.2; **web** follow-up with §10.3. Server first
   — every server change is compatible with the shipped clients (§8.2, §8.3
   compat notes are the proof obligations, pinned by tests). **Honest
   old-fleet statement for the window between steps 2 and 4** (review
   R2-I2 — the draft's "killed-app recovery still works for old clients"
   holds ONLY for alive-process old clients): a truly KILLED pre-v3 process
   never calls ring-me — `PushHooks.callWakeHandler` is null in an
   FCM-woken process (tray path only) and MainActivity's `parseDeepLink`
   drops the `?call=` param (MainActivity.kt:79–88) — so its member sees a
   tray ring they cannot join; the caller gets an honest 45s of ringback
   (the push-capable avenue holds the window), then voicemail. That is
   strictly better than legacy's ~1s voicemail, but it is NOT recovery; only
   this step's release makes the killed-app rungs of §15.5 passable.
5. **Kill-switch retirement, then cleanup — strictly in this order, and
   strictly AFTER step 4** (review X5/I4 + R2-I2: flipping the switch after
   the RPCs are dropped would 500 every inbound ring — and the §15.5
   killed-app rungs this step is gated on CANNOT pass until step 4's
   Android release ships the cold-process wake handler; the draft's
   original 4↔5 order was internally impossible): after the FULL founder
   ladder (§15.5, both pre- and post-Android rungs) passes, ONE change
   deletes the kill switch AND the legacy inbound handlers; the **cleanup
   migration dropping `api_claim_ring_answer` + `api_ring_leg_failed` ships
   in that same change, never before it**. Until that change lands, the
   drop migration must not exist in the tree.

### 12.2 Idempotency across the cutover

Telnyx retries and the 5-minute sweeper can replay pre-cutover events into
the DO: adoption + dedup + guards make that a no-op or a completion, never a
double effect (the terminal merge delegates were already replay-idempotent —
that property is retained and tested).

### 12.3 What is deleted

`ringMembersOrVoicemail` / `ringMemberBrowser` / `handleMemberRingAnswered` /
`handleMemberRingHangup` / `cancelRingingMemberLegsForUser` and the
cancel-first pattern; the ring RPCs; the #168 ring-me ledger gate; client:
`StaleRing.kt`, the probe plumbing, MainActivity's wake-handler overwrite.
(The voicemail pipeline functions, terminal merge, threading, MCTB, transfer
engine survive as DO delegates. Deletion of the legacy inbound handlers +
ring RPCs happens ONLY at §12.1 step 5 — they are kill-switch collateral
until then.)

### 12.4 Kill switch

`CALLS_V3_LEGACY=1` (env, checked in the webhook router) restores the legacy
inbound handlers for emergencies. Three behaviors are binding under the flag
(review X1):

- The webhook router routes inbound events to the legacy handlers and never
  calls the DO.
- `/state` bypasses the DO entirely and serves row derivation (§8.1) — the
  one contract new clients depend on never depends on the DO being in the
  path, and never serves a stale pre-flip snapshot.
- **`alarm()` no-ops under the flag — but RE-ARMS a coarse re-check alarm
  (+5 min) before returning** (review R1-m4: a fired alarm that no-ops
  without re-arming leaves the object with NO pending alarm — including the
  T15 purge and T16 janitor, which ARE alarms — i.e. immortal DO storage,
  contradicting §13's "no immortal objects", unless a later event happens to
  re-adopt). When the flag clears, the re-check alarm finds the flag unset
  and re-arms the nearest real deadline (ring/janitor/purge) from the
  retained machine. A T9 firing against a call the legacy engine owns would
  otherwise answer it into voicemail out from under the legacy handlers.
  The machine state is retained (not purged) so a flip-BACK re-adopts
  cleanly via §7.5 with the row as truth.

Removed at §12.1 step 5 — strictly before the RPC drop migration.

---

## 13. Cost & limits (cap-and-drop, per the standing mandate)

Per inbound call, worst-case-ish: ~10–15 webhook events + ≤3 ring-me + ≤6
state reads + ≤5 alarms ≈ **~25–30 DO requests** (\$0.15/M → ~\$0.000004).
Billed active duration: the events spread across a ~3.5-min ring+voicemail
session, so budget 2–3× the naive per-event sum — **~25 GB-s ≈
~\$0.0003/call** at 128MB (\$12.50/M GB-s), not the optimistic ~8 GB-s.
Storage <10KB/session, purged at terminal+15min (SQLite storage \$0.20/GB-mo
→ ~zero). SQLite-backed DO **row writes** bill at \$1.00/M rows written, and
the §4.1 journal advances a persisted cursor after EVERY effect — budget
~50–150 row writes/call ≈ \$0.0001 (review R2-m2 — carried as a line item
because this section claims to be the cap-and-drop accounting, not because
it moves the total). **Order of \$0.0004/call — noise against the ~1.2¢/min
Telnyx cost the call already carries.**

Hard caps (enforced in the DO, Sentry warning at 50%, drop + log at 100% —
Sentry inside the DO REQUIRES the §2.1 instrumentation or every one of these
alerts is a silent no-op):

- `MAX_LEGS_PER_SESSION = 24` (engine fan-out + ring-me adds) — RING-START
  fires a Sentry warning the moment eligible targets exceed it (alert BEFORE
  the cap, per the standing mandate) and dials the first 24 deterministically
  (§4 T1d); past it, ring-me returns `dial_failed`.
- `MAX_TELNYX_COMMANDS_PER_SESSION = 3 × MAX_LEGS_PER_SESSION + 16` (= 88
  at the current 24) — **derived, not flat** (reviews R1-I3/R2-m4: a
  fully-LEGAL max-fanout session is 24 dials + T9's answer + speak + 24
  exhaustive cancels = 50, over the old flat 48 — and the overflow drop
  landed on exactly the commands that guarantee honest termination). Past
  the cap, commands drop with one **exemption class: terminal-path
  commands NEVER drop** — T5/T9/T10/T16/T17 cancels, the voicemail answer
  + speak, and terminal hangups execute regardless (a session must always
  be able to end honestly; the cap exists to stop runaway loops, not
  termination). The janitor still force-ends as the last resort.
- `seen` dedup marks capped at 256 (rolling).
- Every session's storage is purged (T15) and every non-terminal session is
  force-ended at 4h (T16 + the retained cron backstop) — **no immortal
  objects, no unbounded storage, no alarm leaks** (one pending alarm per
  object by platform design; we re-arm to the nearest deadline among
  ring/journal-resume/retry/fanout-settle/intent-expiry/janitor/purge).
  **T15 explicitly calls `deleteAlarm()` before/with `storage.deleteAll()`**
  (review R2-m3: `deleteAll` does NOT delete a pending alarm — a stray
  deadline would wake an empty object forever).

---

## 14. Failure-mode walkthroughs — the founder's three scenarios on v3

### Scenario 1 — FOREGROUND (was: banner vanishes ~1s → voicemail → banner again)

1. call.initiated → DO T1d: leg A recorded pending→`dialing` → dialed →
   re-keyed on ccid → ledgered; push fan-out; alarm t+45; state `ringing`.
2. INVITE A rings the foreground app → banner + ringer (unchanged fast path).
3. Push lands ~1s later. **v3 client**: a live RINGING call exists → push
   ignored (rule §10.2). **Pre-v3 client**: fires ring-me unasserted → T4a:
   member has a live leg → NO-OP `{rang:false, live_leg}` — and this holds
   at ANY push latency, including Doze-delayed pushes landing >4s after the
   dial (the old 4s window would have let a slow push cancel the live
   banner — review X3; the liveness rule has no such window). Either way
   **no cancel is ever issued** — the banner stays.
4. Member answers → T2: inbound answered (bri anchor, journaled §4.1) →
   stamped → bridged → siblings canceled → `answered` broadcast + `call_end`
   push. Counterfactual: if the member ignores it, the alarm at t+45 — and
   only the alarm — starts voicemail (T10→T9), which cancels leg A; the
   client processes the BYE; no client ever kills anything.
   **No step can start voicemail while leg A rings: T3 requires zero live
   legs, and leg A is in the machine from before its own dial.**

### Scenario 2 — KILLED APP (was: phone "rings" via push → voicemail after ~1s)

1. T1d: the durable credential still dials leg A; push fans out; alarm t+45.
2. Leg A fails fast (~1s, unregistered SIP) → T3 ladder: zero live legs, BUT
   `pushCapableUserIds` contains the member → **stay `ringing`, hold
   ringback**. The caller keeps hearing ringback — no voicemail.
3. FCM wakes the process. v3 client: the app-context wake handler exists
   (§10.2) → connect (~2–4s) → `GET /state` → `ringing` → ring-me with
   `no_local_leg:true` → T4b/c: the assertion licenses the dial and the
   debounce only checks ring_me-sourced legs (dead leg A is engine-sourced
   and dead — irrelevant either way) → **fresh leg B dialed on the FIRST
   ring-me** → INVITE B → full-screen ring. (Without the assertion field
   this step would have been refused as a recent leg and recovery would ride
   the optional ~4s retry — the assertion is what makes the first call
   work; §6.) Total time-to-INVITE ≈ push latency + connect ≈ 2–5s, well
   inside the 45s window; the §15.5 ladder should expect that, not
   instant. (Tray-fallback path: the tap now carries the session and runs
   the same sequence.)
4. Member answers within the window → T2 → talking. Nobody answers → alarm at
   t+45 → voicemail, honestly, after a real 45-second window.

### Scenario 3 — BACKGROUND (was: ~1ms ringtone, notification never renders)

1. T1d dials leg A; push wakes the process before the frozen socket thaws.
2. v3 client: no live leg for the session → `GET /state` → `ringing` →
   ring-me with `no_local_leg:true` → **T4b/c dials leg B and cancels
   NOTHING** — leg A is LIVE (INVITE frozen in this device's dead socket),
   and the assertion "nothing presents HERE" cannot prove leg A isn't
   presenting a banner on the member's OTHER device right now (§6, review
   R2-B2 — the founder's own desktop-web + Android setup: one credential,
   one leg, every device rings on it; the draft's cancel-after killed the
   desktop's live banner mid-ring, recreating the scenario-1 flap). Legs A
   and B coexist; A dies by T2/T9's exit sweep or its own 45s timeout.
   **The voicemail race cannot occur: leg B is in the leg map before any
   other leg's death can be "last", and events are admitted one-at-a-time
   by the §4.1 FIFO.**
3. Socket thaws: leg A's INVITE arrives on a phone already presenting leg B
   → held silent by rule §10.1.4 (promoted only if B dies while still
   `ringing`); a desktop presenting leg A keeps its banner uninterrupted
   and ALSO receives leg B's forked INVITE → same rule, held silent. Any
   answer, on any leg, on any device, runs T2; the sibling sweep reaps the
   rest.
4. Pre-v3 client on this path: its unasserted ring-me no-ops (`live_leg`) —
   the frozen INVITE eventually thaws and presents, or leg A times out and
   the push-capable avenue holds the window open. No cancel-and-redial flap
   is possible for old builds at any push latency — and after review R2-B2,
   none is possible for NEW builds either: ring-me never cancels.

---

## 15. Test plan

### 15.1 The pure machine (`apps/api/src/calls/transitions.ts`)

The reducer is `(machine, event) → {machine', effects[]}` with zero I/O —
effect outcomes (answer success/failure, fan-out settled) re-enter as
internal events (§4.1), so the DO shell only queues, journals, executes
effects, and forwards events. Tests:

- **Exhaustive transition table**: every §4 row, plus every (state ×
  event-type) pair NOT in the table asserted a no-op — with the T17
  totality assertion: an INBOUND-leg hangup — bri-tagged, vmi-tagged, or
  UNTAGGED — reaches a terminal state from EVERY non-terminal state (no
  (state × inbound-hangup × tag-state) triple may no-op; the untagged ×
  voicemail_greeting cell is review R1-B1's 4h-busy-line hole, pinned
  forever). Plus the two §3 terminal upgrades (`ended_missed →
  ended_voicemail`, `ended_missed → ended_answered` with the retained
  answerIntent stamp), and the T2 dead-inbound and T9 dead-inbound
  discrimination branches asserted TERMINAL (never "stay") — review
  R1-B3's dropped-hangup ordering, pinned.
- **Property (the founder invariant), fuzzed**: for randomized interleavings
  of {initiated, leg answered/hangup per leg, ring-me (asserted ×
  unasserted), caller hangup, alarm, fan-out settle with pruning,
  duplicated events, adopted starts}: **no reachable path emits the
  voicemail-entry effect while the window is open and an avenue remains**
  (formally: VM-ENTRY only under T1a, T1d zero-avenue, T10-alarm, or
  T3-exhaustion with zero live legs ∧ zero push-capable). Companion
  properties: no transition out of `ended_*` except the T13 upgrade; every
  exit from `ringing` cancels every live leg and emits exactly one
  `call_end` push; ring-me — asserted or not — never emits a hangup/cancel
  effect at all (§6); `answered_by_user_id` is written at most once per
  session (± setOwner and the §3 ended_missed→ended_answered upgrade);
  exactly one terminal state (± the two §3 upgrades); every effect list is
  idempotent under event replay.
- **Crash/replay property (§4.1), fuzzed**: for every transition with
  effects, kill-and-restart at every persist boundary (post-journal,
  mid-effects at every cursor, pre-clear), replay via sweeper semantics:
  the machine converges to the same terminal state, no terminal-merge
  delegate runs twice, and the answer-4xx discrimination is exercised on
  both branches (leg alive → success; leg dead → terminal, member released,
  no stamp, answerIntent retained). The crash fuzz additionally pins: a
  T9 crash between the speak POST and the cursor advance double-speaks at
  most once and produces exactly ONE `voicemail_recording` transition (the
  second speak.ended no-ops on the T11 guard — review R1-m1); T2 admitted
  on a `canceling` leg GETs the member leg first and degrades to T3 when
  it is dead (review R1-B2); a stood-down T7 followed by intent
  expiry/clear re-runs the teardown exactly once (review R1-B4); an
  UNASSERTED or ASSERTED ring-me emits ZERO hangup effects in every
  interleaving (review R2-B2 — the no-cancel rule, property-tested).

### 15.2 DO shell + contracts (api vitest)

**Harness mechanism (binding — the naive version breaks the whole suite):**
apps/api's vitest runs plain node-environment projects (vitest.config.ts —
no pool-workers, no miniflare), and `mount.test.ts:19` imports the real
`./index`; the moment `src/index.ts` re-exports a class extending
`DurableObject` from `cloudflare:workers`, node module resolution fails and
the ENTIRE existing api suite dies. Mandated fix, mirroring the existing
telnyx-doubles alias pattern: a vitest `resolve.alias` mapping
`cloudflare:workers` → `src/test/cloudflare-workers-double.ts` (a no-op
`DurableObject` base class + the minimal storage/alarm surface the shell
uses), applied to BOTH projects (the "telnyx" project has no alias block
today and hosts mount.test.ts — it needs one). Shell tests drive the class
directly against an in-memory storage double; no pool-workers migration is
required for #170 (it may come later; it is not a dependency).

- Serialization: concurrent entrypoint calls (answer racing the alarm at
  t+45±ε, answer racing caller-hangup) admitted strictly FIFO; the losing
  event observes the winner's completed state (the §4.1 Fact-1
  interleavings, pinned).
- Journal: eviction simulated at each boundary → resume-on-admission and
  the +2s resume alarm both complete the transition.
- Adoption matrix (§7.5): pre-v3 live ringing / answered / **voicemail
  in-flight (vmi speak.ended, vmi hangup, recording.saved as the first v3
  event — recording stored, MCTB on time)** / ended rows / bri-tagged
  hangup with answered_at null (T17) / unledgered legacy legs adopted via
  §7.7.
- Orphans (§7.7): ambiguous dial → orphan answer connects (ringing) /
  defensively hung up (voicemail states); unknown-ccid brc/brt events pass
  the D43 gates, never the brm map.
- Intent: registerIntent-before-dial → T7 stands down; intent expiry →
  stand-down window bounded; consult initiation with the owner's hangup
  interleaved at every point never tears down the customer (review B3's
  sequence, pinned).
- Mirror-write failure → alarm retry → converges; terminal mirror retries
  until success.
- Every §8 endpoint: status × body per table, including the legacy-read
  freeze (8.2), ring-me's `ok:true` retention + `no_local_leg` branches,
  hidden-number 404s, and the route-level 409s being request-property-only.
- Kill switch: flag set → router bypasses DO, `/state` derives from the row
  (never calls snapshot), `alarm()` no-ops; flip-back re-adopts.
- Forgery (review R2-B3's interception sequence, pinned): forged brm naming
  a foreign session → dropped; forged brm naming a REAL ringing session
  with no pending/ambiguous record for the tag's userId → defensive hangup
  + Sentry, NO adoption, NO T2, no answer/bridge command ever issued —
  asserted with a hostile-member fixture holding a real credential and the
  broadcast session id; ledger-less minting asserted possible ONLY on an
  `adopted` machine AND only for an active, credentialed, #106-eligible
  member.
- Push contract: `call_end` sent ONLY to caps-declaring
  tokens/subscriptions (a fixture pre-v3 token receives the `call` wake
  but never a `call_end` — review R2-B1's fleet ghost, pinned);
  pushCapableUserIds excludes pref-disabled members (solo pref-disabled
  member → instant voicemail at RING-START, review R2-I1); fanout-settle
  alarm synthesizes the settle after a simulated mid-fanout eviction
  (review R1-I4).
- Edge dispatch (§7.2): inbound-family event admitted before ack; duplicate
  POST on an unstamped row re-dispatches; no-row inbound hangup drop leaves
  the row unstamped and a later-minted machine consumes the sweeper replay
  (review R1-B3/R1-I1).

### 15.3 The three founder sequences as end-to-end regressions

Scripted event traces with virtual time, driven through the router + DO with
a fake Telnyx + fake push sink, asserting the §14 walkthroughs step-by-step —
including the timing-critical orderings (push 1s after dial; leg-failure at
1s; slow push at 6s against a live leg (unasserted no-op); cancel-vs-ledger
interleavings made deterministic by the DO's queue; eviction+sweeper-replay
mid-answer resolving to a connected call, review B1's sequence; the
founder's MULTI-DEVICE sequence — desktop-web presenting the engine leg
while the phone's ring-me adds a second leg: the desktop banner is never
interrupted and either device's answer connects, review R2-B2; the
double-caller sequence — line busy → divert → caller 2 hangs up before the
vm answer lands → line reports FREE the moment call 1 ends, review R1-B1).
These are the permanent regressions for #170.

### 15.4 Android

- Push-while-ringing does NOT call ring-me; push-with-no-leg does (after the
  state read), with `no_local_leg:true`.
- No code path outside user action invokes `handle.end()` (StaleRing deleted;
  lint/grep test pins it).
- Cold-process wake handler installed from app context; deep link carries the
  session; `call_end` dismisses the tray entry.
- Existing suites (answer flow, by-leg retry, telecom) unchanged and green.

### 15.5 Founder ladder (post-deploy, per the epic's phase 4)

Foreground / background / killed × answer / ignore / decline × solo member —
with the caller-side expectation now uniform: **ringback until answer, the
45s alarm, or an honest exhaustion — never an early voicemail.** The ladder
is split in two (review R2-I2 — the killed-app rungs are physically
unpassable before the Android release):

- **Pre-Android rungs** (gate nothing but themselves; runnable right after
  §12.1 step 2): foreground + background × answer/ignore/decline on the
  shipped fleet and web, multi-device (desktop-web + phone) banner
  stability, caller-side window honesty.
- **Post-Android rungs** (gate §12.1 step 5, runnable only after step 4):
  killed-app time-to-ring ~2–5s (push latency + connect, §14 scenario 2 —
  not instant; anything beyond ~8s is a defect), `call_end` tray dismissal,
  cold-process deep-link join.

---

## 16. Appendix — review findings considered and resolved differently

Every blocking and important finding from the 2026-07-17 adversarial design
reviews AND the 2026-07-17 second-round reviews (R1/R2) was accepted and
folded in above. The points below were resolved differently than a reviewer
proposed, or rejected; recorded here so the reasoning survives:

1. **Unknown-ccid `brm` answer: adopt-and-honor in `ringing` — but ONLY
   onto an existing pending/ambiguous record** (first review's B4 proposed
   a blanket defensive hangup; the ORIGINAL v3 resolution honored ANY
   signed tag and was itself struck down by review R2-B3). The first-round
   reasoning survives half-way: hanging up a member answering a leg WE
   dialed re-creates the legacy 'lost'-verdict cruelty
   (inbound-ring.ts:468–475), so a leg with a matching pending/ambiguous
   record is honored (T2). But the original justification — "the tag is
   unforgeable" — was FALSE (client-mintable client_state,
   calls.ts:407–408), so tag-only legs are now defensively hung up + Sentry
   (§7.7). Every leg a member can legitimately answer has a record by
   construction (pending persists before every dial POST); the only
   record-less-but-legitimate legs are legacy-cutover legs, scoped by the
   `adopted` flag + eligibility gates.
2. **brc/brt legs: D43 gates retained instead of `registerLeg`** (review
   R2-B3 offered either). A `brt` transfer leg's ccid is created by
   Telnyx's transfer command and is unknowable to any registrar until its
   first webhook — a registerLeg contract would be unsatisfiable for it,
   and satisfiable-but-redundant for consult legs (their ledger rows +
   calls-row proof already gate them). Scoping the leg map to brm (§7.2)
   is the one rule that is total.
3. **T1b (unattended/suspended) still has no 45s alarm** (R2 minor
   proposed one for uniformity). Rejected as a behavior change smuggled in
   as hygiene: suspended-line ring-out to the carrier timeout is today's
   deliberate caller experience; a server hangup at 45s would change it for
   no honesty gain (there is no voicemail product surface on a suspended
   line). The "no immortal ringing states" claim is held by the janitor
   alarm, which T1b explicitly arms (§4).
4. **Kill-switch alarms: no-op, not purge** (review X1 offered either).
   Purging a live DO's state under the flag would make a flip-BACK lossy
   (re-adoption would run from the degraded row, losing leg records and
   the intent). No-op preserves the machine for recovery; §7.5 handles the
   divergence on flip-back with the row as truth. (Per review R1-m4 the
   no-op now re-arms a coarse re-check alarm — §12.4.)
5. **T2 crash-window discrimination: NOT via reading `client_state` off the
   ended-call GET** (review R1-I2 proposed "the discrimination read the
   ended call's state/client_state from the GET"). Rejected as a MECHANISM:
   Telnyx's retrieve-call response is not documented to reliably return
   `client_state` for an ended leg, and building the billing-correctness
   path on an undocumented field is the kind of premise both reviews
   punished elsewhere. The finding's substance is fully accepted and
   resolved with facts we own: the failure branch keeps `answerIntent`
   persisted (never cleared on failure), terminals as PROVISIONAL
   `ended_missed`, and the bri tag on the hangup event itself — which IS
   documented and IS proof of our successful answer — upgrades to
   `ended_answered` via the §3 terminal edge when it surfaces.
6. **Lost-event liveness: await-admission-before-ack, not
   "processed_at=null-with-fast-retry"** (review R1-I1 offered either).
   A null-stamp still leaves the retry to OUR sweeper cadence; awaiting DO
   admission in the request path (§7.2) recruits Telnyx's own 6-attempt
   fast ladder as the retry — seconds, not minutes — and the
   unstamped-duplicate re-dispatch covers the ack-raced case. The residual
   window (isolate death AFTER ack, BEFORE admission-persist completes) is
   closed by the same rule: no stamp → sweeper; and admission IS the
   persist, so post-admission death is the journal's job.
7. **Multi-device ring-me: never-cancel + client suppression, not
   per-device leg identity** (review R2-B2 offered either). Per-device legs
   require per-device Telnyx credentials — a product/infra change (webrtc
   credential lifecycle, D43 surface) far outside #170, with its own
   registration-cleanup failure modes. Never-cancel is one deleted effect
   plus one client presentation rule (§10.1.4), and it strengthens the §15.1
   no-cancel property to unconditional.
8. **R1-B1's alternative fix — minting `ringing` on the busy/divert/
   zero-avenue branches so T5 applies** — resolved differently: broadcasting
   `ringing` for a call being diverted to voicemail would serve a false
   state to every client (`/state`, realtime) — phase-1 defect-4-class
   dishonesty. The chosen fix (VM-ENTRY persists `voicemail_greeting`
   before effects + the untagged-hangup T17 extension) keeps the state
   truthful AND total.

---

## 17. Gate-review addenda (BINDING on implementers)

The final gate review (issue #170, verdict SHIP) attached these as binding
implementation notes:

1. **§7.7 destination binding (hardening, REQUIRED):** `leg:pending` /
   `ambiguous` records store the dialed SIP TARGET; adoption verifies the
   event payload's destination matches before attaching a ccid. Closes the
   residual hostile-member interception window to zero.
2. **Unreachable-defensive branches:** T2's `rejectedForCap → ended_rejected`
   parenthetical and T2's `canceling` branch are defense-in-depth with no
   driving sequence — the §15.1 test author marks them
   `unreachable-defensive`, not hunts for a driver.
3. **Admission promise plumbing (§7.2):** resolve the webhook caller's
   promise at the step-1 persist while the FIFO slot stays occupied through
   effect execution. One explicit comment in session-do.ts + a shell test:
   an event admitted during another transition's effect phase observes the
   COMPLETED state.
4. **Internal events in the no-op matrix:** §15.1's exhaustive matrix
   includes the internal events (`push-fanout-settled`, answer-outcome) ×
   every state — e.g. a settle arriving in `answered` is a licensed no-op.
5. **Load-bearing telemetry:** T1d's ~2s FIFO queue-latency Sentry signal is
   NOT optional — it is the drift alarm for the webhook-ack budget
   (worst-case ~3-4s behind a 24-target dial).
6. **Old-fleet tail ghost (accepted, self-extinguishing):** pre-v3
   killed-process clients keep the 30s tray timeout and no call_end cap; a
   late push can tray-ring up to ~25s past voicemail entry until §12.1
   step 4 ships. Same class as the shipped behavior; do not attempt to fix
   in v3 server code.
7. **Verified-in-repo facts implementers may rely on** (gate re-checked):
   telnyx.ts duplicate pure-ack + post-dispatch processed_at stamp; fcm.ts
   data-only/no-collapse-key; sw.js renders every push (notice vs
   call:<session> tags); incoming-call.ts #146 pref filter; one durable
   credential per (company,user); MainActivity.parseDeepLink drops `?call=`
   today; vitest 'telnyx' project hosts mount.test.ts with no resolve.alias;
   `instrumentDurableObjectWithSentry` exists in @sentry/cloudflare 10.63.0;
   SWEEP_MAX_ATTEMPTS=5.
