# 04 — Telnyx

**Status: CURRENT DIRECTION (#323).** Step 4 of the production deploy runbook. Where it disagrees with the Telnyx console, the console wins.

Telnyx is almost entirely driven at **runtime via the v2 REST API** — messaging
profiles, number orders, and 10DLC brand/campaign are all created programmatically
by the API Worker. The **only three portal actions** you take are creating an API
key, copying the webhook public key, and creating the Call-Control (voice)
application.

---

## 1. Create the three portal credentials

### `TELNYX_API_KEY`

- Telnyx portal → **Account → API Keys** → create a **V2 API Key**.
- This becomes `TELNYX_API_KEY`; it's sent as `Authorization: Bearer <key>` on
  every Telnyx call (`apps/api/src/telnyx/client.ts:80`, `apps/api/src/env.ts:26`).

### `TELNYX_PUBLIC_KEY`

- Telnyx portal → **Account → Public Key** → copy the **webhook-signing public key**.
- This becomes `TELNYX_PUBLIC_KEY` (`apps/api/src/env.ts:27`). It is the **base64 of
  the 32-byte raw Ed25519 key** — the Worker rejects anything that isn't exactly 32
  bytes after base64-decoding (`apps/api/src/telnyx/verify.ts:34-40`).

Signature scheme the Worker enforces (`apps/api/src/telnyx/verify.ts:5-11,56-101`):
Ed25519 over the bytes `"{telnyx-timestamp}|{raw_body}"`, signature from the
`telnyx-signature-ed25519` header, timestamp from `telnyx-timestamp`, with a
**5-minute** tolerance. Verified with WebCrypto (`crypto.subtle`).

### `TELNYX_VOICE_CONNECTION_ID` — create the Call-Control application (once)

The missed-call text-back (D26 in `docs/DECISIONS.md`) needs inbound **voice**
events. Per-company numbers are ordered SMS-only, so the Worker later binds each
number's voice settings to one **shared Call-Control application** you create in
the portal (`apps/api/src/telnyx/voice.ts:1-22,68-118`):

- Telnyx portal → **Voice → Call Control** (a.k.a. Programmable Voice
  application) → create one application.
- **Webhook URL** = `https://api.loonext.com/webhooks/telnyx` (your
  `<API_ORIGIN>/webhooks/telnyx` — the **same endpoint as messaging**; `call.*`
  events are Ed25519-verified exactly like message webhooks).
- **Webhook failover URL** = the same URL.
- Copy the application's **id** → the `TELNYX_VOICE_CONNECTION_ID` Worker secret
  (`apps/api/src/env.ts:28-34`).
- **Assign an Outbound Voice Profile** (D38/#133 — without one, EVERY outbound
  dial 403s with "Connection has no Outbound Profile assigned"): create one
  (`POST /v2/outbound_voice_profiles` — traffic_type `conversational`,
  service_plan `global`, usage_payment_method `rate-deck`,
  `whitelisted_destinations: ["US","CA"]` to mirror the messaging posture),
  then `PATCH /v2/call_control_applications/{id}` with
  `outbound.outbound_voice_profile_id`. Done for prod on 2026-07-11
  (profile `3001971696790931111`, "loonext-conversational").

### `TELNYX_WEBRTC_CONNECTION_ID` — the shared WebRTC credential connection (once, D43)

Browser calling (docs/CALLS-V2.md) mints one **telephony credential per
member** on a single shared **credential connection**:
`POST /v2/credential_connections` with `connection_name`, a random
`user_name`/`password` (never used by clients — members get their own
credentials), `webhook_event_url` = the SAME `/webhooks/telnyx` endpoint,
`webhook_api_version: "2"`, `outbound.outbound_voice_profile_id` = the §1
profile, `inbound.codecs: ["OPUS","G722","G711U"]`. Copy the id → the
`TELNYX_WEBRTC_CONNECTION_ID` Worker secret. Done for prod on 2026-07-11
(connection "loonext-webrtc").

> **REQUIRED for INBOUND ringing (#135, learned the hard way in prod):** this
> connection MUST have `sip_uri_calling_preference: "internal"` —
> `PATCH /v2/credential_connections/{id}` with `{"sip_uri_calling_preference":
> "internal"}`. Every member browser REGISTERS its telephony credential/JWT on
> THIS connection, and each ring leg is a SIP-username INVITE to
> `sip:<sip_username>@sip.telnyx.com`. Set on prod 2026-07-12. WITHOUT it (the
> create-time default is null/disabled) the ring leg returns `state='failed'`
> and the browser never rings — the call goes straight to voicemail.
>
> **Which connection dials the ring (corrected 2026-10-31, D142; open).** D43's
> live fix dialed each ring leg from this connection, in `inbound-ring.ts` as it
> was then, because a ring dialed from the VOICE connection came back
> `state='failed'`. The call-session object that replaced that path dials every
> leg, ring legs included, from the VOICE connection: `connection_id =
> TELNYX_VOICE_CONNECTION_ID` in `apps/api/src/calls/runtime.ts`. The two
> disagree, and this file does not settle which is right. Keep the setting above
> all the same. Verify on production's next inbound call that a browser rings;
> if its leg fails, the ring has to dial from this connection again
> (`docs/RIG.md` §12, risk 14).

The Worker does the rest at runtime: when a company enables missed-call text-back
or sets a forward-to-cell, it PATCHes each active number's voice settings to
`connection_id = TELNYX_VOICE_CONNECTION_ID`
(`apps/api/src/telnyx/voice.ts:88-101`), and the `*/15` cron reconciles any
number that was missed (`apps/api/src/telnyx/voice.ts:160-205`). Only the voice
facet is touched — SMS keeps flowing through the messaging profile.

---

## 2. Account prerequisites (geo + 10DLC)

Nothing here is a code setting — these are Telnyx account capabilities the runtime
flows depend on:

- **US + Canada messaging** enabled. The Worker creates each company's messaging
  profile with `whitelisted_destinations: ["US","CA"]`
  (`apps/api/src/telnyx/provisioning.ts:152-153`), an SMS-pumping defense layer.
- **10DLC / Level 2 messaging** access, so the runtime can register brands and
  campaigns via the 10DLC API (see §4). Request this from Telnyx if your account
  isn't already enabled.
- Sufficient **balance / billing** to order phone numbers and pay 10DLC fees.

---

## 3. The single webhook URL — set programmatically, NOT in the portal

For **messaging**, there is no webhook field to fill in the Telnyx portal — the
one exception is the Call-Control application's webhook URL, entered once when
you create it (§1). The Worker sets the messaging callback URL itself when it
creates each company's messaging profile
(`apps/api/src/telnyx/provisioning.ts:143-155`, `apps/api/src/telnyx/wizard.ts:140-142`):

```
POST /v2/messaging_profiles
  name                 = <company.id>
  webhook_url          = https://api.loonext.com/webhooks/telnyx
  webhook_failover_url = https://api.loonext.com/webhooks/telnyx
  whitelisted_destinations = ["US","CA"]
```

Both the primary and failover URL are `${API_ORIGIN}/webhooks/telnyx`
(`apps/api/src/telnyx/wizard.ts:140-142`). The profile ID is stored on
`companies.telnyx_messaging_profile_id`. 10DLC brand/campaign payloads set the same
URL as `webhookURL` / `webhookFailoverURL`
(`apps/api/src/telnyx/wizard.ts:167-168`).

> **Consequence for deploy:** apart from the one-time Call-Control app (§1), you
> never paste a URL into Telnyx. You just need `API_ORIGIN` set correctly on the
> Worker ([05](./05-workers-deploy.md)) so the programmatic URL points at your
> live API. Telnyx expects a 2xx within ~2s and retries up to 6× (`SPEC.md:843`).

### What the webhook receives

Event dispatch by `event_type` (`apps/api/src/messaging/dispatch.ts:14-43`):

- `message.received` → inbound message
- `message.sent` / `message.finalized` → delivery status + usage metering
- `call.*` (Call-Control events from the voice application, §1) → missed-call
  text-back (`apps/api/src/messaging/voice-webhook.ts:99-120`)
- `10dlc.*` (brand/campaign/phone-number updates) → registration state machine
  (`apps/api/src/telnyx/registration.ts:864-925`)
- `porting_order.*` → port-in state machine (`apps/api/src/telnyx/porting.ts`)
- anything else → acked as a no-op

### Production talks to Telnyx directly; the rig goes through its guard (D142)

The rig (`docs/RIG.md`) runs this same Worker against the same Telnyx account,
so every difference is configuration, read in one place
(`apps/api/src/environments/`). For production that means:

- **Leave `TELNYX_API_BASE`, `TELNYX_WEBHOOK_URL` and `TELNYX_MEDIA_PUBLIC_BASE`
  unset.** A production Worker (`DEPLOY_ENV=production`, stamped by `ship.yml`)
  refuses to start with `TELNYX_API_BASE` set, because that would send
  customers' calls and texts to a stub or to the rig. With the other two unset,
  the webhook URL is `${API_ORIGIN}/webhooks/telnyx` as above and Telnyx fetches
  media from the signed storage URL directly.
- Nothing about the profile body above changes in production.

On the rig, `TELNYX_API_BASE` points at the guard behind the edge, and the
other two point Telnyx's callbacks and media fetches at the edge. In rig mode
the Worker also refuses, before any request, a dial, transfer, text or
verification code to a number outside the partition, and any 10DLC, porting or
hosted-messaging request, since those act on the whole account and the
sole-proprietor OTP texts a number the request does not carry; rejects inbound
calls and texts from strangers before they ring, reach voicemail or get a
text-back; and caps each messaging profile it creates at $0.03 a day with a
US/CA whitelist.

---

## 4. Runtime flows (no portal steps) — for your awareness

All of the below are done by the Worker via v2 REST; listed so you understand what
happens post-checkout and what account permissions must exist. No action required.

- **Number search + order** (`apps/api/src/telnyx/provisioning.ts:177-211,341-349`):
  `GET /v2/available_phone_numbers` (filters `country_code`, `features=sms`,
  `phone_number_type=local`, by NDC then falling back to administrative area), then
  `POST /v2/number_orders` with `messaging_profile_id` and
  `customer_reference=company.id`. Release is `DELETE /v2/phone_numbers/{id}`.
- **10DLC** (`apps/api/src/telnyx/registration.ts:391-417,428-432,460-471,514-532,696-700`):
  `POST /v2/10dlc/brand`, `PUT /v2/10dlc/brand/{id}`, `POST/PUT
  /v2/10dlc/brand/{id}/smsOtp`, `POST /v2/10dlc/campaignBuilder`,
  `POST /v2/10dlc/phoneNumberCampaign`, etc.

---

## 5. Buying the first number is automatic post-checkout

You do **not** manually buy a number. The flow, triggered by a successful Stripe
checkout:

1. Customer completes Stripe Checkout → Stripe fires `checkout.session.completed`.
2. The webhook handler activates the company, then calls `provisionCompanyNumber`
   and `submitRegistration` (`apps/api/src/webhooks/stripe.ts:252-272`).
3. `provisionCompanyNumber` **find-or-creates the messaging profile** (§3), searches
   inventory, and **orders a local number** on that profile
   (`apps/api/src/telnyx/provisioning.ts:143-211`).
4. The 10DLC **brand + campaign** are registered
   (`apps/api/src/telnyx/registration.ts`), and Telnyx sends `10dlc.*` webhooks back
   to the single `/webhooks/telnyx` URL as the registration progresses.
5. The `*/15` provisioning-reconcile cron and the `0 13` registration poller
   retry/adopt anything that stalled (`apps/api/src/index.ts:165-176,187`). The
   daily poller also migrates already-approved campaigns' declared content
   (review-ask `sample3` + description) once per campaign
   (`apps/api/src/telnyx/registration.ts:790-823`).

So the operator's job is only: keep `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`,
`TELNYX_VOICE_CONNECTION_ID` (the §1 Call-Control app), and `API_ORIGIN` correct
on the Worker, and ensure the account has US/CA + 10DLC permissions and balance.

### Production numbers never carry a billing group (D142)

**Production numbers never carry a billing group; the billing group marks a
number as belonging to the nonprod partition (D142).** The rig's test numbers
live in this same Telnyx account, in the `loonext-nonprod` billing group
(`docs/RIG.md` §3.6), so the group is the only thing telling the two apart.

- Production leaves `TELNYX_BILLING_GROUP_ID` **unset**. It then owns only
  numbers with no billing group, and its orders carry none
  (`apps/api/src/telnyx/ownership.ts`).
- The 15-minute reconcile sweep counts a number outside its partition and does
  nothing else: no orphan warning, no DELETE, no adoption. A release confirms the
  number is in the partition (`GET /v2/phone_numbers/{id}`) before it DELETEs,
  and refuses when the read does not positively state the number's group.
- If a customer's number ever gains a billing group, production stops managing
  it. It sends the `telnyx-ownership-mismatch` notice (PostHog fingerprint
  `ops:telnyx-ownership-mismatch`, level error) when it has evidence the number
  is its own: the number's `customer_reference` names one of its companies, or
  one of its `phone_numbers` rows holds the number's id or E.164. Every sweep
  that sees it sends it, and so does a refused release, so the PostHog issue
  stays open until the number is fixed. A refused release keeps the row
  un-released, and the daily grace pass carries on with the company's campaign
  and its other numbers. Fix it by clearing the group on the number in the
  portal. Never assign a billing group to a production number.
- `GET /health` lists `telnyx-partition-v1` in `capabilities` once a deploy
  enforces this rule. The rig orders no number until it sees it.

---

## 6. Production, and the nonprod partition beside it (D142)

There is no Telnyx sandbox and no second Telnyx account. Production and the
rig share this one account.

- **Production** uses the account's V2 key as `TELNYX_API_KEY` and its webhook
  public key as `TELNYX_PUBLIC_KEY` (copy it from **Account → Public Key**).
  `TELNYX_VOICE_CONNECTION_ID` is the §1 Call-Control application. Confirm the
  account is 10DLC-approved.
- **Testing against real Telnyx** happens on the rig, in the nonprod partition,
  through the guard (`docs/RIG.md` §3.5 and §3.6). The partition has its own
  Call-Control apps, credential connections, messaging profiles and numbers,
  and its numbers sit in the `loonext-nonprod` billing group. The rig holds no
  Telnyx key. It reaches Telnyx only through `loonext-telnyx-guard`, which
  holds the one extra key and refuses anything outside the partition.
- **Production numbers never carry a billing group** (§5). The group is the only
  thing that tells a rig number from a customer's. Never assign one to a
  production number, and never set `TELNYX_BILLING_GROUP_ID` in production.

---

## 7. What you now have

- `TELNYX_API_KEY` → api Worker secret.
- `TELNYX_PUBLIC_KEY` → api Worker secret.
- `TELNYX_VOICE_CONNECTION_ID` → api Worker secret (the Call-Control app id, §1).
- Account with US/CA + 10DLC enabled and funded.

---

## 8. Vendor-side daily spend limits (#642)

The app's own per-company caps are the first line against a bug that spends.
Telnyx's daily spend limit is the second: over the limit, Telnyx refuses new
calls on the outbound voice profile until 00:00 UTC, and answers HTTP 429 with
code `40333` to a send on a messaging profile (and fires
`messaging-profile.spend-limit-reached`, which the API acknowledges and does
nothing with). It also emails the account owner, but only after the fact.

### Sizing, from evidence

Read on 2026-11-01 from `GET /v2/detail_records`, the last 60 days
(`filter[date_range]=last_60_days`), production's resources only (no billing
group):

| Cost centre | Records | Busiest real day | Source |
|---|---|---|---|
| Voice | 4 calls on `sip-trunking`, with 3 matching `call-control` records, on 2 days | about USD 0.013 (2026-10-07: two outbound legs and one WebRTC inbound leg, 132 billed seconds) | `record_type=sip-trunking` and `call-control` |
| Messaging | 0 | none | `record_type=messaging` returned no rows |

Production has not carried real volume yet. The rule for the limit is the larger
of ten times the busiest real day and USD 25 a day: ten times is about USD 0.13
for voice and nothing for messaging, so the floor decides, and **both limits are
USD 25.00 a day** (about 1,900 times the busiest voice day). A limit that high
never caps a real customer day, and it is still far below what a loop could burn
in a day. When real volume arrives, re-measure; if ten times the busiest day
passes USD 25, raise the limit to that and change the floor in
`apps/api/src/telnyx/spend-limits.ts` in the same change.

### What was set (2026-11-01, one production configuration change)

Production's profiles are the ones without the `nonprod-` prefix. There is one
outbound voice profile and, today, one messaging profile (one per company; its
name is the company id).

| Profile | Field | Before | After |
|---|---|---|---|
| Outbound voice profile `loonext-conversational` | `daily_spend_limit` | `""` | `"25.00"` |
| | `daily_spend_limit_enabled` | `null` | `true` |
| Messaging profile of the production company | `daily_spend_limit` | `"0.00"` | `"25.00"` |
| | `daily_spend_limit_enabled` | `false` | `true` |

Read back after the change: nothing else on either profile moved (the
`updated_at` stamps apart). New messaging profiles are created with the same
limit (`ensureMessagingProfile` in `apps/api/src/telnyx/provisioning.ts`).

### How to revert, or to raise a limit

An outbound voice profile PATCH needs `name` and replaces the profile, so read it
first and send it back whole with only the limit fields changed:

```bash
curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/outbound_voice_profiles/<id>      # read, copy the fields below
curl -s -X PATCH -H "Authorization: Bearer $TELNYX_API_KEY" -H "Content-Type: application/json" \
  https://api.telnyx.com/v2/outbound_voice_profiles/<id> -d '{
    "name": "<name>", "traffic_type": "<as read>", "service_plan": "<as read>",
    "usage_payment_method": "<as read>", "whitelisted_destinations": ["US","CA"],
    "enabled": true, "tags": [], "concurrent_call_limit": null,
    "daily_spend_limit": "25.00", "daily_spend_limit_enabled": true }'
```

For a messaging profile a partial body is enough:

```bash
curl -s -X PATCH -H "Authorization: Bearer $TELNYX_API_KEY" -H "Content-Type: application/json" \
  https://api.telnyx.com/v2/messaging_profiles/<id> \
  -d '{"daily_spend_limit": "25.00", "daily_spend_limit_enabled": true}'
```

To revert, send `"daily_spend_limit_enabled": false` with the before values
above. Reverting removes the vendor-side cap. Raising a limit is fine and is not
drift; record the new figure and the reason here.

### Who hears about it

Telnyx does, and nothing of ours does (D146). Over a limit, Telnyx refuses the
call or the text itself and emails the account owner. A text it refuses fails on
the thread as an ordinary failed message with code `40333`, and the API sends no
notice of its own.

The account's Telnyx notifications, read from `GET /v2/notification_settings` on
2026-11-07:

| Notification | State | What it covers |
|---|---|---|
| Low Available Credit | enabled | The balance running down |
| Account Disabled Due to Insufficient Balance | enabled | The balance running out |
| Messaging Profile Activity | not enabled | A messaging profile changed or deleted, which is how a removed limit would be seen |

Nothing warns before a limit is reached. The hourly spend gauge that alerted at
70% of a limit is gone, and that early warning is a known gap.

---

## 9. The account level and its limits (#643)

No API exposes the account's level (`/v2/account` returns 404), and the founder
will not contact Telnyx, so the level is judged from what can be measured.

### Evidence

- **Measured, 2026-11-01.** The rig guard's validation check wrote
  `concurrent_call_limit` on an outbound voice profile that has no connection.
  Telnyx accepted **10** and refused **11**. Telnyx documents the field as "Must
  be no more than your global concurrent call limit", so the account's global
  concurrent call limit is **10**.
- **Paid** (developers.telnyx.com, "Paid Account Privileges & Limitations",
  fetched 2026-11-01): 5 concurrent outbound calls across all connection types,
  10 outbound calls an hour, 100 outbound calls a day, and Telnyx's automated-call
  announcement prepended to machine-generated audio.
- **Verified** (same site, "Verified Account Privileges & Limitations", fetched
  2026-11-01): full access except as the page specifies. It lists no hourly or
  daily call caps.
- **Level 2** (support.telnyx.com/en/articles/1130717): the concurrent limit is 2
  by default and 10 after Level 2.

A limit of 10 is above the Paid level's 5, so the account is **not at Paid**. It
matches Level 2 in the older framework, and a Verified account has no documented
cap below it. The exact name of the level is not recorded, because nothing
readable states it; the limits are.

### Limits that apply

| Limit | Value | Basis |
|---|---|---|
| Concurrent calls, account-wide | **10** | Measured (above), and recorded here. The rig's guard keeps its own evidence for the figure (`tools/guard/src/state/concurrency.ts`). |
| Outbound calls an hour (10) and a day (100) | **Do not apply** | Telnyx documents them for the Paid level only, and the measured concurrent limit rules Paid out. No direct measurement of an hourly or daily cap exists: if a dial is ever refused for rate with code `90103` and HTTP 429, treat this decision as wrong and re-open it. The rig's guard keeps assuming the Paid values as ceilings (`docs/RIG.md` section 3.5), which only makes the rig more cautious. |
| Automated-call announcement | **Does not apply** | A Paid-level behaviour. If a customer ever hears it, the account is at Paid or below and every row here is wrong. |

### Nothing prices production's calls against it

Telnyx has no API or notification for the concurrent call limit, and the API no
longer models it, so that is a known gap. A leg Telnyx refuses for the limit
reaches PostHog as an exception from the call path. When the account's level
changes, update the table above.

Next: [05 — Workers deploy](./05-workers-deploy.md).

---

## Port-out: notifications and protection (#398)

Two separate switches, both in the Telnyx portal, and **neither is on by
default**. Together they are the only thing standing between a customer's
business number and somebody taking it.

### 1. Port-out notifications — REQUIRED, or the code below never runs

`apps/api/src/telnyx/portout.ts` handles `portout.*` webhooks: it marks the
number `ported_out`, writes the audit row, emails the owner and sends the
`port-out` notice to PostHog. Telnyx does not send those events unless you switch
them on:

**Account Settings → Advanced Features → Notifications**
1. Create a **Notification Profile**.
2. Add a **New Channel** with the webhook URL `https://<API_ORIGIN>/webhooks/telnyx`.
3. Add a **New Setting**, choose **Port Out Notifications**, bind it to that
   profile and channel.

Without this, a number can leave the account and the product will never know —
inbound simply stops, which is the one failure it cannot detect on its own.

### 2. Port-out PIN (`external_pin`) — the anti-theft control

**Checked 2026-07-28 via the API: `external_pin` is NOT SET on our live number,
and `deletion_lock_enabled` is `false`.**

`external_pin` is the passcode a gaining carrier must supply to take a number
away. With it unset, a port-out request needs only the information printed on
the business's own website. Port-out fraud is an established attack, and the
number is both the customer's public identity and, for many services, an
authentication factor.

This is **deliberately not set from code**. A PIN the operator does not know is
worse than none — it blocks the customer's own legitimate port and turns a
routine goodbye into a support incident. Set it in the portal (or via
`PATCH /v2/phone_numbers/{id}` with `external_pin`), record it wherever account
recovery details live, and note the date here.

To re-check at any time:

```bash
curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/phone_numbers/<id> \
  | python -c "import sys,json;d=json.load(sys.stdin)['data'];print('pin set:',bool(d.get('external_pin')),'| deletion lock:',d.get('deletion_lock_enabled'))"
```
