# Capacity: what breaks first, and at what volume

> **Status: partial; #251 remains open.** Updated 2026-11-10. Sections 2c and
> 2e hold the hosted numbers: temporary Pro-tier Supabase projects and
> separately named Workers, all deleted after their runs. Section 2b holds
> the first ceilings found by driving a deployed non-production stack: the
> Loonext rig (`docs/RIG.md`), which runs the production Worker, Durable Object
> and a local Supabase stack. It found where that stack gives out and five ways
> the failure was not truthful, all fixed. The fail-closed driver for a
> **hosted** project ran on 2026-11-10, and sections 2c and 2e record it;
> 2e adds hosted Realtime delivery under fan-out (it starts losing deliveries at
> 500 sockets between 30 and 40 inbound messages a second), hosted call latency
> to 32 simultaneous calls, and Durable Object cost per call. Still unknown:
> why that Realtime loss starts, Realtime above 500 sockets, co-tenancy on
> Cloudflare, calls above 32, and anything above the Micro compute size. A capacity number that reads as
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

On the rig VM (section 2b), from a worktree's `apps/api`:

```bash
pnpm --filter @loonext/api capacity:rig -- --scenario all --conversations 5000
pnpm --filter @loonext/api test:rig
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
| webhook | Duplicate retry storm and distinct inbound burst | `pnpm --filter @loonext/api test:load` | 25 concurrent copies → 1 row; 40 distinct → 40 rows; zero hangs. Rig: 100 copies → 1 row; 100 distinct each twice all landed | Rig: refusals begin between 100 and 200 distinct messages in a second, retryable, none lost. Hosted not measured | Local lower bound and rig ceiling measured |
| pooler | Concurrent reads and database failure shape | `pnpm --filter @loonext/api capacity:deployed -- --target-id staging-capacity-251 --api-origin https://api-staging.example.net --supabase-origin https://abcdefghijklmnopqrst.supabase.co --scenario api` | 40 concurrent local reads; every database request has a 10 s deadline. Rig: `GET /v1/for-you` to 1,000 concurrent callers, every request answered, refusals a 503 with Retry-After (2b). Hosted, Micro compute: to 80 concurrent callers, every request answered (2c) | Rig: sheds from about 400 concurrent. Hosted, Micro: about 14 requests a second on a 5,000-conversation workspace, 10 s deadline missed at 160 concurrent (confirmed). Supavisor: refuses the 201st client connection (confirmed); the Worker does not go through it. Larger compute sizes unknown | Hosted measured on Micro (2c); larger sizes and the 50,000-conversation workspace required |
| realtime | Private-topic join and broadcast fan-out | `pnpm --filter @loonext/api capacity:deployed -- --target-id staging-capacity-251 --api-origin https://api-staging.example.net --supabase-origin https://abcdefghijklmnopqrst.supabase.co --scenario realtime` | 40 independent local websockets × 20 broadcasts = 800 exact deliveries. Rig: 160 private-topic joins held stable. Hosted: 500 private-topic joins held stable, no refusal (2c). Hosted fan-out: 500 sockets receive every delivery up to 30 inbound messages a second (2e) | Rig: 200 concurrent (tenant setting). Hosted joins: not reached; the driver stops at 500 and the project's setting is 10,000. Hosted delivery: at 500 sockets and 40 messages a second 14 to 16% of deliveries never arrive, with no error (2e); the cause is unknown | Local delivery, rig joins, hosted joins to 500 and hosted fan-out measured; joins above 500 and the cause of the loss required |
| durable-object | Call-session FIFO and bounded ring fan-out | `pnpm --filter @loonext/api test:workerd` | 12 hot objects × 24 targets = 288 completed dial effects; per-object peak ≤ 6. Rig: 32 simultaneous 12-person calls, no wrong or leaked call. Hosted, against a fake switch (2e): 32 simultaneous 12-person calls, all rang, were answered and ended, no 5xx | Rig: first 5xx acknowledgements between 8 and 32 simultaneous calls. Hosted: not reached at 32; last crew phone rings in about 2.5 s at 2 and at 32 calls. Co-tenancy not separable; calls above 32 unknown | Structure, rig latency and hosted latency to 32 calls measured; calls above 32 required |
| degradation | Truthful error instead of hang or silent drop | `pnpm --filter @loonext/api exec vitest run src/db-timeout.test.ts src/routes/honest-failure.test.ts src/app.test.ts` | Database stall/refusal and Telnyx 429/503 paths are bounded and truthful. Rig: overload answered 503 with Retry-After at every level to 1,000 callers; webhook refusals retryable, none lost | Rig ceilings reached and honest. Hosted: past the ceiling the API answered 200 or went silent until the driver's 10 s deadline; no 429 or 5xx came back in that time. Behaviour with a longer client deadline unknown | Rig measured; hosted overload partly measured (2c); a longer-deadline hosted run required |
| cost | Storage/vendor units and serving compute | `pnpm --filter @loonext/api exec vitest run src/billing/costs.test.ts` | Message, voice, AI, storage, and egress units modelled | API Worker CPU per `/v1/for-you` request: median 4 ms, mean 7 ms, p99 48 ms (2c). Call session: 145 ms of Durable Object CPU, 3.6 GB-s and 205 rows written per call; about $0.27 per 1,000 calls at published prices (2e). Durable Object use outside calls unknown | Partial; Worker reads and call sessions measured, other Durable Object usage required |
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

