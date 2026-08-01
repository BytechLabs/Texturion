# Disaster recovery (#249)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

`docs/deploy/08-operations.md` §6 covered backups in six lines: "confirm PITR is
enabled", and to recover, "use the dashboard to restore to a timestamp". That is
a plan, not a capability — an untested backup is a belief, and the first
exercise of a belief is always during the worst hour of the company's life.

This document exists so nobody reads that sentence at 3am and discovers what it
left out.

---

## 1. The targets (D74)

| | Target | What it means |
|---|---|---|
| **RPO** — how much data we can lose | **Up to 24 hours** (verified 2026-07-29) | PITR is **OFF** on production, so the only restore points are the daily physical backups. The 5-minute figure this row used to carry assumed PITR was on; nobody had checked. See §2 |
| **RTO** — how long until we are serving again | **4 hours** | Not because recovery takes four hours, but because *discovering, deciding, and reconciling* does |

**These numbers are a commitment about the database only.** The reconciliation in
§4 is bounded by what Stripe and Telnyx will tell us, and neither has an SLA to
us. A recovery is "done" when texting works; it is "correct" days later.

---

## 2. What we actually know, and how we know it

**The logical restore path is measured**, not assumed:

```bash
node scripts/ops/backup-drill.mjs
```

**Drill record — 2026-07-30, local Supabase (PostgreSQL 17.6):**

| Phase | Result |
|---|---|
| Source | 70 base tables (+1 view), 188 functions |
| Dump (`pg_dump -F c`) | **0.5s**, 1.3 MB |
| Restore (`pg_restore`) | **1.5s** |
| Verification | ✓ 70 base tables, 188 functions, **every per-table row count matched exactly** |
| **Total data time** | **2.0s** |

The counts are **base tables**, with views reported separately. The first version
of this record said "66 tables" from an unfiltered count that included the
`task_map_rows` view, while the per-table row comparison only ever covered base
tables — so it claimed to have verified one more object than it compared. A
recovery record that overstates its own coverage, even by one, is the kind of
small inaccuracy that makes a reader distrust the rest of it.

**Re-run the drill after any release.** The earlier figures (66/154) went stale
within a day: 27 migrations landed between writing them and reading them again,
adding 5 base tables and 34 functions. The numbers in a table like this decay, so
the command matters more than the row.

What the drill genuinely proves: the dump restores, no constraint or extension
bites only on reload, and nothing is silently dropped. Those are the failures
that hide until you need them.

What it does **not** prove, stated plainly rather than left to be assumed:

- **It is not a PITR drill.** Restoring Supabase's own backup into a fresh
  project is a dashboard action with a cost. It is also moot until PITR is on,
  which it is not (below) — the only thing to restore *from* today is a daily
  snapshot.
- **It runs against local, not production.** Production scale is now measured
  separately rather than guessed:

```bash
node scripts/ops/prod-dump-scale.mjs   # read-only; writes nothing to disk
```

  **Measured 2026-07-30:** production holds 50 base tables, 102 functions, ~3,300
  rows, **20.2 MB** on disk, and `pg_dump -F c` produced **1.16 MB in 31.5s** over
  the session pooler.

  Two things worth reading off that. First, **31.5s against local's 0.5s for
  almost the same bytes** — the real path is ~60× slower because the time is
  network round-trips, not data, so quoting a local drill number as the real one
  understates it by an order of magnitude. Second, it is *still* seconds. The
  data half of the RTO is negligible at this size, which is what makes the
  4-hour RTO a statement about §4 rather than about `pg_restore`.

  Both numbers stop meaning anything past roughly a gigabyte, when bytes rather
  than round-trips set the pace. Re-run it then.

  Nothing is written to disk, deliberately: a full production dump at rest on a
  developer's machine is customer message bodies and phone numbers with no
  retention policy, and the only thing it would buy is a restore timing that
  local already measures per byte. The bytes are counted in flight and discarded.

