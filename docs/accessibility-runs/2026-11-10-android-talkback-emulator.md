# Android TalkBack pass on the rig emulator, 2026-11-10

**Status: HISTORICAL RESEARCH (#323).** A dated record of one run, kept for what it found; `docs/ACCESSIBILITY.md` is the current statement.

**What this is.** A real TalkBack pass, with TalkBack itself speaking, on an Android emulator. It is
**not** the physical-device pass the protocol in `docs/ACCESSIBILITY.md` asks for, and it does not
close it. A physical Android device and VoiceOver on an iPhone are still open. Per that protocol this
record is supporting evidence and does not count as the TalkBack pass.

## Setup

| | |
|---|---|
| Device | AVD `rig-pixel`: Pixel 8 profile, Google Play image, Android 16 (API 36), 1080x2400. An emulator, no physical hardware |
| TalkBack | Android Accessibility Suite, `com.google.android.marvin.talkback` 16.0.0.738667889 (60149353), preinstalled on the image; nothing was downloaded or installed |
| Text to speech | Google TTS on the image; audio muted on the host |
| App | `apps/android` debug build, `main` at 5d1d5401 plus the fixes in this record, application id `com.loonext.android` |
| Backend | The local stack: Supabase and the API worker (`wrangler dev`) on the workstation, reached over `adb reverse`. The build's three public endpoint values were pointed at it for this pass only and were not committed. Data from `scripts/dev-seed.mjs` |
| Locale | App English, device English (US). Text size at the default (100%). **French and 200% text were not run** |
| Tester | Claude Code agent driving TalkBack; not a person who uses a screen reader |

## Method

- TalkBack was turned on with `settings put secure enabled_accessibility_services` and `accessibility_enabled 1`.
- TalkBack's developer settings were used for the speech overlay ("Display speech output") and log level VERBOSE. What TalkBack said was read from the line it logs for each utterance (`TalkBackFeedbackProvider ... ttsOutput=`) and checked against the overlay in screenshots. The "Double-tap to ..." sentences are TalkBack's own hints.
- `adb shell input` events bypass TalkBack's touch explorer, so they cannot drive it. Gestures were sent as real multi-touch events through the emulator's gRPC `sendTouch` (the proto in `tools/rig/lanes/proto`): one-finger swipe right and left for next and previous, a single tap to explore, a double tap to activate, down-then-right for the TalkBack menu. Navigation that only had to reach a screen used a plain `adb input tap`.
- `uiautomator dump` takes accessibility away from TalkBack for a moment (it announces "TalkBack off" and "TalkBack on"), so it was not used while an announcement was being checked.
- Not used: a hardware keyboard, Switch Access, Voice Access, braille.

## Flows and results

"Pass" means the name, role, state, order and hint were right. Every "Fail" has a fix below.

| Flow | What TalkBack said | Result |
|---|---|---|
| Sign in | Wordmark; the tagline with no "heading"; "Continue with Google" with no role; the label "WORK EMAIL" and then the field again ("Edit box, Work email"); "Show password, Button"; "Sign in, disabled" until both fields are filled, then enabled; "Forgot password?" and "Create your account" with no role. Signing in worked. A cold start sometimes landed on "Couldn't load your workspace." and "Try again" worked | Fail: heading, button roles, duplicate label |
| Sign up, reset | **Not walked on the device.** They share the sign-in components, which `TalkBackSemanticsTest` and `AccessibilityAuditTest` (100% and 200%) cover | Not run |
| Notification primer (first screen after sign-in) | Modal, focus wraps inside it, "Not now, Button", "Turn on notifications, Button"; the title is not a heading | Pass, with the title noted under "Not fixed" |
| For you | "DB" read as a word; "Notifications" with an unread dot and no mention of it; "Customise this screen" and "Notifications" with no role; 7d, 30d, 90d with no selected state; section titles not headings | Fail |
| Tab bar | "Selected, For you" and "Not selected, Inbox, Double-tap to toggle": no "tab", no position. Account: "Account, 4 unread notifications" | Fail: role |
| Inbox: header and filters | Title with no "heading"; "Search" and "Filters" with no role; Open, Mine, All, Closed said "Selected" and "Not selected" correctly; an idle stop "0 percent. Progress bar" | Fail |
| Inbox: a row | "Read, PN, Priya Natarajan, 22h, <preview>, Quote sent, Sam Rivera": initials read as a word; the section header "PINNED" and its count "1" as two stops; **no "Actions available"**, so Mark read and Close could not be reached | Fail |
| Inbox: bulk selection | Long press is advertised ("Double-tap and hold to long press"). Selection mode itself was **not entered on the device** | Not run |
| Thread: reading order | Back, avatar, name, Call, More, then the "2 conversations, Open, Dana" line, then the tags, then the messages oldest to newest: notes, messages, call lines with "Make a task from this call, Button". The status line is read after the buttons beside it | Pass, with a note |
| Thread: a message | Inbound and outbound bubbles read as the text alone; the time and delivery are a second stop ("Dana Brightside, 1:54 PM, Delivered"), which is the only place direction is said | Pass, with a note |
| Thread: header buttons | "Back", "Call Maria Alvarez", "More" with no role | Fail |
| Thread: composer | "Text" and "Note" with no selected state; "Add to message, Button"; "Draft with Lou, Button"; "Edit box, Text message"; "Send later, Button"; "Send message, Button, disabled" until there is text | Fail: mode state |
| Thread: send | After sending TalkBack said only "Cleared text". The message appeared and came back "Not delivered" (there is no carrier on the rig) with nothing spoken; focus stayed on the now disabled Send | Fail: no announcement |
| Thread: incoming message | **Not heard.** A row inserted straight into the database is not pushed to the app (the push goes through the API's realtime path, which needs the carrier webhook). The code had no live region or announcement for it | Fail by reading the code |
| Thread: Make a task menu (the message menu) | **Not opened on the device** | Not run |
| Ringing, in-call | **Not reached.** The softphone needs a Telnyx credential (`/v1/webrtc/token` returns 409 on the local stack) and a call to ring. `AccessibilityAuditTest` found Answer, Decline, Mute, Keypad and Hold with no role once the new check existed | Not run on the device; fail in the audit |
| Settings index | Rows read as "Title, subtitle" in one stop; "Hand this phone to someone else"; "Copy number"; the account initials ("DB") were a stop | Pass, with the initials fixed |
| Account sheet | Modal; "Close sheet"; the theme choice read "System", "Light", "Dark" with no selected state | Fail |
| Task list | "New task", "Search task titles"; the four view buttons read "checked, List view, Check box"; the status chips (Open, Mine, All) with no selected state; the same idle progress bar; the empty state reads the glyph for the message menu | Fail |
| New task (quick add) | Opens with focus in the field ("Editing, Edit box, Say it in one line, ..."); the helper line; "Add task, Button, disabled"; "More options"; "Close sheet" | Pass |
| Task detail | **Not reached.** The seed has no open task, and creating one needed a keyboard round trip that was not completed | Not run |

## Defects found and fixed

Each fix has a test. The new `RoleMissing` check and `TalkBackSemanticsTest` failed before the fixes (checked by reverting `Ds.kt` and `Ui.kt`: three of the tests failed).

| # | Defect | Fix |
|---|---|---|
| 1 | Controls built from `Surface(onClick)` or a bare `clickable` had no role: icon buttons, the sign-in buttons and links, the thread header buttons, the call controls, the tab bar | `Modifier.asButton()`, `asToggleButton(selected)` and `asTab(selected)` in `ui/common/A11y.kt`, applied at those sites. `SemanticsAudit` now fails an icon-only control with no role (`RoleMissing`) |
| 2 | A choice did not say which one was on: task chips, the calls filter, For you 7d/30d/90d, the Text and Note switch, the theme choice, the in-call toggles | the same helpers, which carry `selected` |
| 3 | The tab bar read "Double-tap to toggle" | `Role.Tab` inside a `selectableGroup`; it now reads "Tab, 1 of 4" |
| 4 | The task view buttons read as check boxes | `Role.Tab`, keeping the checked state |
| 5 | Titles and section headers were not headings; a section header and its count were two stops | `heading()` on `ScreenTitle`, `SectionHeader`, `MeasureHeader` and the sign-in headline; header and count merge |
| 6 | Initials were read as a word before every name | `InitialsAvatar` clears its semantics |
| 7 | An idle pull-to-refresh read "0 percent. Progress bar" | `RefreshBox` hides the indicator from the reader |
| 8 | The inbox row's Mark read and Close actions were not offered ("Actions available" missing): they were declared on a child that the merge dropped | declared on the row's own node (`rowActionsModifier`) |
| 9 | The For you bell's unread dot was not spoken | spoken now ("Unread, Notifications, Button") |
| 10 | The sign-in label was a second stop before each field | the label is hidden from the reader; the field carries the name |
| 11 | A send that came back undelivered, and a customer's text arriving, were silent | `threadAnnouncement` and an announcement event from the thread screen: "Message not delivered. Retry is on the message." (heard) |

Fix commit: `29ec8f65` (all eleven, with their tests). It was one commit, so the two groups above (1 to 10 and 11) share it.

## Checked again after the fixes

On the same emulator: the tab bar ("Tab, 1 of 4"), the For you buttons and bell ("Unread, Notifications, Button"), "Selected, 30d, Button", the Inbox title ("Heading"), "Search, Button", "Selected, Open, Button", "PINNED, 1, Heading" as one stop, a row with "Actions available" and without the initials, the composer ("Selected, Text, Button"), and the undelivered-send announcement, which was heard. The incoming-message announcement could not be exercised for the reason above; it is covered by `ThreadAnnouncementTest`.

## Fixed in a second round (commit `78c0ab83`)

| # | Defect | Fix | Heard after |
|---|---|---|---|
| 12 | A message bubble and its time and delivery were two stops | one clickable node around both; Retry and the task icon stay separate | "Be there soon. Dana Brightside, 2:52 PM. Not delivered", then "Retry" |
| 13 | The thread header read the status line after Call and More | avatar, name and status are one clickable node | "Back", "Maria Alvarez. 2 conversations, Open, Dana Brightside. Button", "Call", "More" |
| 14 | Times read as "22h" | `spokenTime`: the time in the reader's locale and clock, with the date when not today, on the inbox row and the For you rows | "Nov 9, 2026, 3:54 PM" in the row. fr-CA is covered by a unit test, not heard |
| 15 | The hint read "Double-tap to Go to that message" | the label is now "go to the message" / "aller au message" in both catalogues | not heard again (not on screen in the re-check) |
| 16 | The notification primer title and the host header title (Settings and every hosted screen) were not headings | `heading()` on both; the host's back button also gets a button role | the Settings title was not walked again; covered by a test |

Each has a test in `TalkBackSemanticsTest`, and each test failed with its fix reverted (the five checked together: bubble, hint, headings, row time; the header has no unit test because it needs a live controller, so it was checked by ear only).

## The "Couldn't load your workspace" first load: an app bug, fixed

Reproduced on the emulator and caught with a temporary log: the generic bootstrap failure was `NetworkOnMainThreadException`, thrown by `ApiClient.execute` reading `response.body.string()` on the main thread. The headers had arrived but the body had not, so the read blocked on the socket. It only shows when the body lags the headers, which is why it was intermittent and worse on a cold, slow start, and why a retry worked. It is not specific to the emulator: any slow connection can hit it. The read now happens on `Dispatchers.IO` (`ApiClient.kt`), and `ApiClientTest` fails without that change. After the fix the first load on the emulator succeeded.

## Not fixed

- The task detail, sign up, reset, bulk selection, ringing and in-call flows were still not walked on a device (see the table above).
- The relative times on the other screens (calls, contacts, tasks, notifications) still read as "5m"; only the inbox and For you rows got the spoken form.
- The bubble's long-press no longer shows a ripple (the press target is now the bubble and its meta line together).

## What stays open

A TalkBack pass on a physical Android device, and VoiceOver on a physical iPhone, including the protocol's French and large-text runs. This record replaces neither.
