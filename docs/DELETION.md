# Deleting a workspace

The ordered teardown behind D48. `DELETE FROM companies WHERE id = …` fails on
the first of **25 `restrict`** foreign keys, having already destroyed rows
through **13 `cascade`** ones — which is why deletion is a sequence, not a
statement.

Counts are from the live schema, not from reading migrations:

```sql
select c.confdeltype, count(*)
  from pg_constraint c
  join pg_class f on f.oid = c.confrelid
 where c.contype = 'f' and f.relname = 'companies'
 group by 1;
```

Re-run that after any migration that adds a company-scoped table. **A new table
with a `company_id` and no entry in this document is a workspace that cannot be
deleted**, and nothing will say so until someone tries.

---

## The two phases

**Phase 1 — the request (one transaction, synchronous).** What the customer
experiences as deletion:

1. `companies.deleted_at` is stamped and a `purge_after` 30 days out is
   recorded.
2. Every member's sessions end and their push registrations go (the machinery
   from #276 — `api_revoke_user_sessions`, `push_subscriptions`,
   `device_push_tokens`).
3. The workspace stops resolving: it is gone from `/v1/me`, from every
   workspace switcher, and from every read path.
4. The Telnyx number is released, and the Stripe subscription is cancelled.
   Both are chargeable and neither should wait 30 days.

Nothing is erased yet, and the customer is told exactly that.

**Phase 2 — the erasure (resumable job, after the window).** The order below,
running in batches with a recorded position, so an interrupted run resumes
rather than restarting or stranding the workspace half-erased.

Reversal is possible at any point in phase 1 and impossible once phase 2 starts.

---

## Teardown order

Each step must complete before the next. The ordering is forced by `restrict`
edges *between* company-scoped tables — a child has to go before its parent,
whatever the company-level policy says.

| # | Table | Why here |
|---|-------|----------|
| 1 | `usage_events` | `restrict` → `messages` |
| 2 | `tasks` | `restrict` → `messages` **and** → `conversations` |
| 3 | `message_mentions` | `restrict` → `conversations` (cascades from `messages`, but the order matters) |
| 4 | `message_attachments` | cascades from `messages`; delete first so the Storage sweep below has the paths |
| 5 | `attachments` | cascades from `conversations`; same reason — the paths are needed |
| 6 | `messages` | `restrict` → `conversations`. **Bodies erased**; see *What survives* |
| 7 | `conversation_events` | cascades from `conversations`, `restrict` → `companies` |
| 8 | `conversations` | `restrict` → `contacts` **and** → `phone_numbers` |
| 9 | `calls`, `call_records` | `set null` to numbers/conversations/contacts, so any time before `companies` — but after `conversations` to keep the journey intact while it exists |
| 10 | `port_requests`, `text_enablement_orders` | `restrict` → `phone_numbers` |
| 11 | `contacts` | freed by step 8 |
| 12 | `phone_numbers` | freed by steps 8 and 10 |
| 13 | `tags` | `conversation_tags` cascades from both sides |
| 14 | `templates`, `invites`, `messaging_registrations`, `grace_notices`, `inbound_notification_days`, `usage_alerts`, `egress_events`, `audit_log`, `company_members`, and the 13 `cascade` tables | independent children; any order |
| 15 | `companies` — **anonymised, not deleted** | see below |

**The `companies` row survives, stripped.** An earlier draft of this document
said step 15 deleted it and released `opt_outs.company_id`; that is not
possible — the column is `NOT NULL`, and it should not be made nullable to
serve a teardown. Keeping the row is the better answer anyway, and it is what
D48 meant by *anonymise, not erase*: the row becomes the anchor that keeps
`opt_outs` enforceable and gives the CASL consent artifact somewhere to hang,
while carrying none of the business's identity.

Cleared at step 15: `name`, `stripe_customer_id`, `stripe_subscription_id`,
`telnyx_messaging_profile_id`, `chosen_number_e164`, `away_message`,
`mctb_message`, `voicemail_greeting`, `cnam_display_name`, and `business_hours`
(reset to `{}` — the column is `NOT NULL`). Kept: `id`, `created_at`,
`country`, `timezone` and a `purged_at` stamp, so a regulator's question — was
there consent, on what date, in what jurisdiction — still has an answer.
`timezone` stays because it is `NOT NULL` with a default and says nothing about
who the business was.

