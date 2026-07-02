# 04 — Telnyx

Telnyx is almost entirely driven at **runtime via the v2 REST API** — messaging
profiles, number orders, and 10DLC brand/campaign are all created programmatically
by the API Worker. The **only two portal actions** you take are creating an API
key and copying the webhook public key.

---

## 1. Create the two portal credentials

### `TELNYX_API_KEY`

- Telnyx portal → **Account → API Keys** → create a **V2 API Key**.
- This becomes `TELNYX_API_KEY`; it's sent as `Authorization: Bearer <key>` on
  every Telnyx call (`apps/api/src/telnyx/client.ts:80`, `apps/api/src/env.ts:12`).

### `TELNYX_PUBLIC_KEY`

- Telnyx portal → **Account → Public Key** → copy the **webhook-signing public key**.
- This becomes `TELNYX_PUBLIC_KEY` (`apps/api/src/env.ts:13`). It is the **base64 of
  the 32-byte raw Ed25519 key** — the Worker rejects anything that isn't exactly 32
  bytes after base64-decoding (`apps/api/src/telnyx/verify.ts:34-40`).

Signature scheme the Worker enforces (`apps/api/src/telnyx/verify.ts:5-11,56-101`):
Ed25519 over the bytes `"{telnyx-timestamp}|{raw_body}"`, signature from the
`telnyx-signature-ed25519` header, timestamp from `telnyx-timestamp`, with a
**5-minute** tolerance. Verified with WebCrypto (`crypto.subtle`).

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

There is **no webhook field to fill in the Telnyx portal.** The Worker sets the
callback URL itself when it creates each company's messaging profile
(`apps/api/src/telnyx/provisioning.ts:143-155`, `apps/api/src/telnyx/wizard.ts:140-142`):

```
POST /v2/messaging_profiles
  name                 = <company.id>
  webhook_url          = https://api.jobtext.app/webhooks/telnyx
  webhook_failover_url = https://api.jobtext.app/webhooks/telnyx
  whitelisted_destinations = ["US","CA"]
```

Both the primary and failover URL are `${API_ORIGIN}/webhooks/telnyx`
(`apps/api/src/telnyx/wizard.ts:140-142`). The profile ID is stored on
`companies.telnyx_messaging_profile_id`. 10DLC brand/campaign payloads set the same
URL as `webhookURL` / `webhookFailoverURL`
(`apps/api/src/telnyx/wizard.ts:167-168`).

> **Consequence for deploy:** you never paste a URL into Telnyx. You just need
> `API_ORIGIN` set correctly on the Worker ([05](./05-workers-deploy.md)) so the
> programmatic URL points at your live API. Telnyx expects a 2xx within ~2s and
> retries up to 6× (`SPEC.md:843`).

### What the webhook receives

Event dispatch by `event_type` (`apps/api/src/messaging/dispatch.ts:19-29`,
`apps/api/src/telnyx/registration.ts:800-850`):

- `message.received` → inbound message
- `message.sent` / `message.finalized` → delivery status + usage metering
- `10dlc.*` (brand/campaign/phone-number updates) → registration state machine
- anything else → acked as a no-op

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
   retry/adopt anything that stalled (`apps/api/src/index.ts:148,155`).

So the operator's job is only: keep `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, and
`API_ORIGIN` correct on the Worker, and ensure the account has US/CA + 10DLC
permissions and balance.

---

## 6. Sandbox vs production

- Use a **test/sandbox Telnyx setup** while validating: a low-cost number and a
  separate API key. The messaging-profile creation, number order, and 10DLC calls
  are the same v2 endpoints.
- For **production**, switch `TELNYX_API_KEY` to the live-account V2 key and confirm
  the account is 10DLC-approved. `TELNYX_PUBLIC_KEY` is the live account's webhook
  public key — copy it fresh from the production account's **Account → Public Key**.

---

## 7. What you now have

- `TELNYX_API_KEY` → api Worker secret.
- `TELNYX_PUBLIC_KEY` → api Worker secret.
- Account with US/CA + 10DLC enabled and funded.

Next: [05 — Workers deploy](./05-workers-deploy.md).