**On the rig, the first thing to give out is Realtime connections (200 at once,
the tenant's setting), then the database path (about 400 simultaneous
post-login loads, about 100 to 200 inbound webhooks in one second), and in each
case what the customer gets is a retryable `503` with the request id, not a
hang** (section 2b). Those are the rig's numbers: the rig has no Supavisor and
no Cloudflare edge.

**On the hosted stack (Pro, Micro compute, 2026-11-10), the first thing to give
out is the database's compute, not a connection limit:** `GET /v1/for-you` on a
5,000-conversation workspace levels off at about 14 requests a second, so
latency grows with the number of callers and a 10 s deadline is missed at 160
concurrent (section 2c). Supavisor refuses at 200 client connections and the
hosted Realtime project held 500 sockets, but the API Worker does not use
Supavisor and 500 is the driver's own cap.

**What breaks first is therefore still unknown for the call path on the hosted stack.** The
hosted run did not exercise the Durable Object, and the local runs cannot order
deployed call-path latency or co-tenancy. Section 2 says what each
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
the safe deployed driver below answered the managed-pooler and hosted
Realtime connection questions once (section 2c). The Durable Object already runs locally on
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

Ceilings were reached on the rig afterwards; what the API did there is section 2b.

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
PostHog exception and its log line — this narrows what we call transient rather than
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

## 2b. Measured on the rig (2026-11-01)

The Loonext rig (`docs/RIG.md`) is a deployed non-production stack: the real API
Worker under wrangler on workerd, the real `CallSessionDO`, and a local Supabase
stack, on an 8-vCPU, 24 GB VM. It is the first place the distributed questions
in section 2 could be driven, and it answers them for **its own topology**:

| Layer | Rig | Hosted production |
|---|---|---|
| Edge | Caddy, then wrangler's local proxy | Cloudflare |
| Worker and Durable Object | the production code on workerd | the same code on Cloudflare |
| Gateway | Kong, 512 worker connections | Supabase's gateway |
| Database access | PostgREST, pool of 10, Postgres `max_connections` 100 | PostgREST and the project's pooler, sized by the project's plan |
| Realtime | one tenant, `max_concurrent_users` 200, 100 joins per second | the project's plan limits |

So the counts, the shapes of failure and the order in which things give out
transfer. The milliseconds and the exact levels do not, and nothing below is a
statement about the hosted ceilings, which section 2 still lists as unknown.

Everything is rerunnable on the rig VM, from a worktree's `apps/api`, and each
scenario prints aggregate `CAPACITY_RESULT` lines (counts and timings only):

```bash
pnpm --filter @loonext/api capacity:rig -- --scenario all --conversations 5000
pnpm --filter @loonext/api test:rig          # all three suites below, one at a time
pnpm --filter @loonext/api exec vitest run --config vitest.rig.config.ts e2e/rig-api-pressure.rig.ts
```

`capacity:rig` seeds one workspace, signs in as its owner through the rig's
GoTrue, and runs the hosted driver (section 2, "Deployed non-production driver")
at `https://api.rig.internal` and `https://db.rig.internal`. It refuses to run
anywhere a production name resolves. The three `e2e/rig-*.rig.ts` suites start
their own second copy of the Worker on a loopback port, with fake carrier,
payment and mail vendors, so a burst of synthetic events never reaches the rig's
real API, a real number, or a vendor. Run them one at a time: they share one
Postgres, and a burst measured beside another burst measures both.

### What breaks first, on the rig

In the order a growing customer would meet them:

1. **Realtime connections: 200 at once.** 160 independent authenticated sockets
   joined the private company topic and stayed up (join p50 1.45 s, p95 2.5 s).
   Asked for 320, 212 joined and 108 were refused with a join `channel_error`;
   the refusal repeated after a cooldown and a healthy single-join control, so
   it is a limit and not a blip. No joined socket was dropped afterwards. The
   number is the tenant's `max_concurrent_users`, not a property of the code.
   One member can hold several sockets (a browser tab and a phone), so 200 is
   roughly ten busy 20-member workspaces online together.
2. **The database path: about 400 simultaneous heavy reads.** `GET /v1/for-you`
   on a 5,000-conversation workspace is clean to 200 concurrent callers and
   starts to shed around 400 (section "The post-login landing under load").
3. **Inbound webhooks: about 100 to 200 distinct messages in one second.**
4. **Calls: the correctness holds at every size tried; latency grows and the
   first 5xx acknowledgements appear between 8 and 32 simultaneous calls.**

On this topology the shedding in 2 to 4 is PostgREST's pool of 10 and Kong's
512 connections, not the Worker. Nothing here says where Supavisor refuses; that
is the one hosted number the plan most needs and still does not have.

### The post-login landing under load

Two measurements, deliberately kept apart.

**Through the rig's own API** (`capacity:rig`, hosted driver, Caddy, deployed
ref `1e19f16c`, before the fixes below), 5,000 conversations and 20,000
messages, three rounds per level, all requests `200`:

