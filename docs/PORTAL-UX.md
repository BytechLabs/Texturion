# Loonext Portal — Definitive UX/UI Spec

**Status:** Binding build direction. Supersedes prior shell explorations.
**Winner:** `triage` (Focus / triage home) — grafted with the best ideas from `command`, `jobs`, and `hybrid`.
**Register:** Wealthsimple-calm. Hairlines not shadows. One rationed petrol accent. Few things per screen. Type and spacing carry the craft.

---

## 0. Why this direction

The real job is *"catch every text that turns into paying work and never drop a lead,"* done by an owner who is in a truck with the phone in a dusty pocket. That person does not want to browse an inbox; they want the app to hand them the next thing that matters and get out of the way.

So the portal's default answer to *"what do I do now?"* is a **finite, ordered pile** — the **For You** triage home — not an open-ended list. The full **Inbox** is a calm secondary surface one click away. Both are the *same objects seen two ways*, over the already-shipped `api_for_you` RPC and the existing conversations/messages/tasks/contacts model. No backend rewrite.

This wins because it is the strongest concept for the ICP *and* the most buildable, and it honors the demonstrated taste (calm, sleek, visual-but-quiet left sidebar, no shadows). The runner-up ideas are grafted rather than discarded:

- **From `command`:** a context-aware ⌘K palette (search + navigate + act in one surface), single-letter accelerators printed inline, dense-but-calm inbox rows, amber "internal, not sent" notes, and a "Task" chip on a promoted message.
- **From `jobs`:** the optional **job spine** (a lightweight stage stepper) and a **right context panel** carrying the facts a tradesperson needs (address with a Map jump, job type, quote, scheduled time), plus auto-lifted facts shown as a *confirmed* in-thread event.
- **From `hybrid`:** the petrol 3px edge-marker + tint active-nav treatment, the slide-in right **context drawer** that co-locates contact/tasks/attachments, and missed-call text-back rendered as a real tagged conversation with an `Auto:` prefix.

Two grafts are deliberately **rejected** to protect the taste: `hybrid`'s default-collapsed hover-rail (hides the at-a-glance count on touch) and `jobs`' four-hue stage taxonomy (violates the single-accent rule). The rail stays **always-labeled**; stages render in **one petrol accent + neutral ink**, never a rainbow.

---

## 1. Navigation model

A **calm, always-labeled left sidebar** (232px, white, single hairline right border) — never a top bar, never a bare icon rail. It carries real visuals: a company tile, glyph+label+count nav, single-tone avatars, and exactly one live petrol pill.

```
┌─ SIDEBAR 232px ─┐┌─ CONTEXT COLUMN ─┐┌─ STAGE (flex-1) ─┐┌ DRAWER 300px ┐
│ Company tile    ││ (varies by dest) ││ (varies by dest) ││ (slide-in,   │
│                 ││                  ││                  ││  on demand)  │
│ FOCUS           ││ Inbox → conv list││ Inbox → thread   ││ Contact +    │
│  For you  ●6    ││ Tasks → task list││ Tasks → detail   ││ this convo's │
│  Inbox    12    ││ Contacts → list  ││ Contacts → detail││ Tasks +      │
│  Tasks     4    ││ ...              ││ ...              ││ attachments  │
│  Contacts       │└──────────────────┘└──────────────────┘└──────────────┘
│ LIBRARY         │
│  Templates      │  The context column swaps its whole content per
│  Numbers   2    │  destination. The stage holds the open object.
│ ─────────────── │  The drawer is optional context, never a route change.
│  Settings       │
│  [JR] Joe R ▸   │
└─────────────────┘
```

### 1.1 Sidebar contents (top → bottom)

- **Company tile** — petrol-tint square logo (initials, e.g. `RP`), company name, and a quiet sub-line (`Austin, TX` / `2 numbers active` with a live dot). Click opens the workspace/plan switcher.
- **FOCUS group:** `For you` (the triage home, **default landing**, the *only* petrol pill — a live count of items in the batch), `Inbox` (unread count, muted numeral), `Tasks` (open count), `Contacts`.
- **LIBRARY group** (quieter, uppercase 10.5px label): `Templates` (saved replies), `Numbers` (count of active lines).
- **Footer (pinned):** `Settings`, then the signed-in **member tile** (avatar, name, role, a notification bell). Click opens profile/team/sign-out.

**Active-nav treatment (grafted from `hybrid`):** petrol-tint fill + petrol-deep text/icon + a **3px petrol left edge-marker**. Never a heavy fill, never a shadow.

**Count rationing:** counts are muted tabular numerals. The **single petrol pill** is reserved for `For you` — the one queue with live, must-act work. This is the "one rationed accent" made literal in the nav.

