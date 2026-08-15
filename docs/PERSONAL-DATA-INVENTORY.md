# Where personal data lives (#340)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

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
| `conversation_snoozes` | which member deferred which thread, until when, and a short note THEY wrote (#293). No customer data — the note is a crew member's own words about their own work | Same |
| `conversation_summaries` | **a paraphrase of the customer's own messages** (#247) — the cached thread catch-up, plus the id of the message each line was drawn from. Same class as `messages` and deliberately not a weaker one: a summary of what somebody said is a statement about that person, and Canada's Criminal Code s.183 treats "the substance, meaning or purport" of a communication as the communication. Every line is a quotation from the thread by construction, so an erasure that reached the messages and left this behind would leave the words in the workspace under a different table name | Same as `messages`. Overwritten on every new message, cascades away with the message it was written from, and purged with the workspace |
| `saved_views` | a member's own list filters under a name THEY wrote (#280). The filters can name a teammate (assignee) or a tag; no customer data | Same |
| `scheduled_messages` | **an unsent message body** addressed to a contact (#233), plus who wrote it and whose clock it was timed against | Same as `messages`, and it must be purged with the workspace for a second reason: a row that outlives closure would fire a text into a number that has since been released, from a business that no longer exists |
| `contacts.custom_fields` | **whatever the workspace defined** (#291) — equipment serials, gate codes, site notes. Declared as CONTACT data, the same class as a name: covered by the same retention, export and erasure. The product tells owners not to store payment, government-ID or health data there, because a text column cannot enforce it | With the contact |
| `contacts.custom_values` | a search projection of the VALUES in `custom_fields` (#291), derived and never written directly. No new personal data — it holds nothing the row does not already carry, and it goes with the contact on erasure and export because it is a column on that row | With the contact |
| `contact_field_defs` | a workspace's own field NAMES (#291). No customer data — it is configuration, recorded here because "none" is an answer that has to be written down | Life of the workspace |
| `contact_phones` | **a customer's other numbers** (#291) — the landline, the second person in the household, the site cell. The same class of personal data as the primary number on `contacts`, and matched against inbound webhooks, so it is stored in E.164 like every other number | Deleted with the contact (FK cascade) |
| `contact_addresses` | **where a customer lives or has property** (#291), one row per address. The most sensitive field in the record after the phone number, and now plural — a property manager's forty buildings are forty addresses | Deleted with the contact (FK cascade), so erasure and export reach them through the contact they belong to |
| `job_ratings` | **a customer's rating of a finished job** (#313), and which member it was attributed to. No free text — the answer is a digit | Same as `messages`: it is a statement by the customer about a visit to their home, so an export and an erasure both have to carry it |
| `appointment_reminder_rules` | the workspace's own reminder wording and how far before a job it goes (#237). No customer data — the body is a template written by a member | Same as `templates`: it must be purged with the workspace, because a rule that outlives closure is the wording for a text from a business that no longer exists |
| `attachments`, `message_attachments` | file names, and the objects in R2 | Same; soft-deleted objects reclaimed by sweep |
| `calls` | **caller name (CNAM)**, voicemail audio path, **voicemail transcript** | Same |
| `call_member_legs` | which member took which leg | Same |
| `opt_outs` | phone number | **Outlives the workspace.** A do-not-text record belongs to the person who sent the STOP, not the business that received it |
| `blocked_senders` | phone number, plus a free-text reason a member typed (#250) | Life of the workspace; purged with it. Deliberately NOT like `opt_outs`: a block is one business refusing one number, which says nothing about what any other business may do, so it must not outlive the workspace that made it |
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
| `on_call_shifts` | **which member was holding the phone, and when** (#244) — a record of one person's working hours, which is employment data rather than a preference | Life of the workspace; deleted with the member |
| `alert_escalations` | **which member was paged and which one claimed it** (#244). No customer content: the conversation is referenced, never copied | Life of the workspace; the user columns null out with the member |
| `pending_notifications` | **which member is owed a notification about which thread** (#297), for the minutes before their batch closes. No content: the conversation is referenced, never copied | Deleted the moment the batch is sent; nothing survives a flush |
| `cancellation_reasons` | **which member said the workspace was leaving, and what they wrote** (#277). `detail` is free text somebody typed while annoyed, which is the most candid thing in the database and can name a person, a competitor or a price. Classified here rather than under business data for that reason: the row is attributable to the member who wrote it | Life of the workspace; the user column nulls out with the member |

## 3. Business data — the workspace itself

| Table | Holds | Retention |
|---|---|---|
| `companies` | business name, country, **CNAM display name**, away/greeting copy, Stripe ids | Life of the workspace |
| `messaging_registrations` | legal name, address, **SSN/SIN last-4** on the sole-prop path, OTP mobile | Identity fields cleared at **30 days** for signups that never paid (#381) |
| `port_requests` | **auth person name**, billing phone, **SSN/SIN last-4** | Life of the port |
| `phone_numbers`, `number_access`, `number_health` | the numbers and who may use them | Life of the workspace |
| `company_ai_settings` | business description | Life of the workspace |
| `templates`, `tags` | copy the business wrote | Life of the workspace |
| `voicemail_greetings` | an **audio recording of a crew member's voice** (#309), plus the `created_by` user id. The speaker is one of OUR users, never a contact — a greeting is the business introducing itself, which is why it carries none of the consent weight a customer's voicemail does. It is still someone's voice: a recording identifies a person more directly than their name does, so it is listed here rather than under "no personal data" | Life of the workspace; the row cascades on closure and the audio object is purged with the bucket |
| `stripe_connect_accounts` | the workspace's Stripe **account id**, its country and Stripe's own onboarding flags — and NOT the bank details, the legal name, the date of birth or the ID documents behind them, which is the whole point of the D133 Express decision: Stripe collects and holds those, we mirror only the answers. `requirements_due` is a list of Stripe requirement IDENTIFIERS (`individual.verification.document`), never the values (#224) | Life of the workspace; the row cascades on closure. The Stripe ACCOUNT is deliberately not deleted with it — it is the business's own legal entity, with payout history they are required to keep |
| `payment_requests` | an amount, a currency, and **what the money is for in the business's own words**, joined to the conversation and contact it was sent into (#224). The description is free text a crew member typed and can name a person or a place — "Deposit, Mrs Ellis, 14 Alder Rd" — so it is listed here rather than under "no personal data". No card details, no bank details, no customer name of its own | Life of the workspace; erased with it, and named in `purge_workspace_step` |
| `lead_sources` | the owner's own words for where their customers come from — "Truck", "Yard sign", "Neighbour" — plus the `created_by` user id (#301). The NAMES are the business's marketing vocabulary and describe nobody; the attribution they carry sits on `conversations`, which is already listed, and says which of the owner's own channels a contact arrived through rather than anything about the contact themselves | Life of the workspace; cascades on closure |

## 4. Prospect data — neither user nor contact

**The category this inventory came from.**

| Table | Holds | Retention |
|---|---|---|
| `contact_messages` | name, **email**, company, message, **IP** | **IP at 30 days**, whole row at **1 year** (#340). Erasure: `scripts/ops/erase-contact.mjs` — no account required |
| `widget_verifications` | **the visitor's mobile number**, **IP**, and a code **hash** — never the code (#232/D124) | **Whole row at 30 days**, `api_prune_widget_verifications`. Deliberately far shorter than `contact_messages`' year: a contact submission is a message somebody meant to send and may reference later, while this is a machine artifact nobody will ever ask about, kept only for a few days of abuse forensics. Goes with the workspace in the teardown |
| `marketing_contacts` | **email**, the consent timestamp, the surface it was given on, and **the exact words agreed to** | **Unsubscribed rows at 30 days**; a consent that never produced a send at **1 year**. A LIVE consent is kept while it is the basis for sends — deleting it while still mailing somebody is worse than never recording it (#312) |

**One asymmetry in §4 worth stating out loud, because it looks like an oversight
and is not.** An unsubscribed `marketing_contacts` row loses its plaintext at 30
days, but the matching `email_suppressions` entry (§5) is kept **indefinitely**.
That is deliberate: you cannot honour "never email me again" without remembering
who asked. Forgetting the address to be tidy would let the next capture re-add
them, which is the opposite of respecting the request.

## 5. Operational data with an identifier attached

Not obviously personal, and worth naming precisely because that is how a table
gets overlooked.

| Table | Personal element | Retention |
|---|---|---|
| `email_events`, `email_suppressions` | **recipient email** | Suppressions outlive by design: they are how we stop mailing somebody who bounced or complained |
| `email_ledger` | an email **key**, not the address | Rolling |
| `public_link_access` | **country only**, deliberately never the IP (#335) | 30 days, swept daily by `job:prune-public-link-access` — `apps/api/src/crons/retention-prunes.ts`. The window was published here while the SQL that enforces it had no caller (#581); the number was always right, the sweep is what makes the row true |
| `public_links` | token **hash** only, never the token | Life of the linked object |
| `webhook_events` | provider payloads, which **contain message bodies and numbers** | Pruned daily |
| `webhook_rejections` | signature failures | Rolling |
| `webhook_deliveries` | the payloads we send OUT, which **contain message bodies, numbers and contact names** — the same class as `webhook_events`, copied into a second table (#243) | **30 days**, `api_prune_webhook_deliveries`, swept daily. The payload is kept rather than rebuilt so a redelivery re-sends the event as it was; that is a real requirement and it is also why this row needed a retention answer rather than inheriting one. Goes with the workspace in the teardown |
| `webhook_endpoints` | a **URL** the business chose, its **signing secret**, and the **user id** who added it. No contact data | Life of the endpoint; deleted with the workspace. The secret is readable by `service_role` alone — no policy and no grant reaches it from a client key, because anything that can read it can forge our signature |
| `inbound_canary_runs` | our own numbers only | Rolling |
| `data_exports` | a notify-email id, and the export objects **contain everything above** | Expired exports deleted at 7 days (#378) |
| `usage_events`, `usage_alerts`, `egress_events`, `company_ai_usage`, `call_records`, `provider_costs`, `billing_disputes`, `prepayments`, `referrals` | volumes and Stripe ids; no names or bodies | Billing record |

## 6. No personal data

`app_release_policy`, `company_modules`, `conversation_reads`,
`conversation_tags`, `feature_flags`, `feature_flag_overrides`, `grace_notices`,
`high_priority_push_budget`, `high_priority_push_days`,
`inbound_notification_days`, `liveness_heartbeats`, `message_mentions`,
`outbound_call_authorizations`, `outbound_dial_leases`, `ownership_confirmations`,
`ownership_transfers`, `call_silence_state`, `probe_results`,
`retention_notices`, `template_uses`.

Ids and counters. Listed rather than omitted, so "not in the document" always
means "somebody forgot", never "deliberately excluded".

One of them deserves a sentence rather than a place in a list.
`ownership_confirmations` (#537) holds no name, address or message — a workspace
id, a user id, which handover step it is for, and a **hash** of the six-digit code
that was emailed. It is a CREDENTIAL rather than personal data, which is why it is
here and not in section 5: nothing in it describes a person. It is also
short-lived by construction — a row is spent on first use and dead after ten
minutes either way — so there is nothing to retain and nothing an export would
usefully contain.

`template_uses` (#475) is here for the same conditional reason, and the
condition is the shape of the table: it holds a template id, a boolean, and a
timestamp. There is no `contact_id` and no `conversation_id`, deliberately — a
usage counter is aggregate, but *which reply did you send this person* is a
per-contact fact, and nothing that needed the ledger (sorting a picker, finding
dead templates, gating a delete confirmation) needed that. Adding either column
would move this row to section 5 and is its own decision, which is exactly why
they were left out rather than added "in case".

`probe_results` (#477) is in this section CONDITIONALLY, and the condition is
enforced in the schema: its `detail` column is a short failure code, capped at
64 characters, never a message and never a body. A probe that recorded what it
actually saw — a number it texted, a URL with a key in it — would move this
table into section 5 on the first bad day. The cap is what keeps it here.

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
**IP addresses** in exactly three (`audit_log.actor_ip`, `contact_messages.ip`,
`widget_verifications.ip`) —
`user_sessions` and `public_link_access` store derived geography rather than the
address, on purpose.

## Related

- `docs/DISASTER-RECOVERY.md` §4 — the stores that are not Postgres
- `docs/OPERATIONS.md` — `erase-contact.mjs`, the non-customer erasure path
- `docs/DECISIONS.md` D71/D75 — retention decisions made since
