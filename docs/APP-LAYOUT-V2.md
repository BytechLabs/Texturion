# JobText App Layout V2 — the UX overhaul (BINDING)

**Status: BINDING.** Same authority as `docs/DESIGN.md` and `docs/APP-UI-ELEVATION.md`. This
spec **elevates** the app's *structure and core interactions* the way `APP-UI-ELEVATION.md`
elevated its *look and feel*. It keeps every locked value from that doc — petrol `#0F766E`,
warm stone, Inter, border-first, restraint, one-obvious-action, `prefers-reduced-motion`, the
accent budget of **one petrol element per region** — and re-plumbs the shell, the filter model,
the composer, the per-message action, and the in-thread views to a modern shared-inbox standard
(Front / Missive / Linear / Superhuman) **tuned down** to a tradesperson's calm.

**Precedence.** This doc *supersedes* the layout/interaction details of DESIGN.md **G3, G4, G5,
G6** and refines APP-UI-ELEVATION §3.1–§3.3 where they conflict. It **inherits** every token,
color, motion, and copy rule from APP-UI-ELEVATION.md unchanged (that doc still governs look &
feel; this one governs layout & interaction). Where a rule here tightens a token, treat it as a
tightening at equal authority. Product behavior (SPEC.md, DECISIONS.md **D1–D22** ratified; the
**/for-you · notifications · /tasks-views** surfaces live in binding `docs/HOME-AND-VIEWS.md` with
**provisional** numbers D23–D25 — see §6) is unchanged —
this is UX, not a data-model change, except where it *reuses* already-decided tables (D7 notes,
`conversation_events`, `message_attachments`, D14 done state, D17 tasks per the sibling
`docs/TASKS.md`).

**Audience anchor (unchanged).** A plumber, landscaper, cleaner, salon owner — in a truck, on a
phone all day, at a desktop between jobs. **Calm = nothing fights for attention while you get a
reply out fast.** We take the *structure* and *interaction quality* of the reference apps and
drop their density, their multi-accent color, their mandatory keyboard, and their triage-KPI
framing (APP-UI-ELEVATION §6 forbids all four; this doc must not smuggle them back in).

**Auditability.** Every rule is written as a pass/fail check for the design-QA pass against the
running seeded app.

---

## 0. What this overhaul changes, in one breath

1. **Desktop becomes a full-viewport-height app frame**, not a scrolling document: fixed
   `nav | list | thread | (optional context)`, each column scrolls on its own, the page body
   never scrolls, the composer is docked to the thread's bottom. Message *text* is capped at a
   reading measure inside a wider thread pane.
