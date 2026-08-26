# Capacity: what breaks first, and at what volume

> **Status: partial; #251 remains open.** Updated 2026-08-25 with local lower
> bounds for every functional axis and a fail-closed deployed driver for the
> managed-pooler and hosted-Realtime connection axes. The driver has **not run**:
> there is still no deployed non-production environment or credential. Hosted
> ceilings, Realtime delivery under hosted fan-out, deployed call
> latency/co-tenancy, honest degradation at those ceilings, and Worker/DO
> compute cost therefore remain unknown. A capacity number that reads as
> measured and was guessed is worse than an admitted gap: it is the number
> somebody quotes to a 50-tech prospect.

Re-run the measured halves with:

```bash
pnpm db:start
node scripts/ops/query-load.mjs
pnpm --filter @loonext/api test:load
pnpm --filter @loonext/api test:workerd
pnpm --filter @loonext/api capacity:deployed -- --help
```

Every scenario that runs emits an aggregate `CAPACITY_RESULT {json}` line. Save those
lines with the date and commit rather than copying terminal prose into this
document; they contain no request bodies, tokens, phone numbers, or customer
data.

## Acceptance matrix

This is the source of truth for #251's axes. A lower bound means the scenario
completed at that size; it is not a claim that the next size works or that a
ceiling was found.

<!-- capacity-matrix:start -->
| Axis ID | What | Rerun | Tested bound | Ceiling | Acceptance state |
|---|---|---|---|---|---|
| query | Hot list queries at realistic volume | `node scripts/ops/query-load.mjs` | 50,000 conversations / 200,000 messages; all current surfaces under 200 ms | Not reached | Local lower bound measured |
| webhook | Duplicate retry storm and distinct inbound burst | `pnpm --filter @loonext/api test:load` | 25 concurrent copies → 1 row; 40 distinct → 40 rows; zero hangs | Not reached | Local lower bound measured |
| pooler | Concurrent reads and database failure shape | Local: `pnpm --filter @loonext/api test:load`; hosted: `capacity:deployed -- --scenario api ...` | 40 concurrent local reads; every database request has a 10 s deadline | Managed Supavisor refusal point unknown | Deployed driver committed; authorized run required |
| realtime | Private-topic join and broadcast fan-out | Local delivery: `pnpm --filter @loonext/api test:load`; hosted connections: `capacity:deployed -- --scenario realtime ...` | 40 independent local websockets × 20 broadcasts = 800 exact deliveries | Hosted connection and delivery-fan-out ceilings unknown | Local delivery measured; hosted connection driver committed; authorized run required |
| durable-object | Call-session FIFO and bounded ring fan-out | `pnpm --filter @loonext/api test:workerd` | 12 hot objects × 24 targets = 288 completed dial effects; per-object peak ≤ 6 | Deployed latency, co-tenancy, and saturation point unknown | Structure measured; deployed measurement required |
| degradation | Truthful error instead of hang or silent drop | `pnpm --filter @loonext/api exec vitest run src/db-timeout.test.ts src/routes/honest-failure.test.ts src/app.test.ts` | Database stall/refusal and Telnyx 429/503 paths are bounded and truthful | Behaviour at an actually reached load ceiling unknown | Partial; deployed overload required |
| cost | Storage/vendor units and serving compute | `pnpm --filter @loonext/api exec vitest run src/billing/costs.test.ts` | Message, voice, AI, storage, and egress units modelled | Worker and Durable Object compute per load unit unknown | Partial; deployed usage delta required |
<!-- capacity-matrix:end -->

---

## 0. The headline

#251's deliverable is "a number the CEO needs before selling to a 50-tech
operation, and the CTO needs before the first one signs". Here it is, in the
order those two would ask.