| Concurrent callers | p50 | p95 | max |
|---|---|---|---|
| 5 | 96 ms | 214 ms | 214 ms |
| 10 | 117 ms | 135 ms | 137 ms |
| 20 | 197 ms | 214 ms | 223 ms |
| 40 | 328 ms | 420 ms | 428 ms |
| 80 | 569 ms | 798 ms | 838 ms |
| 160 | 1,055 ms | 1,772 ms | 1,826 ms |
| 320 | 2,056 ms | 3,014 ms | 3,252 ms |

Latency is linear in concurrency, about 105 requests a second at 320: one
resource is saturated and everything queues behind it. Started cold at 320
instead of ramped to it, the same endpoint gave 940 of 960 answers, 18 `500`
and 2 requests past the driver's 10 s deadline, and the repeat 899, 17 and 44.
That is a confirmed ceiling by the driver's own rule, and the 44 are the
behaviour the next measurement exists to remove.

**Through a second copy of the Worker with the fixes** (`rig-api-pressure.rig.ts`),
same workspace, three full runs of the ramp. The Worker's own access log is the
count of requests it answered:

| Concurrent callers | Received with 200 | Received with 503 | p50 | Slowest answer | Back to 200 after load stops |
|---|---|---|---|---|---|
| 50 to 200 | all | none | 0.4 to 1.3 s | 1.7 s | 0.5 s |
| 400 | 341 to 347 | 48 to 53 | 2.1 to 2.4 s | 3.2 s | 0.6 s |
| 600 | 381 to 485 | 37 to 219 | 3.1 to 3.5 s | 4.4 s | 0.5 s |
| 800 | 515 to 587 | 5 to 285 | 3.2 to 4.5 s | 5.6 s | 0.6 to 2.0 s |
| 1,000 | 474 to 629 | 111 to 526 | 4.6 to 5.9 s | 6.9 s | 0.5 to 1.6 s |

Counts are what the driver received; where it received fewer than it sent, see
"A limit of the rig" below. Every `503` carried a `Retry-After` and the SPEC error envelope with the
request id. The Worker answered every request it was sent at every level of
every run (21 level-runs, none short). Before the fixes the same overload was
answered after 80 to 110 seconds, as a `500` "Something went wrong.", and an
overloaded request kept asking the database it had just been refused by.

The `503` share at a given level swings a lot from run to run, because what
fills is a queue and not a counter. Read the table as a range, and read the
200-concurrent row as the largest size that was clean in every run.

### Honest degradation, found and fixed here

Driving the Worker past the pool, and reading the failure paths that exposed,
found five ways the truthful answer was not the answer given. Each is fixed and pinned by a test that fails without it:

1. **A request kept asking a database that was refusing it.** Each of a
   request's several database calls waited its own 10 s in the queue that had
   just failed the first, and postgrest-js retries every GET three more times
   with 1, 2 and 4 s sleeps. `db-pressure.ts` gives each request a scope: after
   the first timeout or refusal its remaining calls fail at once, with an error
   coded `ABORT_ERR` because that is the one thing postgrest-js does not retry.
2. **Overload was reported as a bug.** A saturated database answered `500`
   "Something went wrong." and filed a PostHog exception for every shed request.
   It is now `503 service_unavailable` with `Retry-After`, no event, and the ray
   in the log. Only the database being out of room is called busy; a query that
   failed for its own reasons is still a `500`.
3. **The gateway running out of connections looked like a failed query.** Kong
   logs `512 worker_connections are not enough` and answers a bare
   `500 {"message":"An unexpected error occurred"}` with no SQLSTATE, which the
   Worker reported as a bug for 32 of 800 callers. A bare gateway `500`, and a
   gateway `502`, are now overload. The same sentence beside a SQLSTATE is not.
4. **A key set that did not arrive signed people out.** When the identity
   service was slow or reset under load, JWT verification failed and the API
   answered `401`, which the clients treat as "sign in again". A token that was
   never judged is not a bad token: it is now `503` with `Retry-After`, and a
   token that is bad once the keys do arrive is still `401`.
5. **Background work must not inherit a request's rules.** Crons and Durable
   Object alarms have no request scope and keep the database's own answer, so
   code that reads the status (push attempts logs `HTTP 503`) is unchanged.

### Webhook burst on workerd

A signed Telnyx webhook is acknowledged before it is ingested (deliberate), so
the suite measures the acknowledgement, the landing and the ledger separately.

| Scenario | Acknowledged | Result |
|---|---|---|
| One event, 100 concurrent copies | 100 `200` in 0.56 s | exactly 1 message row |
| 25 distinct events, each twice | 50 `200`, p95 0.25 s | 25 of 25 landed |
| 50 distinct, each twice | 100 `200`, p95 0.44 s | 50 of 50 |
| 100 distinct, each twice | 200 `200`, p95 0.86 s | 100 of 100 in 2.3 s |
| 200 distinct, each twice | 381 `200`, 19 `503`, p95 1.55 s | 191 landed |

At 200 distinct events the rig refused 19 acknowledgements. In the 9 events
that did not land, both copies had been refused, so the carrier is told to
retry; none was acknowledged and then lost, none was duplicated, and every
acknowledged event was in the ledger and finished within 0.2 s of landing. In
earlier runs of the same code the first refusals appeared at 100 distinct
events (10 refused). So the ceiling is between 100 and 200 distinct inbound
messages in one second, and what it produces is a retryable `503`, which is the
honest failure for a carrier that retries.

### The call session under a burst