- **Production trails `main` by design.** 50 base tables against local's 70 is
  not drift — only a merged release ships migrations (D50), so the released
  schema is behind the repo's. At the time of measuring, 45 migrations were
  unreleased. §5 is where that matters.
- **2.0 seconds is not the RTO.** At our size the data is the *fast* part.
  Provisioning a target, moving secrets, repointing DNS and doing §4 dominate.

### PITR status — a fact, with a date

Recorded rather than assigned as a chore, and now **re-checked weekly by CI**
rather than by anybody remembering: `.github/workflows/backup-posture.yml` runs
the posture script every Monday.

| Checked | By | Plan | PITR | Backups retained |
|---|---|---|---|---|
| **2026-07-30** | `scripts/ops/verify-backup-posture.mjs` (Management API) | Supabase Pro, us-east-1 | **OFF** | 7 daily physical, oldest 2026-07-23, newest 23.8h old |

That last column is a **count of the snapshots the API returned**, not a retention
setting — the script reads no retention policy, and calling it "retention" implied
a configured guarantee where there is only an observed list. The count moved from
8 to 7 between 2026-07-29 and 2026-07-30, which is a rolling window doing what it
does, and exactly why a number here needs a date beside it.

**What the weekly job alarms on, and what it deliberately ignores.** It runs the
script in `--monitor` mode, which fails only if backups have *stopped* — none at
all, or the newest older than 36 hours. It does **not** fail because PITR is off:
that is a recorded founder decision with a price attached, not news, and a
scheduled job that is red every week for a reason everybody already knows is a job
people learn to scroll past. The thing worth alarming on is the daily snapshot
quietly failing, because that is the change nobody would otherwise notice until a
recovery. PITR turning *on* is reported loudly and fails nothing — it is good news
whose correct response is editing this table and D74.

**PITR is not enabled.** The worst case this section told the reader to assume
turned out to be the actual case, which is why assuming it was the right
instruction — and why leaving the row blank was not.

It did not need a dashboard visit after all. `scripts/ops/verify-backup-posture.mjs`
asks the Management API directly, read-only, with the token CI already holds.
**Run it before answering any question about RPO** — including a security
questionnaire. In its default mode it **exits non-zero while PITR is off**, which
is what makes it usable as a gate on such an answer rather than merely
informative. It does not, on its own, stop the tighter claim reappearing in a
document; the weekly job above is what keeps this table from going stale, and
nothing mechanically prevents somebody writing "5 minutes" in new prose.

One limit worth knowing: the script asserts the PITR **boolean**, not the
24-hour figure. "Up to 24 hours" follows from PITR being off plus a daily
snapshot cadence, and the script prints the age of the newest backup so you can
see the live exposure — but the 24 is reasoning, not a measurement.

**What this means in practice.** The only restore points are the daily snapshots,
taken around 05:27 UTC. At the moment of checking, the newest was **18.1 hours
old** — that was the live exposure, not a theoretical maximum. Anything written
since the last snapshot is gone in a total-loss scenario.

**Enabling PITR is a paid Supabase add-on and a founder decision**, and it is the
one change that would make the 5-minute figure real. Until then 24 hours is the
number, and it is what goes in a security questionnaire.

---

## 3. Order of operations

1. **Stop the bleeding before restoring anything.** `docs/ROLLBACK.md` §1 —
   kill switches take effect in ~10 seconds and need no deploy. If the cause is
   a bad release rather than data loss, you are in the wrong document.
2. **Establish the restore point — you do not get to choose an instant.** With
   PITR off there is no restore-to-a-timestamp capability. The restore points are
   the **daily snapshots**, taken around 05:27 UTC, seven or eight retained, so
   the reach is about a week. The restore point is *the newest snapshot at or
   before the last moment you trust*, which can be up to 24 hours earlier than
   the moment you actually wanted. **Write down that snapshot's timestamp**, not
   the timestamp you wished for: every step in §4 is measured from it, and the
   gap between the two is the data that is simply gone.
