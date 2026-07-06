# 07 — Telnyx, Resend, Sentry Setup + Webhook Registration

The vendor-side actions for **Telnyx**, **Resend**, and **Sentry/PostHog**, and
where each webhook URL is registered. Stripe's own setup (catalog, tax, its
webhook endpoint) is in [09](./09-stripe-catalog-setup.md). Supabase is in
[05](./05-supabase-migrations.md). Every fact cites `file:line`.

The one webhook URL rule for Loonext: **there is exactly one Telnyx webhook path
and one Stripe webhook path**, both on the API Worker, both outside the JWT/CORS
chain (the provider signature is the authentication) — `apps/api/src/index.ts:123-129`.
The Telnyx path receives messaging, 10DLC, porting, **and** `call.*`
Call-Control (voice) events alike.

| Provider | URL | Registered where | Auth |
|---|---|---|---|
| Telnyx | `${API_ORIGIN}/webhooks/telnyx` | **Programmatically**, per messaging profile (not the portal) — plus **once manually** on the Call-Control application ([04](./04-telnyx.md) §1) | Ed25519 |
| Stripe | `${API_ORIGIN}/webhooks/stripe` | **Manually**, one endpoint in the Stripe dashboard | HMAC |

With `API_ORIGIN=https://api.loonext.app` these are
`https://api.loonext.app/webhooks/telnyx`
(`apps/api/src/telnyx/wizard.ts:140-142`) and
`https://api.loonext.app/webhooks/stripe` (`apps/api/src/index.ts:129`).

---

## Telnyx

### Portal vs API — the split

Almost all Telnyx configuration is done **at runtime by the Worker via the v2
REST API**, not in the portal. The only manual portal actions are getting the
two credentials (API key + webhook signing public key) and any account-level
enablement Telnyx requires before you can order numbers or register 10DLC.

**Done in the Telnyx portal (operator, once):**

1. **Create a V2 API key.** Portal → Account → API Keys. This is
   `TELNYX_API_KEY`; it is sent as `Authorization: Bearer <key>` on every call
   (`apps/api/src/telnyx/client.ts:80`).
2. **Copy the webhook signing public key.** Portal → Account → Public Key. This
   is `TELNYX_PUBLIC_KEY` — the **base64 of the 32-byte raw Ed25519** public key.
   Anything that does not decode to exactly 32 bytes is rejected as misconfig
   (`apps/api/src/telnyx/verify.ts:5-11,38-40`). Signature verification is
   Ed25519 over `"{telnyx-timestamp}|{raw_body}"` from the
   `telnyx-signature-ed25519` header, 5-minute tolerance
   (`apps/api/src/telnyx/verify.ts:56-101`).
3. **Create the Call-Control (voice) application, once.** Portal → Voice →
   **Call Control** (Programmable Voice application): set its webhook URL **and**
   webhook failover URL to `${API_ORIGIN}/webhooks/telnyx` — the same endpoint as
   messaging; its `call.*` events carry the same Ed25519 signature and are
   verified identically. Copy the application id → `TELNYX_VOICE_CONNECTION_ID`
   (`apps/api/src/env.ts:28-34`). The Worker binds each company's numbers'
   **voice** settings to this application at runtime when missed-call text-back
   is enabled (`apps/api/src/telnyx/voice.ts:73,88-101`); the SMS binding
   (messaging profile) is never touched.
4. **Account-level messaging enablement / funding** as Telnyx requires before
   number orders and 10DLC (account balance, US 10DLC access). *Not encoded in
   the app — a Telnyx account prerequisite; the code assumes ordering and 10DLC
   submission succeed.*

That is the entire portal surface. **Do NOT create messaging profiles, set
per-profile webhook URLs, order numbers, or register brands/campaigns in the
portal** — the Worker does all of that per-company via the API, and a
portal-created profile would not be linked to a company row.

### What the Worker does via the API (no operator action)

Listed so you understand what NOT to do by hand, and so you can recognize the
objects in the Telnyx portal.

**Messaging profile — one per company** (the number-provisioning saga step S1,
`apps/api/src/telnyx/provisioning.ts:134-170`):