N workspaces, each with a 12-technician crew, take one inbound call each at the
same moment, through signed webhooks into the Worker, the router, one real
Durable Object per call and a fake switch. Every level runs ring, answer and end
as three bursts.

| Simultaneous calls | Ring settles | Answer settles | Webhooks acknowledged |
|---|---|---|---|
| 2 | 1.2 s | 1.2 s | all `200` |
| 8 | 1.7 s | 2.3 s | 239 `200`, 1 `503` (one run) |
| 12 | 2.5 s | 2.8 s | all `200` |
| 16 | 2.7 s | 3.9 s | all `200` |
| 24 | 4.0 to 4.3 s | 4.9 to 5.2 s | all `200` in one run, 18 `503` of 720 in another |
| 32 | 5.5 s | 7.2 s | 116 `503` of 960 |

Which level first shows a `503` acknowledgement moved between runs (8, 24, 32),
so treat it as a band, not a line. What did not move, at any level in any run:
every call rang, was answered by the technician who answered and ended; no leg
was left alive after a call ended; no object dialled past its bound of 12 for a
12-person crew; and a replayed `call.initiated`, 40 copies at once, dialled the
crew once. So saturation costs call-setup latency and then retryable
acknowledgements, never a wrong or leaked call. These milliseconds are the
driver's wall clock around real HTTP on a VM, not Cloudflare's.

### A limit of the rig, not of the Worker

At 400 concurrent connections and above, wrangler's local proxy sometimes never
returned the response to the driver: 6 to 260 requests in 1 level of about every
other run, with the rest of the run clean. The Worker's log shows it finished
every one of them. The driver counts these separately (`unanswered_at_driver`
beside `answered_by_worker`) and the suite fails if the Worker finished fewer
requests than it was sent, so this cannot hide a request stuck inside the
Worker. The hosted path does not go through wrangler's proxy.

### Still unmeasured after this

- **Supavisor's refusal point.** The rig has no Supavisor; the pool that filled
  here is PostgREST's. Needs the hosted driver aimed at a hosted non-production
  project (section 2).
- **Hosted Realtime limits and broadcast fan-out.** The 200 above is the rig
  tenant's setting; the hosted number is the project's plan limit, and delivery
  under fan-out still needs an approved event emitter.
- **Cloudflare compute and Durable Object cost per unit of load,** and call
  latency on Cloudflare with real co-tenancy. The rig has no billing meter.
- The 50,000-conversation workspace through the HTTP path. Section 1 measured
  the queries at that size; the rig runs above used 5,000 conversations.

## 2c. Measured on a hosted non-production stack (2026-11-10)

One run of `capacity:deployed` against a stack built for the purpose and
deleted afterwards. It is the only hosted measurement in this document.

**What was built.** A Supabase project in the BytechLabs organization (Pro
plan, us-east-1, Micro compute, which is production's compute: it has no
compute add-on), with all 382 migrations applied through the Management API and
one workspace seeded with 5,000 conversations and 20,000 messages (an owner and
an ordinary member). A copy of the API Worker named `loonext-api-capacity-251`
on `workers.dev`, with no routes, no cron triggers, no rate-limit or AI
bindings, and the Durable Object class and migration tag of production. Every
Telnyx, Stripe, Resend and VAPID value was the literal `fake`, so it could not
text, call, bill or email anyone. The driver's own ceremony (confirmation
phrase, ordinary-member token, publishable key) was used unchanged. The Worker
and project were deleted at the end; a list call confirmed neither exists.
Production was not contacted by the driver.

**Where the load came from.** One workstation in Calgary behind a VPN, so every
client-side latency below includes that round trip (a single unloaded request
took 370 ms median, 530 ms at p95; the Worker's own wall time for such a request
was about 320 ms in Cloudflare's analytics, which sampled 7 of those 40
requests). The rig had no such hop.

### API: `GET /v1/for-you`, 5,000 conversations

| Concurrent callers | Requests | Answered 200 | Client p50 | Client p95 |
|---|---|---|---|---|
| 5 | 15 | 15 | 464 ms | 674 ms |
| 10 | 30 | 30 | 710 ms | 7.7 s (one slow burst) |
| 20 | 60 | 60 | 1.3 s | 1.7 s |
| 40 | 120 | 120 | 2.5 s | 2.9 s |
| 80 | 240 | 240 | 4.9 s | 5.7 s |
| 160 | 480 per wave | 189, then 274 | 7.4 s | 9.8 s |

At 160 concurrent callers 291 of 480 requests missed the driver's 10 s deadline
in the first wave and 206 in the repeat, after a cooldown and a healthy
single-request control (407 ms). The driver classified it
`confirmed_capacity_ceiling`. No 429 and no 5xx was returned at any level.

What the numbers say: from 20 callers up, throughput is flat at about 13 to 14
requests a second (60 requests in 4.7 s, 120 in 8.7 s, 240 in 17.1 s), so
latency is queueing and doubles with every doubling of callers. The database is
the queue: `pg_stat_statements` shows the `api_for_you` call averaging 79 ms
of execution under that load, which is about one core's worth at 14 a second on
Micro's two shared cores. The rig did about 105 requests a second on the same
workspace size, so the rig's number does not transfer to Micro. A larger
compute size would move this line; it was not tried.

