# What leaves the device, and where it goes

The inventory behind both store declarations (#254). The forms are its output:
fill them from here, not from memory, and update here first when a feature
changes what we collect.

Every row was read out of the code, not recalled. Where a claim rests on a
specific file, the file is named so the next person can re-check it rather than
trust this page.

> **Not to be confused with `docs/PERSONAL-DATA-INVENTORY.md`**, which answers
> a different question: which database TABLE holds what, server-side, for an
> access, deletion or retention request. This document is about what leaves the
> device and is what the store forms are filled from. Adding a data class starts
> here; adding a table starts there.

> **Re-declaration is part of shipping.** A feature that touches a new data
> class changes both store forms. The checklist in `docs/RELEASING.md` is the
> gate; this document is what it checks against.

---

## The three that must agree

A store declaration, the privacy policy, and the product's actual behaviour are
one statement made three times. A mismatch in any direction is the finding that
gets an app pulled — usually weeks after submission, in a review sweep, with no
engineering fix available.

| | Where it lives |
|---|---|
| Store declarations | `apps/ios/store/`, `apps/android/store/` |
| Privacy policy | `apps/web/src/app/(marketing)/legal/privacy/page.tsx` |
| Deletion promises | `apps/web/src/app/(marketing)/legal/delete-my-data/page.tsx`, `docs/DELETION.md` |
| Behaviour | this document |

---

## Data collected

"Linked to the user" in Apple's sense and "collected" in Google's both mean the
data reaches our servers tied to an account. All of it does: the product is a
shared inbox, and a shared inbox that forgets is not one.

| Data class | What it is | Why | Apple category | Play category |
|---|---|---|---|---|
| Name, email | The crew member's own profile and sign-in | Account | Contact info | Personal info |
| Phone numbers | The business's number and every customer number it texts | App functionality | Contact info | Personal info → Phone number |
| Message content | Every text sent and received, and internal notes | App functionality | User content → Other | Messages → Other in-app messages |
| Photos and files | MMS pictures and files attached to notes and jobs | App functionality | User content → Photos or videos | Photos and videos, Files and docs |
| Voice recordings | Voicemail audio, stored in our bucket | App functionality | User content → Audio data | Audio → Voice or sound recordings |
| Call history | Who called, when, how it ended, duration | App functionality | Usage data | Personal info |
| Contacts | Customer records the business keeps: name, phone, address, notes | App functionality | Contacts | Personal info, Contacts |
| Approximate location | Job addresses geocoded to a point; the map's "my location"; the city a device signed in from, on the signed-in-devices list (#236) | App functionality; account security | Location → Coarse location | Location → Approximate location |
| Crash and error data | Stack traces, no message bodies | Diagnostics | Diagnostics | App info and performance |

**Not collected:** precise (GPS-grade) location, health, financial account
numbers (Stripe holds the card; we store identifiers only), advertising
identifiers, browsing history, biometrics.

**Never used for:** advertising, tracking across apps or sites, or building a
profile. No data is sold. Message content is not used to train anyone's model
(see *AI*, below).

---

## Permissions, and what actually asks for them

### Android (`apps/android/app/src/main/AndroidManifest.xml`)

| Permission | Why | When it is asked |
|---|---|---|
| `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` | Two-way phone calls in the app | Placing or answering a call |
| `MANAGE_OWN_CALLS`, `FOREGROUND_SERVICE_PHONE_CALL` | Calls appear in the system dialer UI | Call time |
| `BLUETOOTH_CONNECT` | Route call audio to a headset in a van | Call time |
| `POST_NOTIFICATIONS` | A ringing call and a customer's text | First launch |
| `USE_FULL_SCREEN_INTENT` | A ringing call reaches a locked phone | Install |
| `ACCESS_COARSE_LOCATION` | "Jobs near me" on the map | Only when the map's location button is tapped |
| `READ_CONTACTS`, `WRITE_CONTACTS`, sync settings | #183 "Call/Text with Loonext" rows in the system Contacts app | Only when the user turns that feature on |
| `WAKE_LOCK`, `VIBRATE`, `INTERNET`, `ACCESS_NETWORK_STATE` | Ordinary app operation | Install |

Contacts is the one Play requires a written justification for; it is in
`apps/android/store/data-safety.md`.

### iOS (`apps/ios/project.yml`)

| Key | String |
|---|---|
| `NSMicrophoneUsageDescription` | "Loonext uses the microphone for phone calls." |
| `NSLocationWhenInUseUsageDescription` | "Loonext shows where you are on the job map so you can see which jobs are nearby." |
| `NSContactsUsageDescription` | "Loonext shows your phone's contacts alongside your crew's, so you can text someone without adding them first. Your contacts stay on your phone." |
| `UIBackgroundModes` | `audio`, `voip`, `remote-notification` — a call has to survive the screen locking |

**No photo-library permission string, deliberately.** Attachments use SwiftUI's
`PhotosPicker` (`Features/Compose/Composer.swift`), which runs out of process:
the app receives only what the person picked and never gains library access, so
no `NSPhotoLibraryUsageDescription` is needed or requested. Adding one would
declare access we do not take.

---

## Reading the device address book is not collecting contacts

Both apps read the phone's own contact book, and neither uploads it. This is the
distinction that decides two store answers, so it is stated once here and both
declarations point at it:

| | What it does | Declaration |
|---|---|---|
| Reading the device book | Shows and searches the phone's own contacts beside the crew's, so a number does not have to be retyped. Given name, family name, organisation, phone numbers. The search runs on the device | A permission with a purpose string. **Not** a collected data class: nothing is sent |
| The customer records the business keeps | Names, phones, addresses and notes stored in the workspace, typed or imported by the crew | A collected and shared data class, in both tables above |
| Android's Connected-Apps sync (#183) | Writes "Call with Loonext" / "Text with Loonext" rows INTO the phone's contacts | Needs `WRITE_CONTACTS` as well, and its own Play justification |

Files: `apps/ios/Loonext/Features/Contacts/DeviceContacts.swift` (#459),
`apps/android/.../features/contacts/device/` (read),
`apps/android/.../features/contacts/sync/` (#183, write).

Conflating the first two over-declares one and under-declares the other. Neither
error is safe: claiming we collect an address book we never receive is a promise
we cannot keep, and omitting the permission is the finding that gets an app
pulled.

---

## Who else sees it

Every one of these is a sub-processor and must also appear on
`/legal/subprocessors`. If a name is here and not there, the privacy policy is
wrong.

That rule was broken twice and found by #389: this table's Cloudflare row
described only hosting after Workers AI shipped, and Firebase Cloud Messaging
was listed here and absent from the public page entirely. Both are fixed. The
AI half is now bound in code rather than by this paragraph —
`packages/shared/src/ai-disclosure.ts` is what the public page renders, and a
test asserts it covers every feature in the AI cost registry, so a new AI
feature cannot ship undisclosed.

| Third party | What reaches them | Why |
|---|---|---|
| **Telnyx** | Phone numbers, message content, call audio | They are the carrier. There is no texting without them |
| **Supabase / AWS us-east-1** | Everything stored | Database, auth, file storage |
| **Cloudflare** | Everything in transit; the Worker runtime. Plus, via Workers AI: message threads (suggested replies), message text (task details) and voicemail audio (transcripts) | Hosting, and the AI features. Workers AI runs in the same account and network boundary, which is why Cloudflare is one entry rather than two |
| **Stripe** | Billing identifiers, no card data held by us | Payments |
| **Resend** | Email addresses and notification copy | Transactional email |
| **Firebase Cloud Messaging** | Push tokens and notification payloads (sender name, message snippet) | Push to Android and iOS |
| **Sentry** | Stack traces, request ids. Message bodies excluded | Error monitoring |
| **PostHog** (web only) | Cookieless event counts. No message content, names, or numbers | Product analytics |

---

## AI, which is a data-sharing disclosure on both forms

Customer message content and voicemail audio are sent to **Cloudflare Workers
AI**, in the same account and network boundary as the rest of the Worker. Three
features, each opt-in per company and off by default:

| Feature | Model | What is sent |
|---|---|---|
| Task address and due date (#214) | `@cf/meta/llama-3.2-1b-instruct` | The one message being promoted to a job |
| Reply drafts | `@cf/meta/llama-3.1-8b-instruct-fast` | Recent messages in that thread |
| Voicemail transcripts | `@cf/openai/whisper-large-v3-turbo` | The voicemail audio |

Files: `apps/api/src/tasks/enrichment.ts`,
`apps/api/src/messaging/reply-suggestions.ts`,
`apps/api/src/calls/voicemail-transcript.ts`.

**Both declarations must say message content is shared with a third party for
app functionality.** The counterweight, which the privacy policy also states:
it is not used to train models, and each feature is a switch a company turns on
knowingly (`company_ai_settings`).

---

## Deletion and export

Both forms ask, and both answers now exist:

- **Account deletion, in-app** (Apple 5.1.1(v)): Settings → Account → Delete
  your account, on web, iOS and Android (#346).
- **Data-deletion URL** (Play): `https://loonext.com/legal/delete-my-data`.
  Stable path — it is filed with Google, so renaming it breaks the declaration.
- **Export**: Settings → Workspace → Export your data (#227).
- **What survives deletion, and why**: `docs/DELETION.md`. Both stores allow
  legally-required retention when it is disclosed; ours is disclosed on the
  public page above.

---

## When this changes

Queued work that will move a row in this table. Each needs the declaration
re-filed before it ships, not after:

- **#245 calendar** — a new data class (Calendar) on both forms.
- **#250 automatic spam classification** — extends what AI sees from opt-in
  features to every inbound message. That is a materially different disclosure.
- **#247 thread summarization** — same.
- **#234 mobile offline outbox** — message content stored on the device, which
  Apple asks about separately.
