# Android TalkBack pass 2, on the rig emulator, 2026-11-11

**Status: HISTORICAL RESEARCH (#323).** A dated record of one run, kept for what it found; `docs/ACCESSIBILITY.md` is the current statement.

**What this is.** A second real TalkBack pass, with TalkBack itself speaking, on an Android emulator, over the flows the first pass (`2026-11-10-android-talkback-emulator.md`) did not reach and that need no phone call. It is **not** the physical-device pass the protocol in `docs/ACCESSIBILITY.md` asks for, and it does not close #238. A physical Android device and VoiceOver on an iPhone are still open.

## Setup

| | |
|---|---|
| Device | AVD `rig-pixel`: Pixel 8 profile, Google Play image, Android 16 (API 36), 1080x2400, headless (`-no-window`). An emulator, no physical hardware |
| TalkBack | `com.google.android.marvin.talkback` 16.0.0.738667889, preinstalled on the image; nothing was downloaded |
| App | `apps/android` debug build, `main` at 9c8d72f1, application id `com.loonext.android`. The build's three public endpoint values and the cleartext flag were pointed at the local stack for this pass only; both files were restored byte for byte afterwards |
| Backend | Local Supabase and the API worker (`wrangler dev`) over `adb reverse`; data from `scripts/dev-seed.mjs` |
| Inbound text | A **second** local worker on port 8788 with its own throwaway Ed25519 webhook key and `TELNYX_API_KEY` set to a dummy value, so the signed `message.received` was accepted and nothing could reach Telnyx. It was stopped afterwards. No call was placed and no text was sent |
| Locale and size | English at 100%, then fr-CA (per-app locale), then font scale 2.0 |
| Tester | Claude Code agent driving TalkBack; not a person who uses a screen reader |

## Method

- Same as the first pass: real multi-touch through the emulator's gRPC `sendTouch` (swipe right and left for next and previous, a tap to explore, a double tap to activate, a double tap and hold for a long press). Speech was read from TalkBack's verbose log (`SpeechControllerImpl: Speaking fragment text=`), with the speech overlay on in screenshots.
- Text was typed with `adb shell input text`, and some navigation used `adb input tap`; neither is an accessibility gesture, so neither says what TalkBack does.
- **French and 200% were not walked with gestures.** They were read from the accessibility tree (`uiautomator dump`, which pauses TalkBack) and from screenshots. What is said there is what the tree carries, not what was heard.
- The timestamped speech after a swipe takes several seconds on this emulator, so every stop was read after a wait; no stop was judged from a half-spoken sentence.

## Flows and results

| Flow | What TalkBack said | Result |
|---|---|---|
| Sign up | "Back to sign in, Button"; "Create your account, Heading"; "Continue with Google, Button"; "or"; "Edit box. Your name", "Edit box. Work email", "Password, Edit box", "Show password"; "At least 8 characters." as its own stop; "Create account, Button, disabled"; the terms sentence as text; **"Already have an account?" and then "Sign in, Button" as two stops** | Fail: footer |
| Password reset | "Reset your password, Heading"; the helper line; "Edit box. Work email"; "Send reset link, Button, disabled"; **"Remembered it?", then "Back to sign in, Button"** | Fail: footer |
| Sign in footer | **"New to Loonext?", then "Create your account, Button"** | Fail: footer |
| Inbox, bulk selection | A long press (double tap and hold) enters selection mode. **Nothing was said**: no "selected", and the row read "Read, Maria Alvarez, ..." with no state. The bar was "Spam", "Close", "Mark read", "More actions for Maria Alvarez", "1 selected", "Clear selection", all named | Fail: no state, silent |
| Inbox, other | The filter row read "Open, Radio button, 1 of 4" with Selected and Not selected. **"Views: Views, Button"**. The Getting started card: **title not a heading, "Dismiss getting started" with no role, and the same progress said three times** ("4 of 5 done", "80 percent", "4 of 5 steps done, Progress bar"). The inbox row spoke the preview, tags and a spoken time ("Yesterday 9:41 PM, Tue, Nov 10, 2026, 9:41 PM GMT") | Fail |
| Tasks, bulk selection | The same silence. **The bar was drawn over the list**: "1 selected" and "Done" sat on top of the "TO DO" header and the first row (at 100% text, a layout defect that also hid text) | Fail |
| Tasks, list | "Mark done, Check box" with **no checked state**; the row read "Sounds good...", "T-17 · Maria Alvarez", "Assigned to Dana Brightside" | Fail: state |
| Message menu (long press on a message) | A sheet with the exact time, then "Copy text, Double-tap to activate", **"not checked, Done, Double-tap to toggle"** and **"not checked, Pinned"** (no role), "Make a task", "Delete message" | Fail: role |
| New task sheet | "New task" (**not a heading**); **"Close"** and "Create task" with **no role**; the title field read its value then "Edit box" with **no name** ("TITLE" was a separate stop); the assignee chips read "Dana Brightside, Selected" while **"Sam Rivera" and "Nobody yet" had no role and no "Not selected"**; the due chips **"Today", "Pick a time..." with no role and no state**; "Address, From the contact, Hide address" and **"Clear" with no role** | Fail |
| Task detail | "Back to tasks, Button"; "Task"; "Mark done, Check box"; the title; "Unfollow this task, Button"; "Task actions, Button"; "Task 17"; "To do"; "Created Wed, Nov 11, 2026, 10:11 PM GMT by Dana Brightside"; **"Assignee / Assigned to Dana Brightside / You", "Due / No due date", "Priority", "Tags", "Repeat" with no role**, so nothing said they open a menu; "Address", **"Clear" with no role**, the address fields as "Edit box" | Fail: role |
| A customer's text arriving (live) | **"New message: Quick question - can you also bring a ladder tomorrow?"** spoken within seconds of the signed webhook, with the thread open. This is the announcement added after pass 1 and it works | Pass |
| Task created | "Task created." spoken from the snackbar, and its "Open" action reachable | Pass |
| French (fr-CA) | The inbox, tasks, task detail, a thread, the new-task sheet and the account sheet carried French names for every control, state and heading. English left on screen was workspace data (tag names, message text). **The account sheet showed "Dana Brightside · Owner" in English** | Fail: role word |
| Text at 200% | **The Getting started card was 1260 of 2400 px**, leaving the list a sliver; **the inbox row name was cut to "Priya Natar..." and the time to "Yesterd"**; **a task title was cut to "Sounds good. On..."**. The status pills run off the edge (see "Not fixed") | Fail |
| Ringing, in-call | Not reached; they need the dial window and are scheduled separately | Not run |

## Defects found and fixed

Every fix has a test in `a11y/TalkBackFlowsSemanticsTest.kt` unless a row says otherwise. Each test was run with its fix reverted (see "Proof").

| # | Defect | Fix (file) | Test |
|---|---|---|---|
| 1 | The lead-in and the link in the footer of sign in, sign up and reset were two stops | `FooterLink` in `features/auth/AuthScreens.kt` is one node: description "lead-in action", role Button | `the sign in footer is one button...`, `...sign up...`, `...reset...`; `AuthFrenchRenderTest` now finds the footer by description |
| 2 | A row picked in a multi-select said nothing, and the count was silent | `selectableRow(selecting, selected)` and `announcesChanges()` in `ui/common/A11y.kt`; `GroupedRow` in `features/inbox/InboxTab.kt`, `TaskListRow` and `TaskBulkBar` in `features/tasks/TasksTab.kt`, and the inbox bar | `a row says whether it is selected once a selection is open`, `a row says nothing about selection when none is open`, `the selection count is a live region` |
| 3 | The task bulk bar was drawn over the first rows (a sibling inside the pull-to-refresh Box) | The bar and the list are in a Column; the list takes the rest (`features/tasks/TasksTab.kt`) | None: a layout defect; checked on the emulator after the fix |
| 4 | The check boxes in the record menu ("Done", "Pinned") had no role | `role = Role.Checkbox` in `ui/common/RecordMenu.kt` | `a menu state is a check box` |
| 5 | The new-task sheet: title not a heading; Close, Create task, Clear and the Address toggle with no role; assignee, nobody and due chips with no role or state, and "Selected" said twice; the title field unnamed | `features/thread/MessageActions.kt`: `asHeading()`, `Role.Button`, `asToggleButton(selected)`, the title label hidden and the field named; `SegmentedControlGuardTest` names the three chip uses | `assignee and due choices say they are buttons and which one is on`, `a selected choice does not say selected twice` |
| 6 | Task detail: rows with no role, "Task" not a heading, Clear and the Address toggle with no role | `MetaRow`, `DetailTopBar` and the address section in `features/tasks/TaskDetailScreen.kt` | `a task detail row is a button only when it opens something` |
| 7 | The done box said "Mark done" or "Mark not done" and no state | `DoneCircle` in `features/tasks/TasksUi.kt` has one name and `toggleableState` | `a task done box says whether it is checked` |
| 8 | "Views: Views, Button" | `ListViewsMenu` in `ui/common/ListFilterHeader.kt` says "Views" alone when no saved view is on | `the views button does not repeat its own name`, `...names the saved view that is on` |
| 9 | Getting started: title not a heading, dismiss with no role, progress said three times | `features/inbox/GettingStartedCard.kt`: heading, `asButton()`, the bar hidden from the reader | `the getting started card is a heading...` |
| 10 | "Owner" in English in the French account sheet | `AccountSheet` uses `roleLabelIn` from `features/settings/TeamSection.kt` | `the account sheet says the role in French` (covers the function, not the call site) |
| 11 | At 200%: the Getting started card took half the screen; the inbox row name and time were cut; a task title was cut | `cappedAtLargeText()` in `A11y.kt` (past 1.3x the card holds to 30% of the height and scrolls); at large text the inbox row puts the time under a name that may wrap to two lines; a task title may wrap to three | `a header above a list holds to a share of the screen at 200 percent`, `a header is left whole at the default text size`, `no scroll action is added at the default text size`. The two row layouts have no unit test; checked on the emulator after the fix |

Heard after the fixes, on the rebuilt app: "Selected" then "1 selected" on a long press in tasks, and the bar above the list; "Views, Button"; "Dismiss getting started, Button"; "Getting started, Heading"; "New task, Heading"; "Close, Button"; "Create task, Button"; "Selected, Dana Brightside, Button" and "Not selected, Nobody yet, Button"; "Not selected, Tomorrow 9 AM, Button"; the title as "Call from +14155560111, Edit box, Title"; "Address, Show address, Button". At 200% after the fix (screenshot, not speech): the Getting started card scrolls inside under a third of the screen and the inbox row shows "Priya Natarajan" in full with "Yesterday" under it. The task-row title at 200% was not re-screenshotted.

Not re-heard: the three footers (checked by test), the message menu check boxes (checked by test), task detail rows and the done box state (checked by test).

## Proof

With the fixes for 1, 2, 4, 5, 6, 7 and 9 reverted in one build, nine of the new tests failed (both footers and the reset footer, the selected row, the menu check box, the chips, the detail row, the done box and the Getting started card). The views and French tests were not run against their reverts: the views test fails on the old expression by reading it ("Views: Views" is not "Views"), and the French test exercises `roleLabelIn`, not its call site.

## Not fixed

- **The status pills at 200%.** "Closed" or "Done" is cut at the edge of the inbox and task rows and the sort pill is pushed off the screen. The row scrolls, so TalkBack reaches every pill; it was not reworked.
- Noise that was heard and left: "or" between Google and the form is a stop; "At least 8 characters." is its own stop after the password; the Material drag handle reads "collapsed, Drag handle"; times read twice in the spoken form ("Yesterday 9:41 PM, Tue, Nov 10, 2026, 9:41 PM GMT"); "Close sheet" (the Material scrim) has no role.
- French durations read "3m 12s" and "4m 32s"; the call title reads "Call from +14155560111" with the raw number.
- French was not walked on the sign in, sign up and reset screens, the message menu, the calls tab or the settings screens other than the account sheet.
- Ringing and in-call: not reached; they need the 04:00-10:00 UTC dial window.

## What stays open

A TalkBack pass on a physical Android device, and VoiceOver on a physical iPhone, including the protocol's French and large-text runs. This record replaces neither.