Two caveats. The first ramp stopped at 20 callers with 4 of 60 requests ending
in a client network error in both waves; the driver calls that inconclusive. It
did not recur in a second ramp from 20 and a hand-run probe at 20, 60 and 120
callers saw none, so it is not counted. And the 10 s deadline is the driver's:
a browser waits longer, and what the Worker answers to a caller that waits
(a 503 from the pressure path, or a late 200) was not measured. At the 160
level Cloudflare logged 491 requests as client-disconnected after about 10 s of
wall time.

### Supavisor

The Worker reaches the database through PostgREST over HTTP, not through
Supavisor (`apps/api/src/db.ts` uses supabase-js only), so the API ramp above
says nothing about Supavisor. It was measured separately with a throwaway
script (not the driver; it is not committed) opening client connections to the
transaction-mode pooler on port 6543, running `select pg_sleep(0.2)` three times
on each, and closing them:

| Client connections | Connected | Result |
|---|---|---|
| 25 to 200 | all | no errors; query p50 250 ms at 25, 1.5 s at 200 |
| 250 | 200 | 50 refused: `EMAXCONN max client connections reached, limit: 200` |

The refusal repeated after a healthy single-connection control and eight
seconds of cooldown, so it is a limit. Below it nothing was refused: queries
queue instead. The backend pool is about 15 connections (100 clients finished a
round of 0.2 s sleeps in 1.5 s, about 14 running at once), so more clients
than that wait rather than fail. The project's Postgres `max_connections` is
60. Supavisor's 200 is the Micro plan's pooler figure in the Management API's
add-on listing.

### Realtime

The driver joined 25, 50, 100, 200, 300, 400 and 500 independent sockets to the
private company topic, with a 3 s dwell. All 500 joined and stayed up; no join
failed and no joined socket dropped. Join time was 333 ms at p50 with 25
sockets, 447 ms at p50 and 589 ms at p95 with 500, and 779 ms at the maximum.
The project's configured limit is `max_concurrent_users` 10,000, with 2,500
joins and 2,500 events a second, so **500 is the driver's own maximum
(`--realtime-ramp` accepts 1 to 500), not a refusal**. The hosted
connection ceiling is therefore above 500 and was not found. Broadcast
fan-out was not measured: the driver sends no event and an authenticated member
cannot publish to the topic.

The first attempt failed its preflight join on the cold project, so no ramp ran;
the same command succeeded about a minute later. A freshly created project's
Realtime service is not ready the moment the API reports it healthy.

### Cloudflare compute

From Cloudflare's `workersInvocationsAdaptive` for the Worker, over the
window of the 160-caller ramp (20, 40, 80 and 160 callers: 1,380 requests, the
count the driver sent):

| | Requests | CPU per request | Wall per request |
|---|---|---|---|
| Answered | 889 | median 4.0 ms, p90 17.6 ms, p99 47.8 ms, mean 7.2 ms | median 5.2 s, p99 9.9 s |
| Abandoned by the client at 10 s | 491 | median 3.3 ms, p99 43 ms, mean 7.0 ms | about 10 s |

Across all 1,380 requests the mean was 7.1 ms of CPU and 3.0 subrequests.
CPU stayed near 7 ms regardless of
how long a request waited, so the Worker is not what saturates. The Durable
Object was not exercised, so its cost per load unit is still unknown.

### What the run cost

About 31 minutes of one Pro-tier Micro project at $0.01344 an hour is about
$0.007. The Worker handled about 4,700 requests (about 1,300 of them health checks and probes) and about 22 CPU-seconds, which
is under $0.001 at Workers Paid rates. No egress or Realtime message charge was
incurred of a size worth counting (9 MB of responses, no events). The whole run
was under $0.02.

### Still unknown after this run

- **Realtime above 500 sockets.** The driver stops at 500. Delivery under
  fan-out is section 2e.
- **Behaviour when the caller waits past 10 s**: whether overload at the hosted
  ceiling becomes the 503 with Retry-After seen on the rig, or a late 200.
- **Call latency and Durable Object compute.** Needed call events; section 2e
  has them, against a fake switch.
- **Co-tenancy.** The Worker's wall and CPU times came from Cloudflare's own
  analytics under whatever else shared those machines that hour. Nothing here
  separates that from the database queue, and 2e could not separate it either.
- **Any compute size above Micro**, and the 50,000-conversation workspace
  through the HTTP path.

### 2d. `api_for_you` cut from 31 ms to 19.5 ms (2026-11-10, #698)

Same method as 2c: a temporary Pro-tier Micro project in us-east-1 (all 383
migrations through the Management API), a copy of the Worker named
`loonext-api-capacity-698` on `workers.dev` with fake vendor secrets, and the
driver's own ceremony. Both were deleted afterwards and list calls confirmed
it. The fixture was 2c's (5,000 conversations, 20,000 messages) plus an
ordinary member who owns 1,250 open conversations, 700 tasks, and three more
workspaces of 5,000 conversations each, because production holds other
tenants and the second problem below only shows with them.

**Where the time went.** `EXPLAIN (ANALYZE, BUFFERS)` of the body, as the
member: about 7 ms planning (a SQL function is planned on every call) and
about 22 ms executing, in three parts.

- The conversation base, about 8 ms. 5.5 ms of that is the unread probe, once
  for each of the member's 1,250 open conversations; it is the answer to the
  `unread` total and cannot be skipped.