Because the row survives, the 13 `cascade` tables no longer go with it and are
deleted explicitly at step 14: `call_member_legs`, `company_ai_settings`,
`company_ai_usage`, `company_modules`, `email_ledger`,
`member_telephony_credentials`, `notification_prefs`,
`notification_read_items`, `notification_reads`, `number_access`,
`outbound_call_authorizations`, `outbound_dial_leases`, `provider_costs`.

### Outside the database

A teardown that leaves a customer's voicemail audio in a bucket has not deleted
anything meaningful. All three are **Supabase Storage**, not R2:

- **`attachments`** — note and task files. Paths come from step 5.
- **`mms-media`** — inbound and outbound picture messages. Paths from step 4.
- **`voicemails`** — the recordings, which are ours: the audio is downloaded
  into our bucket and the Telnyx copy deleted at ingest.

And the third-party records: the **Stripe** customer (phase 1 cancels the
subscription; phase 2 deletes the customer), the **Telnyx** number (released in
phase 1 — see #316: a released number must carry no history to whoever gets it
next), and every **push registration** for the workspace's members.

---

## What survives, and why

Total erasure is not available to us, and a deletion feature that claims it is
lying. Two things outlive the workspace:

**`opt_outs` — kept whole, forever.** A STOP belongs to the person who sent it,
not to the business they sent it to. Erasing it would let the same owner, re-
signed-up on a new workspace, text somebody who told them to stop — the one
place where honouring the customer's deletion request harms a third party. It
stays, in full, because the phone number *is* the record.

**Consent artifacts — anonymised, kept to the CASL floor.** SPEC §5 retains
consent records and message history for three years. We keep the minimum that
proves consent existed — the number, the timestamps, the source — and erase
everything around it: contact names, emails, addresses, message bodies,
attachments, voicemail audio. That satisfies both obligations instead of
choosing one, and it is the only version of "we deleted your data" that is
true.

---

## What the customer is told

Before the button, not after:

- Everything in the workspace is erased in 30 days: messages, photos,
  voicemails, contacts, tasks, notes.
- Access ends now. The number is released now, and it cannot be got back.
- Anyone who told you to stop texting stays on the do-not-text list. That is
  the law and it protects them, not us.
- A record that consent existed is kept for three years, with names and
  message contents removed.
- Until the 30 days are up, this can be undone by contacting us. After that it
  cannot be undone by anyone.

And in writing, twice (#371). The screen that said all of this is one the
person is signed out of a second later, so it is also emailed:

| When | To | What it says |
|---|---|---|
| The workspace closes | The owner who closed it | What ended now, the date of the erasure, that it can still be undone until then |
| The erasure finishes | The same address, stored for this | That it is done, and on what date. **This is the receipt** — the artefact a regulator asks for |
| An account is deleted | The address being deleted, *before* it is severed | What went, what went back to the crew, what stays with the business |

The copy in those emails is built from this section
(`apps/api/src/workspace/deletion-emails.ts`) so the emails, the confirmation
screens and the public page cannot drift into three different promises.

The address for the second one is captured on `companies.purge_receipt_email`
when the workspace closes, because by the time the purge finishes it has
deleted `company_members` and there is no owner left to look up. The anonymise
step clears it.

**A failed send never fails or reverses a deletion.** The customer asked to
leave; an unsent receipt raises in Sentry and is ours to chase.

---

## Open, and tracked elsewhere

- **#316** — a released number must carry no history to its next owner.
- **#325** — deletion ordering against a live call or an in-flight port.
- **#340** — `contact_messages` from the public marketing form is keyed to
  nobody and is structurally out of reach of a company-scoped teardown. It
  needs its own retention, not a hook here.
- **#346** — deleting an *account* (a person across every workspace) is a
  different operation that builds on this one.