2. **The filter fly-out drawer/sheet is deleted.** Filtering is one-glance: persistent inline
   segmented status tabs + removable chips + a compact command popover (reusing Cmd-K's surface).
   All filter state lives in the URL.
3. **The composer is rebuilt as a Google-Messages pill**: far-left `+` overflow, auto-grow field,
   one petrol send affordance derived from "field non-empty," **no up/down buttons**, desktop
   inline toolbar vs. mobile overflow.
4. **The per-message action is vertically centered**, hover-reveal on desktop / subtle-always on
   mobile, and **done is auditable** — it writes a `conversation_events` `message_done` /
   `message_undone` row that renders in the timeline.
5. **The thread gains an in-thread filter** (All | Messages | Notes | Events) and an
   **attachments gallery** aggregating every attachment from messages + notes (+ task attachments),
   served by the existing signed-URL machinery.

Nothing above adds infrastructure. It reuses D7 (notes as `messages` rows, `conversation_events`,
`message_attachments`, Supabase Storage + signed URLs), D9 (Broadcast IDs-only), D14 (done state),
and the D17/TASKS.md tasks layer.

---

## 1. The full-height 3-pane desktop shell (supersedes DESIGN.md G3 desktop)

### 1.1 The frame

**The whole app is a fixed shell pinned to the viewport; only inner columns scroll.**

- Outer frame: `height: 100dvh` (fallback `100vh`), `overflow: hidden`, a CSS grid of columns.
  The browser page must **not** scroll. Auditable check: at any content volume, `document`
  scrollTop stays 0; scrollbars appear only inside a pane.
- Columns at `≥1280px` (the working desktop):
  | region | width | scroll | notes |
  |---|---|---|---|
  | **Nav rail** | `240px` (collapsible → `64px`) | own (rare) | receded chrome, §1.3 |
  | **Conversation list** | **`360px` fixed (MVP)** | own `overflow-y:auto` | filter bar pinned at its top (§2) |
  | **Thread** | flexible (`1fr`) | own `overflow-y:auto` for the message region only | header pinned top, **composer docked bottom** (§3) |
  | **Context panel** | `320px`, **default closed**, toggled | own | §1.5, Missive-style Details |
- **List width is FIXED at 360px for MVP.** Persisted, user-resizable list-pane width is a
  documented **fast-follow**, not MVP — it is a per-user layout preference the phone-first ICP will
  rarely touch on desktop, and it adds state to persist/QA without moving any of the four stated
  desktop pains (composer, filters, sidebar look, done-centering). The **rail collapse** (§1.3) stays
  in MVP because it earns its place on tablet (§1.6). (Two persisted layout knobs remain in MVP: the
  rail collapsed/expanded state and the context-panel open/closed state — deliberately the minimum.)
- Pane edges are **1px `stone-200` surface edges** (these are surface edges, not the interior
  `--border-subtle` hairlines). **No shadows between panes.** The context panel, when floating on
  a narrow viewport, is the one place a `shadow-lg` overlay is allowed (§1.5).
- Three independent scroll regions run at once: list scroll, thread-message scroll, context-panel
  scroll. The thread **header** (contact + status/assignee/overflow) and the **composer** are
  *outside* the message scroll region — they never scroll away. This is the single biggest
  structural change from the current document-flow thread.
- Keep `@tanstack/react-virtual` virtualization on **both** the list and the message scroll region
  (APP-UI-ELEVATION §6 perf lock). Virtualization now lives inside a fixed-height scroll container,
  which is the correct and simpler shape for it.

### 1.2 Message content max reading width (inside a wide thread pane)

The thread pane fills `1fr`, so on a 1440px+ monitor it is wide. **The pane is wide; the message
*text column* is not.**

- Introduce a centered **reading track** inside the message scroll region:
  `max-width: 42rem` (≈672px, ≈66ch at 16px — the Baymard/Bringhurst measure), centered, with the
  screen gutter. Day dividers, centered timeline event lines, the in-thread filter bar, **and the
  docked composer (§3.1)** all span this same track so the column — including where you type — reads
  as one coherent conversation aligned to the messages, not floated to the pane edge.
- Message bubbles live inside that track: inbound left, outbound right, **both within the centered
  measure** — so on an ultrawide monitor the conversation stays a calm centered ribbon, not a
  fatiguing full-bleed wall. Replace DESIGN.md's `max-width: 65%` percentage with an **absolute**
  bubble cap so the measure holds regardless of monitor width: bubble `max-width: min(90%, 34rem)`
  inside the 42rem track (85–90% on mobile, unchanged). The percentage was relative to the pane
  and blew past 100ch on wide screens; the absolute cap is the fix.
- Message text stays "the largest, darkest thing" (APP-UI-ELEVATION balance-screen hero):
  15px desktop / 16px mobile, near-black, unchanged. Everything around it recedes.

### 1.3 The modern nav rail (Linear "dim the chrome so content wins")

The rail **recedes**; the content panes carry all the near-black.

- Background `stone-100`. Nav **labels** in `stone-500/600`, **icons** in `stone-400`,
  stroke-width `1.75` (DESIGN.md G2 lock). A single **16px icon + 20px label** grid, obsessively
  aligned (Linear's lesson) — icons, labels, and the collapse control share one baseline.
- Primary nav order (members): **For You** (D23, first) · **Inbox** · **Tasks** (new, D17/D25) ·
  **Contacts** · **Templates**. Owners/admins may set Inbox as their default landing (D23).
  Spacer, then **Settings**, the **usage mini-bar** (petrol fill → amber at 80%, APP-UI-ELEVATION
  §3.6), and the company/user block at the bottom.
- **Active item = the ONE petrol element for the rail**: white pill + petrol text/icon. Nothing
  else in the rail competes — no petrol on inactive items, no second accent, no badges-with-color.
- **Unread is the same fact at two altitudes (stated intentionally, not a contradiction).** The
  **rail** communicates unread as a **quiet `stone-500` tabular numeral** (navigation altitude — a
  count of "where is there something"); the **conversation list row** communicates unread as a
  **petrol dot** (content altitude — "this specific thread is unread"). They are the same underlying
  unread state rendered at two altitudes: the rail counts, the row points. Never a petrol dot in the
  rail; never a stone numeral on the row.
- **Collapse to a 64px icon rail** via an explicit click-toggle at the rail's foot (calmer than
  Front's hover-reveal — no twitch), state persisted. Collapsed rail shows icons only, active pill
  becomes a petrol icon on a white square, labels move to `title`/`aria-label` tooltips. This is
  the same 64px rail the tablet breakpoint already uses (§1.6).
- **Do not put search in the rail** (Front does; we don't). Search belongs above the list where the
  filter bar lives (§2); Cmd-K covers jump-nav. The rail is navigation only.
- A **notifications bell** (D24) lives in the thread/top region, not the rail (§1.4).

### 1.4 Top-of-content affordances

There is no global top bar spanning all panes (that would be chrome). Instead:

- The **list header** (top of the list pane) holds: the pane title ("Inbox"), the **petrol "New"
  compose button** (the one petrol element for the list region), and the search field. Below it,
  pinned, sits the filter bar (§2).
- The **thread header** (top of the thread pane) holds: contact name (`500`, near-black), number
  (13px `stone-500`), status select, assignee select, the **notifications bell** (D24 popover),
  the **info/context-panel toggle**, and the overflow menu — **all in `stone-400` chrome, no petrol
  in the header** (send is the thread's one petrol element, §3).

### 1.5 The context panel = toggleable, never always-on (Missive Details)

Validated by every reference app: contextual metadata is **on-demand**, and the default maximizes
the conversation.

- **Default closed.** First impression is a clean 3-pane focused on the thread (APP-UI-ELEVATION
  §3.3). The header info button toggles it (open/closed); that open/closed preference persists per
  user.
- **Automatic dock-vs-float, NOT a user-selectable tri-mode.** On wide viewports (`≥1440px`) the
  panel **docks open** (pushes the thread narrower; the reading track is unaffected); on narrower
  desktop it **floats** as a right overlay with a backdrop and the one allowed `shadow-lg`; on mobile
  it is a **bottom sheet**. This is chosen **automatically by breakpoint** — there is **no
  user-selectable Fixed/Float preference knob** in MVP (a power-user setting the ICP won't touch).
  User-selectable dock modes are a documented **fast-follow** (like the gallery date-scrubber, §5.2).
- **One panel, sectioned, trimmed to the calm core** (don't scatter metadata *and* don't over-stuff):
  Contact (name inline-edit, number+copy, address) · Consent history (plain-language, D3/D4) · Tags ·
  **Tasks checklist** for this conversation (D17/TASKS.md — checkable; checking calls the source
  message's `PATCH /v1/messages/:id {done}`, striking it through in the thread). **The Attachments
  gallery is NOT a panel section** — the panel shows only a quiet **"View all attachments (N)"** row
  (up to 3-4 recent thumbnails) that opens the single gallery surface (§5.2). One entry point, not
  two. Calm surface: 20–24px padding, 32px between sections, labels `stone-500`, auto-saving fields
  (APP-UI-ELEVATION §3.3).
- Slide in 200ms ease-out, backdrop fade; ESC and outside-click close (APP-UI-ELEVATION §4).

### 1.6 Responsive collapse

- **`≥1280px` — full 4-region** as above (nav 240 | list 360 | thread 1fr | context 320 toggled).
- **`1024–1279px`** — same, but the context panel is **float-only** (never docked; too tight to
  dock without crushing the reading track). The list stays at its fixed 360px (MVP — no resize).
- **`768–1023px` (tablet)** — **nav collapses to the 64px icon rail** (§1.3); **list + thread are
  master-detail** (list full-width → tapping a row slides the thread in over it with a back header),
  the fixed-height shell rule still holds; context panel = bottom sheet.
- **`<768px` (mobile)** — **bottom tab bar** (For You · Inbox · Tasks · Contacts · Settings; 44px+
  targets, safe-area padding). The list is a full-screen view; the thread pushes in as a full-screen
  view with a back header; the **composer is docked to the bottom above the safe area**; the compose
  **FAB** (petrol) floats bottom-right above the tab bar on list screens. No nav rail on mobile.
  Message text 16px (prevents iOS zoom). Everything one-handed on 375px.

---

## 2. Filter redesign — kill the fly-out, make triage one-glance (supersedes DESIGN.md G4 filter bar)

**Delete the overflow filter sheet/drawer entirely.** UX evidence is unambiguous that segmented
controls beat dropdowns/drawers for a small set of instantly-applied, mutually-exclusive filters,
and that persistent chips beat hidden state. The new model has three visible layers, no modal that
hides the active filter.

### 2.1 Layer 1 — persistent segmented status tabs

- A segmented control pinned above the list: **Open · Mine · All · Closed** (4 segments, well under
  the 5–7 ceiling). This reuses the **shared segmented-control component** (TASKS.md T6.3); the
  `/tasks` page uses the same component with labels `Open | Mine | All | Done`.
- **Count treatment — reconciled with the anti-KPI lock (§6/§8), not asserted against it.** A count
  is **not** shown on every segment (that is the ambient-number pressure the calm bar rejects, and
  the D14 "no counts" precedent). Instead: a **single count on the action segment only** (**Open** —
  "what needs handling"), rendered as a **quiet `stone-500` tabular numeral**, shown **only when
  `> 0`** and **capped at `9+`**. Mine/All/Closed carry **no** count. This gives one-glance triage of
  the one number that drives action without turning the tab bar into a KPI strip — the explicit
  reconciliation with APP-UI-ELEVATION §6.
- **Active segment = a quiet stone pill** (`stone-100` fill / `stone-800` text) — **NOT petrol.**
  Petrol in the list region is reserved for the "New" compose button (accent budget, §1.4). This
  is locked by APP-UI-ELEVATION §3.1.
- Default = the "what needs me now" view: **Open** for the shared inbox, and on **/for-you** the
  member's assigned queue (D23). Spam is **not** a segment — a chip reveals it (D7/G4).
- URL-encoded: `?status=open|mine|all|closed` (DESIGN.md G3 already mandates `?status=`).

### 2.2 Layer 2 — removable inline chips

- Secondary dimensions (assignee, tag, unread, spam) render as **removable stone-tinted chips**
  right in the filter bar, each with an `×` to clear — **never behind a drawer.** Tokens = the
  status-pill tokens (11px, `500`-weight, rounded, `2px 8px`, stone tint, not petrol).
- Active chips are **always visible** — that is what makes the filter one-glance (Linear's model).
  Each chip maps to a URL param: `?assignee=&tag=&unread=1&spam=1`, so a filtered view is shareable
  and bookmarkable exactly like Linear.

### 2.3 Layer 3 — a compact `+ Filter` command popover (reuse Cmd-K, don't invent a menu)

- A small **`+ Filter`** button opens a lightweight **cmdk command popover** (JobText already ships
  cmdk with shadcn — reuse *that* surface, do not build a second menu). It lists filter properties
  (assignee / tag / unread / spam) with the matching count per option (Linear). Picking one adds a
  chip (Layer 2) and updates the URL.
- The popover is the **one place a `shadow-lg` overlay is allowed** in this region. It is a popover,
  not a drawer: it closes on select/ESC/outside-click and leaves the applied filter visible as a chip.
- Optional keyboard: `F` opens it, `/` focuses search (desktop only, invisible on mobile — no
  keyboard tax, APP-UI-ELEVATION §5/§6).

### 2.4 Search

- Search field in the list header (§1.4), debounced 250ms, fires `/v1/search` at ≥2 chars, results
  grouped Conversations / Contacts with snippet highlights (unchanged from G4). `?q=` in the URL.

**Auditable:** there is no filter drawer/sheet anywhere; the active status is a stone segment; all
active secondary filters are visible as chips; every filter dimension round-trips through the URL.

---

## 3. Composer rebuild — Google-Messages pill (supersedes DESIGN.md G5 composer)

The reference the decision names is Google Messages' Material-3 composer. Adopt its **anatomy** and
its **derive-send-state-from-content** rule; keep JobText's deliberate-send stance and accent budget.

### 3.1 Anatomy (docked to the thread's bottom, never scrolls away)

Left → right, a single pill-shaped container (1px `stone-200`, radius fully rounded, `teal`-free):

1. **Far-left `+` overflow** (`stone-500` icon). It is the attach/template/emoji entry point.
   - **Desktop:** `+` expands **inline** to a compact toolbar — **Attach image** and **Insert
     template** icons (`stone-500`), emoji folded behind the same overflow (an SMS tool doesn't need
     a first-class emoji picker). `/` still opens the template picker inline (G5 lock).
   - **Mobile:** everything **collapses behind the `+`** so the field is maximal one-handed (the
     explicit decision). Tapping `+` opens a small action sheet (Attach · Template · Emoji).
2. **Auto-grow text field**, 1→6 rows, pill-shaped, generous vertical padding ("less cramped, more
   modern"), 16px on mobile (iOS zoom lock). Placeholder `stone-400`.
3. **Send affordance = the single petrol control in this region.** A petrol send arrow/button,
   **active only when the field is non-empty** (Google/WhatsApp derive-from-content rule); disabled
   = `stone-300`, no petrol. Attachment-only (no text) also enables send.

**The docked composer pill is constrained to the same 42rem reading track as the message column**
(with the screen gutter), so the field aligns to the conversation, not to the full `1fr` pane — the
send affordance sits under the messages it belongs to, never floated far right on an ultrawide
monitor. This puts the composer in the **same track set** as the message column, the in-thread filter
bar (§5.1), and the day dividers (§1.2): all four share the 42rem centered track.

### 3.2 Kill the up/down buttons — what they were, what replaces them

The current composer carried **stepper-style up/down controls**. In practice these were one (or
both) of: (a) a **row-height stepper** to grow/shrink the textarea, and (b) a **segment-count
stepper** next to the character meter. **Both are removed:**

- **Textarea rows** are now **auto-derived** from content (1→6 rows, then internal scroll) — no
  manual grow/shrink control. This matches every modern composer; the field just grows.
- **Segment count** is **not a stepper** — you can't "step" how many SMS parts a message is; it's
  computed. Replace it with a **quiet inline segment hint**: a single `stone-400` 12px line that
  **appears only past 120 chars** (`Sent in 2 parts`), turning amber only at ≥4 parts, with the
  plain tooltip from APP-UI-ELEVATION §3.2 ("Longer texts are sent in parts — this one's 4 parts").
  Never the word "segment," never a stepper, never a +/−. Tabular numerals.

**Auditable:** no up/down/stepper buttons exist in the composer; send is derived from field content;
the segment hint is a passive text line, not a control.

### 3.3 Send affordance & keyboard (deliberate-send preserved)

- **Cmd/Ctrl+Enter sends. Enter = newline.** SMS is deliberate, not chat-instant — **do NOT copy
  chat apps' Enter-sends** (DESIGN.md G5 + APP-UI-ELEVATION §3.2 lock). The send button is the
  primary; the shortcut is the accelerator.
- Send is **optimistic** (APP-UI-ELEVATION §4): the queued outbound bubble *is* the optimism (D9
  send lifecycle), updating in place "Sending…" → "Sent" → "Delivered." Failure → red
  "Not delivered — Retry" inline.
- **Banner-replaces-composer states** are unchanged (opted-out / registration-pending /
  past-due / usage-cap — one tinted card, one sentence, one action; APP-UI-ELEVATION §3.2). The
  banner replaces the whole docked pill.
- New-outbound compose flow (recipient E.164 formatting, consent checkbox, quiet-hours dialog,
  first-message footer preview) is unchanged (G5).

---

## 4. Per-message action — vertically-centered, hover-reveal desktop, and AUDITABLE done
(refines DESIGN.md G5 message actions + D14)

### 4.1 The affordance (Gmail right-edge reveal, adapted to a bubble)

- **Desktop:** on message hover, a quiet **circle-check + overflow (⋯)** appears at the bubble's
  **right edge, vertically centered to the bubble** (`stone-400`, petrol on hover). Two controls
  max — resist a Gmail-style four-button cluster (keep it calm); the overflow holds the rest.
- **Mobile:** an always-visible **subtle circle** on the bubble's action row (D14 mobile spec), same
  vertical centering.
- Applies to inbound, outbound, and notes alike (D14). 150ms transition, `aria-pressed` toggle,
  SR labels "Mark done" / "Mark not done."
- Done visual (unchanged, D14): `line-through` + 55% opacity + a small **petrol check badge** with
  the audit tooltip (`Done · Sam · 2:14 PM`).
- The **overflow (⋯)** menu holds: **Make a task** (D17 promote — `POST /v1/tasks {message_id}`,
  opens the compact prefilled form from TASKS.md T5.1), Copy text, and (outbound/eligible) Retry.
  Promote-to-task is opt-in and rare; the quiet done toggle stays the default 99% action.
- **A promoted message shows a single quiet STONE task indicator, never a petrol task badge.** The
  "has a task" affordance is a tiny checklist glyph in `stone-400` (petrol only on hover/focus) that
  links to the checklist / task detail (TASKS.md T5.1). **Done-ness is carried ONLY by the D14
  strikethrough + petrol check** — a task is *metadata*, not *completion*, so it recedes. This keeps
  a promoted-and-done message from becoming a three-mark petrol cluster (strikethrough + petrol
  done-check + a second petrol badge). Distinguish the two marks by **channel**: petrol check = state,
  stone checklist glyph = "has a task," with a minimum gap between them (design-QA case, TASKS.md
  T5.3).

**Accent-budget clarification (locks §8; applies to the whole thread region).** The one-petrol rule
is **one petrol *control* per region** — the composer **send** is the thread's single petrol
*control*. The D14 **done-check** and the promoted-message task indicator are **not controls in the
budget sense**: the done-check is a passive petrol *state* mark, and the task indicator is **stone**
(petrol only on transient hover). So a thread scrolling several done messages plus an active composer
still shows exactly **one petrol control**; passive done *state* marks are the sole exception, and the
task indicator spends no petrol at rest. No more than one petrol *control* is ever in view.

### 4.2 Done is auditable — the event (new; extends D14, does not change its schema)

D14 already stores `messages.done_at` + `messages.done_by_user_id` and broadcasts `message.status`.
**This overhaul additionally writes an audit row so done/undone appears in the timeline** and in the
new Events filter (§5.1). No new table — reuse `conversation_events` (D7 audit timeline). The
canonical event vocabulary is the **shipped** table: column **`type`** (the `conversation_event_type`
enum — **not** `event_type`), column **`payload`** (jsonb — **not** `meta`), `actor_user_id`; the
enum-addition list is pinned in `docs/TASKS.md` T8.

- On a **done** transition (a real state change — see the idempotency guard), the `PATCH
  /v1/messages/:id {done:true}` handler appends one `conversation_events` row **in the same
  transaction** as the `done_at` write:
  ```json
  {
    "type": "message_done",
    "conversation_id": "<uuid>",
    "actor_user_id": "<uuid>",          // done_by_user_id
    "created_at": "<ts>",
    "payload": { "message_id": "<uuid>" }
  }
  ```
- On an **undone** transition, an identical row with `"type": "message_undone"`.
- **The payload stores only `{ message_id }`.** The timeline renders "Sam marked a message done" by
  **joining the live `messages.body`** at display time (as it already does for status/assign lines) —
  the body is **not** copied into the event. One source for the text, no stale excerpt, no new PII
  surface (D8). (This replaces an earlier draft that stored a `message_excerpt`/`message_direction`
  copy; both are removed.)
- **Completion is derived — there is no task-side write, so no `source` field.** Under D17
  (TASKS.md) a task has **no** done column; the task checklist checkbox literally calls this **same**
  `PATCH /v1/messages/:id {done}` on the source message. There is one column (`messages.done_at`) and
  one write path, so there is nothing to mirror and no "which side clicked" to record.
- **Idempotency / no loop (one sentence):** **single column, single write path, D14 idempotency — no
  loop is possible.** A PATCH that sets `done` to its current value is a D14 **no-op** (returns the
  row, writes nothing, emits **no** broadcast, appends **no** event). Only a genuine transition logs
  an event. The elaborate value-guard / mirror / echo-suppression analysis from the earlier draft is
  **deleted** — it defended a two-writer race that D17's derived design removes by construction.

### 4.3 How it renders in the timeline

- In the thread's **Events** view (and inline in **All** view), the row renders as a centered 12px
  `stone-400` system line (the existing timeline-event treatment, APP-UI-ELEVATION §3.2), with the
  excerpt **joined from the live message body** at render time (§4.2 — never a stored copy):
  - `Sam marked "Can you come Thursday?" done · 2:14 PM`
  - `Sam marked "Can you come Thursday?" not done · 2:20 PM`
  - There is **no separate "completed a task" line** — completion is the message's `message_done`
    event whether the user clicked the in-thread check or the task checkbox (both write the same
    `messages.done_at`, D17). Task *metadata* lifecycle (created/assigned/due/deleted) has its own
    `task_*` lines (TASKS.md T2.1 / D22).
- The excerpt is quoted, truncated with `…`, and links to the source message (scrolls/anchors to it).
  Relative time in the viewer's timezone; hover shows absolute + zone (D15). Quiet by design — this
  makes done history discoverable without cluttering the default message view.

---

## 5. In-thread filter + attachments gallery (new; pure read-views over existing data)

Both are read-only views over data JobText already stores (D7): notes are `messages` rows
(`direction='note'`), events are `conversation_events`, media is `message_attachments` (+ task
attachments per TASKS.md). No new storage, no new write paths.

### 5.1 In-thread filter — All | Messages | Notes | Events

- A **compact inline segmented control** at the top of the message scroll region (inside the reading
  track, §1.2), same tokens as the inbox status tabs: **quiet stone active pill, no petrol.**
  4 segments; **All is the default.**
- Behavior:
  - **All** — the full interleaved stream: inbound + outbound + notes + centered timeline events.
  - **Messages** — `direction in ('inbound','outbound')` only.
  - **Notes** — the amber internal-note cards only (`direction='note'`).
  - **Events** — the centered `stone-400` timeline lines only (status changed, assigned, tagged,
    opt-out/opt-in, **and the new `message_done`/`message_undone`** from §4.2), read from
    `conversation_events`.
- This is a cheap client/query-side toggle over already-loaded data. State may be URL-encoded
  (`?thread=all|messages|notes|events`) for shareability but defaults to All and does not need to
  persist. Keep it near-invisible until used (stone chrome) — "nothing fights for attention."

### 5.2 Attachments gallery — all media from messages + notes + tasks (ONE entry point)

The reference is Telegram's "Shared Media," trimmed to a tradesperson's reality.

- **Single entry point: the thread-header overflow.** The gallery is **not** a context-panel section
  (that would give one surface two entry points, breaking one-obvious-action) and **not** a 5th
  in-thread segment (keeps the in-thread control at 4). The context panel only carries a quiet
  **"View all attachments (N)"** row (§1.5) that opens **this same** gallery.
- **Source — a TWO-table union (canonical query + item shape in `docs/APP-FEATURES-V2.md` §4.2, cited
  here, not restated):** (1) the **MMS arm** — `message_attachments` **JOINed through `messages`**
  for conversation scope, because `message_attachments` has **no `conversation_id` column** (SPEC.md);
  (2) the **generic arm** — the D19 `attachments` table filtered on its denormalized `conversation_id`,
  which supplies **both** note (`owner_type='note'`) and task (`owner_type='task'`) attachments. There
  is **no** `task_attachments` table (D19/D17). Served via the existing short-lived signed URLs (MMS
  path + the generic `GET /v1/attachments/:id/url`, D19); zero new storage work.
- **Origin tag = the canonical `source` enum** `'mms' | 'note' | 'task'` (APP-FEATURES-V2 §4.2),
  mapped to display tags **Message / Note / Task** in the UI layer only, so the owner can tell where a
  photo came from. `kind: 'image' | 'file'` drives the tabs.
- **Category tabs** trimmed to reality: **Images · Files** (SMS is mostly images + the occasional
  PDF; drop Links/Music/Video-as-separate unless present). **Group by date.**
- **Interaction:** thumbnail → the existing **MMS lightbox** (blur-up placeholder, already in the
  stack); file → **signed-URL download**. Calm responsive grid on a `stone-50` surface, lazy-loaded,
  blur-up thumbnails.
- **Explicitly out of scope for MVP** (Telegram-scale, wrong altitude): pinch-to-zoom density,
  calendar date-scrubber, in-files search, and user-selectable panel dock modes (§1.5). A simple
  date-grouped responsive grid is the right size. Respect done/opt-out and company RLS; never surface
  an attachment outside the company (D8).

---

## 6. What changes vs. current components (the migration map)

| current component (DESIGN.md) | change | new spec |
|---|---|---|
| **App shell** (G3, document-flow 3-region) | **restructure** → fixed `100dvh` grid, independent pane scroll, docked composer, toggled context panel | §1.1, §1.5 |
| **Nav sidebar** (G3, 240px) | **restyle + extend** → receded Linear chrome, add For You/Tasks, click-collapse to 64px, one petrol active pill | §1.3 |
| **`conversation-row`** (G4, 68px) | **keep** anatomy; unread petrol dot is the only accent; time/assignee/pill drop to `stone-400`; virtualized inside the fixed list scroller | §1.1, inherits APP-UI-ELEVATION §3.1 |
| **`filter-bar`** (G4 segmented **+ overflow sheet**) | **rebuild** → delete the sheet; segmented status tabs (single quiet count on Open only, §2.1) + removable chips + `+ Filter` cmdk popover; all URL-state | §2 (all) |
| **`thread`** (G5, scrolls as a document) | **restructure** → pinned header + docked composer *outside* a virtualized message scroll region; centered reading track (≤42rem); add in-thread filter | §1.1, §1.2, §5.1 |
| **`message-bubble`** (G5, `max-width:65%`) | **retune** → absolute measure cap (`min(90%, 34rem)` in the track); vertically-centered hover/subtle action (done + overflow); done writes an audit event | §1.2, §4 |
| **`composer`** (G5, toolbar + steppers) | **rebuild** → Google-Messages pill: `+` overflow, auto-grow, derive-send-from-content, **no up/down buttons**, passive segment hint, desktop toolbar vs mobile overflow | §3 (all) |
| **contact panel** (G6, toggled right) | **extend** → Missive Details (calm core: Contact/Consent/Tags/Tasks checklist + a "View all attachments" row); auto dock-vs-float by breakpoint (no user Fixed/Float knob); gallery is header-overflow, not a panel section | §1.5, §5.2 |
| **timeline events** (G5, centered stone lines) | **extend** → add `message_done`/`message_undone` rows; surface via the Events in-thread filter | §4.2, §4.3, §5.1 |
| **command palette** (G3, cmdk) | **reuse** → the same cmdk surface backs the `+ Filter` popover (no second menu) | §2.3 |
| **MMS lightbox / signed URLs** (D7) | **reuse** → the attachments gallery is built entirely on it | §5.2 |

**New surfaces this overhaul assumes exist** (specified in their own docs, referenced here for
layout only): **/for-you**, **/tasks** + its four views, the **notifications bell** (all in
`docs/HOME-AND-VIEWS.md`), the **tasks** data layer (D17/TASKS.md). This doc governs their *shell
placement* (nav order §1.3, top region §1.4), **not their internals and not their ratification**.

> **Provisional decision numbers.** `docs/HOME-AND-VIEWS.md` is a **binding** product-owner doc, but
> its decision numbers **D23 (/for-you) · D24 (notifications bell) · D25 (/tasks four views)** are
> **provisional** — that doc states they are "provisional — reconcile with DECISIONS.md D17–D22 when
> merging," and ratified DECISIONS.md currently ends at **D22**. So wherever this layout doc places
> /for-you, the notifications bell, or /tasks-nav, it governs **shell placement only**; the surfaces'
> existence and final numbering rest on HOME-AND-VIEWS.md's ratification. A builder should wire nav
> placement as specified but treat "D23/D24/D25" as pending numbers, not final DECISIONS.md entries.

---

## 7. Guardrails (mobile-first · a11y · reduced-motion · performance)

Inherits every guardrail in **APP-UI-ELEVATION §6** unchanged; these are the overhaul-specific
additions.

**Mobile-first**
- Every new surface is designed at 375px first: the composer collapses to `+`-overflow so the field
  is maximal; the context panel + attachments gallery are bottom sheets; the in-thread filter and
  status tabs remain full segmented controls (they fit 4 segments at 375px) or scroll horizontally
  if a chip row overflows. Bottom tab bar owns primary nav; no rail on mobile.
- 16px message field + message text (iOS zoom lock). Hit targets ≥44px (`.tap-target`). Compose FAB
  above the tab bar. One-handed throughout.

**Accessibility (WCAG 2.1 AA)**
- The fixed-height shell must keep a **complete keyboard path**: rail → list (`J/K` optional, Enter
  opens) → thread messages → composer → context panel; focus never trapped in a scroll region;
  `Tab` order follows visual order across panes.
- Segmented tabs = `role="tablist"` / `tab` with `aria-selected`; filter chips are buttons with an
  accessible "Remove <filter>" label; the `+ Filter` popover is a labeled dialog/listbox with
  arrow-key navigation.
- Composer send is a real `button` (disabled state announced); the `+` overflow is a labeled
  `menu`. The per-message action is an `aria-pressed` toggle + a labeled overflow `menu`.
- Incoming messages announce via `aria-live="polite"` (unchanged). Timeline event lines (including
  done/undone) are readable text, not icon-only. `stone-400` meta must still clear 4.5:1 on its
  surface; anything carrying essential meaning bumps to `stone-500` (APP-UI-ELEVATION §6).
- Attachments gallery: every thumbnail has alt/label text; lightbox is a focus-trapped dialog with
  ESC; downloads are keyboard-reachable.

**Reduced motion**
- All new motion (pane/panel slides, in-thread filter transitions, the message action reveal, FLIP
  re-sort, undo toast) is authored as CSS transitions/keyframes so the `globals.css`
  `prefers-reduced-motion: reduce` base rule disables it for free; any JS-driven motion (FLIP,
  gallery layout) checks the media query and no-ops to instant state (APP-UI-ELEVATION §2.5).

**Performance**
- No new animation libs, no scroll-cinema (APP-UI-ELEVATION §6). Virtualize the list *and* the
  message scroll region inside their fixed-height containers. The in-thread filter and Events view
  operate on already-loaded/refetched page data (D9 refetch-by-ID); Attachments lazy-loads
  thumbnails with blur-up. Signed URLs are short-lived and generated on demand (D7). Route-level
  code splitting; Board/Calendar/Map task views and the map's `react-leaflet` stay lazy client
  islands (HOME-AND-VIEWS). The UI must never make a tradesperson wait.

**On-brand / honest (locks, restated):** petrol `#0F766E` + warm stone + Inter only; **one petrol
*control* per region** (rail active pill · list "New" · composer send — never two controls in view).
**Passive done/task *state* marks are the sole exception** (§4.1): the D14 done-check is a passive
petrol state mark and the promoted-message task indicator is stone (petrol only on hover) — neither is
a control, so a thread of done messages plus an active composer still shows one petrol control.
Tinted-quiet pills are the color ceiling (no rainbow source-coding); no card shadows (overlays only);
keyboard is strictly optional and invisible on mobile; the home surface is a conversation/queue,
never a KPI dashboard (APP-UI-ELEVATION §6).

---

## 8. Twelve-line summary

1. **Desktop becomes a fixed `100dvh` app frame** — `nav | list | thread | (context)` — with each
   pane scrolling independently and the page body never scrolling.
2. **The composer docks to the thread's bottom** and the thread header pins to its top, both
   *outside* a virtualized message scroll region.
3. **Message text is capped to a ~66ch reading track (≤42rem, centered)** inside a wide thread pane;
   bubbles use an absolute measure cap, not a percentage.
4. **The nav rail recedes (Linear-style)** — stone chrome, one petrol active pill, click-collapse to
   64px — and gains For You + Tasks; search stays out of the rail.
5. **The context panel is default-closed, toggleable**, auto-docks-or-floats by breakpoint (no
   user-selectable Fixed/Float knob), and holds the calm core — Contact, Consent, Tags, the Tasks
   checklist, and a "View all attachments (N)" row (the gallery itself opens from the thread-header
   overflow, one entry point).
6. **The filter fly-out drawer is deleted**; filtering is one-glance via segmented status tabs
   (Open/Mine/All/Closed, quiet stone active — never petrol) with a **single quiet count on Open only**
   (stone, `>0`, capped `9+`) — reconciled with the anti-KPI lock, not a count on every tab.
7. **Secondary filters are always-visible removable chips + a `+ Filter` cmdk popover** (reusing
   Cmd-K), with every filter dimension round-tripped through the URL.
8. **The composer is a Google-Messages pill** — far-left `+` overflow (desktop toolbar / mobile
   action sheet), auto-grow field, petrol send derived from "field non-empty."
9. **The up/down stepper buttons are removed** — rows auto-grow and segment count becomes a passive
   `stone-400` "Sent in N parts" hint; Cmd/Ctrl+Enter still sends, Enter = newline.
10. **The per-message action is vertically centered** (done + overflow), hover-reveal on desktop /
    subtle-always on mobile, with "Make a task" in the overflow.
11. **Done is auditable** — a genuine done/undone transition writes a `conversation_events` row
    (column `type`=`message_done`/`message_undone`, `payload {message_id}`, idempotent via the D14
    no-op) rendered as `X marked "…" done` (body joined live) in the timeline/Events view. Completion
    is **derived** (D17): the task checkbox calls the same message PATCH — one column, one write path,
    no mirror, no loop.
12. **The thread gains an in-thread filter (All/Messages/Notes/Events — client-side over embedded
    data, D21)** and an **attachments gallery** (a **two-table** union: `message_attachments` joined
    through `messages` for conversation scope + the generic `attachments` table for note+task, D19/D21;
    single header-overflow entry point), all on existing signed-URL/RLS machinery — no new
    infrastructure.