- `POST /v2/messaging_profiles` with `name = company.id`,
  `webhook_url` **and** `webhook_failover_url` both set to
  `${API_ORIGIN}/webhooks/telnyx` (`provisioning.ts:143-155`,
  `telnyx/wizard.ts:140-142`). Both point to the same URL — that is how Telnyx's
  6-attempt delivery (3 primary + 3 failover) is enabled (`provisioning.ts:150`).
- `whitelisted_destinations: ["US","CA"]` — SMS-pumping defense, US + Canada only
  (`provisioning.ts:151-154`).
- The returned profile id is stored on `companies.telnyx_messaging_profile_id`
  (`provisioning.ts:160-168`).

**Number order** (saga S2/S3, `apps/api/src/telnyx/provisioning.ts:330-365`):

- Search inventory: `GET /v2/available_phone_numbers` filtered by country,
  `features=sms`, `phone_number_type=local`, and the requested area code
  (national destination code), falling back to the area code's state/province
  (`provisioning.ts:177-211`).
- Order: `POST /v2/number_orders` with the chosen number,
  `messaging_profile_id`, and `customer_reference = company.id`
  (`provisioning.ts:341-349`). The order id is persisted immediately (crash
  recovery) and the number activated when the order completes.
- Release (on grace expiry / number delete): `DELETE /v2/phone_numbers/{id}`,
  tolerating 404 (`provisioning.ts:539-557`).

**10DLC brand + campaign registration** (`apps/api/src/telnyx/registration.ts`
and `apps/api/src/telnyx/wizard.ts`). The full §4.4 API contract:

| Purpose | Telnyx call | Source |
|---|---|---|
| Create brand | `POST /v2/10dlc/brand` | `registration.ts:466-471`, payload `wizard.ts:150-184` |
| Update brand (rejected-resubmit) | `PUT /v2/10dlc/brand/{brandId}` | `registration.ts:460-464` |
| Sole-prop OTP trigger/resend | `POST /v2/10dlc/brand/{brandId}/smsOtp` | `registration.ts:391-399` |
| Sole-prop OTP verify | `PUT /v2/10dlc/brand/{brandId}/smsOtp {otpPin}` | `registration.ts:407-417` |
| Poll brand | `GET /v2/10dlc/brand/{brandId}` | `registration.ts:428-432` |
| Create campaign | `POST /v2/10dlc/campaignBuilder` | `registration.ts:514-532`, payload `wizard.ts:193-227` |
| Poll campaign | `GET /v2/10dlc/campaign/{campaignId}` | `registration.ts:891-899` |
| Assign number → campaign | `POST /v2/10dlc/phoneNumberCampaign {phoneNumber, campaignId}` | `registration.ts:696-700` |
| Deactivate campaign (grace) | `DELETE /v2/10dlc/campaign/{campaignId}` | `registration.ts:1013-1017` |

The brand and campaign payloads carry `webhookURL` and `webhookFailoverURL`
both set to the single Telnyx route (`wizard.ts:167-168,224-225`), so 10DLC
status updates come back to the same `/webhooks/telnyx` endpoint.

### Telnyx webhook — event types the Worker handles

The single `/webhooks/telnyx` route dispatches on `data.event_type`
(`apps/api/src/messaging/dispatch.ts:14-43`, `SPEC.md:864-867`):

| `event_type` | Handler | Source |
|---|---|---|
| `message.received` | inbound pipeline (threading, opt-out, MMS download) | `dispatch.ts:21-23` |
| `message.sent` | mark message `sent` | `dispatch.ts:24-26` |
| `message.finalized` | delivery status + metering | `dispatch.ts:24-26` |
| `call.*` (from the Call-Control app: `call.initiated`, `call.hangup`, `call.machine.detection.ended`; other lifecycle events are acked no-ops) | missed-call text-back — forward-to-cell dial + computed-missed → text-back | `dispatch.ts:27-31`, `messaging/voice-webhook.ts:99-120` |
| `10dlc.brand.update` | brand state machine | `dispatch.ts:32-35`, `registration.ts:873-881` |
| `10dlc.campaign.update` | campaign state machine | `registration.ts:883-894` |
| `10dlc.phone_number.update` | number-assignment ledger | `registration.ts:896-923` |
| `porting_order.*` | port-in state machine (PORTING.md §5.1) | `dispatch.ts:36-41`, `telnyx/porting.ts` |