3. **Restore Postgres** from that snapshot.
4. **Answer the migration question** (§5) *before* pointing the Worker at it.
5. **Reconcile the five stores that did not roll back** (§4), and read that
   section's first paragraph before starting — one of the five *partly does*
   roll back, which changes what reconciliation even means for it.
6. **Then** re-enable outbound.

---

## 4. Postgres is not all our state

Restoring the database alone leaves us inconsistent with **five** other systems.
For each, the posture is reconciliation, not restoration.

**One correction to make before anything else in this section, because the
original version of it got this backwards.** "None of them roll back" was the
premise, and it is wrong for the largest one: **object storage half rolls back.**
This product uses **Supabase Storage**, not Cloudflare R2 — `apps/api` has no R2
binding at all — and Supabase Storage keeps its object metadata in
`storage.objects`, *a table in the same Postgres cluster being restored*. So a
restore rewinds our knowledge of which objects exist while the bytes stay exactly
where they were. That asymmetry is what makes the storage reconciliation below
different in kind from the other four, and it is why every tool that reasons
"from `storage.objects` outward" stops working right after a restore.

### Supabase Storage — four buckets, and only two of them have a sweeper

The buckets, all Supabase Storage:

| Bucket | Rows that point at it | Reclamation today |
|---|---|---|
| `attachments` | `attachments` | `job:sweep-deleted-attachments` |
| `mms-media` | `message_attachments` | `job:sweep-deleted-attachments`, plus `api_orphan_mms_media_objects` / `api_ghost_mms_media_rows` |
| `voicemails` | `calls.voicemail_path` | `job:sweep-deleted-attachments`, via `api_orphan_voicemail_objects` / `api_ghost_voicemail_calls` (#479) |
| `exports` | `data_exports` | delete-on-expiry, plus `api_orphan_export_objects` for prefixes whose row is gone or reaped (#479) |

Two kinds of drift, and the *directions matter differently* than the original
version of this section said:

- **Rows pointing at objects that are gone.** An attachment deleted after the
  restore point has had its bytes removed, and the restored row references it
  again. Downloads fail with a signed URL to nothing.
- **Objects with no row.** Files uploaded after the restore point still exist and
  we still pay for them, and now nothing in the database mentions them.

**Reconciliation — and the hard part is that none of our existing tools work on
this day.** Three traps, and the third is the one that matters.

**Trap one: `created_at` cannot find the broken rows.** "List attachment rows
created after the restore point and probe each object" — the instruction this
section used to give — returns the empty set. After a restore, no row *has* a
`created_at` after the restore point; those rows are precisely what was rolled
away. The broken rows are the ones that came *back*, whose objects were deleted in
the meantime, and they all predate the restore point.

**Trap two: the orphan scans reclaim nothing, and cannot.**
`api_orphan_attachment_objects` and `api_orphan_mms_media_objects` enumerate
candidates *from* `storage.objects`. A file uploaded after the restore point lost
its `storage.objects` row in the restore along with its application row — so the
anti-join returns nothing for it. Worse, `storage.objects` is the *only handle on
the bytes*: `storage.remove()` resolves paths through it, so an object with no
metadata row cannot be enumerated or deleted through the product at all. Those
bytes are unreachable and billable until somebody takes an inventory on the
storage backend side.

**Trap three: the ghost scans cannot find the broken rows either.**
`api_ghost_attachment_rows` and `api_ghost_mms_media_rows` look for a row with no
`storage.objects` row. But the restore brought the metadata row *back* alongside
the application row — both were rolled back together — while the bytes stayed
deleted. So the ghost scan sees a healthy pair and reports nothing.

**Put together: after a restore, `storage.objects` describes the world as of the
restore point and the bytes describe the world as of now, and every tool we have
reasons from `storage.objects`.** Both directions of drift are invisible to all
four RPCs. This is a genuine gap, not a procedure to follow, and it is worth
saying so rather than listing a job that will report zero and be ticked off.

### The procedure (#479)

**Half of that is now a tool, and the other half is provably unbuildable.**

**Broken rows — run `scripts/ops/reconcile-storage.mjs`.** It ignores
`storage.objects` entirely and asks the storage backend whether each live row's
object is really there: a signed URL, then a one-byte ranged GET through it. The
signing step proves nothing on its own (it resolves through the table that is
wrong); the fetch is the answer.

```
SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/ops/reconcile-storage.mjs
SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/ops/reconcile-storage.mjs --apply
```

Dry run by default, like every script in that directory. It covers all four
buckets, and what `--apply` does differs by bucket on purpose:

| Bucket | Repair | Why |
|---|---|---|
| `attachments`, `mms-media` | row deleted | the row exists only to describe an object |
| `voicemails` | pointer cleared, row kept | `calls` is a business record; somebody phoned, and that stays true without the audio. **The transcript is kept** — it is the only remaining record of what the caller wanted |
| `exports` | `reaped_at` stamped | the row is the record of a request (#378); stamping stops the UI offering a download that cannot work |

Each bucket is independent: one that cannot be read is reported loudly and the
other three still run. That is not hypothetical politeness — the first real dry
run against production stopped on `exports` because prod was a few migrations
behind main, which is an ordinary state between releases and must not cost an
operator the three buckets that would have reported.

**Unreferenced bytes — there is no tool, and there cannot be one on this plan.**
That was checked rather than assumed. Supabase's S3-compatible endpoint is served
at `project_ref.storage.supabase.co/storage/v1/s3` — Supabase's own service
speaking the S3 protocol, not credentials for the bucket underneath. `ListObjectsV2`
through it lists what `storage.objects` knows, which is precisely the table that
is wrong after a restore. No inventory of the backing store is purchasable.

**So the residual is a bounded cost leak, and here is the bound.** The orphaned
objects are exactly those uploaded between the restore point and the restore.
With PITR **off** (see §2 — the real RPO is up to 24 hours, not 5 minutes), the
worst case is one day of uploads across `attachments`, `mms-media` and
`voicemails`. At current volumes that is single-digit megabytes and a cost of
roughly a cent a month, held forever. It is worth knowing rather than fixing, and
it will stay worth knowing until upload volume is three orders of magnitude
larger.

The honest expectation after a restore is therefore: **no customer is left with
an attachment that 404s** — the script finds and repairs those — and we pay
indefinitely for up to one RPO window of objects we cannot see or reach.

**Broken rows should be deleted, not left as silent 404s.** A customer needs to
know a photo is gone, not click a button that fails.

**`voicemails` and `exports` need naming separately**, because they have the least
cover and the most consequence:

- **`voicemails` has no sweep in either direction.** An orphaned voicemail
  recording is paid-for storage nothing will ever reclaim; a restored `calls` row
  with a rolled-away recording is a voicemail the crew can see and never play.
- **`exports` is the highest-consequence object in the product** — a data export
  is a copy of every message, contact and call in a workspace. An export built
  after the restore point loses its `data_exports` row, so the expiry-driven
  delete never fires and the most concentrated personal-data object we produce
  sits in a bucket indefinitely with nothing tracking it. **Enumerate the
  `exports` bucket by hand after a restore and delete anything with no row.**

### Durable Objects — live call state

**Undefined behaviour, and the most dangerous item here.** A `CallSessionDO`
carries authoritative machine state *outside* Postgres. A DB restore under live
DOs means the DO believes in a call the database has never heard of.

**The `calls` row is not an independent durable record.** It is written *by* the
DO, as a best-effort mirror with a bounded retry budget — 12 attempts, 3 seconds
apart, so about 36 seconds total (`apps/api/src/calls/session-do.ts`). Every one
of those writes goes to the very Postgres being restored. A restore guarantees
they fail for longer than the budget, and then the mirror gives up. So during the
restore window the durable record is *not* being kept, and calls that were live
across it may have no row at all.

**Containment, stated as what the switch actually does.** Turning off
`kill:calls` (`docs/ROLLBACK.md`, or `node scripts/ops/set-flag.mjs`) refuses new
softphone tokens **and** refuses new outbound calls at
`POST /v1/calls/browser` — that second gate was missing until #249 found it, so
a softphone holding an already-issued token (good for up to 24 hours) used to keep
placing calls straight through a thrown switch.

Two residuals it does **not** cover, and an operator should expect both:

- **Inbound calls keep arriving.** Telnyx does not know about our flag. Inbound
  calls still reach the webhook and still create `CallSessionDO` state; what the
  switch prevents is the crew *answering* them, because answering needs a token.
  In practice they ring out to voicemail — which is a better outcome than a
  half-restored call, but it is still new DO state during the window.
- **`job:sweep-stale-calls` does not close DO state.** It never touches a DO. It
  prunes stale outbound authorizations, hangs up Telnyx legs open past
  `MAX_LIVE_CALL_MS`, and finalizes `calls` rows. So there is no bounded "wait for
  the sweeper" step; waiting is for in-flight calls to end on their own.

DO state itself is not worth restoring — it is short-lived by design. What is
worth knowing is that the `calls` rows for that window are unreliable, and no job
will notice.

### Stripe — subscriptions, and three other kinds of money

**Does not roll back, and the drift is money.** A restore past a billing event
puts our tables out of sync with the actual charges — in our favour or the
customer's, and *we would not know which*.

**Subscriptions.** `job:subscription-reconcile` re-mirrors Stripe's state, and it
is the right tool with a **narrower reach than it looks**: its scans cover
companies whose stored `subscription_status` is neither `active` nor `canceled`,
plus `active` companies whose `current_period_end` has already passed. A company
that was `active` before the restore point and still looks `active` afterwards is
not examined at all, even if its plan or period changed in between. So it is a
first pass, not a proof.

It also has **no on-demand entry point** — its only trigger is the `0 15 * * *`
cron. "Run it immediately rather than waiting for its daily slot" was an
instruction with nothing behind it. Either wait for the slot, or reconcile the
affected companies from Stripe's dashboard by hand, which is what the next three
items require anyway.

**Invoices are not reconciled by anything.** `syncSubscription` writes five
subscription columns and touches no charge. The section heading used to say
"subscriptions and invoices"; only the first half was true.

**The $29 US-registration fee can be charged a second time by the restore
itself.** The "charged at most once, ever" guard is entirely columns on
`companies` — the paid stamp and the in-flight claim — and a restore rolls both
back. A workspace that paid after the restore point comes back looking unpaid,
and the next registration attempt charges again. **Before repointing the Worker,
pull Stripe's charges for the restore window and re-stamp the paid marker by hand
for every company that already paid.**

**Metered usage gets re-reported.** Segment and voice-minute reporting queues on
`stripe_reported_at` being null. A restore brings back rows whose reporting stamp
was written after the restore point, so the hourly usage jobs will report them to
Stripe a second time and customers are billed twice for the same traffic. Same
remedy: re-stamp from Stripe's record before the Worker runs, or accept and issue
credits.

Then check the webhook ledger for Stripe events between the restore point and now
and replay them — `job:sweep-webhooks` does this, but only for events we received
and stored. **Events that arrived during the outage may never have been stored at
all**; Stripe's dashboard is the source of truth for that window, not our ledger.

### Telnyx — numbers

**Does not roll back.** A number ordered after the restore point still belongs to
us and is missing from our tables. A number *released* after the restore point is
gone from the carrier's pool and may already belong to another business — while
our restored table says it is ours.

**Reconciliation:** `job:reconcile-numbers` adopts orphans (a number we own with
no row) on its normal cadence — the Telnyx→database direction, and it works. The
reverse, **a row claiming a number we no longer hold, has no tool at all**, and it
is the dangerous direction: the workspace looks healthy and every send fails.

Marking those rows `provision_failed` is the instruction, with one caveat that
matters for exactly the customers who care most: the remediation path only
re-provisions numbers we bought. For a **ported or hosted** number — the
customer's own number, brought to us — there is nothing to re-provision, and
`provision_failed` routes them to a flow that cannot help. Handle those by
re-establishing the number with the carrier, not through the app.

### Telnyx — 10DLC registrations and in-flight ports

The fifth store, and the one the original section omitted entirely. Both are
paid, carrier-side, and measured in weeks rather than seconds.

**10DLC brand and campaign registrations.** Every campaign submission buys a fresh
vetting fee. The only guards against re-submitting are counters on
`messaging_registrations`, and a restore rolls them back — so a restored workspace
can re-submit and pay again. Check the registration state at Telnyx before letting
any workspace re-register.

**In-flight porting orders.** A confirmed port is a multi-week carrier commitment
with an FOC date, and its entire saga state lives in `port_requests`. Both
recovery paths fail *closed* on a missing row: the webhook handler no-ops when it
cannot find the order. So a port confirmed after the restore point becomes a port
that is still happening at the carrier and that we have no record of, and the
number arrives with nothing expecting it. **List open porting orders at Telnyx and
compare against `port_requests` before re-enabling anything.**

---

## 5. Migration-after-restore

**Restoring to a timestamp before a migration leaves a schema the deployed
Worker does not expect.** `supabase db push` runs *before* `wrangler deploy`, so
the schema is always at or ahead of the code — restoring backwards inverts that
for the first time.

Ask the same question `docs/ROLLBACK.md` §3 asks:

- **The restore point is before an ADDITIVE migration.** The current Worker
  expects a column that no longer exists. **Re-run the migrations** — they are
  written expand-first and are idempotent (`if not exists`, `create or replace`),
  so re-applying is safe.
- **The restore point is before a REMOVING or NARROWING migration.** The current
  Worker expects the *narrower* shape and the restored data may violate it.
  Re-running the migration can fail on data written between the restore point and
  the drop. Fix the data first, then re-apply.

```bash
git log --oneline <restore-point-date>..HEAD -- supabase/migrations/
```

**Do not point the Worker at a restored database before doing this.** A Worker
against an unexpected schema fails in ways that write more bad data.

---

## 6. Independent backups

Everything currently lives inside **one vendor account**. Account-level loss —
compromise, billing failure, provider action — takes the backups with the data.
That is the same concentration argument as #241, applied to storage rather than
carriage.

**Current position:** we accept the concentration risk, and this is the honest
statement of it rather than a claim to have solved it. The mitigation available
today costs nothing to state: `scripts/ops/backup-drill.mjs` produces a portable
`pg_dump` in seconds, and a copy taken to any store outside Supabase converts "one
account" into "two".

An earlier version of this paragraph said R2 "is a different vendor and is already
provisioned". It is not provisioned — `apps/api` has no R2 binding, and every
object in this product is in Supabase Storage, i.e. *inside the same account* this
section is worried about. So the second store is a decision to make, not one
already sitting there, and the concentration is worse than that sentence implied:
the database, all four object buckets, and the backups are one account.

**What has not been decided** is where that copy lives, who holds the key, and
its retention. Those are founder decisions with cost and custody implications,
and inventing them here would be exactly the kind of unverified instruction this
document was written to replace.

---

## Related

- `docs/ROLLBACK.md` — kill switches, and the same migration question for a bad deploy
- `docs/OPERATIONS.md` — the support scripts; note that a released number is gone
- `docs/DECISIONS.md` D74 — the RPO/RTO decision and its reasoning
