# Play Data safety — the answers, as filed

Fill the Play Console form from this file. When they disagree, this file is
wrong until someone checks it against `docs/DATA-INVENTORY.md`, which is the
source both are derived from.

Kept in the repo on purpose: a declaration that lives only in a web console one
person can reach cannot be reviewed, diffed, or checked against the code by
anyone else.

**Last reconciled with the code:** 2026-08-01.

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

> Loonext is a business phone line for a work crew, and the permission serves
> two things the app does with the phone's own contacts.
>
> Reading: the app shows and searches the phone's contacts beside the crew's
> shared ones, so a tradesperson can text or call somebody without retyping a
> number or adding them twice. It reads names, organisations and phone numbers
> only, the matching and searching happen on the device, and no contact is
> uploaded to our servers.
>
> Writing: with the user's explicit permission, the app adds "Call with
> Loonext" and "Text with Loonext" actions to their existing contacts, so a
> customer can be reached from the business number straight out of the phone's
> own Contacts app. That half is requested only when the user turns the feature
> on, never at launch, and the account it creates is removed when they sign
> out.

Implementation: `apps/android/.../features/contacts/device/` (read),
`apps/android/.../features/contacts/sync/` (write, #183).

**Reading the device book is not a collected data class.** The Contacts row in
the table above is the customer records the business itself keeps in the
workspace. The phone's own address book is read, matched and searched on the
device and never sent to us. `docs/DATA-INVENTORY.md` states the distinction in
full; declaring the address book as collected would claim we hold data we never
receive.

### `RECORD_AUDIO`, `MANAGE_OWN_CALLS`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_PHONE_CALL`

The app places and receives real phone calls on the business's number. The
microphone is used during a call and at no other time; the foreground service
keeps a call alive when the screen locks, which is the normal state of a phone
in a work van.

### `USE_FULL_SCREEN_INTENT`

An incoming business call has to reach a locked phone as a ringing call, in the
same way the system dialer does. It is used for inbound calls only.

### Runtime prompts Play asks no form about

Neither of these maps to a Data safety type and neither triggers a permissions
declaration form. They are recorded here anyway, so this file is the whole list
of what the app asks a person for rather than only the parts with a form
attached:

- **`POST_NOTIFICATIONS`** — a ringing call and a customer's text. Asked on
  first launch, because a business line that cannot notify is not one.
- **`BLUETOOTH_CONNECT`** — routes call audio to a headset, which is how a call
  is taken in a van. Asked at call time, and a refusal only means the call plays
  through the phone.

### `ACCESS_COARSE_LOCATION`

The job map's "my location" button, and nothing else. Asked only when that
button is tapped. `ACCESS_FINE_LOCATION` is never requested.

---

## Ads and tracking

- **Contains ads:** no.
- **Tracks users across apps or websites:** no.
- **Advertising ID:** not requested.
