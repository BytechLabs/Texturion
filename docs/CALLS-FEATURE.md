# Calls — end-to-end feature spec (#129)

Product-owner spec for the full Calls feature. Billing shipped first as D36 (#128:
fair-use metering, 1¢/min overage, spending-cap pause). This document binds the
rest: capture → inbox → surface → notify → settings, desktop + mobile + PWA,
security-reviewed. Written 2026-07-10; the shipped decision is recorded in
DECISIONS.md (D37) when this lands.

## Why (product)

Loonext's wedge is "a missed call still turns into a conversation." Today the
machinery exists (forwarding, missed-call text-back, crew alert) but the calls
themselves are invisible in the product: nothing in the inbox says a call
happened, there is no place to see who called, and the only trace is the
text-back message. A trades owner lives on their phone log; giving the crew a
shared call log inside the shared inbox closes the loop and makes the $8 module
feel like a feature, not a fee.

## Pillars

- **P1 — Capture & outcome (API).** At hangup time the voice webhook already
  knows everything: leg, duration, hangup cause, AMD verdict, caller. Persist a
  per-call OUTCOME (`missed` | `answered` | `voicemail`) on the inbound call
  record, plus contact/conversation linkage, so calls are queryable product
  data instead of billing residue.
- **P2 — Inbox integration.** A call renders inside its conversation thread as
  a timeline entry (event, not message): outcome icon, duration when answered,
  timestamp. The thread must read as the full history of the relationship —
  texts AND calls.
- **P3 — Calls surface.** A recent-calls view: caller (contact name or
  number), the business number called (multi-number companies), outcome,
  duration, time, tap-through to the conversation. Placement decided by the
  design panel WITHIN the HOME-AND-VIEWS laws — bias to the smallest honest
  surface (a view/filter, not a new empire). Desktop and mobile.
- **P4 — Notifications & PWA.** The existing missed-call crew alert must
  deep-link to the conversation, work from the installed PWA, and respect
  notification prefs. No new notification classes without prefs coverage.
- **P5 — Settings.** `/settings/missed-calls` is the Calls settings home:
  forwarding target, text-back toggle + message, and the D36 fair-use fine
  print (already honest about 1¢/min + cap pause).
- **P6 — Billing.** D36 (#128), shipped with this wave.
- **P7 — Security.** Every calls read is per-number-access filtered (#106
  deny-list resolver + SQL-side filters), service-role RLS on raw tables,
  role ≥ member for reads, owner/admin for settings. Security team reviews
  before ship.

## Non-goals (binding)

- ~~**No outbound calling from the app**~~ **REVERSED by D38 (#131,
  founder direction):** outbound click-to-call bridging shipped — the app
  rings the member's cell from the business number, then connects them to
  the customer. In-browser WebRTC audio remains a possible later wave.
- **No call recording, no voicemail transcription** — two-party-consent risk;
  revisit only as its own decision.
- **No IVR/PBX** — FEATURE-GAPS non-goal, unchanged.
- **No concrete allowance numbers on marketing surfaces** — D34/D36; the
  fair-use page stays the only public home.

## Acceptance (QA gates)

1. A forwarded call answered on the cell → `answered` outcome with duration;
   visible in the conversation thread and the Calls surface within one webhook
   round-trip.
2. A rang-out/declined call → `missed`; AMD machine-answer → `voicemail`
   (missed-class); the text-back and crew alert behave exactly as today.
3. A member whose number access excludes number N sees no calls to N anywhere
   (list, thread they can't already see, search).
4. Desktop and mobile render per the winning design in BOTH themes (dev-shot
   light + dark, mobile viewport); the PWA deep-link from a missed-call push
   opens the right conversation.
5. All suites green (api, web, SQL); no new cost center unbounded; no
   marketing surface gains a number.

## Status (D37, 2026-07-10)

Shipped: P1 (calls read model + outcomes), P2 (call_completed timeline lines),
P3 (/calls desktop + mobile + account-sheet entry, #106-filtered), P5 (settings
home unchanged, fine print honest per D36), P6 (D36 billing, #128), P7
(security review inline; RPC grants pinned in calls_feature.test.sql).

D38 addendum (2026-07-10, #131): outbound click-to-call bridging shipped —
POST /v1/calls + /calls/cell, oc_agent/oc_customer webhook legs, one
calling-minutes pool both directions, the thread Call button, two-direction
call log, marketing claims reversed.

Deferred (next wave, in priority order):
1. P4 remainder — a `missed_call`/`call_completed` arm on the D24
   `api_notifications` twins so misses reach the in-app bell, and decoupling
   `notifyMissedCall` from the MCTB claim so the crew alert fires even with
   text-back off (deep link /inbox/{id} when threaded, else /calls).
2. A For You "Recent calls" section as the second mobile entry point.
3. Per-member cell verification; a visible cell field on Calls settings;
   the module label rename ("Call forwarding" → "Calling").