- The base was found with `assigned_user_id = me OR assigned_user_id IS NULL`
  on `conversations_assigned_idx`. The NULL entries of that index belong to
  every workspace, so each call fetched all 13,750 other-tenant unassigned
  open conversations and discarded them on `company_id`. With one tenant this
  costs nothing and cannot be seen.
- Waiting-on-you joined the deduplicated overdue-task list. The planner
  estimated one row for it, chose a nested loop, and rescanned the list once
  per candidate. Fine at 219 overdue tasks, 80 ms the moment the base
  estimate changed shape (found while trying the fix above).
- The remaining tasks and contact lookups are 1 to 2 ms each.

**What changed** (`20261110130000_for_you_reads_its_own_workspace.sql`; same
output, checked by comparing the old and new function on 12 combinations of
member, hidden numbers and limit):

- `conversations_for_you_idx (company_id, assigned_user_id)` on open
  non-spam rows, and the base reads "mine" and "unassigned" as two branches so
  each is an exact index condition (unassigned: 115 buffers).
- The base carries the five columns the sections read, not the whole row.
- "Has an overdue task" is a hashed membership test, which cannot become a
  per-row rescan.

| | Before | After |
|---|---|---|
| One call, no load, interleaved A/B in one session | 31 to 33 ms | 19.5 to 21 ms |
| Mean `api_for_you` exec, 20 to 80 callers | 267 and 307 ms (two runs) | 128 ms |
| Hosted `GET /v1/for-you`, 20 / 40 / 80 callers (requests per second) | 8.5 / 10.2 / 10.3 and 9.7 / 10.3 / 8.7 | 11.0 / 11.8 / 11.9 |
| Hosted p95 at 80 callers | 7.7 and 9.6 s | 6.8 s |

The ceiling moved from about 10 to about 12 requests a second, less than the
halving in execution time suggests. This stack ran slower than 2c's (about 14
before) with a heavier fixture, and its per-call time under load is 6 to 10
times the unloaded time, so Micro's CPU share, not only the function, is
what is being rationed. The remaining 19.5 ms is about 7 ms planning and 5.5
ms of unread probes; a covering `messages` index for the probe was tried and
changed nothing.

The target set for this read is under 20 ms for one call on Micro at this
fixture, which it now meets unloaded. It does not meet "p95 under 20 ms" under
load: that needs either more compute or a cheaper unread total (a stored
per-member unread count), which was not built. Not measured: 50,000
conversations through the HTTP path, or a larger compute size.

---

## 2e. Realtime broadcast fan-out and call sessions, hosted (2026-11-10)