### 1.2 Global reach (everywhere)

- **⌘K command palette** (grafted from `command`) — the real navigator. Opens over any screen. Fuses:
  - **Search** (default): conversations, contacts, tasks, templates, settings.
  - **Go to** group: `G F` For you, `G I` Inbox, `G T` Tasks, `G C` Contacts.
  - **Context actions** when an object is focused: a chip reads `Dana Whitfield · actions apply to this conversation`, and rows run `Assign… A`, `Mark done E`, `Make a task T`, `Send template`, `Change status`. Accelerator letters are **printed in the row** so the keyboard model teaches itself.
- **Search glyph** sits in each context-column header and opens the same palette in search mode (`/` focuses it).
- **Notifications** — the bell in the member tile drives Web Push; a notifications view lives in ⌘K and Settings.

### 1.3 Keyboard model (desktop, discoverable not hidden)

Printed inline in the composer footer and the ⌘K rows:

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `J`/`K` | next / prev item in queue or list | `R` | reply (focus composer) |
| `E` | mark Done | `A` | assign |
| `T` | promote to Task | `N` | new message |
| `/` | focus search | `⌘K` | command palette |
| `G` then `F/I/T/C` | jump to destination | `Esc` | close drawer / palette |

Every keyboard action is **also reachable by click** (rail, row-hover actions, thread action buttons, ⌘K). Keyboard accelerates the expert; it never strands the mouse-only or touch user.

---

## 2. Information architecture — every feature has a home

| Feature | Home | Notes |
|---|---|---|
| **Conversation inbox** (new/open/waiting/closed, spam, tags, assignment, unread) | `Inbox` destination → context column | Statuses = `Open · Waiting · Closed` segmented control + `Spam` filter. Tags, assignee chip, unread petrol dot render inline on each row. |
| **For-you focus queue** | `For you` destination (default landing) | Renders `api_for_you`: **Triage** (unassigned leads to dispatch), **Waiting on you** (your open/waiting, urgency-sorted), **My tasks** (overdue/soon). Missed-call text-backs appear as typed cards inline. |
| **Message thread** (SMS+MMS, notes, mark message Done, promote-to-Task, attachments) | Stage column when a conversation is open | Bubbles, delivery receipts, day divider, amber internal notes, inline task/stage events, per-message Done + promote actions. |
| **Tasks** (list + board + calendar + map, detail: title/assignee/due, discussion) | `Tasks` destination | View switch in the Tasks header. Task detail opens as a **drawer** over the list (also `?task=` deep-link). Surfaced in For-You as `my_tasks` and via promote-to-task. Back-links to source conversation. |
| **Contacts** (list, detail, import/export) | `Contacts` destination | Detail carries history + tags; reachable from a thread header's person icon. CSV import/export. |
| **Templates / saved replies** | `Templates` destination + composer picker | Managed as a library; inserted inline from the composer or ⌘K → Send template. |
| **Multiple Numbers** | `Numbers` destination + Settings → Numbers | Thread footer names which line is on the wire (`Sending as Main line · (512) 555-0193`). Each number carries its own inbound routing + missed-call/after-hours rules. |
| **Settings** | Footer → Settings sections | Profile, Team members (invites/roles/seats), Numbers management, Billing + usage with caps (80/100% alerts, one-click raise), 10DLC registration/compliance (brand/campaign, sole-prop OTP), number porting. |
| **Notifications** | Bell in member tile + ⌘K + Settings → Notifications | Web Push; unread drives the `For you` pill and `Inbox` count. |
| **Global search + ⌘K** | The ⌘K palette + per-column search glyph | Search-first; context actions when an object is focused. |
| **Missed-call text-back** | Inbox/For-You **typed card** + toggle under Numbers | A real tagged conversation (`Missed call` tag, `Auto:` outbound prefix). |
| **After-hours auto-reply** | Rule under Numbers/Settings | Posts a system reply into the thread. |

**Nothing is orphaned:** every feature is a sidebar destination, a Settings section, a thread/composer action, or a typed card in the For-You batch.

---

## 3. Key screens

### 3.1 For You — the triage home (default landing)

The differentiating surface. A **single scrollable stage** of typed cards, grouped into a few labeled sections, cleared one at a time.

- **Header:** `For you`, a quiet sub-line (`6 things need you · you're all caught up otherwise`), the bell, and the search glyph.
- **Sections** (each a small uppercase label + count), rendered from `api_for_you`:
  1. **Triage** — unassigned new leads + unassigned tasks to dispatch (owner/lead only). Each card: avatar, name, one-line preview, the reason chip (`New lead`, `Missed call`), and inline `Assign ▾ / Reply / Done`.
  2. **Waiting on you** — your assigned open/waiting threads, **urgency-sorted**, with overdue-task and unread pinned to the top.
  3. **My tasks** — your overdue / due-soon tasks with the source-conversation back-link.
