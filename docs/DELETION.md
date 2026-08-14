# Deleting a workspace

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

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
| 6 | `conversation_summaries` | cascades from both `messages` and `conversations` (#247), and listed anyway: a catch-up quotes the customer's own words, so an erasure that reached the bodies and left this behind would leave those words in the workspace under another table name |
| 6 | `messages` | `restrict` → `conversations`. **Bodies erased**; see *What survives* |
| 7 | `conversation_events` | cascades from `conversations`, `restrict` → `companies` |
| 8 | `conversations` | `restrict` → `contacts` **and** → `phone_numbers` |
| 9 | `calls`, `call_records` | `set null` to numbers/conversations/contacts, so any time before `companies` — but after `conversations` to keep the journey intact while it exists |
| 10 | `port_requests`, `text_enablement_orders` | `restrict` → `phone_numbers` |
| 11 | `contacts` | freed by step 8 |
| 12 | `phone_numbers` | freed by steps 8 and 10 |
| 13 | `template_uses` | cascades from `templates` and `companies`; batched explicitly (#475) so a high-volume ledger cannot stall the erasure inside one cascade |
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
`mctb_message`, `emergency_message`, `offramp_message`, `voicemail_greeting`,
`cnam_display_name`, `signup_source`, `signup_landing_path`, and
`business_hours` (reset to `{}` — the column is `NOT NULL`).

Kept: `id`, `created_at`, `country`, `timezone` and a `purged_at` stamp, so a
regulator's question — was there consent, on what date, in what jurisdiction —
still has an answer. `timezone` stays because it is `NOT NULL` with a default
and says nothing about who the business was. Also kept, each for its own
reason: `legal_hold_reason` (clearing it would leave a hold in place with its
justification destroyed), `aup_enforcement` and `aup_enforcement_note` (the
abuse history, so the same actor cannot be re-onboarded with no memory of why
they left), and the configuration columns — ring strategy, call screening,
locale, currency, crew size, requested area code — which are settings rather
than identity.

> **This paragraph was wrong until 2026-08-09, and the way it was wrong is the
> point.** It presented itself as exhaustive while omitting `emergency_message`
> and `offramp_message` — the business's own words to its own customers, the
> same class as the `away_message` sitting three items earlier in the list. They
> were added to `companies` after `anonymize_purged_workspace` was written, and
> nobody came back to either the function or this list. A published exhaustive
> list with nothing checking it against the table is a promise that decays
> silently. `supabase/tests/purge_coverage.test.sql` (PC-3) now asserts the
> cleared set against the catalog, with the keep-list and a reason for each
> entry, so a text column added to `companies` in future fails the build until
> somebody decides which side of this paragraph it belongs on.

Because the row survives, the 13 `cascade` tables no longer go with it and are
deleted explicitly at step 14: `call_member_legs`, `company_ai_settings`,
`company_ai_usage`, `company_modules`, `email_ledger`,
`member_telephony_credentials`, `notification_prefs`,
`notification_read_items`, `notification_reads`, `number_access`,
`outbound_call_authorizations`, `outbound_dial_leases`, `provider_costs`.

### Outside the database

A teardown that leaves a customer's voicemail audio in a bucket has not deleted
anything meaningful. All four are **Supabase Storage**, not R2:

- **`attachments`** — note and task files. Paths come from step 5.
- **`mms-media`** — inbound and outbound picture messages. Paths from step 4.
- **`voicemails`** — the recordings, which are ours: the audio is downloaded
  into our bucket and the Telnyx copy deleted at ingest.
- **`exports`** — the data exports (#227). Added by **#378**, which found this
  list saying "all three" while a fourth bucket held, by its own header, "a
  copy of every message, contact and note the workspace holds" — the most
  concentrated personal-data object the system produces, and one nothing ever
  deleted. Unlike the other three it stores a PREFIX per row rather than a path
  per object, so the sweep lists the prefix first.

  Every export goes, not only unexpired ones: `expires_at` governs whether a
  customer may still download it, and erasure is about whether the data exists
  at all. A six-month-old export is exactly as complete a copy as yesterday's.

  Expired exports are also reclaimed **daily**, independently of any deletion
  request (`pruneExpiredExports`). The completion email promises the links are
  good for seven days "after which the export is deleted"; until #378 that was
  enforced only as an access check, so expired meant invisible rather than
  gone, and every export ever built was retained forever for every workspace.

And the third-party records: the **Stripe** customer (phase 1 cancels the
subscription; phase 2 deletes the customer), the **Telnyx** number (released in
phase 1 — see #316: a released number must carry no history to whoever gets it
next), and every **push registration** for the workspace's members.

---

## The retention sweep deletes in a DIFFERENT order, on purpose

The nightly sweep (`workspace/retention-enforce.ts`) ages out a batch of
messages inside a workspace that is still very much alive. That single
difference changes two steps of the order above, and #581's C3 finding is what
happens when the difference is not written down.

| # | What | Why this and not the teardown's answer |
|---|------|----------------------------------------|
| 1 | resolve the batch's `tasks` ids | a task's files are keyed by the TASK, so once the row is gone there is nothing left to find them by |
| 2 | remove the Storage objects — MMS, note files, task files | the rows hold the paths, so objects go first (the #378 rule, unchanged) |
| 3 | delete the `attachments` rows | `owner_id` is a bare uuid with **no** foreign key across two id spaces, so neither the message nor the task cascades them. Removing the object and keeping the row makes the gallery list a photo that 404s |
| 4 | delete `tasks` | `message_id` is `NOT NULL … restrict`: a task is a promoted message and cannot outlive one |
| 5 | **null** `usage_events.message_id` | the teardown DELETES this row; the sweep must not. It is the billing meter — a count and a Stripe identifier, carrying nothing a customer wrote — and the workspace is still trading. The column is already nullable for adjustment rows, and the hourly re-reporter reads `meter_identifier ?? id` |
| 6 | delete `messages` | `message_attachments` and the mention rows cascade from here |

Steps 4 and 5 are the two `on delete restrict` edges pointing at `messages`.
Both were missing, so the delete at step 6 threw **after** step 2 had already
destroyed the customer's photos — every night, for any workspace with a short
enough window. It was dormant only because nothing outside SQL sets
`retention_days`, which is a fact about the product's surface area rather than
about the code being right.

`supabase/tests/retention_enforce.test.sql` pins the set of restrict edges in
**both** directions, so a third one added later fails a build instead of a
customer's attachments.

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

- ~~**#316**~~ — **closed.** A released number carries no history to its next owner (D86).
- ~~**#325**~~ — **closed (D97).** Deletion cannot race a live call: D48 splits
  teardown into closure (immediate, transactional) and purge (30 days later),
  so a live call outlives closure and is long gone before purge. The split was
  forced by Storage, Stripe and Telnyx not being transactional; that it also
  makes the race impossible is a second reason to keep it. An in-flight port
  continues to completion.
- ~~**#340**~~ — **closed.** `contact_messages` got its own retention rather
  than a hook here (`api_prune_contact_messages`, one year). It is still out of
  reach of a company-scoped teardown, which is now a stated BOUNDARY on
  `/legal/delete-my-data` rather than an unmentioned gap (#357).
- ~~**#346**~~ — **closed.** Deleting an *account* ships, and the public page
  covers it.

Both were listed here as open while the pages that quote this document were
being written, which is the drift #323 is about: a stale "open" list is read as
an admission. Struck rather than deleted, so the next reader can see the two
resolved rather than wonder whether they were ever tracked.
