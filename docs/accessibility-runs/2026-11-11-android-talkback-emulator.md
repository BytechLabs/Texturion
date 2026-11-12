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
- Ringing and in-call were reached on 2026-11-12 in the dial window; see the next section for what that pass covered and did not.

## Ringing and in-call (2026-11-12, 06:00 to 09:00 UTC)

**What this is.** The same TalkBack method, on `rig-pixel` again, over a ringing call and a live one. It is an emulator pass, so it does not close #238.

**Setup.** The nonprod app the rig had installed (built from `main` on 2026-11-10, before any fix below), signed in as QA-A's technician. Calls came from the rig's robot (ROBOT-1 to DEV-A1 for the ring; the app's own dialer to ROBOT-1 for the outgoing call) under the guard's lease. TalkBack was on for the ring and for the live call, and its speech was read from its verbose log; the overlay was on in screenshots. The rig's own dial taps (uiautomator) were run with TalkBack off, and TalkBack was switched on once the call was up. The call was kept open for 4 minutes by a VM-only change to D07's run time and audio steps, put back afterwards; those three runs are recorded as D07 passes in the verdict store and are not D07 passes (no audio was judged), so a correcting `infra` verdict (`correction-2026-11-12`, no dials) follows them and D07 stays unresolved. No emulator audio was injected or streamed in any call walked here.

**What was walked, and what was heard.**

| Flow | What TalkBack said | Result |
|---|---|---|
| Incoming ring, heads-up notification | **"Call. Incoming call, Incoming call. Double-tap with 2 fingers to answer"**: an unknown caller is titled "Incoming call" and captioned "Incoming call". The notification's own "Decline" and "Answer" read as buttons. A double tap on its body opens the app's ring screen | Fail: same words twice |
| Incoming ring, the app's ring screen | **"IC"** (the avatar's initials) before the name; "Incoming call"; "(416) 900-4752"; "Decline, Button"; "Answer, Button"; then **"Decline" and "Answer" again** (the captions under the discs). The ring window is about 45 s here, and one slow walk ran out of it | Fail: initials, captions |
| Answering the ring | Not reached: the ring ended (voicemail answered) before the Answer disc was activated; a later ring was refused by the guard (see "Not reached") | Not run |
| In call, outgoing (4 min) | **"Pound"** (the avatar's "#" initial) before the number; "(416) 900-4752"; the timer as "1:41"; "Mute"; "Keypad"; "Hold"; "Transfer"; "Add a note in the conversation, disabled"; "Speaker"; "End call"; "Hide". The log printed the role and state fragment after each control as `null`, so whether a lit control said "Selected" was not read from it | Fail: initials |
| Mute, hold, speaker | Activating Mute said "Unmute" (the name flips); Hold then Resume were heard; the lit Speaker was explored. Keypad read "disabled" while on hold, as it should | Pass |
| Keypad keys (dialer sheet, which the call's keypad shares) | **"2", then "ABC"**, then "Double-tap to activate" with no "Button"; a press said nothing and the display read "(2" | Fail: letters, role, no echo |
| The call ending | **Nothing.** The screen closed 400 ms after the last call and TalkBack read only the window title ("Loonext", "Calls") | Fail: silent |
| Hold or call note card, second call, transfer sheet, DTMF sheet in a call | Not walked | Not run |

## Defects found and fixed

Each has a test in `a11y/InCallTalkBackSemanticsTest.kt` (Robolectric, `@Config(sdk = [34])`).

| # | Defect | Fix | Test |
|---|---|---|---|
| 1 | The avatar's initials were a stop before the caller's name, on the ring screen ("IC") and in the call ("Pound") | `CallerAvatar` hides its initials (`features/calls/CallKit.kt`) | `the caller's initials are not a stop before the caller's name` |
| 2 | Answer and Decline on the ring screen (and in a second ring) were read twice: as a button and as the caption under it | `RingActionCircle` hides the caption (`features/calls/InCallScreen.kt`) | `a ring action is one button, not a button and its caption` |
| 3 | A keypad key read its letters after the digit and said no "Button" | `KeypadKey` is a button and hides the letters (`features/calls/CallKit.kt`) | `a keypad key is a button named by its digit alone` |
| 4 | The end of a call was silent | `InCallScreen` announces "Call ended" once, when the last live call goes (`announcesCallEnd`) | `the end of a call is announced once, and not when the screen opens on none` |
| 5 | A ring from an unknown caller read "Incoming call" as its title and again as its caption | `CallNotifier.ringTitle` and `incomingRingText` title every ring and leave the caption off when the title already says it: the ring notice, the call's foreground notice and a push-woken ring (`telephony/CallNotifications.kt`, `TelecomCallRegistry.kt`, `SoftphoneManager.kt`) | `a ring from an unknown caller is not titled and captioned with the same words` |
| 6 | The call note card was a clickable with no role | `asButton()` on `CallNoteCard` | `the call note card is a button` |
| 7 | "On hold" on the phase line, and the digits shown in the call's keypad, were not live regions | `announcesChanges()` on "On hold" and on the DTMF readout. "Call ended" is not one: fix 4 announces it, and both would say it twice | `on hold is said when it appears`, `call ended is not a live region, because the screen announces it`, `the ticking call timer is not a live region` |
| 8 | Found reading the code for fix 5, not heard (French was not run on a call). The call notices were English in French: "Incoming call", "Connecting…", "Call" and the in-call "Unknown caller" were literals, so TalkBack read them in English in the shade and on the lock screen | They come from the catalogue in the device's language (`deviceCopy`), as the foreground notice's words already did | `the words a call notice shows come from the catalogue` (scans `telephony/`; it flagged all seven literals before the fix) |
| 9 | The in-call screen's hide control said only "Hide" | "Hide call screen" on Android; on iOS the visible "Hide" stays and VoiceOver reads "Hide call screen" | none: a catalogue word, covered by the catalogue's own checks |

**Proof.** With the app changes reverted and the new test file kept, five of the six Robolectric tests that cover fixes 1, 2, 3, 6 and 7 failed (the timer test is a guard and passes either way); the end-of-call and ring-caption helpers have no pre-fix form to run. Then the fixes were put back and the file passed, and so did the full `:app:testDebugUnitTest` run.

**Not re-heard.** The fixed build was not installed on the rig emulator (the rig installs the nonprod APK built from a ref), so every fix is checked by its test, not by TalkBack. The announcement in fix 4 and the live regions in fix 7 are the least certain: an announcement event, as the thread screen uses, is what spoke on this emulator before, and a live region on text that is already on screen has not been heard here.

## Not reached

- **Answering the ring and the in-call controls of an incoming call.** The one ring walked ended before it was answered, and the third ring (09:00 UTC) was refused by the guard with `budget.tier_amber` before any dial; no budget was bypassed.
- The keypad sheet in a call, the transfer sheet, a second call ringing in and the call chip above the tab bar. French and large text were not run on any call screen.
- The ring screen over a locked keyguard (the full-screen intent).

## What stays open

A TalkBack pass on a physical Android device, and VoiceOver on a physical iPhone, including the protocol's French and large-text runs. This record replaces neither.