The same method as 2c, with a second temporary Worker standing in for Telnyx
and drivers that send events. The stack was a Supabase project
`loonext-capacity-251` in the BytechLabs organization (Pro, us-east-1, Micro
compute, all 386 migrations through the Management API), the API Worker
`loonext-api-capacity-251` on `workers.dev` (no routes, no crons, fake vendor
values, production's Durable Object class and migration tag), and
`loonext-telnyx-fake-capacity-251`, which holds the rig's switch model
(`e2e/fake-telnyx-voice.ts`) in one Durable Object. The API Worker's
`TELNYX_API_BASE` was the second Worker, so no dial could reach Telnyx. All
three were deleted afterwards, and list calls confirm that neither Worker nor
the project exists. The API Worker ran with `DEPLOY_ENV` unset, which the code
treats as local. The clients were one workstation in Calgary behind a VPN; the
Worker answered from Cloudflare's Seattle colo, the database is in Virginia and
Realtime reported itself in us-west-1.

The drivers are committed in `apps/api/scripts`: `hosted-capacity-fanout.ts`,
`hosted-capacity-calls.ts`, and `capacity-fake-telnyx-worker.ts` (the switch).
Both drivers refuse the production hosts and need the same target-bound phrase
as `capacity:deployed`. Run either with
`node --experimental-strip-types scripts/<name>.ts --help` from `apps/api`.
Creating and deleting the project and Workers is not scripted in the repo.

### Broadcast fan-out

**How events were emitted.** The way production does it. The driver signs a
Telnyx `message.received` webhook and posts it to the Worker; the Worker
inserts the message; the `messages` trigger calls `realtime.send` through
`broadcast_number_scoped`. The driver never publishes, and an ordinary member
cannot. N independent sockets, each its own supabase-js client, joined as an
ordinary member.

**The topic is the per-number one, `company:<id>:number:<number id>`.** The
company-topic send in `broadcast_number_scoped` has been removed, so a client
on `company:<id>` alone receives no message events (the first run delivered
nothing until this was found). Each inbound message puts two frames on that
topic, `message.created` and `conversation.updated`. The table counts
`message.created` deliveries; the frame rate is twice that.

Events were spread evenly over 12 s per level. Latency runs from the driver
sending the webhook to the driver receiving the frame, on one clock, so it
includes the Worker's acknowledge-then-ingest path and the VPN hop each way
(about 300 ms is the floor). The thread was read back through the API, and it
held every event the Worker had acknowledged.

| Sockets | Inbound messages/s | `message.created` deliveries | Received | Emit to socket p50 / p99 / max | First to last socket, p99 | Driver loop lag, p99 |
|---|---|---|---|---|---|---|
| 50 | 1 | 600 | all | 295 / 358 / 359 ms | 16 ms | 18 ms |
| 50 | 10 | 6,000 | all | 288 / 780 / 834 ms | 21 ms | 21 ms |
| 50 | 40 | 24,000 | all | 298 / 663 / 752 ms | 31 ms | 23 ms |
| 200 | 1 | 2,400 | all | 298 / 449 / 451 ms | 19 ms | 20 ms |
| 200 | 10 | 24,000 | all | 303 / 549 / 674 ms | 31 ms | 23 ms |
| 200 | 25 | 60,000 | all | 308 / 548 / 605 ms | 44 ms | 24 ms |
| 500 | 1 | 6,000 | all | 322 / 397 / 438 ms | 133 ms | 21 ms |
| 500 | 5 | 30,000 | all | 305 / 357 / 419 ms | 121 ms | 24 ms |
| 500 | 20 | 120,000 | all | 342 / 1,058 / 1,418 ms | 292 ms | 25 ms |
| 500, two processes of 250 | 30 | 180,000 | all, in both | 327 / 726 / 858 ms | not kept | 33 ms |
| 500 | 40 | 240,000 | **201,875 (84.1%)** | 1,156 / 3,227 / 3,815 ms | 1,969 ms | 372 ms |
| 500, two processes of 250 | 40 | 240,000 | **206,599 (86.1%)** | 314 / 902 / 978 ms | not kept | 20 ms |

**First thing to break: delivery at 500 sockets, between 30 and 40 inbound
messages a second** (15,000 to 20,000 `message.created` deliveries a second,
30,000 to 40,000 frames a second counting `conversation.updated`). At 40 a
second, 14 to 16% of deliveries never arrived, not even after the 3 s of
silence the driver waits for, and 78 of 480 events missed some sockets.
Nothing told the sender or a receiver: the webhooks were acknowledged `200`
and ingested (480 of 480), no socket dropped and no join failed. What did
arrive arrived on time, so the symptom is a missing update, not a slow one.

The single-process run also showed the driver struggling (event-loop lag
372 ms), so the same 500 sockets were split across two processes, each lagging
20 ms. The loss was the same (86%), which puts it in the service and not the
driver. Below the limit nothing was lost at any level, and latency grew only
with load: p99 under 0.4 s at 5 messages a second and about 1 s at 20.

What this does not say. Only one cell crossed the limit. Whether it is a
limit on deliveries a second, on frames a second or on sends a second was not
separated, and 200 sockets were taken only to 25 messages a second. The
project's own settings are `max_events_per_second` 2,500 and
`max_bytes_per_second` 1 MB, and the sends here were at most 80 a second, so
neither obviously explains it; the cause is not known. If the limit is per
project, the figure to remember is about 30,000 delivered frames a second
shared by every workspace on the project, not per workspace. A workspace of 50
clients was nowhere near it.

Inbound ingest through the Worker held at 40 messages a second for 12 s with
every acknowledgement `200`. The Worker's CPU for one webhook averaged 9 to
10 ms (median 6 to 10 ms, p99 35 to 51 ms) at every level. The rig refused
between 100 and 200 distinct events a second; the hosted stack was not pushed
there.

### Call sessions

**How calls were driven.** The driver is the carrier. For each simultaneous
call it asks the fake switch for an inbound call to one of 33 seeded
workspaces, each with a 12-person crew whose softphone credentials were
seeded, delivers the switch's `call.initiated` to the Worker as a signed
webhook, and keeps delivering what the switch queues (the 12 ring legs'
events, the answer, the hangups). Then the first ring leg of each call
answers, then every caller hangs up. Levels 2, 8, 16 and 32 were run twice:
back to back, and then 50 s apart so Cloudflare's analytics could be read per
level.

| Simultaneous calls | Crew phones rung | First crew phone rings, p50 | Last crew phone rings, p50 / p99 | Answer to the others hung up, p50 / p99 | Acknowledgements |
|---|---|---|---|---|---|
| 2 | 24 of 24 | 2.28 s | 2.44 s / 2.44 s | 1.18 s / 1.18 s | 60 `200` |
| 8 | 96 of 96 | 2.29 s | 2.42 s / 4.90 s | 1.13 s / 1.17 s | 240 `200` |
| 16 | 192 of 192 | 2.69 s | 2.88 s / 3.41 s | 1.09 s / 1.46 s | 480 `200` |
| 32 | 384 of 384 | 2.24 s | 2.50 s / 3.12 s | 1.22 s / 1.40 s | 960 `200` |

These are the second (isolated) run, measured on the switch's own clock from
the moment the caller dialled in. They include the driver's own round trips to
the switch and the Worker (about 0.5 s) and cross-country database queries
(Worker in Seattle, Postgres in Virginia). The back-to-back run had the same
shape (last crew phone p50 2.97, 2.55, 2.42 and 2.20 s).

**Nothing broke up to 32 simultaneous calls.** There was no `5xx` or timeout in
the 3,480 webhook acknowledgements across the two runs. Every call rang its
whole crew (exactly 12 dials a call), was answered, hung up the other 11
phones, and ended with no leg alive. The rig saw its first `5xx` between 8 and
32 calls; the hosted stack did not, though it was not pushed past 32. Ring time
did not grow with the number of calls, so no queueing showed: the 2.3 to 2.9 s
is mostly the path, not the load.

**Cloudflare's own meter**, from `durableObjectsInvocationsAdaptiveGroups`,
`durableObjectsPeriodicGroups` and `workersInvocationsAdaptive`, over the
isolated run's four windows (46 s each, so a call's tail is inside its window):

