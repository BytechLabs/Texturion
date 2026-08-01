# Carrier portability (#241)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

`grep -rl telnyx apps/api/src` returns **20+ modules**. Telnyx is not a
dependency we use; it is the substrate the product is built out of.

That is fine as an implementation and dangerous as a business: a communications
company whose ability to deliver rests entirely on one vendor's uptime, one
vendor's account-standing decisions, and one vendor's pricing. We have already
been bitten by the middle one — Canadian number ordering returns 10038 pending
an account upgrade, so a *vendor decision*, not a technical one, gated a market.

**This document is an honest map, not a plan to switch.** Its job is to make the
second carrier *possible* before we need it, so adding one is a refactor rather
than an emergency. §3 now names which carrier that would be — **Bandwidth**, on
costed grounds (D76 amendment) — which is still not the same as a plan to move.

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

## 3. Alternatives — structural fit and what a switch costs

### 3.1 Structural fit

| | Call-control model | 10DLC | Canadian numbers | Portability cost for us |
|---|---|---|---|---|
| **Telnyx** (current) | Command-based (Call Control) | Direct | **Blocked at our account level** (10038) | — |
| **Bandwidth** | Command-based (BXML + callbacks) | Direct, owns registry relationships | Yes | Messaging seam fits; calls rewrite |
| **Twilio** | **Markup-based (TwiML)** | Direct | Yes | Messaging seam fits; calls rewrite is **larger** — a markup model inverts control flow |
| **Sinch** | Command-based | Via partner | Yes | Messaging seam fits; calls rewrite |
| **Vonage** | Command-based (NCCO) | Direct | Yes | Messaging seam fits; calls rewrite |

### 3.2 List prices, read from the vendors' own pages on 2026-07-29

The figures live in `apps/api/src/billing/carrier-list-prices.ts` rather than
only here, because a table in a document rots quietly: that module carries the
source URL per vendor, a `RECHECK_AFTER` date a test fails on, and the
cross-check that our own modeled costs never fall below the incumbent's
published floor.

**Two corrections to make before comparing anything**, or the comparison is
wrong:

1. **Carrier fees are pass-through and cancel out.** The US carriers set a
   per-message surcharge by *destination* carrier (Twilio publishes AT&T
   $0.0035, T-Mobile $0.0045, Verizon $0.0045 outbound; Telnyx quotes the same
   band as "$0 to $0.005"). Every vendor passes it on at cost, so it is common
   to all of them. The only part a vendor controls — and the only honest basis
   for comparison — is the **base rate**.
2. **List is not negotiated.** These bound the *direction and rough size* of a
   switch. They are not quotes.

| | Base outbound SMS | Base inbound SMS | Voice in / out per min (US local) | Local number / mo |
|---|---|---|---|---|
| **Telnyx** (current) | $0.0040 | $0.0040 | $0.0032 / *not published* | $1.00 + $0.10 SMS = **$1.10** |
| **Bandwidth** | $0.0040 | *not published* | $0.0055 / $0.0100 | *not published (quote)* |
| **Twilio** | $0.0083 | $0.0083 | $0.0085 / $0.0140 | $1.15 |

*Sinch and Vonage are absent on purpose: as of the verification date neither
publishes retrievable rates (403 / 404 — both gate pricing behind a contact
form). Their structural fit is in §3.1; inventing numbers for them would be the
exact failure this section was reopened to fix.*

**Twilio 10DLC registration** (the only vendor publishing it): Standard brand
$44 one-time + $15 per campaign vetting + $1.50–$10 per campaign per month; Sole
Proprietor $4 + $15 + $2/mo. Our cost model assumes **$10/campaign/mo**
(`us10dlcCampaign`), which sits at the *top* of that published range — the
assumption is conservative, not understated.

**Canada is structurally dearer at every vendor.** Twilio's Canadian base rate
matches its US one ($0.0083), but Canadian carrier surcharges are 1.5–2× the US
ones ($0.0064–$0.0087 outbound, up to $0.017 inbound). Whoever we use, Canadian
messaging costs more per segment than American — which matters for fair-use
sizing and for #328 (billing Canadians in CAD).

### 3.3 What a switch would actually cost

Base-rate delta per outbound segment, against Telnyx:

- **Bandwidth: ±0.** Identical $0.0040 base. Messaging is cost-neutral.
- **Twilio: +0.43¢** per segment (2.08× the base). Against a fully-used month
  that is **+$2.15 per Starter tenant** (500 segments, on $29 of revenue) and
  **+$10.75 per Pro tenant** (2,500 segments, on $79).

Voice is where the gap is widest. A forwarded call bills *both* legs — the
inbound leg and the leg we dial:

- **Bandwidth: 1.55¢/min** ($0.0055 + $0.0100)
- **Twilio: 2.25¢/min** ($0.0085 + $0.0140)

Both exceed the **1.2¢/min** our cost model assumes, which is an incumbent-shaped
figure. A voice migration is therefore a repricing as well as a rewrite, and
`VOICE_OVERAGE_CENTS_PER_MINUTE` would have to be revisited with it. The test
beside the price module asserts this inequality still holds, so if a vendor
repriced below our model we would find out from a failing suite.

### 3.4 The conclusion this supports

**Bandwidth is the designated second carrier** — recorded as D76's amendment.
It is the only alternative that is simultaneously cost-neutral on messaging
(identical base rate), command-based rather than markup-based (so §1's seam fits
and the voice rewrite is the smaller of the two), and able to sell Canadian
numbers today. **Twilio is the break-glass option**: the same seam fit, but
~2× the messaging base and ~1.9× the forwarded-minute cost, so switching to it
is a cost event as much as an engineering one.

**The urgent driver is still not redundancy — it is Canada.** Our headline
market is gated by a Telnyx account-level restriction *today* (10038), and every
alternative sells Canadian numbers. **One** thing remains genuinely external, and
it does not block the choice above: a **negotiated** rate. List price is enough to
pick a direction, not to sign.

Canadian A2P registration is no longer among the unknowns (#379, resolved
2026-07-29 — see `docs/VENDOR-QUESTIONS.md` R3): no CA→CA long-code registration
requirement exists on any network. What *is* real is that Canadian carriers filter
long-code A2P at their own discretion, and the published mitigation is **verified
toll-free** (#329). So a vendor's toll-free story matters here alongside price.

---

## 4. Related

- `docs/DECISIONS.md` **D76** — the posture and its accepted recovery time
- `docs/DECISIONS.md` D2 — the open Canadian registration question (#379)
- `docs/ROLLBACK.md` — `kill:outbound-send` contains a carrier incident in ~10s
- `docs/DISASTER-RECOVERY.md` §4 — Telnyx state does not roll back with the database
