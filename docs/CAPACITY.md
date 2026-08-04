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

### Contact search cannot use its own indexes

`api_search`'s contact half sequential-scans **all 50,000 contacts, ~123 ms,
even when nothing matches**. The trigram indexes it needs already exist
(`contacts_name_trgm`, `contacts_phone_trgm`) and it does not use them.

Its predicate is three branches OR'd together:

```sql
   ct.name ilike ('%' || p_q || '%')
or ct.phone_e164 ilike ('%' || p_q || '%')
or coalesce(ct.name, '') operator(extensions.%) p_q
```

Measured separately, the cause is unambiguous:

| Predicate | Plan |
|---|---|
| the two `ilike` branches alone | **BitmapOr** over both trigram indexes |
| the `coalesce(...)` branch alone | **Seq Scan** |

`contacts_name_trgm` indexes `name`. It cannot serve `coalesce(name, '')`, which
is a different expression, so that branch has no index available — and because
it is OR'd with the other two, the planner cannot use the indexes for any of
them. **One unindexable branch costs the whole predicate its index.**

The `coalesce` is not earning that: `NULL % 'x'` is NULL, which an `OR` treats
as false, so `ct.name operator(%) p_q` returns the same rows. Dropping the
wrapper is better than adding an index to support a wrapper nothing needs.

Left unfixed here per #251's own instruction that the resulting index work goes
in its own change rather than in the analysis.

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
