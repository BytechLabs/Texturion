# Destructive actions: undo, confirm, or neither (#295)

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
| Close a conversation | yes (leaves the open filter) | **undo** ¹ | undo | **undo** ¹ |
| Assign / unassign | no | undo | re-pick | re-pick |
| Complete a task (inline) | no | undo | tap again | tap again |
| Clear an inferred address | no | undo | re-enter | re-enter |

¹ Added by this audit. Web's status control and iOS's swipe-close both changed
status with no undo at all, while Android had offered one since its swipe
shipped — so this was the parity gap, and it was in the row that needed it most.

**Undo toast sites, exhaustively:** web has five (`for-you-view.tsx`,
`tasks-checklist.tsx`, and three in `thread-header.tsx`); Android and iOS have two
each (spam, close). The three web-only ones are all in the "no" column above —
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

### Self-reversing → neither, correctly

| Action | Why no guard |
|---|---|
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

## 4. Bulk actions: the undo story, before #275 ships

#295 asks for this to be settled before bulk actions are built, because the
per-row toast pattern does not extend and discovering that mid-build would mean
either shipping bulk actions with no guard or redesigning them late.

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

This is a decision, not a design document; #275 owns the implementation.

---

## 5. What is deliberately NOT undoable, and never will be

- **A sent text.** Once it reaches the carrier it is gone; the product must never
  imply otherwise. There is no unsend and there cannot be one.
- **An opt-out.** BINDING: a STOP can only be lifted by the customer. An "undo"
  on honouring a STOP would be a compliance breach with a friendly label.
- **A billing action.** Charges and refunds are Stripe's record, not ours to
  reverse with a toast.
