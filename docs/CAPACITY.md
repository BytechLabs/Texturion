# Capacity: what breaks first, and at what volume

> **Status: partial, and the partiality is the point.** Updated 2026-08-04 with the `EXPLAIN` pass. #251 asks for "a
> documented capacity plan naming the first thing that breaks and at what
> volume." One of its five unknowns is now measured. The other four are not,
> and this document says so rather than estimating them, because a capacity
> number that reads as measured and was guessed is worse than an admitted gap —
> it is the number somebody quotes to a 50-tech prospect.

Re-run the measured half with:

```bash
node scripts/ops/query-load.mjs
```

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

## 2. What is NOT measured, and why not

These four are properties of a **deployed system under concurrency**. Nothing
local can speak to them honestly, and each needs a non-production environment
plus a driver that generates real concurrent load.

| Unknown | Why local cannot answer it | What it would take |
|---|---|---|
| **Durable Object saturation** | A DO is single-threaded per instance and serializes every event for one call. The failure mode is latency on call setup, which only appears when real webhooks arrive concurrently. | A deployed Worker, N synthetic concurrent calls per workspace, measuring time-to-answer. |
| **Supabase pooler ceiling** | Workers scale to arbitrary concurrency; Postgres does not. The question is where the pooler refuses and whether the API errors honestly or hangs — a property of the managed pooler, not of a local Postgres. | Load against a non-prod Supabase project with the same pooler configuration. |
| **Realtime fan-out** | Broadcast delivery to many subscribers is a Supabase Realtime property. Realtime has already died silently twice (#215, and the mobile parked-reconnect bug), so this is the axis with a track record. | N subscribed clients per workspace against a deployed project, measuring delivery and drop rate. |
| **Webhook burst** | Telnyx delivers on its schedule; a carrier retry storm after a partial outage is the spike, and it arrives exactly when we are least able to absorb it. | Replay a captured burst against a deployed Worker at real concurrency. |

**The honest-degradation requirement is also unverified.** #251 asks that every
ceiling produce a truthful failure rather than a hang. That cannot be claimed
for a ceiling nobody has reached.

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
