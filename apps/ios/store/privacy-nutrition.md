# App Privacy — the answers, as filed

Fill App Store Connect's App Privacy section from this file. When they
disagree, this file is wrong until someone checks it against
`docs/DATA-INVENTORY.md`, which is the source both are derived from.

Kept in the repo on purpose: a declaration that lives only in a web console one
person can reach cannot be reviewed, diffed, or checked against the code by
anyone else. Doubly so here, where iOS cannot be built on the founder's machine
and the console is the only other place this would exist.

**Last reconciled with the code:** 2026-07-26.

---

## Data used to track you

**None.** No advertising identifiers, no cross-app or cross-site tracking, no
data brokers, no data sold.

## Data linked to you

All of it is linked: the product is a shared inbox for a business, and the
whole point is that it remembers. Purpose is **App Functionality** unless
stated.

| Apple category | Type | Notes |
|---|---|---|
| Contact info | Name, Email address, Phone number, Physical address | The crew member's profile, and the customers the business texts |
| User content | Emails or text messages | Every text sent and received, plus internal notes |
| User content | Photos or videos | Picture messages and job photos |
| User content | Audio data | Voicemail recordings |
| User content | Other user content | Files attached to notes and jobs |
| Contacts | Contacts | Customer records the business keeps |
| Location | Coarse location | Job addresses geocoded to a point; the map's "my location" |
| Usage data | Product interaction | Call history: who called, when, how it ended |
| Diagnostics | Crash data, Performance data | Stack traces. Message bodies are excluded before they leave |

**Precise Location: not collected.** The map uses when-in-use coarse location
only, and only when the location button is tapped.

**Financial Info: not collected.** Stripe holds the card; we store identifiers.

**Health, Browsing History, Search History, Sensitive Info, Purchases: not
collected.**

---

## Guideline 5.1.1(v) — account deletion

**In-app account deletion exists**: Settings → Account → Delete your account,
in the iOS app itself (not a hand-off to a website). It signs the person out
everywhere, removes their identity and personal data, and hands whatever they
were working on back to their crew.

Reviewers should know, and the in-app copy says so before the button: the
business records the person contributed to — texts sent to customers, jobs
logged — stay with the business and are anonymised rather than erased. Canadian
anti-spam law requires a proof-of-consent record for three years, and a
do-not-text record belongs to the person who sent the STOP rather than to us.
Apple permits legally-required retention where it is disclosed; ours is
disclosed in the app, in the privacy policy, and at
`https://loonext.com/legal/delete-my-data`.

Implementation: `apps/ios/Loonext/Features/Settings/DeleteAccountCard.swift`.

---

## Purpose strings, as shipped

Source: `apps/ios/project.yml`. These are the exact strings; change them there,
not here.

| Key | String |
|---|---|
| `NSMicrophoneUsageDescription` | "Loonext uses the microphone for phone calls." |
| `NSLocationWhenInUseUsageDescription` | "Loonext shows where you are on the job map so you can see which jobs are nearby." |

**No `NSPhotoLibraryUsageDescription`, deliberately.** Attachments use
SwiftUI's `PhotosPicker`, which runs out of process: the app receives only the
items the person picked and never gains library access. Declaring a string
would claim access we do not take.

**Background modes:** `audio`, `voip`, `remote-notification`. A business call
has to survive the screen locking, and an incoming call has to wake the app.

---

## Third-party sharing

Named in full in `docs/DATA-INVENTORY.md`. The one worth a reviewer's attention:

**Message content and voicemail audio are sent to Cloudflare Workers AI** for
three features — job address extraction, reply drafts, and voicemail
transcripts. Each is opt-in per business and off by default. The content is not
used to train models. This is disclosed in the privacy policy and controlled in
the app under Settings → Lou.
