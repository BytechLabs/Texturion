# Destructive actions: undo, confirm, or neither (#295)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Every action in the product that destroys or hides something, classified. #295
asked for this list because a shared undo primitive existed and nobody had
enumerated what it covered — so "does this action have a guard" was answerable
only by reading the component.

**The audit found two unguarded actions and one wrong revert**, all now fixed:

1. **Deleting a file had no guard at all** — one click, gone, "File deleted."
2. **Closing a conversation had no undo on web or iOS**, though Android had one.
3. **Undo on a close reverted to `open`**, not to the status the row actually had,
   so a `new` or `waiting` conversation came back having quietly lost that.

It also found one thing that looked like a gap and is not: web has three undo
toasts the phones lack, and they should stay that way (§2).

---

## 1. The rule the audit settled on

The product had drifted into using undo and confirmation interchangeably. It
should not, and the distinction is not stylistic:

| Kind of action | Guard | Why |
|---|---|---|
| **Reversible state flip** — spam, assignment, done, open/closed | **Undo toast** | The prior value still exists. A confirmation on something frequent and reversible is friction that trains people to click through confirmations. |
| **Deletion that destroys data** — a file, a contact, a task, a template | **Confirmation** | There is nothing to flip back to. The pause is the only protection, and it is worth the interruption because the action is rare. |
| **Self-reversing control** — removing a tag chip, toggling read | **Neither** | The control that undoes it is the control that did it, still on screen, one click away. A toast would be noise. |

**Undo is not "better" than confirmation.** They protect against different
things: undo protects against a mis-tap on something reversible, a confirmation
protects against a mis-tap on something final. Reaching for undo everywhere
would have meant either a restore endpoint for every delete, or an undo button
that lies.

---

## 2. The classification

Verified against the code on 2026-07-29. **W** = web, **A** = Android,
**I** = iOS. A dash means the surface does not exist on that client.

### Reversible state flips → undo

**The rule that actually governs parity here, and it is not "same toast
everywhere":**

> Every action that REMOVES THE THING FROM VIEW has an undo toast on all three
> clients. An action that leaves the thing on screen is reversed by the control
> that did it.

That is the line worth holding, because it is about whether a mis-tap is
recoverable — not about whether three codebases picked the same affordance. An
undo toast on something still sitting in front of you is a convenience; an undo
toast on something that just vanished is the only way back.

