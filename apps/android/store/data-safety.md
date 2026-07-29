# Play Data safety — the answers, as filed

Fill the Play Console form from this file. When they disagree, this file is
wrong until someone checks it against `docs/DATA-INVENTORY.md`, which is the
source both are derived from.

Kept in the repo on purpose: a declaration that lives only in a web console one
person can reach cannot be reviewed, diffed, or checked against the code by
anyone else.

**Last reconciled with the code:** 2026-07-26.

---

## Data deletion

- **Account deletion is available in the app**: Settings → Account → Delete
  your account.
- **Data deletion URL**: `https://loonext.com/legal/delete-my-data`
  — public, no sign-in, stable path. Renaming it breaks this declaration.

## Encryption and transit

- **Encrypted in transit:** yes, everywhere.
- **Encrypted at rest:** yes.

---

## Data collected and shared

Every row is **collected**, **shared** with the sub-processors named in
`docs/DATA-INVENTORY.md`, **required** (the app does not function without it),
and used only for **App functionality** unless stated. None is used for
advertising, and none is sold.

| Play data type | Collected | Shared | Purpose |
|---|---|---|---|
| Personal info → Name | Yes | Yes | App functionality, Account management |
| Personal info → Email address | Yes | Yes | App functionality, Account management |
| Personal info → Phone number | Yes | Yes | App functionality |
| Personal info → Address | Yes | Yes | App functionality (job addresses) |
| Messages → Other in-app messages | Yes | Yes | App functionality |
| Photos and videos → Photos | Yes | Yes | App functionality (picture messages, job photos) |
| Audio → Voice or sound recordings | Yes | Yes | App functionality (voicemail) |
| Files and docs | Yes | Yes | App functionality (attachments) |
| Contacts | Yes | Yes | App functionality |
| Location → Approximate location | Yes | Yes | App functionality (job map); Fraud prevention, security, and compliance (#236 signed-in devices) |
| App activity → Other actions | Yes | Yes | App functionality (call history) |
| App info and performance → Crash logs | Yes | Yes | Diagnostics |
| App info and performance → Diagnostics | Yes | Yes | Diagnostics |

**Precise location: No.** Job addresses are geocoded to a point and the map's
location button uses `ACCESS_COARSE_LOCATION`. We never request
`ACCESS_FINE_LOCATION`.

**Financial info: No.** Stripe holds the card; we store customer and
subscription identifiers only.

---

## Permission declarations

### `READ_CONTACTS` / `WRITE_CONTACTS`

**Justification as filed:**

> Loonext is a business phone line for a work crew. With the user's explicit
> permission, the app adds "Call with Loonext" and "Text with Loonext" actions
> to their existing contacts, so a tradesperson can reach a customer from their
> business number straight out of the phone's own Contacts app rather than
> retyping the number. The permission is requested only when the user turns
> that feature on, never at launch, and the account it creates is removed when
> they sign out.

Implementation: `apps/android/.../features/contacts/sync/`.

### `RECORD_AUDIO`, `MANAGE_OWN_CALLS`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_PHONE_CALL`

The app places and receives real phone calls on the business's number. The
microphone is used during a call and at no other time; the foreground service
keeps a call alive when the screen locks, which is the normal state of a phone
in a work van.

### `USE_FULL_SCREEN_INTENT`

An incoming business call has to reach a locked phone as a ringing call, in the
same way the system dialer does. It is used for inbound calls only.

---

## Ads and tracking

- **Contains ads:** no.
- **Tracks users across apps or websites:** no.
- **Advertising ID:** not requested.