- **Why-it's-here transparency (grafted from `command`/`triage` best-idea):** every card shows the concrete signal that placed it — `overdue task`, `unread 2h`, `waiting 3h` — never a black-box score. This is what earns owner trust.
- **Clear-one-at-a-time:** `J`/`K` move the focus ring; `R` opens the thread inline, `E` clears, `A` assigns, `T` makes a task. Clearing a card slides it out; the count in the sidebar pill decrements live.
- **Empty state:** a calm centered mark + `You're all caught up. New leads will show up here.` — never a spinner-shaped void.

### 3.2 Inbox — the calm secondary surface (primary mockup)

Three-pane: sidebar · conversation list · thread (+ optional drawer).

**Conversation list (context column, ~372px):**
- Header: `Inbox` title, search glyph, sub-line (`3 new leads · 2 waiting on us`), then a `Open · Waiting · Closed` segmented control (with counts) and a `Spam` filter reachable from an overflow/filter affordance.
- **Dense-but-calm rows (grafted from `command`):** single-tone avatar, name (bold if unread), 2-line preview, relative time, an unread **petrol dot**, and a meta line of chips — status/reason (`New lead`, `Missed call`, `Waiting on us`, `Scheduled`), plus an **assignee chip** (`[JR] You`). Scannable in one glance without opening the thread. Selected row = white fill + hairline border (no shadow).
- Day separators group the list. Missed-call text-back is a first-class row (`Missed call` tag).

**Thread (stage column):**
- **Header:** avatar, name + status pill, meta line (`(512) 555-0148 · Main line · Assigned to you`), and actions: promote-to-Task, assign, overflow, and the petrol **Done** button. A drawer toggle (person/info icon) opens the context drawer.
- **Optional job spine (grafted from `jobs`, single-accent):** a slim, dismissible stage stepper under the header — `New lead · Quoted · Scheduled · In progress · Done` — where the current stage is petrol and the rest are neutral ink hairline dots. Advancing a stage = PATCH a pipeline tag. Off by default for solo crews; on for those who want pipeline visibility. **No rainbow** — one accent only.
- **Stream:** inbound bubbles (white, hairline, top-left clipped), outbound bubbles (petrol), day divider, delivery receipts (`✓ Delivered · 2:44 PM · Joe`), MMS attachment tiles with caption, **amber internal notes** (`internal, not sent`, distinct from customer-visible), and inline **events**: `Joe made a task · Emergency water heater · due today 5 PM`, and the auto-lifted-fact event `Address saved to job from Dana's text — 214 Marlow St` (grafted from `jobs` — a *confirmed* one-tap event, never silent parsing). A promoted message carries a small `Task` chip in its meta (grafted from `command`).
- **Composer:** `Reply · Note` tabs (Note tab tints amber), a focus-ringed box, tools (`Templates`, `Attach`, emoji), the petrol send button, and a footer line: `Sending as Main line · (512) 555-0193 · Reply R · Done E · Next J` — naming the number on the wire and teaching the keyboard loop.

**Context drawer (grafted from `hybrid`, ~300px, slide-in, no route change):** contact details (name, number, tags, `View contact`), **this conversation's Tasks** (checkable, with due + assignee, `Board ↗` jump), and an **attachments gallery**. Auto-collapses below ~1100px to the header toggle so the thread keeps a comfortable measure.

### 3.3 Tasks

- Context column = the task list; header carries a `List · Board · Calendar · Map` view switch.
- **List:** grouped by due (Overdue / Today / This week / Later), each row: checkbox, title, assignee avatar, due chip, source-conversation link.
- **Board:** columns by status or pipeline stage (drag = PATCH), single-accent.
- **Calendar / Map:** scheduled tasks by date / by job address (Map uses the auto-lifted address facts).
- **Task detail** opens as a **drawer** over whichever view: editable title / assignee / due, a **discussion** thread, attachments, and a back-link to the source conversation. Reachable from the thread's context-drawer task list too.

### 3.4 Contacts

- Context column = searchable contact list (name, number, last-contact, tags).
- **Detail** (stage): profile, tags, full conversation history, tasks, `CSV import / export` in the header.
- A thread header's person icon deep-links to the contact detail.

### 3.5 Settings

