# JobText — Tasks (D17) Build Specification

**Status: BINDING.** Same authority as `SPEC.md` and `docs/DECISIONS.md`. This document is the
single source of truth for the **Tasks** feature (Decision **D17**) plus the two thread-view
read-affordances shipped alongside it (**in-thread filter** and **attachments gallery**). Where it
states a schema value, API name, error code, or behavior, it is final — build exactly this.

It **composes with** the shipped message-level done state (**D14** — `messages.done_at` /
`messages.done_by_user_id` + strikethrough), the `conversation_events` audit table (SPEC.md — column
`type` / `payload` / `actor_user_id`; §6/T8), the generic `attachments` table + `attachments` bucket
(**D19**), Supabase Auth (D8), the API conventions (§7 — cursor lists, error codes, roles), realtime
Broadcast (§8), and the calm Wealthsimple-grade aesthetic (`docs/APP-UI-ELEVATION.md`). It **does not
duplicate D14, and it does not create a second done-state**: a task has **no** completion column of
its own — completion is a **join read of `messages.done_at`** (D17). Section numbers below refer to
`SPEC.md` unless prefixed `T` (this doc).

**The one-line product frame.** 99% of the time a tradesperson marks a message **done** (the quiet
D14 circle-check — unchanged). **Promote to task** is a single, opt-in overflow action that appears
only when they need an assignee, a due date, notes, or task attachments. A task is a first-class row
that *links back* to its source message; it never copies the message body and it never owns a second
completion flag.

---

## T0. Decision recap (do not relitigate — D17 is decided)

- Any message stays **simply markable done** (D14, untouched).
- A message may be **optionally promoted to a Task**. Completion is **derived** from the source
  message's `messages.done_at` — checking the task's box calls the **same** `PATCH
  /v1/messages/:id {done}` (D14). There is no task-side done column, no mirror, no sync (D17).
- Tasks render as **checklists in the conversation overview** (the context/right panel).
- A dedicated **`/tasks` page** lists tasks with assignee / derived status / timeline and deep-links
  back to the source message + conversation.
- **Task attachments** use the **generic `attachments` table + `attachments` bucket** (D19),
  `owner_type='task'` — the exact same storage machinery as note attachments. No task-specific table
  or bucket.
