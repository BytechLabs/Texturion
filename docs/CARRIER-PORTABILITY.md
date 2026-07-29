# Carrier portability (#241)

`grep -rl telnyx apps/api/src` returns **20+ modules**. Telnyx is not a
dependency we use; it is the substrate the product is built out of.

That is fine as an implementation and dangerous as a business: a communications
company whose ability to deliver rests entirely on one vendor's uptime, one
vendor's account-standing decisions, and one vendor's pricing. We have already
been bitten by the middle one — Canadian number ordering returns 10038 pending
an account upgrade, so a *vendor decision*, not a technical one, gated a market.

**This document is an honest map, not a plan to switch.** Its job is to make the
second carrier *possible* before we need it, so adding one is a refactor rather
than an emergency.

---

## 1. What is portable, and what would be a rewrite

| Surface | Portability | Why |
|---|---|---|
| **Send a message** | **Portable** | One request, one response, one status webhook. Every provider has this shape. `messaging/send.ts` is the single dispatch choke point, so there is exactly one call site to swap |
| **Failure reasons** | **Portable — done** | Was the worst leak; see §2 |
| **Inbound message webhook** | **Portable** | Normalising is mechanical: sender, recipient, body, media, provider id. The router already isolates signature verification per provider |
| **Order / release a number** | **Portable, with a caveat** | The verbs match everywhere. What does *not* port is **inventory** — area-code availability differs per provider, and a customer's chosen number may simply not exist elsewhere |
| **Number registration (10DLC)** | **Partly portable** | Every US provider fronts the same registries, but the submission shapes and status vocabularies differ enough that `telnyx/registration.ts` would be rewritten rather than adapted. The *state machine* survives; the API layer does not |
| **Call control** | **REWRITE** | See below |
| **WebRTC softphone** | **REWRITE** | The browser and mobile clients embed Telnyx's SDK. A different provider means a different SDK, different lifecycle, and re-testing every call path on three platforms |

### Call control is the honest "no"

`docs/CALLS-V3.md` describes a Durable Object whose whole design is shaped by
**Telnyx Call Control**: `call_control_id` as the unit of identity, the specific
command set (`answer`, `bridge`, `transfer`, `gather`, `record`), the webhook
event vocabulary the state machine reduces over, and the ordering guarantees the
DO's queue exists to compensate for.

A provider with a different call-control model — or worse, a TwiML-style *markup*
model rather than a *command* model — does not fit behind an interface. The
reducer, the effects, the mirror, the alarm slots and the DO's entire event
taxonomy would be rewritten. **Pretending otherwise would be the most expensive
kind of wrong**, because it would look portable until the day somebody tried.

**So the seam is drawn around messaging and numbers, and explicitly not around
calls.** If Telnyx became unavailable for voice, the honest recovery is
"calling is down while we rebuild", which is what D76 records.

---

## 2. Vendor codes no longer reach business logic

This was the leak that had travelled furthest, and it is closed.

`messaging/send.ts` compared against the literal `"40300"` to decide whether a
failure was a carrier opt-out — and **so did all three client apps**, each
carrying its own copy of that Telnyx constant to decide whether to offer a retry
button.

Adding a carrier would therefore have meant editing three mobile apps and
shipping them. #339 established what that costs: a store release reaches people
over weeks, and some phones never update at all.

Now:

- `packages/shared/src/carrier-failure.ts` defines **our** taxonomy —
  `opt_out`, `unreachable`, `content_blocked`, `spam_blocked`, `rate_limited`,
  `expired`, `not_provisioned`, `unknown`.
- The Telnyx code → reason map is **the only place a vendor code appears in a
  decision**. A second provider adds its own map beside it and changes nothing
  else.
- The reason is classified once at the edge and persisted on
  `messages.error_reason`. Clients branch on the reason, falling back to
  classifying the code for rows written before the column existed.
- An unmapped code is `unknown`, never a soft default — and **never `opt_out`**,
  because that is the one reason with a legal meaning. A wrongly-inferred
  opt-out takes somebody's number out of service and only the customer can undo
  it.

The taxonomy is hand-ported to Kotlin and Swift with tests asserting the same
table on all three, because a drift means one app offering a retry another
withholds.

### Still Telnyx-shaped, and known

- `call_control_id` throughout the calls stack — see above.
- Custom `X-RTC-*` headers on outbound legs (`runtime.ts`).
- Registration status vocabulary in `telnyx/registration.ts`.
- Provider cost lookups in the billing meter.

These are listed so the next person does not have to rediscover them.

---

## 3. Alternatives — structure, and what still needs a quote

**Read this section for its shape, not its numbers.** The structural comparison
below is drawn from each provider's published model. **Per-message and
per-minute pricing is deliberately absent**: quoting a rate I have not confirmed
would be exactly the kind of unverified assertion this repo keeps getting bitten
by, and negotiated rates differ from list prices anyway.

| | Call-control model | 10DLC | Canadian numbers | Portability cost for us |
|---|---|---|---|---|
| **Telnyx** (current) | Command-based (Call Control) | Direct | **Blocked at our account level** (10038) | — |
| **Bandwidth** | Command-based (BXML + callbacks) | Direct, owns registry relationships | Yes | Messaging seam fits; calls rewrite |
| **Twilio** | **Markup-based (TwiML)** | Direct | Yes | Messaging seam fits; calls rewrite is **larger** — a markup model inverts control flow |
| **Sinch** | Command-based | Via partner | Yes | Messaging seam fits; calls rewrite |
| **Vonage** | Command-based (NCCO) | Direct | Yes | Messaging seam fits; calls rewrite |

**The one urgent question is not redundancy — it is Canada.** Our headline
market is gated by a Telnyx account-level restriction, and every alternative
above sells Canadian numbers. That makes "a second carrier for numbers" a
*commercial* question we could answer this quarter, independent of any failover
ambition.

**To close this section, someone has to ask for quotes.** The questions are:
per-message US and CA, per-minute inbound and outbound, monthly per-number,
10DLC campaign fees, and whether Canadian long-code A2P requires registration on
their network (the same question as #379).

---

## 4. Related

- `docs/DECISIONS.md` **D76** — the posture and its accepted recovery time
- `docs/DECISIONS.md` D2 — the open Canadian registration question (#379)
- `docs/ROLLBACK.md` — `kill:outbound-send` contains a carrier incident in ~10s
- `docs/DISASTER-RECOVERY.md` §4 — Telnyx state does not roll back with the database