Context column = a sections nav; stage = the section body. Sections: **Profile**, **Team members** (invites, roles, seats), **Numbers** (per-line routing, missed-call text-back toggle, after-hours auto-reply rule, porting wizard), **Usage** (caps with 80/100% alerts, one-click raise), **Billing**, **10DLC / Compliance** (brand + campaign status, sole-prop OTP), **Notifications**, **Account**. Each section is a standard calm page; each is deep-linkable from ⌘K.

---

## 4. Visual system

**Font:** Golos Text. `font-family:'AppGolos', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. The literal comment `/*GOLOS_FONTFACE*/` is the first thing inside the first `<style>` (orchestrator injects the real `@font-face`).

**Palette tokens (exact):**
`ink #1A2420` · `ink-soft #3C4742` · `muted #79837D` · `faint #A6ADA7` · `petrol #0F766E` · `petrol-deep #0B4F49` · `petrol-tint #EDF3F1` · `paper #FBFBF9` · `white #FFFFFF` · `line #ECEBE5` · `line-soft #F3F2EE`.

**Rules:**
- **No shadows.** Structure is carried by **hairlines** (`--line`) and fills (`--paper` / `--white` / `--petrol-tint`). A single, barely-there shadow is permitted *only* on a true floating layer (the ⌘K palette, a menu popover).
- **One rationed petrol accent:** the active-nav marker, the selected row, the send/Done buttons, the current job-stage, the single `For you` pill, and the highlighted palette row. Nothing else competes.
- **Radii soft:** 9–12px on controls/rows, 15–16px on bubbles and the frame.
- **Avatars:** flat single-tone — `petrol-tint` background, `petrol-deep` initials. Never gradients.
- **Type carries craft:** tight tracking (`-0.005em` body, `-0.01em` titles), tabular numerals for counts, generous whitespace, few elements per screen.
- **Reason chips** stay neutral (`line-soft` bg, `muted` text); only `New lead` uses `petrol-tint`. Waiting/call/scheduled variants use quiet warm/neutral tints, never saturated — a deliberate step back from the rejected four-hue pipeline.

---

## 5. Responsive / mobile

Desktop-primary, but the truck phone is a first-class device.

- **≥1200px:** full three-pane + optional drawer.
- **~1000–1200px:** drawer auto-collapses to its header toggle; context column narrows; thread keeps a comfortable measure.
- **<1000px (tablet/phone):** columns **stack, master-detail**. The sidebar collapses to a **bottom tab bar** (`For you · Inbox · Tasks · Contacts · More`) — labels stay visible, not bare icons. The conversation list is full-screen; opening a thread pushes it in with a back header. The **For-You batch works touch-first**: big tap targets, **swipe-to-Done / swipe-to-next** replacing `E`/`J`; the shortcut legend collapses. ⌘K becomes a full-screen search/action sheet.
- **No horizontal body scroll** at 390px. Wide content (Tasks board, tables) scrolls inside its own `overflow-x:auto` container.

---

## 6. Empty / loading / error posture

- **Loading:** calm skeleton rows (hairline blocks on `--paper`), never spinners in the primary content area. The shell (sidebar + headers) renders instantly; only the data region skeletons.
- **Empty:**
  - For You → `You're all caught up. New leads will show up here.` with a small petrol-tint mark.
  - Inbox filter with no results → `No open conversations` + a quiet hint to check other statuses.
  - Contacts/Tasks empty → one-line prompt + the primary action (`Import contacts`, `New task`).
- **Error:** inline, calm, actionable. A failed send shows a `Not delivered · Retry` chip on the outbound bubble (never a modal). A failed load shows a single centered `Couldn't load — Retry` line. 10DLC-not-registered gates outbound sending with a calm banner linking to Settings → Compliance, not a dead end.
- **Optimistic actions:** Done / assign / send update immediately; failures roll back with an inline notice.

---

## 7. Build notes (no backend rewrite)

- **For You** = render `api_for_you` (D23): triage strip, waiting_on_you (urgency-sorted, `has_overdue_task`/`unread` flags), my_tasks (overdue), unread cross-cut. Typed cards are a client concern over existing rows.
- **Inbox / thread / statuses / tags / assignment / notes / attachments / tasks** = the existing conversations/messages/tasks/contacts model; nothing new server-side.
- **Job spine + stages** = the pre-seeded pipeline tags; advancing = PATCH a tag; the Pipeline/board is a grouped **view** over `GET /v1/conversations` filtered by tag — pure UI, off by default.
- **Auto-lifted facts** = a one-tap `Save to job` suggestion + confirm event, not silent parsing.
- **⌘K** = a client palette over existing search + action endpoints.
- Buildable on the existing Next.js 15 / React / Tailwind (shadcn-style) component stack.
