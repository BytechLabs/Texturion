# Loonext — "For You" Home + Task Views (BINDING)

Complements docs/TASKS.md and docs/APP-LAYOUT-V2.md (written by the app-v2 spec pass). These
are product-owner decisions added 2026-07-02 answering: where do crew members see what to focus
on, and what views does the tasks page have. Keep the calm Wealthsimple aesthetic (petrol/stone,
restraint, one-obvious-thing) and the lowest-upkeep infra rule. Decision numbers (D23–D25) are
provisional — reconcile with DECISIONS.md D17–D22 when merging.

---

## D23. "For You" home — the crew member's focus queue (default member landing)

A member signing in lands on **/for-you** (owners/admins can set inbox as their default; members
default here). It is a WORKING QUEUE, not a notification log. It answers "what do I do next?"

Sections (each a calm card list, urgency-sorted, empty-state-kind):
1. **Waiting on you** — conversations assigned to me with status `open`/`waiting` and unread or
   awaiting-reply, most-urgent first (overdue > waiting > new).
2. **Your tasks** — tasks assigned to me that are open; **overdue tasks pinned to the top** with a
   quiet amber marker. Inline complete (checkbox) with optimistic + undo.
3. **Unread** — my conversations with unread inbound.
4. **Needs an owner** (owner/admin only) — a triage strip: unassigned open conversations +
   unassigned open tasks, so leads can hand out work.

Rules: everything links straight to the thread/task; one-glance; no configuration required;
realtime-updates as items are handled; fully calm (the conversation/task text is the only bold
thing). Mobile: the same sections stacked, the primary daily screen.

Nav: **For You** becomes the first primary nav item (above Inbox) for members; Inbox stays for
the full shared queue.

## D24. Notifications panel (secondary)

A bell in the top bar → a popover list of recent notifications (new inbound in a thread you're in
or assigned to, assigned-to-you, task-assigned, @mention if/when mentions ship), each with a
read/unread dot, relative time, deep-link, and "Mark all read." Backed by the existing
notification-generation pipeline (email/push already exist); add a lightweight `notifications`
read-model (or derive from conversation_events + assignments + a per-user last-seen) — pick the
lowest-upkeep shape at build (prefer deriving over a new heavy table; a small `notifications`
table with `user_id, type, entity refs, created_at, read_at` is acceptable and simplest to render).
This is secondary to /for-you; do not over-invest.

## D25. Tasks page — four switchable views

/tasks has a view switcher (segmented control, URL-state `?view=`), each clean and calm:

1. **List** (default) — rows: title, linked conversation/contact, assignee, status pill, due,
   quiet meta; filters (assignee/status/due/overdue/unassigned) as one-glance chips (no fly-out).
2. **Board** (kanban) — drag a card to change state (optimistic + undo; keyboard-accessible move as
   well); card shows title + assignee avatar + due + a link glyph to its conversation. Calm columns,
   border-first, petrol only on the active/over state.
   - **Status reconciliation with D17's derived model (important).** D17/TASKS.md gives a task **no
     stored status column** — completion is *derived* from `messages.done_at`, so MVP has only two
     states: **To do (open) → Done**. The richer **To do → In progress → Waiting → Done** board is a
     **fast-follow** that requires the deferred "richer status" decision (TASKS.md T9): it adds a
     stored `task_status` distinct from message-completion (the `Done` column would still be driven by
     `messages.done_at`, but In-progress/Waiting are task-owned metadata). **Until that decision is
     ratified, the Board ships two columns (To do / Done)** where moving a card to/from Done calls the
     source message's `PATCH /v1/messages/:id {done}` (the same derived path as every other view). Do
     not build a stored multi-status column ahead of the T9 decision.
3. **Calendar** — month/week by `due_at`; tasks as chips on their day; click → task detail; drag to
   reschedule (optimistic). This is the scheduling view; a separate Gantt/timeline is intentionally
   NOT built (enterprise-PM bloat for this ICP — calendar covers scheduling).
4. **Map** — tasks plotted at their conversation→contact address; a pin per task (clustered when
   dense), click → peek card → open task; "near me" uses the browser geolocation (optional, prompted
   only on tap). The field-service differentiator: see the day's jobs on a map.

Every view links back to the source message + conversation, and reflects the D14 bidirectional
message⇄task done-sync.

### Map view — technology (lowest upkeep, BINDING)

- **Display:** Leaflet + OpenStreetMap raster tiles — NO API key, free, self-attributed. (React
  wrapper: react-leaflet, a small client-only island; the tasks map view is not SSR/LCP-critical.)
  No Google Maps / Mapbox (API keys, per-load cost, upkeep).
- **Geocoding:** geocode a contact's address to `lat`/`lng` **once**, cached on the `contacts` row
  (add `lat double precision null`, `lng double precision null`, `geocoded_at timestamptz null`,
  `geocode_status text`). Geocode server-side on contact address create/update via a free geocoder
  (Nominatim/OSM, respecting its 1 req/s + attribution policy; a small queue/cron for backfill and
  rate-limiting). If geocoding volume ever outgrows Nominatim's fair-use, swap to a cheap keyed
  geocoder behind the same server interface — but display stays free OSM tiles. Map rendering never
  makes a paid call; only geocoding does, once per address, cached.
- Contacts without a geocodable address simply don't appear on the map (shown in a small "no
  location" count); never block a task on geocoding.

## Build fit

- Backend adds: `contacts.lat/lng/geocoded_at/geocode_status`, a geocoding job (cron/queue,
  Nominatim, cached), and the tasks list/board/calendar/map all read the existing tasks API with
  view-appropriate query params (status grouping, due-range, has-location). The **/for-you** and
  notifications read models are mostly queries over existing tables (assignments, tasks,
  conversation unread, conversation_events) — prefer derived queries over new heavy tables.
- Frontend adds: `/for-you` page, the bell/notifications popover, the `/tasks` view switcher +
  the four views (Board/Calendar/Map are client islands; List is the default calm table).
  `react-leaflet` + `leaflet` are the only new deps (map view only, lazy-loaded).
- All calm/Wealthsimple, mobile-first, reduced-motion, AA, realtime.
