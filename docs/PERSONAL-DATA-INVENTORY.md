# Where personal data lives (#340)

This exists because `contact_messages` was found by listing all the tables and
noticing one nobody had thought about. There was no reason to assume it was the
only one, and it was not.

**Every table is classified.** A new table added without a line here fails CI
(`supabase/tests/personal_data_inventory.test.sql`) — because the failure mode
of every inventory document is that it silently stops being true, and a stale
inventory is worse than none: it answers an access request confidently and
wrongly.

**Serves #227** (what deletion must cover), **#284** (what retention applies
to), and **#318** (the per-data-class location map).

> **Not to be confused with `docs/DATA-INVENTORY.md`**, which answers a
> different question and is the one the store declarations are filled from.
> That document covers **what leaves the device**, by data class, for the App
> Store and Play forms. This one covers **which table holds what, server-side**,
> for an access, deletion or retention question. A feature can change one
> without changing the other, so they are kept apart on purpose — but if you are
> adding a data class rather than a table, start there.

---

## The two people whose data we hold

The distinction runs through everything below and decides who can ask us for
what:

- **A USER** — a member of a workspace. They have an account, they agreed to
  our terms, and deletion is self-serve.
- **A CONTACT** — the customer's customer. A homeowner who texted a plumber.
  **They never agreed to anything with us**, they have no account, and their
  data belongs to the business, which controls it. We route their requests to
  that business.
- Plus **PROSPECTS** — people who filled in the contact form and never became
  either. They were the gap this inventory came from.

---

## 1. Contact data — the customer's customer

The most sensitive category, because the person never chose us.

| Table | Holds | Retention |
|---|---|---|
| `contacts` | name, phone, **address**, free-text notes | Life of the workspace; purged 30 days after closure |
| `messages` | **message bodies**, both directions | Same. The bodies are the product |
| `conversations` | phone-number link, timings | Same |
| `conversation_events` | who did what to a thread | Same |
| `attachments`, `message_attachments` | file names, and the objects in R2 | Same; soft-deleted objects reclaimed by sweep |
| `calls` | **caller name (CNAM)**, voicemail audio path, **voicemail transcript** | Same |
| `call_member_legs` | which member took which leg | Same |
| `opt_outs` | phone number | **Outlives the workspace.** A do-not-text record belongs to the person who sent the STOP, not the business that received it |
| `contact_consent_events` | consent attestations, stripped | **3 years**, names and message contents removed — CASL requires the record, not the content |
| `tasks` | free-text description, **job address** | Life of the workspace |
| `number_port_outs`, `text_enablement_orders` | phone numbers | Life of the workspace |

## 2. User data — our own customers

| Table | Holds | Retention |
|---|---|---|
| `profiles` | display name | Life of the account; self-serve deletion |
| `company_members` | membership, role | Same |
| `invites` | **email** of somebody not yet a user | Life of the workspace |
| `user_sessions` | **IP-derived city/region/country**, user agent, app version | Pruned 90 days after the session ends (#236) |
| `push_subscriptions`, `device_push_tokens` | endpoint, **user agent**, token | Removed with the session; dead rows pruned on send |
| `member_telephony_credentials` | SIP username | Life of the membership |
| `notification_prefs`, `notification_reads`, `notification_read_items` | per-user settings and read state | Life of the membership |
| `mfa_recovery_codes` | hashed codes only | Life of the account |
| `mfa_recovery_attempts` | attempt counts for the brute-force floor | Rolling window |
| `audit_log` | actor, **actor IP**, action | **12 months** (#231), then pruned |

## 3. Business data — the workspace itself

| Table | Holds | Retention |
|---|---|---|
| `companies` | business name, country, **CNAM display name**, away/greeting copy, Stripe ids | Life of the workspace |
| `messaging_registrations` | legal name, address, **SSN/SIN last-4** on the sole-prop path, OTP mobile | Identity fields cleared at **30 days** for signups that never paid (#381) |
| `port_requests` | **auth person name**, billing phone, **SSN/SIN last-4** | Life of the port |
| `phone_numbers`, `number_access`, `number_health` | the numbers and who may use them | Life of the workspace |
| `company_ai_settings` | business description | Life of the workspace |
| `templates`, `tags` | copy the business wrote | Life of the workspace |

## 4. Prospect data — neither user nor contact

**The category this inventory came from.**

| Table | Holds | Retention |
|---|---|---|
| `contact_messages` | name, **email**, company, message, **IP** | **IP at 30 days**, whole row at **1 year** (#340). Erasure: `scripts/ops/erase-contact.mjs` — no account required |

## 5. Operational data with an identifier attached

Not obviously personal, and worth naming precisely because that is how a table
gets overlooked.

| Table | Personal element | Retention |
|---|---|---|
| `email_events`, `email_suppressions` | **recipient email** | Suppressions outlive by design: they are how we stop mailing somebody who bounced or complained |
| `email_ledger` | an email **key**, not the address | Rolling |
| `public_link_access` | **country only**, deliberately never the IP (#335) | 30 days |
| `public_links` | token **hash** only, never the token | Life of the linked object |
| `webhook_events` | provider payloads, which **contain message bodies and numbers** | Pruned daily |
| `webhook_rejections` | signature failures | Rolling |
| `inbound_canary_runs` | our own numbers only | Rolling |
| `data_exports` | a notify-email id, and the export objects **contain everything above** | Expired exports deleted at 7 days (#378) |
| `usage_events`, `usage_alerts`, `egress_events`, `company_ai_usage`, `call_records`, `provider_costs`, `billing_disputes` | volumes and Stripe ids; no names or bodies | Billing record |

## 6. No personal data

`app_release_policy`, `company_modules`, `conversation_reads`,
`conversation_tags`, `feature_flags`, `feature_flag_overrides`, `grace_notices`,
`high_priority_push_budget`, `high_priority_push_days`,
`inbound_notification_days`, `liveness_heartbeats`, `message_mentions`,
`outbound_call_authorizations`, `outbound_dial_leases`, `ownership_transfers`,
`call_silence_state`, `retention_notices`.

Ids and counters. Listed rather than omitted, so "not in the document" always
means "somebody forgot", never "deliberately excluded".

---

## What this tells the three issues that depend on it

**#227 — what deletion must cover.** Sections 1–3 are in scope for a workspace
closure. Two things deliberately outlive it and both are defensible: `opt_outs`,
because the record belongs to the person who sent the STOP; and
`contact_consent_events`, stripped, because CASL requires the record for three
years. §4 is not reachable by any workspace deletion at all — a prospect has no
workspace — which is why it needed its own path.

**#284 — what retention applies to.** Every row above states one. The ones with
no natural expiry are the ones to argue about: `contacts`, `messages` and
`calls` are the product and last as long as the workspace does.

**#318 — the per-data-class location map.** The classes are the section
headings. The sharpest ones to be able to answer instantly: **SSN/SIN last-4**
lives in exactly two places (`messaging_registrations`, `port_requests`);
**IP addresses** in exactly two (`audit_log.actor_ip`, `contact_messages.ip`) —
`user_sessions` and `public_link_access` store derived geography rather than the
address, on purpose.

## Related

- `docs/DISASTER-RECOVERY.md` §4 — the stores that are not Postgres
- `docs/OPERATIONS.md` — `erase-contact.mjs`, the non-customer erasure path
- `docs/DECISIONS.md` D71/D75 — retention decisions made since
