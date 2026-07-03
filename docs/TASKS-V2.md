# Tasks V2 (BINDING) — edit, detail + discussion, thread interweaving, view fixes

Task #22 shipped the tasks data model, the 4 views, and create-from-message, but left the
day-to-day loop unfinished: you cannot edit a task after creating it, there is no place to open a
task and keep working on it, task activity does not show in the conversation it belongs to, and
there is no way to keep discussing a task. This closes those gaps. No em-dashes anywhere. App-code,
serialized; built into the new shell (APP-SHELL-REDESIGN) and Golos Text.

## Ground truth (audited in source, 2026-07-03)

PRESENT and working: `/tasks` page + URL-state view switcher; list, board (To do / Done), calendar
(month/week, drag reschedule to `PATCH /v1/tasks/:id {due_at}`), map (Leaflet + OSM, `has_location`
via contact geocode); create-from-message (`make-task-form`); the whole edit/detail API
(`PATCH /v1/tasks/:id` for title/description/assignee/due_at, `GET /v1/tasks/:id`, per-conversation
checklist) AND the client hooks (`useUpdateTask`, `useAssignTask`, `useSetTaskDue`, `useDeleteTask`,
`fetchTask`).

MISSING in the UI (the whole of this doc):
1. No edit surface. The hooks exist but nothing invokes them except calendar drag. Title,
   description, assignee, due date are all uneditable after creation.
2. No task detail surface. `GET /v1/tasks/:id` and `fetchTask()` are unused.
3. Task events are logged on the conversation (`task_created`, `task_assigned`, `task_due_set`,
   `task_deleted`) but the thread's `eventSentence()` has no cases for them and the web
   `ConversationEventType` enum omits them, so they render as blank lines. Task activity is
   invisible in the thread.
4. No discussion primitive. `tasks.description` exists but there is no ongoing discussion.

## Decisions

### D-A. Task detail is a DRAWER, deep-linkable, reachable from everywhere.
A task lives inside a conversation, so opening one should not yank you out of context. A right-side
detail drawer opens over the current surface (the `/tasks` views, the conversation checklist, and
the thread), and a `/tasks/[id]` route renders the same panel for deep links and refresh. The
drawer shows: the source message (with a link into its thread), the editable metadata, attachments,
and one unified activity-and-discussion timeline (D-C + D-D). It reuses `GET /v1/tasks/:id`.

### D-B. Editing wires the existing hooks. Nothing new on the backend.
In the drawer: inline-editable title, description, assignee (member picker), and due date
(date-time), each saving through the existing `useUpdateTask` / `useAssignTask` / `useSetTaskDue`
on blur or confirm, with optimistic update and rollback. Plus quick-edit affordances without
opening the drawer: assignee and due on list rows and on the conversation checklist. Delete
(creator or owner/admin) from the drawer overflow. This is the major gap and it is pure frontend
against endpoints that already exist.

### D-C. Task activity interweaves in the conversation thread.
Add `task_created`, `task_assigned`, `task_due_set`, `task_deleted` (and the attachment add/remove
events) to the web `ConversationEventType` enum and to `eventSentence()`, rendered as the same quiet
interwoven system lines the thread already uses for status and assignment. So the thread reads, in
order: the customer text, "Jordan turned this into a task," "assigned to Marcus," "due today 3pm,"
the reply. Each task system line links to the task drawer. This is the "show task activity in the
main conversation" ask, and it is a small, safe fix (enum + sentence cases + a link), not a new
pipeline.

### D-D. Discussion reuses internal notes, linked to the task. One primitive, visible in both places.
Rather than a separate task-comments silo that would then have to be re-plumbed into the thread, the
task discussion IS the internal-note primitive that already interweaves in the thread. Add a
nullable `task_id` link on notes (a `direction='note'` message). A note composed from the task
drawer posts a note linked to both the conversation (so it appears interwoven in the thread) and
the task (so it collects in the drawer). In the thread, a task-linked note carries a small task chip
("on: Water heater leak") so its context is clear. In the drawer, the timeline merges task events
(D-C) and the task's linked notes, with a note composer at the bottom. Result: one streamlined
discussion surface, the same words visible from the task and from the conversation. Scope: a small
migration (nullable `task_id` + index on the notes/messages row, plus the `note.task_id` audit
nicety), the note-create path accepting an optional `task_id`, and the two render sites. If a thread
ever gets noisy with task notes, a later enhancement can collapse a task's notes into a group; MVP
is interwoven with the chip.

### D-E. Verify and fix the four views on the running app.
The views are implemented, so "not working properly" is either a runtime issue or a discoverability
one. On the seeded app: confirm the switcher reads as switchable and each view renders; fix any real
bug. Make empty and thin states teach instead of looking broken: a calendar with no due-dated tasks
explains how to set due dates, a map with no geocoded contacts explains that, rather than showing a
blank pane. Board stays two columns (To do / Done) per the derived-done model (richer statuses stay
deferred unless asked), but is styled to read unmistakably as a board. All four adopt the new shell
aesthetic + Golos Text.

## Build order (serialized, after the shell)
1. Migration: nullable `task_id` link on notes (own DB wave). 2. API: note-create accepts optional
`task_id`; task-detail response already carries what the drawer needs. 3. Web: task detail drawer +
`/tasks/[id]`; edit wiring + inline quick-edits; thread task-event rendering; note-as-discussion in
drawer and thread. 4. Runtime-verify the 4 views + empty states; design-QA on the seeded app; I
screenshot before done. Green bar throughout.