Anything else is acked as a no-op (`dispatch.ts:42`). You do **not** enable these
event types in a portal UI — they are delivered because the messaging profile,
10DLC objects, and the Call-Control application were created with the webhook
URL set (above). Telnyx requires
a 2xx within 2 seconds and retries up to 6× (`SPEC.md:843`); the route acks fast
and processes in `waitUntil`, with a PK-dedupe ledger for the expected
duplicates (`apps/api/src/webhooks/telnyx.ts:31-74`).

**Yields env vars:** `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`,
`TELNYX_VOICE_CONNECTION_ID` (`apps/api/src/env.ts:26-34`). The only portal
webhook-URL entry is the one on the Call-Control application (step 3);
everything else is programmatic.

---

## Resend

Two uses, both need one verified domain and one API key.

1. **Transactional email from the API Worker.** Plain REST:
   `POST https://api.resend.com/emails` with `Authorization: Bearer
   RESEND_API_KEY` and `from: RESEND_FROM` (`apps/api/src/email/resend.ts:15,
   28-40`). Resend owns **all** transactional email — billing, registration,
   provisioning, notifications (`SPEC.md:106`).
2. **Supabase Auth custom SMTP.** Invite/signup/reset emails are sent by
   Supabase Auth using **Resend as the custom SMTP provider**
   (`SPEC.md:100,1065`). Configured in the Supabase dashboard — see
   [05](./05-supabase-migrations.md).

**Operator actions in the Resend dashboard:**

1. **Add and verify the sending domain** (e.g. `loonext.app`) — add the DKIM/SPF
   DNS records Resend gives you and wait for verification. `RESEND_FROM` must use
   an address at this verified domain, e.g.
   `Loonext <notifications@loonext.app>` (`apps/api/src/env.ts:42-43`,
   `apps/api/.dev.vars.example:18`). An unverified domain makes every
   `sendEmail` throw on the non-2xx (`apps/api/src/email/resend.ts:43-50`).
2. **Create an API key** → `RESEND_API_KEY` (`re_...`)
   (`apps/api/src/env.ts:37`).
3. For Supabase SMTP: Resend → SMTP credentials; plug host/port/user/pass into
   Supabase Auth (see [05](./05-supabase-migrations.md)).

**Yields env vars:** `RESEND_API_KEY`, `RESEND_FROM`.

---

## Sentry

One action: create a project, take its DSN.

- The whole Worker (fetch + scheduled) is wrapped by `Sentry.withSentry` with
  `dsn: SENTRY_DSN`, `sendDefaultPii: false`, `tracesSampleRate: 0`, and PII
  scrubbing in `beforeSend`/`beforeBreadcrumb`
  (`apps/api/src/index.ts:242`, `apps/api/src/observability/sentry.ts:117-125`).
- The scrubber redacts E.164 phone numbers everywhere and strips name-keyed
  fields, request bodies, cookies, and query strings before anything leaves the
  Worker (`apps/api/src/observability/sentry.ts:20-110`). No extra Sentry-side
  configuration is required for the PII policy — it is enforced in code.

**Operator action:** Sentry dashboard → your project → Settings → Client Keys
(DSN) → copy → set `SENTRY_DSN` (`apps/api/src/env.ts:38`).

**Yields env var:** `SENTRY_DSN`.

## PostHog

**Optional, server-side only.** The API Worker has a single `capture` helper
(`apps/api/src/analytics/posthog.ts`) that posts the north-star funnel events
(checkout completed, first outbound sent, registration submitted/approved) to
PostHog Cloud US. `distinct_id` is always the **company_id** — never a person,
never PII (`posthog.ts:40`), and captures are best-effort (a PostHog outage
never breaks the send/webhook path, `posthog.ts:49-57`).

**Operator action (optional):** create a PostHog Cloud US project and set its
Project API key as the `POSTHOG_API_KEY` Worker secret
(`apps/api/src/env.ts:65`). With the key unset, every capture is a silent no-op
(`posthog.ts:31`) — running without PostHog is fully supported. There is no
web-side PostHog client; the strings in marketing/legal pages are prose only.

**Yields env var:** `POSTHOG_API_KEY` (optional).