**On data volume: no ceiling found up to 50,000 conversations and 200,000
messages per workspace.** Every hot list surface answers in under 200 ms at that
size (section 1, after the #535 fixes). A conversation is one
contact-relationship, so that is a business with tens of thousands of distinct
customers. **No current customer is anywhere near it**, and a 50-tech operation
is not near it either — crew size does not drive that number, customer count
does.

**On burst: the inbound path absorbs a carrier retry storm without duplicating
or dropping** (section 1b), and the guarantee is a database constraint rather
than application logic, which is the strongest place for it.

**What breaks first is therefore still unknown.** Local runs establish useful
lower bounds, but they cannot order the managed pooler ceiling, hosted Realtime
ceiling, or deployed call-path latency/co-tenancy. Section 2 says what each
measurement requires. The acceptance matrix above names every axis explicitly
so improving one row cannot make an omitted row disappear from the headline.

**So the honest sentence for a prospect** is: *the local paths we have measured
are comfortable well beyond your data size and absorb the tested bursts. We
have not yet measured the hosted connection ceilings or call-setup latency when
many calls are live at once. We can tell you exactly what we tested and what we
did not.* That is better than a confident number, and it is the only answer
currently supported by evidence.

**What would change this.** A staging environment (`docs/ENVIRONMENTS.md`
records what that costs and why it does not exist yet) and an authorized run of
the safe deployed driver below will answer the managed-pooler and hosted
Realtime connection questions. The Durable Object already runs locally on
workerd, including twelve hot objects together; that closes structural
questions, not deployed milliseconds, co-tenancy, provider round trips, or
cost. Nobody should fill those in from reasoning.

---

## 1. The hot list queries — MEASURED

The one axis #251 says unit tests cannot reach: *"their behaviour on a
workspace with 50,000 conversations and 200,000 messages is unmeasured, and
index behaviour on realistic data volumes is not something unit tests can tell
us."*

Index behaviour at volume is a property of Postgres and the schema, not of the
network, so a local database running the same migrations answers it exactly.
Measured on a developer laptop (Docker Postgres 15, warm cache, best of three).

> **These numbers are the original 2026-08-02 finding and no longer describe the
> product.** Two defects behind them were fixed on 2026-08-07 and **every hot
> query is now under 200 ms at the larger size** — see "FIXED 2026-08-07" and
> "`api_for_you` — FIXED 2026-08-07" below for the current figures. The table is
> kept because the diagnosis it led to was wrong in an instructive way.

| Workspace size | `api_for_you` | inbox page 1 | `status=open` | search |
|---|---|---|---|---|
| 5,000 conversations / 20,000 messages | 30 ms | 54 ms | 30 ms | 36 ms |
| 50,000 conversations / 200,000 messages | >200 ms | >200 ms | >200 ms | **282 ms** |

**The finding: every hot query crosses 200 ms somewhere between a 5,000- and a
50,000-conversation workspace.** At the smaller size the whole set is
comfortable. At the larger one all four are above the line a person notices,
and search is the worst at 282 ms.

**What that means in customers.** A conversation is one contact-relationship
(D7 threads by contact, reopening within 30 days rather than starting a new
row), so 50,000 conversations is a business with tens of thousands of distinct
customers. No current customer is near it. The honest statement to a
prospect is therefore: *the list surfaces are fast for a normal trade business
and have not been tuned for one with tens of thousands of customers, and we know
where that starts to show.*

### The `EXPLAIN` pass — DONE 2026-08-04, and it changes the verdict

The plans, not the milliseconds, are the finding. A plan is what changes when
data grows; a number on one laptop is a fact about that laptop.

| Surface | Plan at 50k/200k | |
|---|---|---|
| Inbox list, 50 most recent open | Index Scan, `conversations_inbox_idx` | 0.9 ms |
| One thread's messages | Bitmap Index Scan, `messages_conv_created_idx` | <1 ms |
| Message full-text, selective term | Bitmap Index Scan, `messages_body_tsv_idx` | 0.2 ms |
| `api_for_you` | ranked queue | 39 ms |
| `api_search`, whole call | contact half seq-scans (below) | 159 ms |

**This contradicts the ">200 ms for all four" row above, and the earlier row is
the one to distrust.** Two reasons, both measurement artefacts rather than
changes to the product:

1. The figures above were end-to-end through `query-load.mjs`; these are the
   database's own time for the same work. The gap between them is node,
   the driver and JSON, not Postgres.
2. The earlier run's own caveat says the seeding budget ran out before the
   individual sub-figures could be captured. `scripts/load/seed-volume.sql`
   builds the same workspace in about thirty seconds, because it is set-based
   SQL run inside psql rather than driven from node, so the large size is now
   cheap enough to measure repeatedly.

**Three of the four are indexed and flat.** The one that is not:

### Contact search seq-scans, and the reason is NOT the one first published here

**Retraction.** The first version of this section, committed 2026-08-04, said
the cause was one OR branch — `coalesce(name, '') % q` — because
`contacts_name_trgm` indexes `name` and cannot serve a wrapped expression. That
was measured, it was reproducible, and it was **the wrong conclusion**, for two
reasons found by carrying it through to a fix.

**First, it was measured against the wrong function.** `api_search` still exists
with a six-argument signature and nothing calls it: `apps/api/src/routes/
search.ts` calls `api_search_v2`. The contact predicate is identical in both, so
the numbers were real, but the 159 ms figure quoted for "api_search" was the
dead one. The live function measures **262 ms** for a term that matches nothing,
which agrees with the 282 ms in the table above rather than contradicting it.
The earlier row was right and the retraction of it was wrong.

**Second, removing the branch does not fix it.** With the wrapper dropped and
the migration applied, the contacts arm measured 254 ms, 433 ms, 454 ms and 507
ms across runs: no improvement, and possibly worse. The change was reverted
rather than shipped.

### What is actually happening

The 260× improvement is real and reproducible — with a **literal**:

| Query shape | Plan | Time |
|---|---|---|
| predicate with literal `'Zzzqqxx'`, coalesce present | Seq Scan | 142 ms |
| predicate with literal `'Zzzqqxx'`, coalesce removed | BitmapOr over both trigram indexes | 0.5 ms |
| the same, as a **prepared statement with a parameter** | **Seq Scan** | 130 ms |

That last row is the finding. `api_search_v2` is `LANGUAGE sql` and `p_q` is a
parameter, so its body plans generically: Postgres does not know the pattern,
cannot estimate trigram selectivity for `'%' || $1 || '%'`, and chooses a
sequential scan **whether or not the coalesce branch is there**.

So the wrapper is a real wart and worth removing on its own merits, but it is
not why contact search is slow. The cause is that the pattern is not a constant
at plan time.

**What would actually fix it**, in rough order of how much they disturb:

1. Build the contact arm as dynamic SQL in a `plpgsql` function, so the pattern
   is a literal by the time the planner sees it and a custom plan can pick the
   trigram indexes.
2. Split the contact search into its own function called with the term, so at
   least the planner has one small statement to specialise rather than a
   200-line body.
3. Leave it and accept a full scan of the contacts table on every fruitless
   search, which is the current state.

Not attempted here. The lesson of the retraction above is that a plausible,
measured cause is still worth carrying through to a working fix before it is
written down as the answer.

### One more thing worth knowing: only the FRUITLESS search is slow

A term that matches costs 1.7 ms, because `limit 25` stops the scan as soon as
it has twenty-five rows. A term that matches nothing reads all 50,000 contacts.
So the slow case is the typo, the wrong spelling, and the customer who turns out
not to be in the book — which is a worse distribution than it sounds, because
those are exactly the searches somebody repeats.

### The fixture taught a lesson worth keeping

The first version of the seed gave every message one of four canned sentences,
so a search term matched 150,000 of 200,000 rows. Postgres chose a sequential
scan — correctly, at that selectivity — and it looked exactly like a missing
full-text index. The GIN index was there the whole time.

Volume was right and **cardinality** was wrong, which is the empty-table mistake
one level down. Each thread now carries a job reference, so a term matches a
handful of threads the way a real search does, and the full-text path measures
0.2 ms instead of 129 ms.

### Two harnesses, and the remaining tidy-up

`scripts/ops/query-load.mjs` times the queries end to end; `scripts/load/`
seeds fast and reads plans. They seed the same workspace two ways, which is one
way too many — folding the node harness onto the SQL seeder is the obvious next
edit and is not done.

### Caveat on the measurement

Seeding 50,000 conversations and 200,000 messages takes upwards of ten minutes
on a laptop, which is why the table above has a complete row at the smaller size
and a partial one at the larger. The 282 ms search figure and the
"all four over 200 ms" verdict come from a completed full-volume run; the three
individual sub-figures at that size were not captured before the seeding budget
ran out. They are left blank rather than interpolated.

### FIXED 2026-08-07 — and the index diagnosis above was wrong

A full-volume run now completes in about 30 seconds, so the blanks above are
filled in. The three `api_list_conversations` figures were the ones missing, and
measuring them found a defect rather than a tuning opportunity.

| 50k conversations / 200k messages | before | after |
|---|---|---|
| `api_for_you` (post-login landing) | 227.7 ms | 208.9 ms |
| inbox, first page | **501.4 ms** | **160.9 ms** |
| `status=open` | 220.2 ms | **121.9 ms** |
| search | 191.5 ms | **105.0 ms** |

**The inbox first page was doing the expensive per-row work for every
conversation in the workspace, then keeping thirty.** 564,962 shared buffer hits
to return thirty rows. The last-message lateral, its attachment rollup, the
unread check and the tag aggregate all hung off `conversations` in the same
SELECT that chose the rows; given literals a planner pushes the `LIMIT` down and
none of it matters, which is why no test ever saw it. That function never gets
literals — it is `SECURITY DEFINER`, so it cannot be inlined, and one cached plan
serves every combination of fifteen parameters, which makes
`limit greatest(p_limit, 0)` opaque.

Choosing the page first and decorating only those rows
(`20260807120000_inbox_page_before_decorating.sql`) is a 3.1× improvement on the
inbox and takes two of the three over-the-line queries back under it. More
importantly the cost stopped scaling with the size of the workspace.

**An index was the wrong answer, and this document should say so plainly since it
is what §1 above recommended.** Adding
`(company_id, is_spam, last_message_at desc, id desc)` moves the same query
written with literals from 44.9 ms to 2.5 ms — a 200× win that reads like the
whole answer — and moves the function itself by nothing measurable: 532→527 ms
before the restructure, 160→165 ms after. A cached generic plan does not reach
for it. No index was added; one that costs every write and returns nothing to any
reader is worse than none.

**What is still slow, and it is not fixed.** The remaining 160 ms is the page
query scanning and sorting the whole workspace, because one cached plan cannot
prune fifteen "parameter is null or column matches it" disjuncts down to the two
a given call uses. Reaching the planner requires literals, which means dynamic
SQL inside the function that carries row-level access. Filed as #535 rather than
guessed at.

### `api_for_you` — FIXED 2026-08-07, and it was hiding a correctness bug

The last query over the line, and the post-login landing page. **257 ms → 85.5 ms**,
so every hot query is now under 200 ms at 50k/200k.

`EXPLAIN` of the body with literals put 201 ms of the 257 in one place: the base
CTE computes, for every open conversation the reader could be shown, whether it is
unread — an `EXISTS` over `messages` wrapping a correlated read of
`conversation_reads`. Four sections read that CTE, so it is materialised and the
expensive column is evaluated for all of them before any section applies its limit
of twenty.

Every consumer that *filters or sorts* on unread also requires the row to be
assigned to the reader, which is a small set; the two that need it for anything
else only *display* it, on at most twenty rows. So the base computes it only for
the reader's own rows, and the display sections read it after their limit. The base
CTE went from 201 ms to 21 ms.

**The three-valued-logic trap, recorded because it cost a measurement.** The first
attempt guarded the expensive half with `(c.assigned_user_id = p_user_id and
exists (...))`, on the assumption that `AND` short-circuits. For an unassigned row
that comparison is **NULL, not false**, and `NULL and x` must still evaluate `x` to
learn whether the answer is NULL or false — so the `EXISTS` ran for precisely the
rows it was meant to skip. Measured saving: none, 257 → 253 ms. `CASE` is
short-circuiting by definition and does what the `AND` only looked like it did.

**And the load fixture found a bug that CI cannot see.** Every section of that
screen is assembled with `jsonb_agg`, and none of those aggregates stated an order
— each relied on the `ORDER BY` inside its own CTE surviving into the outer join
that attaches contact names, which SQL does not promise. The order of the
post-login queue was therefore whatever the plan produced.

`supabase/tests/for_you_notifications.test.sql` was **already failing** on this
database, asserting the unread cross-cut is newest-first and getting it
oldest-first. The same test passes in CI, which resets from empty: different
statistics, different plan, favourable order, green. It was written off once here
as local drift, and that was wrong — a database with realistic volume was the only
place telling the truth. Fixed by putting `ORDER BY` inside all nine aggregates.

**The lesson for this document.** The value of the volume fixture is not the
milliseconds. It is that a plan chosen for 50,000 rows is a different plan, and it
is the only thing that exercises the assumptions an empty-table test cannot reach.

### The index finally earns its place — FIXED 2026-08-07 (#535)

**Where the hot queries actually stand now**, at 50,000 conversations / 200,000
messages, against the original 2026-08-02 figures at the top of this section:

| query | 2026-08-02 | now | |
|---|---|---|---|
| `api_for_you` | 227.7 ms | **104.2 ms** | 2.2× |
| inbox, first page | 501.4 ms | **63.0 ms** | **8.0×** |
| `status=open` | 220.2 ms | **38.7 ms** | 5.7× |
| search | 191.5 ms | **54.2 ms** | 3.5× |

The remaining ~160 ms this document attributed to the plan cache was **one clause**,
and the diagnosis in §1 and in #535 was wrong about it. The search filter read the
joined contact:

```sql
join public.contacts ct on ct.id = c.contact_id
...
and (p_q is null or ct.name ilike ... or ct.phone_e164 ilike ...)
```

A disjunction mentioning a column of the joined table cannot be evaluated before
the join, so the join was formed for the whole workspace and the newest thirty
found by sorting all of it — no ordered index is reachable from that shape, whatever
indexes exist. As a semi-join the predicate belongs to `conversations` alone,
`contacts` leaves the page query, and an ordered index scan reads thirty rows and
stops. Everything else held equal: **156 ms against 0.65 ms**.

**And this is where `(company_id, is_spam, last_message_at desc, id desc)` stops
being useless.** This document says twice that the index changed nothing, and both
times that was accurate — while the plan was a sort over the whole workspace there
was nothing for it to do. It shipped in the same migration as the clause that makes
it reachable, because either alone is a cost with no return.

**The plan-cache theory was tested, not assumed, and it was wrong.** Under
`plan_cache_mode = force_generic_plan` — the worst case, no literals at all — the
rewritten shape still uses the index and still returns in under a millisecond.
Forcing the opposite, `force_custom_plan` on the function, changed nothing (211 ms).
So no dynamic SQL was written, and none of the injection surface that made #535 the
risky option was introduced.

**One honest cost:** the new index is maintained on every write to
`conversations`. Bulk-seeding 50,000 rows got materially slower, which is the
expected shape — that is 50,000 index inserts in one go, not the one-at-a-time
writes real traffic makes. It has not been measured against a realistic write mix.

---

## 1b. The webhook burst and concurrent reads — MEASURED 2026-08-17

`pnpm --filter @loonext/api test:load` drives the **real Worker handlers**
against **real local Postgres**, with only the vendor HTTP boundary faked — the
same hermetic stack the launch-pass E2E uses, run concurrently instead of
sequentially.

**Read the counts, not the milliseconds.** This is node on a laptop: no workerd,
no isolate limit, no CPU-time limit, no network. The timings below are a
property of this machine and transfer to nothing. Duplicates, drops and hangs
are properties of our own code and transfer completely, and they are what #251's
acceptance criteria are actually about.

| Scenario | Result |
|---|---|
| Carrier retry storm: **25 concurrent copies of ONE event** | 200×25, **exactly 1 message row**, 0 hangs |
| Burst of **40 distinct inbound messages at once** | 200×40, **all 40 landed**, 0 dropped, 0 hangs |
| **40 concurrent conversation reads** | 200×40, 0 hangs |

### The retry storm is safe, and NOT for the reason the code reads like

This is the finding worth carrying, because it changes where the risk is.

The handler's first line of defence is the `webhook_events` ledger: a
`(provider, event_id)` primary key upserted with `ignoreDuplicates: true`, so a
duplicate POST is recognised and stops. Read sequentially that looks like the
guarantee. **Under a real storm it is not** — every copy races the same check
with nothing committed ahead of it, which is exactly the condition a carrier
retry storm creates and a sequential test never does.

What actually holds the line is a database constraint:
`messages_telnyx_id_uq`, a partial unique index on
`messages.telnyx_message_id`. Proved by breaking it: with the ledger's duplicate
signal removed so that every copy believed it was fresh, **25 concurrent copies
still produced 1 row.** The ledger is an optimisation; the index is the
guarantee, and it is in the strongest available place.

### Removing that index does not duplicate — it DROPS

Worth knowing before anybody tidies it. With both the ledger signal and
`messages_telnyx_id_uq` removed, the storm produced **zero** message rows, not
twenty-five: `thread_inbound_message` needs that index for its `ON CONFLICT`
target, so without it the RPC fails and the inbound message is not written at
all.

The webhook still ACKs 200, because ingestion runs in `waitUntil` after the ack —
which is correct for a carrier, and means a failure there cannot be reported in
the response. It is not a silent drop in production: the `webhook_events` row
keeps `processed_at` NULL and the §11 sweeper re-drives it. But it does mean
**that index is load-bearing for ingestion correctness, not merely for
de-duplication**, and a migration that drops or renames it takes inbound
messaging down in a way no HTTP status reports.

### Honest degradation, so far

#251's third criterion is that a ceiling produces a truthful failure rather than
a hang. Across all three scenarios every request returned an HTTP status inside
its deadline; nothing hung and nothing threw. No ceiling was reached at these
volumes, so this is evidence that the paths are well-behaved under contention,
not proof about behaviour at a ceiling — which by definition needs a ceiling.

---

## 2. What is NOT measured, and why not

These are properties of a **managed, deployed system under concurrency**.
Local runs establish the lower bounds in the acceptance matrix; they cannot
establish where a hosted service refuses, how production co-tenancy behaves, or
what serving that load costs. Each row needs a non-production deployment; the
pooler and Realtime-connection rows now have a driver, while the remaining axes
still need the additional tooling or approved event source named below.

| Unknown | Why local cannot answer it | What it would take |
|---|---|---|
| **Durable Object saturation — the LATENCY half only** | Structure is now measured on the real runtime (see below). What remains is milliseconds, and workerd cannot give them: a Worker's clock only advances on I/O, so `Date.now()` deltas inside an isolate measure when I/O happened rather than how long work took. | A deployed Worker, N synthetic concurrent calls per workspace, measuring time-to-answer against a real Telnyx round trip. |
| **Hosted Realtime ceiling** | The local container proves exact delivery at 40 sockets, but it has neither the hosted connection budget nor managed-service tenancy. | The committed deployed driver can ramp independent authenticated private-topic connections and distinguish a repeated join/stability limit from a one-off join burst. Hosted broadcast delivery still needs an approved non-production event emitter; the user role is intentionally read-only on `realtime.messages`. |
| **Managed pooler ceiling** | Local Postgres has neither Supavisor nor the production project's connection budget. The API's 10 s deadline proves the failure is bounded, not where refusal begins. | The committed deployed driver ramps authenticated `GET /v1/for-you` waves through the Worker and managed pooler, recording statuses and client deadlines. It still needs an authorized deployed target. |

### Deployed non-production driver — COMMITTED, NOT RUN

The code-owned half of the hosted harness now exists as a separate, opt-in
operator command. It does not relax or replace any local harness's loopback
guard:

```bash
pnpm --filter @loonext/api capacity:deployed -- --help
```

Provision a short-lived **ordinary member** session in a seeded non-production
workspace, then keep all credentials in environment variables (never shell
arguments):

```bash
export LOONEXT_CAPACITY_ACCESS_TOKEN='<short-lived non-production user JWT>'
export LOONEXT_CAPACITY_SUPABASE_PUBLISHABLE_KEY='<non-production publishable key>'
export LOONEXT_CAPACITY_COMPANY_ID='<seeded non-production company UUID>'
export LOONEXT_CAPACITY_CONFIRM='I_AUTHORIZE_NONPRODUCTION_CAPACITY_LOAD:staging-capacity-251:api-staging.example.net:abcdefghijklmnopqrst.supabase.co'

pnpm --filter @loonext/api capacity:deployed -- \
  --target-id staging-capacity-251 \
  --api-origin https://api-staging.example.net \
  --supabase-origin https://abcdefghijklmnopqrst.supabase.co \
  --scenario all \
  --api-ramp 5,10,20,40 \
  --realtime-ramp 5,10,20,40 \
  --api-rounds 3 \
  --deadline-ms 10000 \
  --dwell-ms 2000
```

The ceremony is load-bearing, not documentation around a dangerous switch:

- live `loonext.com` hosts and the production Supabase project are hard-denied;
  HTTP, redirects, loopback/private addresses, privileged Supabase keys, and a
  token whose issuer does not equal the supplied project are also denied;
- the confirmation phrase is an exact function of the target label and both
  hostnames. Token expiry must cover the selected ramp's conservative
  worst-case duration plus a two-minute buffer (and never less than ten
  minutes), so expiry cannot masquerade as a ceiling;
- before any ramp, `/health` must answer without credentials,
  authenticated `GET /v1/for-you` must answer with the selected company header,
  and (for Realtime) that same member token must join the private company topic;
- API waves use only that read endpoint. An ordinary non-429 4xx or redirect
  invalidates the run before that level is recorded. A 429, 5xx, or deadline is
  only a candidate: after cooldown the driver requires a healthy serialized
  request, cools down again, and repeats the exact wave. Only a repeated
  server/deadline signal is a confirmed ceiling. Network-only and
  non-reproduced candidates are recorded as inconclusive and exit nonzero;
- Realtime opens one independent client per requested connection, observes it
  for the configured dwell (minimum one second), and sends no event. Every
  post-join `CHANNEL_ERROR`, `TIMED_OUT`, and `CLOSED` transition remains counted
  even if the client later reports `SUBSCRIBED` again. A suspect cumulative wave
  is fully closed, followed by cooldown, a healthy one-connection control,
  another cooldown, and a full-concurrency repeat. Only the same join or
  post-join signal repeated in both waves is a confirmed **join/stability
  limit**; this is not labelled a generic concurrent-connection ceiling.
  Cumulative-level attempted, joined, and stable counts all describe the full
  active set; newly attempted connections are reported separately;
- requests, joins, observation waits, and cleanup are bounded. Realtime cleanup
  requires a successful unsubscribe and disconnect; a timeout, rejection, or
  non-`ok` Supabase removal result invalidates the run;
- each completed level emits `CAPACITY_RESULT` with aggregate counts, status
  buckets, classifications, and percentiles. Inconclusive candidates emit a
  record for diagnosis and then exit nonzero. A runtime guard refuses a record
  if it contains a URL, token, company/topic id, user subject, publishable key,
  confirmation, or target label.

One reusable member token is deliberate and matches the local harness: this is
measuring concurrent sockets and the pooler, not Auth's ability to mint many
sessions. It also avoids a mixed-credential run mistaking one unauthorized user
for a hosted ceiling.

**What this advances.** Once a non-production stack is authorized, a confirmed
managed-pooler/API refusal point and a repeated hosted private-topic
join/stability limit can be measured without writing more code or risking
production. A one-off burst failure, network-only failure, failed recovery
control, or differently shaped repeat does not become a quotable ceiling. The
driver has not produced a hosted number today, and this document records none.

**What it still cannot answer.** Authenticated users have SELECT-only access to
the private Realtime topic, so this safe read-only driver cannot manufacture the
database broadcasts needed for a hosted delivery-fan-out result. It also does
not deploy or exercise `CallSessionDO`, call Telnyx, read provider metrics, or
measure Cloudflare cost. Those require the non-production resources and owner
authorization described above; a synthetic temporary Worker would not turn its
latency into a production-plan or real-Telnyx measurement.

### The Durable Object — MEASURED ON workerd, updated 2026-08-25

The row above used to say that "nothing in this repository has ever run a
Durable Object under concurrency on the real runtime". Something does now:
`pnpm --filter @loonext/api test:workerd` runs `CallSessionDO` — the real
class, the same runtime fake the behavioural suite uses — inside workerd, with
real Durable Object SQLite storage and real I/O gates.

**At a full 24-technician crew: 24 targets dialled, peak 6 dials in flight.**
That is `DIAL_BATCH_SIZE`, honoured by the runtime rather than by a node
approximation of it. CALLS-V3 T1d's bounded-parallelism requirement is now
checked where it has to hold; proven by making the fan-out unbounded, where the
assertion reports 24 against a ceiling of 6.

**An answer arriving mid-fan-out was admitted only after all 24 dials had
opened.** The FIFO serializes on the real runtime, which is the property #251
names — and it is also the cost: a technician who picks up early waits behind
the remaining dials.

**Twelve hot call objects now run together on workerd.** Each object dialled all
24 targets, all **288 effects completed**, every object's peak stayed at the
six-dial batch, and the fleet overlapped rather than replaying twelve serial
single-object cases. The command emits the current aggregate as
`CAPACITY_RESULT` JSON rather than making this paragraph the only record.

**Three things this cost, worth recording so the next attempt does not.**

1. **Wall-clock latency is not obtainable locally, at any effort.** A Worker's
   clock only advances on I/O — a timing-attack mitigation. The first version of
   this harness reported 24 sixty-millisecond sleeps finishing in "65ms" and
   would have published it. Counts and orderings are immune; milliseconds are
   fiction. This is why the row above still says "the latency half only".
2. **The ACK is not the cascade.** `onTelnyxEvent` resolves at the atomic
   persist (#617, deliberate). A harness that awaits it measures how fast we say
   "got it". `whenIdle()` is the FIFO tail and is what "the fan-out finished"
   means.
3. **I/O cannot cross Durable Object contexts.** Holding a dial open from the
   test and releasing it — the obvious way to observe concurrency — is refused
   by the platform: *"I/O objects created in the context of one Durable Object
   cannot be accessed from a different Durable Object in the same isolate."* The
   dials release themselves from a timer created inside the object instead.

**What this does NOT license.** It is twelve objects on one laptop. It says
nothing about production co-tenancy, isolate memory pressure, provider round
trips, or the millisecond cost of anything. Do not quote it as "the call path
scales".

### Realtime fan-out — COMMITTED LOOPBACK HARNESS 2026-08-25

This row used to sit in the table above, on the reasoning that "broadcast
delivery to many subscribers is a Supabase Realtime property" and therefore
needed a deployed project. That reasoning was true and **the conclusion did not
follow**: a local Supabase stack runs the same Realtime server in a container,
and the thing worth knowing about fan-out is whether messages arrive at all.

**40 concurrent websockets, one private topic, 20 broadcasts: 800/800 delivered,
every subscriber received exactly 20, zero drops, zero failures.** This no longer
lives only in prose: `test:load` creates a real local Auth user, joins 40
independent supabase-js clients through private-topic RLS, sends through the real
`realtime.send`, applies explicit join and delivery deadlines, and reports
missing/duplicate frames plus current latency/spread as `CAPACITY_RESULT` JSON.
The harness refuses every non-loopback target. Laptop timings belong in each
run's result record rather than in this document as if they were hosted latency.

**What that does and does not license.** It answers the half with the track
record — Realtime has died silently twice (#215, and the mobile parked-reconnect
bug), and silent loss is what those failures looked like. It says nothing about
the managed service's ceiling: a container on a laptop has neither production's
connection budget nor its tenancy. **Do not quote this as "realtime scales".**
It means we have no evidence of drops at small fan-out, which is what we did not
have before.

---

**Partly reduced, and stated precisely.** Section 1b shows our code answers
rather than hangs under local database contention, which is the behavioural
half. **Where the managed pooler refuses is still unknown** and remains in the
table above. The number is missing; the bounded failure mode is not.

---

## 2a. Calls: what the code says, before anyone deploys a load driver

#251 asks what happens "to a 20-tech crew where twelve calls are live and the
webhook storm from Telnyx arrives at once". Part of that is answerable by
reading the code, and reading it first turned out to be worth more than
measuring would have been.

**Twelve live calls are twelve Durable Objects.** `CallSessionDO` is the only DO
class in the Worker and `CALL_SESSIONS` the only namespace; every stub is
`idFromName(<per-call session id>)`. Concurrent calls in one workspace do not
queue behind each other. #251 already said this — it says the DO "serializes
every event **for a call**" — so this confirms the issue's framing rather than
correcting it.

**What did NOT follow from that is the reassurance.** Per-call keying does not
mean concurrent calls are independent, and three things were found underneath
it:

**1. The ring fan-out was serial — FIXED 2026-08-17.** `session-do.ts` dialled
every target one at a time, awaiting a Telnyx POST each. `docs/CALLS-V3.md` T1d
has mandated the opposite since it was written — "**bounded parallelism**
(batches of ~6) … **NOT batch-serial**" — and named this exact failure: "a
24-target serial loop at ~300–800ms/POST holds the single FIFO 10–20s, starving
the §7.2 admission budget and queueing an early answerer behind the remaining
dials". `DIAL_BATCH_SIZE = 6` was exported for it and had **zero consumers in the
repository**.

The arithmetic lands on the biggest crews first, which is exactly the buyer this
document exists for. `ring_strategy` defaults to `"all"` and
`MAX_LEGS_PER_SESSION` is 24, so a two-dozen-tech shop hit the worst case on
every inbound call without changing a setting — and because a DO is
single-threaded, nothing else about that call was served meanwhile, including
the hangup of a customer who gave up and the answer of the tech who picked up on
the second ring.

Why nothing caught it: every existing case in `session-do.test.ts` dials ONE
target, two at the most, and a serial loop is indistinguishable from a batched
one at n=1. The tests were not weak about dialling. They were never asked a
question whose answer changes under load, which is the whole of what #251 is
about.

**2. A shared-vendor refusal is recorded as a per-member death verdict** — filed
as #616. Per-call DOs still share one Telnyx account, and a 429 caused by *other*
concurrent calls is a 4xx, which this code reads as "that technician's phone is
definitely dead". On an outbound call that terminalises and hangs up on a live
customer.

**3. The webhook ACK waits for the whole effect cascade** — filed as #617 —
while the file header and a BINDING §17 requirement both say it resolves at the
atomic persist, and the test meant to pin it passes under either behaviour.

**The conditions under which per-call isolation stops being comfort**, so they
can be checked rather than assumed: more than ~6 simultaneously ringable members
per call; `ring_strategy = "all"`, which is the default nobody has to touch;
enough concurrency to trip a Telnyx account rate limit; and retry storms of
DISTINCT event ids, which the 256-entry dedupe window does not absorb.

### Telnyx's own rate limits — MEASURED 2026-08-19

The paragraph below used to open its unmeasured list with "Telnyx's
account-level rate limit and our aggregate against it", as though the number
were unobtainable. **It is in a response header on every request we already
make.** Read with `node scripts/ops/telnyx-rate-limits.mjs` (read-only GETs;
nothing places a call or sends a message):

| Endpoint family | Limit | What we spend it on |
|---|---|---|
| `/v2/calls/*` — call control | **2000 / 1s** | every ring leg we fan out |
| `/v2/messages/*` | **200 / 1s** | every outbound text |
| `/v2/phone_numbers` — number management | **5 / 1s** | search and ordering |
| `/v2/call_control_applications` | **5 / 1s** | read at provisioning |

**The dial concern is quantified, and it is not the constraint.** Bounded
parallelism holds in-flight dials to `DIAL_BATCH_SIZE` = 6 per session, so at
the design doc's ~500 ms round trip one ringing call sustains ~12 dial POSTs a
second. Saturating a 2000/s bucket takes **roughly 166 simultaneously ringing
calls**. The "twelve concurrent calls authorise 288 dial POSTs" worry is real
arithmetic and lands two orders of magnitude below the ceiling.

That figure is linear in a round trip that is still an ESTIMATE — but it errs
the safe way: a slower Telnyx moves the ceiling further away, not nearer.

**What IS tight is the one nobody was looking at: 5 requests a second on number
management** — the search a customer runs while choosing a number to buy. Our
own `NUMBER_SEARCH_RATE_LIMITER` bounds a single caller and does nothing about
the account aggregate, because two customers shopping in the same second are
not one caller. Five concurrent shoppers is a plausible Tuesday; 166 concurrent
calls is not.

**So the honest-degradation requirement had a hole here, and it is fixed.** A
`TelnyxApiError` is not an `ApiError`, so a 429 fell through to the generic
500 and told somebody mid-purchase that something had gone wrong on our end. It
had not — the phone network declined to answer that fast, and waiting fixes it.
A vendor 429 or 503 now answers **503 `service_unavailable`, "The phone network
is busy right now. Try that again in a moment."** 503 rather than 429 because a
429 tells the caller *they* are going too fast, and they are not: the limit is
ours, spent on their behalf. Every other vendor status keeps its 500, its
Sentry event and its log line — this narrows what we call transient rather than
widening it.

**Still not bounded: the account aggregate itself.** Nothing stops N concurrent
sessions from spending the same bucket; what has changed is that crossing it now
produces a truthful sentence instead of a false one. Bounding it would mean
cross-session coordination, and the measurement above says the dial path does
not need it yet. The number-management path is the one to watch.

**What is still genuinely unmeasured about calls.** The real p50/p99 of a Telnyx
dial POST from a Worker — the 300–800 ms above is an estimate written in a
design doc, and the magnitude of everything in this section is linear in it.
Whether the FIFO admission warning has ever fired in production. The actual
distribution of dial-target counts across real workspaces. Telnyx's published
call-control bucket is now measured above; what remains unmeasured is the real
aggregate arrival pattern against it. Twelve fully fanned-out calls can still
authorise up to 288 dial POSTs, but the measured 2,000/s bucket puts that far
below the vendor ceiling at the design document's estimated round trip.

**One caution on a tempting argument.** That co-located DO instances share a
128 MB isolate is a Cloudflare platform property, not something this repository
evidences. It is plausible and it would matter — voicemail buffering holds an
mp3 in memory — but it is not established here and should not be written down as
if it were.

---

**The honest-degradation requirement remains unproven AT A CEILING.** #251 asks
that every ceiling produce a truthful failure rather than a hang. Section 1b
reached no ceiling, so what it shows is good behaviour under contention. That is
evidence, not proof, and the difference matters: nobody should quote it as "we
degrade gracefully under overload".

---

## 3. Where the declared ceilings already are

Not measurements — these are limits the code sets deliberately, collected here
because a capacity conversation should start from what we already decided.

| Limit | Value | Where |
|---|---|---|
| Concurrent presented calls per device | 2 | `SoftphoneCore` / provider |
| Push targets per user | bounded, oldest evicted | `MAX_PUSH_SUBSCRIPTIONS_PER_USER` (#30) |
| Egress per workspace per period | 200 GB | `EGRESS_ALLOWANCE_BYTES` |
| Retention sweep per run | 500 rows/batch, 20 batches/workspace, 5 workspaces | `retention-enforce.ts` |
| Workspace purge per run | 500 rows/step, 200 steps, 5 workspaces | `purge.ts` |
| AI features per workspace per month | hard per-feature caps | `AI_UNIT_COST_CENTS` consumers |

These bound our own background work. None of them bounds a customer's
interactive experience, which is what section 1 measures.

---

## 4. Cost per unit of load

Partially answered elsewhere rather than here. `node scripts/ops/storage-report.mjs`
(#240) reports stored bytes, egress and derived monthly cost per workspace from
real data, which is the storage half. Message, voice and AI unit costs live in
`billing/costs.ts` and are already summed per tenant by the overage warning.

What is missing is compute: the Worker and DO cost of serving a busy workspace,
which needs the same deployed environment as section 2.