| Action | Removes from view? | W | A | I |
|---|:-:|:-:|:-:|:-:|
| Mark spam | yes (hides the thread) | undo | undo | undo |
| Block number | no (the thread stays; it only goes to spam from the next text or call) | confirm ³ | confirm ³ | confirm ³ |
| Unblock number | no | reverse button | reverse button | reverse button |
| Close a conversation | yes (leaves the open filter) | **undo** ¹ | undo | **undo** ¹ |
| Assign / unassign | no | undo | re-pick | re-pick |
| Complete a task (inline) | no | undo | tap again | tap again |
| Clear an inferred address | no | undo | re-enter | re-enter |
| Merge two contacts (#695) | yes (the second record leaves the list) | **undo** ⁴ | **undo** ⁴ | **undo** ⁴ |
| Bulk tag / untag contacts (#695) | no | undo | — | — |
| Delete a message or note (#691) | yes | **undo** ⁵ | **undo** ⁵ | **undo** ⁵ |
| Delete a conversation (#691) | yes (leaves the inbox) | **undo** ⁵ | **undo** ⁵ | **undo** ⁵ |
| Delete a call or a voicemail (#691) | yes | **undo** ⁵ | **undo** ⁵ | **undo** ⁵ |

¹ Added by this audit. Web's status control and iOS's swipe-close both changed
status with no undo at all, while Android had offered one since its swipe
shipped — so this was the parity gap, and it was in the row that needed it most.

³ Block is not a state flip of something on screen: it changes what happens to
every FUTURE text and call from the number (straight to spam, calls refused
before anyone is rung), so it confirms once, in words that say so and that the
crew can still text the number. Unblock is the reverse control, in the thread
menu, on the contact page and in Settings, Blocked numbers (web-only back-office
list, like the other settings lists). Neither removes anything from view.

**Undo toast sites, exhaustively:** web has seven (`for-you-view.tsx`,
`tasks-checklist.tsx`, three in `thread-header.tsx`, and the merge and bulk-tag
toasts in `components/contacts/`); Android and iOS have three
each (spam, close, merge). The four web-only ones are all in the "no" column above —
extra convenience on the client where a toast is cheapest, not coverage the phones
are missing. **Do not "fix" them by adding toasts to mobile**; a snackbar for a
checkbox you can just tap again is noise on a small screen.

### Deletions → confirmation

| Action | W | A | I | Where |
|---|:-:|:-:|:-:|---|
| Delete a file / attachment | **confirm** ² | — | — | `task-attachments.tsx`; no mobile surface deletes files |
| Delete a task | confirm | confirm | confirm | `task-detail-panel.tsx`, `TaskDetailScreen.kt`, `TaskDetailView.swift` |
| Delete a contact | confirm | confirm | confirm | `contacts/[id]/page.tsx`, `ContactDetailScreen.kt`, `ContactDetailView.swift` |
| Delete a template | confirm | confirm | confirm | `settings/templates/page.tsx`, `TemplatesSection.{kt,swift}` |
| Leave the workspace | confirm | confirm | confirm | `leave-workspace-card.tsx`, `LeaveWorkspaceCard.{kt,swift}` |
| Delete your account | confirm | confirm | confirm | `delete-account-card.tsx`, `DeleteAccountCard.{kt,swift}` |
| Release a number | confirm | confirm | confirm | `number-card.tsx`, `NumbersSection.{kt,swift}` |
| Remove a crew member | confirm | — | — | `settings/team/page.tsx`; team management is web-only |
| Close the workspace | confirm | — | — | `close-workspace-card.tsx`; web-only |

**A dash is "the surface does not exist here", not "unguarded".** Three of these
are deliberately web-only — deleting files, managing the crew, and closing the
workspace are back-office jobs done sitting down. Every destructive action that
DOES exist on a phone is guarded on that phone.

² Added by this audit, and it was the worst finding: a single click on a file's
remove control deleted it and reported success. No confirmation, no undo, and
every other delete in the product already confirmed — so it was an inconsistency
as much as a hazard.

⁴ The merge toast offers Undo, and Undo is `POST /v1/contacts/:id/unmerge` on the
record that was folded in. It puts the second contact and its number back; it does
not move the conversations back (which thread came from which record is not
recoverable) and it never lifts an opt-out. The survivor's page shows "Merged from
{name}" with an Unmerge action behind a confirmation that says both of those
things, gated like merge (`settings.manage`).

Bulk contact tag and untag exist on web only: the phone lists have no selection
mode, so there is nothing to bulk. Their undo is the other tag action over the
rows `applied[]` says changed, so it can never strip a tag somebody already had.
Bulk contact **delete** is a confirmation that states the count, per §1 and §4.

⁵ Added by #691. A delete of a message, conversation, call or voicemail is not a
destruction at the moment of the tap: the item moves to the Trash for 30 days, so
the prior state exists and the guard is an undo toast (undo is `POST
/v1/trash/restore`). A SENT text keeps a confirmation first on the phones, because
the copy has to say it is removed from Loonext only and the customer still has it.
The **final** step is the destructive one and gets the confirmation: **Delete
forever** (Trash, typed confirmation on web, a confirm dialog on the phones) and the daily
expiry that erases what has sat in the Trash 30 days. Bulk delete in the inbox
(web) states the count in its confirmation and then offers one undo for the lot.
Everything is gated by `records.delete`, and every delete, restore and purge
writes a content-free audit event. Trash is in the web sidebar and is its own screen
on Android and iOS (#735).

### Self-reversing → neither, correctly

| Action | Why no guard |
|---|---|
| Remove a tag from a contact (#695) | Same picker, same reason, on the contact's page. |
| Remove a tag from a conversation | The tag picker sits immediately beside the chips. Re-adding is one click on the control you are already looking at. |
| Mark read / unread | Not destructive, and the same swipe reverses it. |
| Discard a draft | The draft is local and unsent; nothing existed to destroy. |

---

## 3. Timing, and why the platforms deliberately differ

| Client | Undoable notice | Plain notice |
|---|---|---|
| Web | 5s (`UNDO_DURATION_MS`) | sonner default |
| Android | `SnackbarDuration.Long` (~10s) | `Short` (~4s) |
| iOS | 10s ³ | 3s |

³ Was 3s for everything before this audit, because the inbox's `notify` was a
text-only variant that could not carry an action at all — which is *why* the
swipe had no undo.

**The phones get longer on purpose.** A web undo follows a deliberate click with
a mouse; a phone undo follows a gesture you can make by accident, and #295 names
the case exactly: somebody who just mis-swiped while climbing down a ladder. The
platform difference is the design, not drift. If it ever needs changing, change
both phones together.

---

## 4. Bulk actions: the undo story — DECIDED HERE, then BUILT to it (#275)

#295 asked for this to be settled before bulk actions were built, because the
per-row toast pattern does not extend and discovering that mid-build would mean
either shipping bulk actions with no guard or redesigning them late.

**Status, 2026-07-29: #275 shipped against these rules on all three clients**
(`api_bulk_conversations`, then web, Android and iOS). The rules below were written
first and the implementation followed them, which is the whole reason this section
existed. What it looks like in practice:

| | Where |
|---|---|
| Grouped undo builder | `undoBulkCalls` (web), `bulkUndoPlan` (Kotlin, Swift) |
| Prior values to revert to | `api_bulk_conversations` returns `applied[].previous` |
| The count that gets reported | `applied.length` from the RESPONSE, never the selection |

**The rule for #275: a bulk operation is ONE undoable action, not N.**

- **One toast for the batch**, naming the count: "42 conversations closed" with a
  single Undo. Not 42 toasts, and not a toast per page of results.
- **The undo reverts exactly the rows the operation touched**, from a list
  captured before it ran — never "re-open everything closed in the last minute",
  which would also revert a teammate's concurrent work.
- **Rows that failed mid-batch are named, not silently dropped.** A bulk action
  that half-applies and reports success is the #263 lesson in a different place.
- **A bulk DELETE gets a confirmation instead**, per the rule in §1, and the
  confirmation states the count. Deleting 200 things is exactly where a pause is
  worth the interruption.
- **The undo window does not extend for bulk.** A longer window implies the
  operation is still pending, and it is not — the rows are already changed.

One thing the build added to this decision rather than merely obeying it:
**`mark_read` carries no undo at all**, on any client. "Unread" is the absence of a
read receipt, so there is no prior state to restore — and nobody asks to un-read
three hundred threads. The RPC records no `previous` for it, so the undo builder
returns nothing and the toast is a plain confirmation. An Undo button that did
nothing would be worse than its absence.

---

## 5. What is deliberately NOT undoable, and never will be

- **A sent text.** Once it reaches the carrier it is gone; the product must never
  imply otherwise. There is no unsend and there cannot be one.
- **An opt-out.** BINDING: a STOP can only be lifted by the customer. An "undo"
  on honouring a STOP would be a compliance breach with a friendly label.
- **A billing action.** Charges and refunds are Stripe's record, not ours to
  reverse with a toast.