| Calls | Durable Object requests | DO CPU per call | DO duration per call | DO rows written per call | Worker requests | Worker CPU per call |
|---|---|---|---|---|---|---|
| 2 | 60 | 170 ms | 3.21 GB-s | 214 | 60 | 69 ms |
| 8 | 241 | 145 ms | 3.94 GB-s | 218 | 235 | 65 ms |
| 16 | 481 | 168 ms | 3.55 GB-s | 216 | 473 | 59 ms |
| 32 | 958 | 133 ms | 3.54 GB-s | 197 | 960 | 57 ms |

Over the 58 calls: 30 requests to the Durable Object per call (one per
webhook event), CPU 145 ms per call (4.9 ms per invocation, median 0.7 to 0.9
ms; the invocation that dials the crew is the p99, 64 to 93 ms), 205 rows
written and 120 rows read per call. The Worker took 59 ms of CPU per call over
30 requests. **CPU per call was flat from 2 to 32 simultaneous calls**, as was
the ring time. The median wall time of a Durable Object invocation was 53 to
72 ms.

One result is unexplained, and it dominates duration. One invocation per call,
about 1 in 30, stays open 17 to 20 s of wall time with about 10 ms of CPU
(wall p99 is 20.0 s at every level). It starts after the driver has finished
the call, the fake switch logged no slow or unanswered request, and the
database's slowest statement was 529 ms. 20 s is the Telnyx client's timeout,
so it may be a request this stack leaves unconfigured (push, FCM or the AI
binding) waiting out its bound; it was not found. It makes the object active
for about 28 s per call and the duration 3.6 GB-s. Without it, duration would
be about a quarter of that.

### Durable Object cost per 1,000 calls

Prices are from Cloudflare's pricing pages, fetched 2026-11-10 (Durable
Objects page "last updated Oct 18, 2026", Workers page "Oct 2, 2026"): Durable
Object requests $0.15 per million, duration $12.50 per million GB-s, SQLite
rows written $1.00 per million, rows read $0.001 per million; Workers requests
$0.30 per million and CPU $0.02 per million ms. Durable Object CPU is not
billed on its own. Using the measured 30 requests, 3.58 GB-s, 205 rows written
and 120 rows read per call, and the Worker's 30 requests and 59 ms:

| Per 1,000 calls | Quantity | Cost |
|---|---|---|
| Durable Object requests | 30,000 | $0.0045 |
| Durable Object duration | 3,580 GB-s (about 900 without the unexplained tail) | $0.045 (about $0.011) |
| Durable Object rows written | 205,000 | $0.205 |
| Durable Object rows read | 120,000 | $0.0001 |
| Worker requests for the webhooks | 30,000 | $0.009 |
| Worker CPU | 59,000 ms | $0.001 |
| **Total** | | **about $0.27, or $0.00027 a call** |

Rows written are about three quarters of it. The Workers Paid plan's monthly
allowance covers the first 1 million Durable Object requests (about 33,000
calls), 400,000 GB-s (about 110,000 calls) and 50 million rows written (about
240,000 calls), so a crew taking a few hundred calls a month pays nothing
beyond the plan. These calls lasted about 10 s on the line. A call that rings
or talks for minutes adds only what the object does while it is active, which
this data cannot say.

**Co-tenancy is still not separated.** Cloudflare publishes no per-machine or
neighbour load, so a slow wall time cannot be split into our own queueing and a
neighbour's. The flat CPU and flat ring times from 2 to 32 calls bound it for
this one hour only.

### What the run cost

About one hour of one Micro project at $0.01344 an hour, about $0.015. The
Realtime runs moved about 1.7 million frames against the plan's 5 million
included messages. Workers and Durable Object usage was a few thousand
requests, rows and GB-s, all inside the Workers Paid allowance. Under $0.05 in
all.

### Still unknown after this run

- **Why delivery fails between 30 and 40 messages a second at 500 sockets**,
  and whether the limit is per project, per topic or per second of fan-out;
  and fan-out above 500 sockets.
- **The 17 to 20 s Durable Object invocation.**
- **Calls above 32 at once**, and Durable Object cost for calls that last
  minutes.
- What 2c lists that is not about Realtime or calls: compute above Micro, the
  50,000-conversation workspace through HTTP, and behaviour when the caller
  waits past 10 s.

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

The API Worker's CPU per request is measured in section 2c (median 4 ms on the
post-login landing). Durable Object compute per call is section 2e: 145 ms of
CPU, 3.6 GB-s and 205 rows written, about $0.27 per 1,000 calls at published
prices.

Partially answered elsewhere rather than here. `node scripts/ops/storage-report.mjs`
(#240) reports stored bytes, egress and derived monthly cost per workspace from
real data, which is the storage half. Message, voice and AI unit costs live in
`billing/costs.ts` and are already summed per tenant by the overage warning.

What is missing is the rest of the compute: the Worker and DO cost of serving a
busy workspace across everything it does, not just reads and calls.