- **Every task promotes a real message.** `message_id` is **NOT NULL** (D17: "promote a message to a
  Task"). **Standalone (message-less) tasks are OUT of MVP** — see T0.1.

Two archetypes exist in the field: (A) *the message/conversation is the task* — JobText already
ships this as D14; (B) *a task is a linked first-class entity with its own assignee/due/notes* —
Missive subtasks, Front linked tasks, Linear issue-from-Slack, Intercom convert-to-ticket. **D17 adds
archetype B as a strictly additive metadata layer over A. It never replaces A, and — crucially — it
never adds a competing completion flag; completion always lives on the message (archetype A's
`messages.done_at`).**

### T0.1 Resolved fork — standalone tasks are cut from MVP (was: two docs disagreed)

An earlier draft of this doc allowed a **standalone** task (typed into a conversation, no source
message, nullable FK). D17's decided model makes completion **derive from `messages.done_at`**, so a
task with no message has **no completion source** — its checkbox would have nothing to write to. The
two positions cannot both ship. **Product-owner resolution: Option A — keep D17 pure.**

- **Every task promotes a real message.** `tasks.message_id` is **NOT NULL**. There is no
  `+ Add task` standalone affordance in the conversation checklist, and no nullable-FK partial index.
- **Rationale (calm / lowest-upkeep / matches D17's stated intent):** a task is a pointer to a real
  customer message, not a free-floating to-do — that discipline is what keeps the surface calm for a
  plumber, and it means completion is *always* derived, with zero branching.
- **Fast-follow (Option B, explicitly deferred, T9):** if standalone tasks are ever wanted, D17 must
  be **amended** to add a task-owned `done_at` used **only** when `message_id IS NULL`, and the
  derive logic branches on message presence. That reintroduces a scoped slice of the complexity D17
  removed, so it is a deliberate future decision — **not** something a build spec adds silently.

---

## T1. Data model (§6 conventions — composes with D14 and D19, never duplicates them)

**One new table** in `public`: `tasks`. (Task attachments are rows in the **generic `attachments`
table** from D19 — see T1.2 — so there is **no** `task_attachments` table and **no** `task-media`
bucket.) The `tasks` table follows every §6 convention: `uuid` PK via `gen_random_uuid()`; FKs
**explicit, `ON DELETE RESTRICT`** by default (noted exceptions); `updated_at` maintained by
`moddatetime`; **RLS enabled, deny-by-default, no `anon`/`authenticated` grants** (the Worker uses
`sb_secret_` and does all authorization itself, D8); **soft-delete** via `deleted_at` (D7/D17).

### T1.1 `tasks`

**No `status`, no `done_at`, no `done_by_user_id`, and no `task_status` enum.** Completion is a join
read of `messages.done_at` (D17). The UI status label is **derived**: `open` when the joined
`messages.done_at IS NULL`, `done` otherwise.

```sql
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id)      on delete restrict,
  message_id         uuid not null references public.messages(id)       on delete restrict,
                       -- NOT NULL: every task promotes a real message (D17). At most one task per
                       -- message (partial-unique index below). No message body is copied; the source
                       -- (and its done_at) are read by join. Completion DERIVES from messages.done_at.
  conversation_id    uuid not null references public.conversations(id)  on delete restrict,
                       -- denormalized from the source message for cheap per-conversation listing (D17).
  title              text not null check (length(title) between 1 and 500),
                       -- seeded from the message body, editable; never a copy of the live body.
  description        text not null default '',
  assigned_user_id   uuid          references auth.users(id) on delete set null,
                       -- independent of conversations.assigned_user_id; a task may go to a different
                       -- crew member than the thread. SET NULL mirrors the conversations convention.
  due_at             timestamptz,                 -- nullable; the "timeline" is created_at + due_at
                                                  -- + the joined messages.done_at, read for T6.
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz                  -- soft-delete (D7/D17); RESTRICT FKs above
);

-- At most ONE live task per source message (D17). Partial on deleted_at so a deleted-then-re-promoted
-- message can get a fresh task:
create unique index tasks_message_uq on public.tasks (message_id)
  where deleted_at is null;

-- /tasks page + conversation-checklist read paths (D17):
create index tasks_conversation_idx on public.tasks (conversation_id, created_at)
  where deleted_at is null;                                                            -- checklist
create index tasks_company_assignee_idx on public.tasks (company_id, assigned_user_id) -- list/"Mine"
  where deleted_at is null;
create index tasks_company_due_idx on public.tasks (company_id, due_at)                -- due-sorted list
  where deleted_at is null;
```

Field-name note (was a cross-doc mismatch): the FK is **`message_id`** and the assignee is
**`assigned_user_id`** — the D17 names. (`source_message_id` / `assignee_user_id` from an earlier
draft are **not** used anywhere.)

Deleting a task is a **soft-delete** (`deleted_at = now()`) by its creator or an owner/admin (T4). It
does **not** touch `messages.done_at` — the message keeps whatever done state it had; removing the
task layer just removes the archetype-B promotion, and D14 archetype A stands.

`moddatetime` trigger applied to `tasks` (append to §6's trigger list) so `updated_at` is maintained.
The generic `attachments` table (D19) is **append-only + soft-delete** — it has **no** `updated_at`
and **no** `moddatetime` (see D19 / APP-FEATURES-V2 §2). There is no task-attachments trigger to add.

### T1.2 Task attachments = rows in the generic `attachments` table (D19) — no new table, no new bucket

Task attachments are **not** a dedicated table. They are rows in the **generic `attachments` table**
(D19) with:

- `owner_type = 'task'`, `owner_id = <task.id>`;
- `conversation_id` denormalized (the task's `conversation_id`) so the gallery union (T7.2) is cheap;
- stored in the **shared private `attachments` bucket** (D19), path
  `attachments/{company_id}/task/{task_id}/{uuid}-{safe_filename}`;
- served by the **generic** signed-URL route `GET /v1/attachments/:id/url` (D19) — there is **no**
  `task-media` bucket and **no** `/v1/task-attachments/:id/url` route.

All D19 rules apply unchanged: **25 MB/file** (D19's bucket ceiling — this supersedes an earlier
10 MB figure), the D19 MIME allow-list, the soft cap of 10 attachments per owner, Worker-mediated
upload across the D8 boundary (browser → `POST /v1/attachments` → Storage; large files via
`createSignedUploadUrl`), content-type re-validated from the bytes, signed-URL serving, and
best-effort object cleanup on soft-delete. Because task attachments live in the same `attachments`
table the gallery unions (T7.2 / APP-FEATURES-V2 §4.2), they appear in the gallery **for free**.

### T1.3 RLS + realtime (§8)

- `tasks` gets **RLS enabled, deny-by-default, no grants** — same as every §6 table. All
  authorization is in the Worker (company scoping on every query, D8/§10).
- **Done needs NO task broadcast.** Checking a task's box calls `PATCH /v1/messages/:id {done}`
  (D17), which already emits the existing **`message.status`** broadcast (D9/D14) — every open client
  updates live with zero new realtime machinery. This is D17's "reuses the `message.status`
  broadcast — no new realtime channel."
- **Task metadata changes DO need a signal** or the `/tasks` page and the checklist go stale until a
  manual refetch. Metadata changes (**create / assign / set-due / soft-delete**) have no message
  write, so `message.status` does **not** fire for them. The **cheapest D9-consistent fix** is a
  single **ID-only** metadata broadcast (D9 pattern), not a `created/updated/deleted` trio:

```sql
-- ONE metadata-only broadcast. Done is NOT here (it flows through message.status). This fires on
-- task create / metadata update / soft-delete so the /tasks page + checklist live-refetch.
create or replace function public.broadcast_task_changed() returns trigger
language plpgsql security definer as $$
declare
  cid uuid := coalesce(new.conversation_id, old.conversation_id);
  co  uuid := coalesce(new.company_id, old.company_id);
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', cid),
    'task.changed', 'company:' || co::text, true);
  return null;
end $$;
create trigger tasks_broadcast after insert or update or delete on public.tasks
  for each row execute function public.broadcast_task_changed();
```

**Event (add to §8's list):** `task.changed {conversation_id}` on `company:{company_id}` —
**ID-only**; clients refetch the affected conversation's tasks (and the `/tasks` list) via the API.
It carries **only** `conversation_id` (D9 minimal payload); it is **not** a done signal. Topic
authorization is the existing `realtime.messages` membership policy — **no new RLS policy** (§8).

> Note: the `updated_at` bump from `moddatetime` means a metadata `UPDATE` reliably fires this
> trigger. Done toggles never write `tasks` (they write `messages`), so they never fire `task.changed`
> — exactly as intended: done rides `message.status`, metadata rides `task.changed`.

---

## T2. Completion is DERIVED — one column, one write path, no mirror (the D17 model)

This replaces the earlier "bidirectional done-sync / value-guard / loop-avoidance" section wholesale.
Under D17 there is **nothing to mirror and no loop to break** — completion has a single home.

### The model

For a task with `message_id = M`, the task's completion **is** `messages.done_at` of `M`. There is
**one** column (`messages.done_at`) and **one** write path (`PATCH /v1/messages/:id {done}`, D14).
The task never stores done state; it reads it by join.

- **Rendering:** the checklist checkbox and the `/tasks` status label read the joined
  `messages.done_at` — `open` when NULL, `done` (strikethrough + D14 treatment) otherwise.
- **Writing:** the checklist checkbox and the `/tasks` status toggle both call the **existing**
  `PATCH /v1/messages/:id {done}` on the task's source message. They are a **second UI entry point to
  the same message PATCH** — nothing more.
- **Marking the source message done in-thread** flips the task's rendered state because both surfaces
  read the same `messages.done_at`, and both live-update off the same `message.status` broadcast
  (D9/D14). "Bidirectional done-sync" is therefore **emergent from the shared column**, not bespoke
  plumbing.

### Loop-safety (one sentence)

> **Single column, single write path, D14 idempotency — no loop is possible.**

A `PATCH /v1/messages/:id` that sets `done` to its current value is a **no-op** (D14): it writes
nothing, emits no `message.status`, and appends no audit event (§6 / D22). There is no second writer,
so there is no ping-pong to defend against. The elaborate value-guard/echo-suppression machinery that
distributed two-way sync needs **does not exist here and must not be built** — that was the whole
point of D17 choosing derived state.

### Exact state transitions (all completion flows through `messages.done_at`)

| Trigger | `messages.done_at` (source M) | Task rendered state | Events / broadcast |
|---|---|---|---|
| Check the task box (calls `PATCH /messages/M {done:true}`), M not-done | set `now()`, `done_by=actor` | renders `done` (derived) | `message_done` event ×1 (D22), `message.status` ×1 |
| Mark message M done in-thread, M has a task | set `now()`, `done_by=actor` | renders `done` (derived) | `message_done` event ×1, `message.status` ×1 |
| Repeat a done→done PATCH on M (either entry point) | **no-op (D14 guard)** | unchanged | **none** |
| Uncheck the task box / un-done M in-thread | `done_at=NULL`, `done_by=NULL` | renders `open` (derived) | `message_undone` event ×1, `message.status` ×1 |
| Mark a message done that has **no** task (plain D14) | set `now()` (D14, unchanged) | *n/a* | `message_done` event ×1, `message.status` ×1 |
| Create / assign / set-due / soft-delete a task (metadata) | *untouched* | *n/a for done* | `task_*` event ×1 (T2.1), `task.changed` ×1 |

**There is no "standalone task" row** in this table — T0.1 cut them; every task has a source message,
so every completion has a `messages.done_at` to derive from.

### T2.1 Audit (reuse `conversation_events` — column `type` / `payload` / `actor_user_id`)

Task **metadata lifecycle** writes **one `conversation_events` row** per real change (append-only log;
SPEC.md 578-593). **Done/undone is NOT re-audited on the task** — it is audited exactly once via the
message's `message_done` / `message_undone` event (D22), because completion lives on the message.
So there is **no** `task_completed` / `task_reopened` event (they would double-log the same fact).

Canonical event `type` values written by tasks (the enum literals — see T8 for the full addition
list): **`task_created`**, **`task_assigned`**, **`task_due_set`**, **`task_deleted`**. Attachment
events (`task_attachment_added` / `task_attachment_removed`) are covered by D19/D22 and also listed in
T8.

- **Column names are the shipped ones:** `type` (the enum column, **not** `event_type`), `payload`
  (jsonb, **not** `meta`), `actor_user_id`. Every doc that writes an event uses these three names.
- `task_created` payload: `{ task_id, message_id }`. `task_assigned` payload: `{ task_id, from_user_id,
  to_user_id }`. `task_due_set` payload: `{ task_id, due_at }`. `task_deleted` payload: `{ task_id }`.
- `conversation_id` is **always present** (a task always lives in a thread), so the shipped
  `conversation_events_conv_required` CHECK (SPEC.md 590-592) is **satisfied without change** — see
  T8. Events are an **append-only log, never a re-sync trigger**; nothing reads an event row and
  writes back to a task or message.

Task lifecycle lines render on the existing thread timeline exactly like status/assign/tag lines
(§8 UI: centered 12px `stone-400` system lines with the actor's name, per APP-UI-ELEVATION 3.2), and
surface under the **Events** segment of the in-thread filter (T7.1 / D21).

---

## T3. Mutation implementation (`security definer` SQL, §3 pattern)

Task mutations run in `security definer` PostgREST RPC functions (the §3 pattern used for threading
and send-gating — the Worker calls them with `sb_secret_`; `search_path=''`). There is **no**
`mark_done()` task function and **no** mirror transaction (T2 killed them). Functions:

- `create_task(company, message, title?, description?, assignee?, due_at?, actor)` → resolves
  `conversation_id` from the source message, inserts the `tasks` row (the partial-unique index rejects
  a second live promotion of the same message with `conflict`), **links the source note back when the
  promoted message is a note** (`messages.task_id = <new task>` where `direction='note'` and `task_id`
  is null — so the note's own files reach the task's derived attachments union, D28 arm (b); an
  inbound/outbound source is left unlinked), writes a `task_created` event, fires `task.changed`.
  **Does not** touch `messages.done_at` — a freshly promoted message keeps its current done state and
  the task simply renders it by join (promotion never flips completion).
- `assign_task(id, assignee, actor)` → sets `assigned_user_id`, writes `task_assigned`. `SET NULL`-safe.
- `update_task(id, {title?, description?, due_at?}, actor)` → field updates; a `due_at` change writes
  `task_due_set`.
- `delete_task(id, actor)` → soft-delete (`deleted_at = now()`), writes `task_deleted`, best-effort
  removes the task's `attachments` objects (D19 sweep). Never touches `messages.done_at`.

**Completion is not a task function at all.** Checking/unchecking a task calls the existing D14
`PATCH /v1/messages/:id {done}` handler, which writes `messages.done_at` + the `message_done` /
`message_undone` event in one transaction and emits `message.status` — unchanged from D14 except for
the D22 audit-row addition. The message handler needs **no** task-awareness: it neither reads nor
writes `tasks`, because the task carries no done state.

---

## T4. API surface (§7 conventions — roles, error codes, cursor lists, realtime)

All routes are `/v1`, carry `Authorization: Bearer` + `X-Company-Id` (§7), return §7 error shapes,
and are **any active member** (M) unless noted. Roles per the §10 matrix: conversations/messages/
tasks are member-level; **delete** narrows to creator-or-owner/admin. Task metadata mutations emit
the T1.3 `task.changed` broadcast; **completion is not a task route** — it is the existing message
route, which emits `message.status`.

| Method & path | Role | Purpose / shape |
|---|---|---|
| `POST /v1/tasks` | M | **Promote a message.** Body: `{ message_id, title?, description?, assigned_user_id?, due_at? }`. `message_id` is **required** (no standalone tasks, T0.1); `title` defaults to the message-body snippet (editable). Resolves `conversation_id` server-side from the message. A second live promotion of the same message → **409 `conflict`** (partial unique index). Returns the task (201). Emits `task.changed` + a `task_created` event. **This is the route the thread overflow "Make a task" affordance calls (T5).** |
| `GET /v1/tasks` | M | **List with filters** (cursor, §7 `{data, next_cursor}`). Query params: `status` (`open`\|`done`, applied as `messages.done_at IS [NOT] NULL` on the join), `assigned_user_id` (or `me`), `conversation_id`, `due_before`/`due_after`, `overdue=true`, `q` (title tr\_gm). **Default when no params: `status=open, assignee=me`** (the "what needs me now" view). Cursor keyed on **`(due_at NULLS LAST, id)`** for due-sorted views, `(created_at, id) DESC` otherwise; default 25, max 100 (§7). Only `deleted_at IS NULL` rows. |
| `GET /v1/conversations/:id/tasks` | M | The **conversation checklist** (T5): all live tasks for the thread, `(created_at)` order, embedded shape `{ data }` (no cursor — a thread's task count is small). Each task carries `message_id`, the joined **`done`** boolean (from `messages.done_at`), `assignee`, `due_at`, `attachment_count` |
| `GET /v1/tasks/:id` | M | Task detail: full row + resolved `assignee` + `created_by` profiles + the **source message** (joined, body rendered live — never copied — including its `done_at` for the derived status) + `attachments: [{id, file_name, content_type, size_bytes}]` (from the generic `attachments` table, D19) + its `conversation_events` slice (`GET`-embedded) |
| `PATCH /v1/tasks/:id` | M | `{ title?, description?, assigned_user_id?, due_at? }` — **metadata only** (there is **no** `done` field here — completion is the message route below). An assignee change writes `task_assigned`; a `due_at` change writes `task_due_set`; emits `task.changed` |
| `PATCH /v1/messages/:id` **`{ done }`** | M | **The existing D14 route — unchanged in shape, and it is the ONE completion path for a promoted message too.** Sets `messages.done_at`, writes `message_done`/`message_undone` (D22), idempotent D14 no-op on a repeat, emits `message.status`. It needs **no** task-awareness (the task holds no done state). The checklist checkbox and the `/tasks` status toggle both call **this** route |
| `DELETE /v1/tasks/:id` | M* | **Soft-delete** a task (`*` creator, or owner/admin): sets `deleted_at`. Best-effort removes the task's `attachments` objects (D19). Does **not** alter `messages.done_at`. Emits `task.changed`, writes `task_deleted` |
| `POST /v1/attachments` | M | **Generic attachment upload (D19)** — `owner_type='task'`, `owner_id=<task id>` uploads a task attachment; `owner_type='note'` uploads a note attachment. Multipart (≤ D19 limits) or two-step signed-URL (D19). This is the **only** attachment-upload route; there is no task-specific upload route |
| `GET /v1/attachments/:id/url` | M | **Generic signed-URL route (D19)** — mints a short-lived signed Storage URL (membership-checked) → `{ url, expires_at }`. Serves task **and** note attachments; feeds the gallery (T7.2). There is **no** `/v1/task-attachments/:id/url` |

**Deleted routes (were in an earlier draft, now removed):** `PATCH /v1/tasks/:id {done}`,
`POST /v1/messages/:id/promote`, `POST /v1/tasks/:id/attachments[/sign|/confirm]`,
`GET /v1/tasks/:id/attachments`, `GET /v1/task-attachments/:id/url`,
`DELETE /v1/task-attachments/:id`. Completion is the message route; promotion is `POST /v1/tasks
{message_id}`; attachments are the D19 generic routes.

**Error codes (all from §7's stable set — no new codes):** `conflict` (409, re-promote of an
already-promoted message), `validation_failed` (422, body/size/type, message-not-in-company),
`not_found` (404, outside company or missing), `forbidden` (403, delete by non-creator non-admin),
`unauthorized` (401). Completion runs on the message route and inherits D14's idempotent behavior
(a repeat returns the row, no event). Tasks have **no** billing/registration/opt-out gates (they are
internal, not outbound messages) — none of `subscription_inactive`/`registration_pending`/
`recipient_opted_out`/`usage_cap_reached` apply.

---

## T5. UX — thread affordances & the conversation checklist (APP-UI-ELEVATION calm)

Calm rules (elevation doc): **one petrol *control* per region** (passive done/task *state* marks are
the sole exception — APP-LAYOUT-V2 §4.1/§8); secondary content recedes to `stone-400/500`; done rows
reuse the **exact D14 treatment** (`line-through` + 55% opacity + the D14 petrol check); no
counts/badges unless usage demands; optimistic + 5s undo for reversible actions.

### T5.1 "Make a task" — the promote affordance (thread, G5 / 3.2)

- The message **overflow menu** (`⋯`, `stone-400`) gains **"Make a task"**, sitting *below* the
  existing D14 done affordance. The default remains the quiet D14 circle-check; promotion is opt-in
  and rare (a plumber marks messages done far more often than they promote).
- Selecting it opens a **compact inline form** (popover on desktop / bottom sheet on mobile),
  **prefilled**: `title` = the message snippet (editable), `assignee` = current user (default),
  `due` = empty (optional). One petrol **"Create"** button; everything else ghost. Natural-language
  nicety (Missive-style "tomorrow" / "@name") is a fast-follow, not MVP — MVP is a plain date input +
  an assignee select.
- On create → `POST /v1/tasks { message_id }`. The message then shows a **single quiet stone task
  indicator** (a tiny checklist glyph, **`stone-400` — NOT petrol**, petrol only on hover/focus) that
  **links to the checklist / task detail**. Re-promoting is blocked (`conflict`) — the indicator is
  the signal that a task already exists.
- **One-glance / one-petrol-per-region (design-QA lock).** Done-ness is carried **only** by the D14
  strikethrough + petrol check (the region's single petrol *state* mark). The **task indicator is
  stone chrome**, so a promoted-and-done message is **not** a three-petrol cluster (no petrol task
  badge sitting next to the petrol done-check). The task indicator recedes because a task is
  *metadata*, not *completion*. Spec the two marks with a minimum gap and distinct channel (petrol
  check = state; stone checklist glyph = "has a task"); the two-marks-together case is a design-QA
  checklist item (T5.3).
- Marking that message **done** (D14 circle-check) also flips its **task** to `done` because both
  read the same `messages.done_at` (T2); the strikethrough appears identically whichever surface the
  user touched.

### T5.2 Tasks-as-checklists in the conversation overview (context/right panel, 3.3)

- The **right info panel** (desktop) / **bottom sheet** (mobile) — the existing progressive-
  disclosure surface (3.3) — gains a **"Tasks" group**: `GET /v1/conversations/:id/tasks` rendered as
  a **compact checkable list**. This is **not a new data structure** — it is the same `tasks` rows
  filtered to `conversation_id`, each carrying its derived `done` (joined `messages.done_at`).
- Each row: a **checkbox** (petrol when done — the D14 state mark), the title (near-black, `500`),
  and — quiet, in `stone-400` — the **assignee avatar** + **due date** (tabular; **amber only when
  overdue**, never a red scare). Done rows get the **D14 treatment** (strikethrough + 55% opacity +
  petrol check). Calm: no count badge, no progress bar in MVP.
- **Checking a row** → the existing **`PATCH /v1/messages/:id { done:true }`** on the task's source
  message (T2 — the checkbox is a second entry point to the message PATCH). The **same transaction
  strikes through the source message** in the thread (D14 visual) — **one write, both surfaces update
  via the single `message.status` broadcast**. Optimistic with a 5s **undo** toast (sonner, per
  3.2/§4) — undo issues the inverse `done:false`, itself the D14 no-op-safe route.
- **There is no `+ Add task` standalone affordance** (T0.1 cut standalone tasks). Tasks are created
  only by promoting a message from its `⋯` menu (T5.1) — the checklist's empty state teaches this
  (T5.3).

### T5.3 States, motion & discoverability

- Task create/metadata-change animate per §4: 150ms micro; the completed row's strikethrough is a
  150ms transition (matches D14); the `message.status` broadcast re-renders the checklist done-state,
  and `task.changed` re-renders metadata via refetch (never a skeleton — §8). `aria-pressed` toggle
  on the checkbox; SR labels "Mark done" / "Mark not done" (the D14 labels — because it *is* the D14
  message-done control).
- **Discoverability (close the hover-gated gap).** "Make a task" living in the per-message overflow
  is correct for the 99%/1% ratio, but must not be the *only* way the feature is discovered. The
  **/tasks page** and the **conversation checklist header** are the discoverable entry points; the
  checklist's and `/tasks`' **empty states teach it**: *"Promote a message from its ⋯ menu to track
  it as a task."* (T6.1). No layout change — just the copy that keeps the feature from being strictly
  hover-gated on desktop.
- **Two-marks design-QA case (T5.1 lock):** a promoted-and-done message shows exactly one petrol
  mark (the done-check) plus one stone task glyph — verify petrol is spent once, the task glyph is
  stone at rest, minimum gap holds, and the pair is legible at 375px.

---

## T6. UX — the dedicated `/tasks` page (list + detail; APP-UI-ELEVATION)

A single flat list over the one `tasks` table (no new storage) — the Missive/Linear/Front shape. It
answers "what needs me now" first, and deep-links every row back to its exact message + conversation.
(The `/tasks` **view switcher** — List / Board / Calendar / Map — is specified in
`docs/HOME-AND-VIEWS.md` D25; this section specs the **List** view + detail, which every view shares.)

### T6.1 List

- **Default view: `Open · Mine`** (`GET /v1/tasks` with defaults) — "one obvious view = what needs
  me now."
- **Filtering is one-glance and inline — NO fly-out drawer** (the killed-drawer decision). Persistent
  **segmented tabs** in the **canonical order `Open | Mine | All | Done`** (D17; the shared segmented
  component contract, T6.3). Active segment = a **quiet stone pill, not petrol** (petrol is spent on
  the one **"New task" / primary** action for the page — never both, per accent budget 2.1). A
  **compact filter** row beside the tabs offers assignee + due (today / overdue / this week) — plain
  selects, not a drawer.
- **Columns** (roomy rows, `--border-subtle` hairlines, one calm column — 3.1 rhythm): **title**
  (near-black, `500`); **assignee** avatar (`stone-400`); **due date** (tabular `stone-400`, **amber
  when overdue**); **status** (the **derived** `open`/`done` label from the joined `messages.done_at`,
  not a stored column). Done rows strikethrough + 55% opacity + petrol check (D14 treatment). A quiet
  **conversation/contact hint** (`stone-500`) shows which thread a task belongs to.
- **Row click deep-links** to `/inbox/[conversation_id]` **anchored/scrolled to `message_id`**. This
  is the "link back to message + conversation" requirement — a lightweight pointer, never a copy.
- **Timeline** on the row/detail = `created_at`, `due_at` read off the row, plus **completion time**
  read from the joined `messages.done_at`; **richer per-task history** (assignments, due changes)
  reads from `conversation_events` filtered to the task's ids (`task_*` types + the message's
  `message_done`/`message_undone`).
- **Cursor pagination** reuses §7/§10 conventions (`{data, next_cursor}`, keyset `(due_at NULLS LAST,
  id)` in due-sorted views, else `(created_at, id) DESC`; default 25).
- **Empty states** (calm, per 3.1): `Open · Mine` empty → *"Nothing on your list."* one line,
  centered, generous air, no illustration. **First-run / all-empty** → a one-line human sentence that
  **teaches promotion**: *"No tasks yet. Promote a message from its ⋯ menu to track it here."* + the
  one petrol primary action (T5.3 discoverability).

### T6.2 Detail

- A task detail view (route `/tasks/[id]` or a slide-over from the list): title (editable inline),
  description, **assignee select**, **due date**, **status** (the **derived** label; the toggle is the
  same `PATCH /v1/messages/:id {done}` on the source message — not a task route), the **source message
  rendered inline** (joined live — a quiet quoted block with a "View in conversation" link), **task
  attachments** (thumbnails → the generic `GET /v1/attachments/:id/url`, D19), and the **timeline**
  (`created_at`/`due_at` + the joined completion time + the `conversation_events` slice). One petrol
  element (the status toggle *or* a save action — never two). Calm surface: 20–24px padding, 32px
  between groups (2.3).

### T6.3 Shared segmented-control contract (so tab sets don't drift)

The `/tasks` list and the inbox reuse **one** segmented component (same tokens, quiet stone active
pill, `role=tablist`), with **different label sets**:

- **/tasks tabs (canonical order, D17):** `Open | Mine | All | Done`.
- **Inbox tabs (APP-LAYOUT-V2 §2.1):** `Open · Mine · All · Closed`.

Same component, same 4-segment order shape, different 4th label (`Done` for tasks, `Closed` for the
inbox). State this once here; the two docs cite this contract rather than restating tab strings.

---

## T7. In-thread filter + attachments gallery (ship alongside D17)

Both are **pure read-views over existing tables** — no new storage. They share the tasks philosophy
("one table, many views").

### T7.1 In-thread filter (messages / notes / events) — client-side, no new endpoint (D21)

- A compact **inline segmented control** at the top of the thread (matching the killed-drawer /
  one-glance rule) filtering the already-embedded stream: **All | Messages | Notes | Events**.
- **This is a pure client-side filter over data already on the page** (D21): `GET /v1/conversations/:id`
  already embeds the `messages` stream (notes are `messages` rows with `direction='note'`) and the
  `conversation_events` timeline (D7/D10). **Messages** = `direction in ('inbound','outbound')`;
  **Notes** = `direction='note'`; **Events** = the `conversation_events` lines. **No `?kind=` server
  param and no separate events pull** — if a server filter is ever wanted for very long threads it is
  the **additive `?kind=` fast-follow D21 already names**, not MVP.
- Calm: the active segment is a quiet stone pill (accent budget); default is **All**.

### T7.2 Attachments gallery (D21) — union of exactly TWO tables

- A **gallery view** (reached from the **thread-header overflow** — the single entry point, T7.3) of
  **all attachments in the conversation**, unioning **exactly two sources**:
  1. **MMS arm:** `message_attachments ma JOIN messages m ON m.id = ma.message_id WHERE
     m.conversation_id = :id AND m.company_id = :company` — because `message_attachments` has **no
     `conversation_id` column** (SPEC.md 566-576: it has `message_id, company_id, storage_path,
     content_type, size_bytes, source_url, created_at` only), the conversation scope **requires this
     join through `messages`**. The join rides the existing `messages(conversation_id, created_at)`
     index (SPEC.md 563) plus the `message_attachments.message_id` FK lookup (confirm an index on
     `message_attachments(message_id)` exists — it is the FK; **add one if absent**).
  2. **Generic arm:** `attachments WHERE conversation_id = :id AND company_id = :company AND
     deleted_at IS NULL` — the D19 table **denormalizes `conversation_id`**, so this arm needs no
     join. This arm supplies **both** note (`owner_type='note'`) and task (`owner_type='task'`)
     attachments, so task attachments appear **for free**.
- **The two arms have different join shapes** (MMS needs the join; generic does not). Do **not**
  express the union as a single SQL sort over a view. The API fetches each arm, tags each item's
  `source`, and merges/sorts **`(created_at, id) DESC`** in the API layer.
- New read route: **`GET /v1/conversations/:id/attachments`** → cursor list `{ data, next_cursor }`
  (see the canonical item shape in APP-FEATURES-V2 §4.2). Each item is served by the existing signed
  URL machinery — MMS via the existing MMS signed-URL path, generic via `GET /v1/attachments/:id/url`
  (D19). Grid, tabular meta in `stone-400`, blur-up lazy images (elevation Guardrails 6).

### T7.3 Gallery source enum + single entry point

- **Source enum (canonical, pinned in APP-FEATURES-V2 §4.2):** `source: 'mms' | 'note' | 'task'`,
  derived as: `'mms'` from the `message_attachments` arm; `'note'` / `'task'` from the generic
  `attachments` arm's `owner_type`. The UI maps these to display tags **Message | Note | Task** in the
  UI layer only. `kind: 'image' | 'file'` drives the **Images | Files** tabs (client-side filter).
- **Single entry point (calm / one-action):** the gallery is reached from the **thread-header
  overflow** — **not** also a context-panel section. The context panel shows only a quiet **"View all
  attachments (N)"** row (with up to 3-4 recent thumbnails) that opens the same gallery. Two entry
  points to one surface is not one-obvious-action; this collapses them.

---

## T8. Migration, audit reuse, and Storage reuse

- **New migration `migrations/0XX_tasks.sql`** (a *new* file — never edit a shipped migration, D14
  rule): create the `tasks` table, its indexes, and the partial unique index; **enable RLS
  deny-by-default, issue no grants** (D8); apply `moddatetime` to `tasks`; add the
  `tasks_broadcast` trigger/function (T1.3, the **single** `task.changed` metadata broadcast — **not**
  a create/update/delete trio); and **extend the audit enum** (below). There is **no** `task_status`
  enum, **no** `task_attachments` table, and **no** `task-media` bucket (D17/D19).
- **Canonical `conversation_event_type` additions (this is the single source of truth — every other
  doc cites T8, none restate a divergent list):**

  ```sql
  -- extend conversation_event_type (each ADD VALUE in its own statement; enum additions can't be
  -- used in the same transaction that adds them — added here, first USED by application code):
  --   'message_done', 'message_undone',
  --   'task_created', 'task_assigned', 'task_due_set', 'task_deleted',
  --   'note_attachment_added', 'note_attachment_removed',
  --   'task_attachment_added', 'task_attachment_removed'
  ```

  **Dropped (do not add):** `task_completed`, `task_reopened` — completion is audited exactly once via
  `message_done` / `message_undone` (D22; T2.1). Adding them would double-log the same fact.
- **The `conversation_events_conv_required` CHECK does NOT change.** Every new event type
  (`message_done`/`message_undone`, all `task_*`, both `*_attachment_*`) **always carries a non-null
  `conversation_id`** — a message, a task, and a note each belong to a conversation — so the shipped
  CHECK (SPEC.md 590-592, which only *permits* null `conversation_id` for
  `'opted_out','opt_out_revoked','consent_attested'`) is **satisfied as-is**. **No `ALTER` to the
  constraint is needed** (editing a shipped constraint is forbidden by D14/D7). This is an explicit
  migration fact, not an assumption.
- **The `PATCH /v1/messages/:id` handler is unchanged in shape** — it gains only the D22 audit-row
  insert (`message_done`/`message_undone`), which is additive to D14 and applies to **every** message,
  task-promoted or not. It has **no** task-awareness (the task carries no done state).
- **Audit trail = `conversation_events` (reused).** No new audit table. Task metadata lifecycle = four
  appended event types (`task_created`/`task_assigned`/`task_due_set`/`task_deleted`), rendered on the
  existing thread timeline surface (§8/3.2). Append-only.
- **Attachments = the generic `attachments` table + `attachments` bucket (D19, reused).** Task
  attachments are `owner_type='task'` rows — **no** new table, bucket, or route. Uploads cross the D8
  boundary via the generic `POST /v1/attachments` (D19).
- **Build-order placement (§12):** lands after **step 10 (Inbox UI)** and **step 11 (Realtime)** — it
  depends on the thread view, the D14 done affordance, `conversation_events` rendering, the signed-URL
  path (MMS + generic D19), and the Broadcast client. Tests (D13, vitest): the D14 no-op (a repeat
  `done` emits no event), the **derived** status (task renders `done` iff joined `messages.done_at` is
  set), the partial-unique re-promote `conflict`, soft-delete not touching `messages.done_at`,
  metadata `task.changed` firing (and done **not** firing it), the gallery two-arm union, and the D19
  attachment upload across the D8 boundary each get a case.

---

## T9. Explicitly deferred (fast-follows)

- **Standalone (message-less) tasks (Option B, T0.1)** — requires **amending D17** to add a
  task-owned `done_at` used only when `message_id IS NULL`, with derive-logic branching on message
  presence. Deliberately out of MVP; a PO decision, not a silent build-spec addition.
- **Richer status** (in-progress / blocked / waiting) — the D25 Board view groups by status, so a
  richer status column becomes relevant there; MVP `/tasks` List uses the derived `open`/`done` only.
  Added later behind an explicit decision (it reintroduces a stored non-`done` status distinct from
  message completion).
- **Natural-language due/assignee** in the promote form ("tomorrow", "@sam") — MVP is a plain date +
  assignee select.
- **Per-conversation task counts / progress badges** — held back per the D14 restraint rule; add only
  if usage shows demand.
- **Subtasks / nested checklists** — a task is flat in MVP (one level); nesting is out of scope.
- **Server-side in-thread filter** (`?kind=`) and gallery **date-scrubber / in-files search** — D21
  fast-follows, not MVP.

---

## T10. Twelve-line summary

1. **D17 adds archetype B** (a linked, first-class task carrying *metadata*) as a strictly additive
   promotion over the shipped D14 archetype A (message-is-done) — it never replaces D14 and **never
   adds a second completion flag**.
2. **Schema:** one `tasks` table (`company_id`, `message_id` **NOT NULL** FK, `conversation_id`
   denormalized, `title`, `description`, `assigned_user_id`, `due_at`, `created_by`, timestamps,
   `deleted_at`) with a **partial-unique on `message_id` WHERE `deleted_at IS NULL`** = at most one
   live task per message. **No `status`/`done_at`/`done_by` column and no `task_status` enum.** No
   message body is ever copied.
3. **Completion is DERIVED** from the joined `messages.done_at` (`open` when NULL, `done` otherwise) —
   D17's dual-source-of-truth-avoiding design. There is nothing to mirror.
4. **One column, one write path:** the checklist checkbox and the `/tasks` status toggle both call the
   **existing `PATCH /v1/messages/:id {done}`** (D14). Marking the message done in-thread flips the
   task's rendered state because both read the same column.
5. **Loop-safety is one sentence:** *single column, single write path, D14 idempotency — no loop is
   possible.* The value-guard / echo-suppression / mirror machinery from the earlier draft is
   **deleted** (it defended a race D17 removes by construction).
6. **Standalone tasks are CUT from MVP** (T0.1, PO decision): every task promotes a real message so
   completion always has a `messages.done_at` to derive from. Option B (a task-owned `done_at` for
   null-message tasks) is a deferred D17 amendment (T9).
7. **Realtime:** done rides the existing **`message.status`** broadcast (no new channel, D17/D9);
   task **metadata** (create/assign/due/delete) fires a single **ID-only `task.changed
   {conversation_id}`** broadcast so `/tasks` + the checklist live-refetch — **not** a
   create/update/delete trio, and **not** a done signal.
8. **API** (§7 conventions): `POST /v1/tasks {message_id}` (promote; 409 on re-promote), `GET
   /v1/tasks` (filtered, default **Open · Mine**), `GET /v1/conversations/:id/tasks` (checklist),
   `GET`/`PATCH`/`DELETE /v1/tasks/:id` (metadata + soft-delete), and completion via the **existing**
   `PATCH /v1/messages/:id {done}`. **Deleted:** `PATCH /v1/tasks/:id {done}`,
   `POST /v1/messages/:id/promote`, and all task-specific attachment routes.
9. **Attachments** = the **generic `attachments` table + `attachments` bucket** (D19),
   `owner_type='task'`, served by the generic `POST /v1/attachments` + `GET /v1/attachments/:id/url`
   — **no** `task_attachments` table, `task-media` bucket, or task-specific route; **25 MB/file**
   (D19). They appear in the gallery for free.
10. **UX:** overflow **"Make a task"** (prefilled, opt-in; a **stone** task indicator, never a petrol
    badge next to the petrol done-check); **checklists** in the conversation context panel (checking
    calls the message PATCH, striking the source message via `message.status`); a **`/tasks` page** =
    flat filterable **List** view (canonical tabs `Open | Mine | All | Done`, **no drawer**, deep-links
    back to message+conversation, first-run empty state teaches promotion) + a task detail; all
    D14-calm (one petrol *control* per region; passive done/task *state* marks exempt).
11. **Audit reuses `conversation_events`** (columns `type`/`payload`/`actor_user_id`); the canonical
    enum additions live in **T8** and are cited by the other docs. Done/undone is audited **once** via
    `message_done`/`message_undone` (no `task_completed`/`task_reopened`). The
    `conversation_events_conv_required` CHECK **does not change**.
12. **Ships with** an in-thread filter (messages/notes/events — **client-side** over embedded data,
    D21) and an attachments gallery (a **two-table** union: `message_attachments` **joined through
    `messages`** for conversation scope + the generic `attachments` table; single header-overflow
    entry point) — both pure read-views; lands after §12 steps 10–11 in a new migration that never
    edits a shipped one.

*End of TASKS.md (D17).*
