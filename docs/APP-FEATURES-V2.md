# Loonext — App Features V2 (build-ready detail)

Companion to `docs/DECISIONS.md` **D17–D22**. This is the *how* for the smaller features the product
owner has already decided — the decisions are binding; this doc refines execution. It assumes the
Wealthsimple-grade calm bar from `docs/APP-UI-ELEVATION.md` (petrol `#0F766E` / warm-stone / Inter /
border-first / restraint / one obvious action per region) and the layout overhaul in
`docs/APP-LAYOUT-V2.md`. Data/security conventions inherit from D7 (schema) and D8 (auth boundary,
Worker-mediated Storage, `sb_secret_` key, RLS deny-by-default).

**Scope of this file:** Auth SSO + credential change (D18), attachments storage for notes/tasks (D19),
contacts export/vCard/picker (D20), conversation-view API support (D21), audit events (D22). The Tasks
feature (D17) and the layout/composer/filter UX live in their own docs; here we only spell out the parts
those decisions delegate to "small features."

---

## 1. Auth — Google + Apple SSO and credential change (D18)

### 1.1 What ships
- "Continue with Google" and "Continue with Apple" on the login **and** signup screens, beside the
  existing email/password form.
- Settings → Account: **change email**, **change password**, and (for OAuth-only accounts) **set a
  password** / see linked sign-in methods.

### 1.2 Provider setup (ops runbook, no product code)
| Provider | What to create | Where it goes |
|---|---|---|
| Google | Google Cloud OAuth 2.0 **Web** client | Authorized redirect URI = `https://<project>.supabase.co/auth/v1/callback`; client id+secret into Supabase dashboard → Auth → Google |
| Apple | **Services ID** (the OAuth client), a **Sign-in-with-Apple Key** (.p8), the **Team ID** | Supabase dashboard → Auth → Apple: Client IDs = Services ID; Supabase mints Apple's short-lived client-secret JWT from the key |

Add every Loonext origin (prod + preview) to the Supabase **redirect allow list**. No provider secret ever
reaches the browser — frontend still gets only `NEXT_PUBLIC_SUPABASE_URL` + publishable key (D8).

### 1.3 The OAuth flow (PKCE + server callback — the `@supabase/ssr` requirement)
```
Button → supabase.auth.signInWithOAuth({
  provider: 'google' | 'apple',
  options: { redirectTo: `${origin}/auth/callback?next=/inbox` }
})
        → provider consent
        → GET /auth/callback?code=…&next=…   (Next.js Route Handler, apps/web)
              createServerClient(cookies) → exchangeCodeForSession(code)
              → redirect to `next`
```
- `/auth/callback` is a **web-app UI route**, the single OAuth server touchpoint. It does **not** violate
  D8's "no Worker auth route" — the Worker still never brokers login; this is Next.js SSR cookie handling.
- Validate `next` is a same-origin relative path (open-redirect guard).
- On `exchangeCodeForSession` error, redirect to `/login?error=oauth` with a calm inline message.

### 1.4 OAuth → company-link (the real integration)
After Supabase creates `auth.users` and the D7 trigger fills `profiles.display_name`, Loonext routes on
its own tenancy (`company_members`, D8) — identically for password and OAuth users:

```
first authenticated request → GET /me
  ├─ has company_members row        → /inbox
  ├─ email matches an open invite   → invite-accept (bind company+role, consume invite,
  │                                     seat check at acceptance — D8). Works via SSO too:
  │                                     match on the verified OAuth email.
  └─ no membership, no invite        → company-first onboarding (POST /v1/companies, D6)
```
- OAuth changes **how you authenticate**, never **how a tenant is created**. No auto-company-from-login.
- **Account linking:** rely on Supabase automatic linking by verified email (password + Google + Apple on
  the same email = one `auth.users`). Manual unlink is out of MVP.
- **Apple caveats (support-doc them):** Apple returns name/email only on *first* consent and may hand back
  a private-relay address. Persist the email at first sign-in; never assume it re-arrives on later logins.

### 1.5 Email change (Settings → Account)
- `supabase.auth.updateUser({ email })` from the browser.
- Keep Supabase **"Secure email change" ON** → confirmation is emailed to **both** the current and the new
  address; the change commits only when confirmed. UI copy: "We've emailed both your old and new address —
  confirm from each to finish." Loonext reads email from `auth.users`, so no app-side mirror to reconcile.
- OAuth-only users (no password) can still set/confirm an email this way.

### 1.6 Password change (Settings → Account)
- `supabase.auth.updateUser({ password })`.
- Keep **"Secure password change" ON** → Supabase requires **reauth only when the session is older than
  24h**. When required: `supabase.auth.reauthenticate()` (emails a 6-digit nonce) → user enters it →
  `updateUser({ password, nonce })`. When not required, the single call succeeds. Surface leaked-password /
  min-strength errors inline.
- **OAuth-only accounts** get a "Set a password" affordance = the same `updateUser({ password })` call,
  turning an SSO account into a dual-login account (nonce not needed on a fresh session).

### 1.7 Consistency & calm
- Worker JWKS verification (D8) unchanged — an OAuth-issued Supabase JWT verifies identically (same
  `iss`/`aud`, ES256). No new tables. RLS + `X-Company-Id` scoping unchanged.
- SSO buttons: stone-outlined, provider wordmark, full-width, stacked above the email form. The **one
  petrol element** on the auth screen stays the primary "Continue"/submit button (accent budget).

### 1.8 Settings → Account "Sign-in methods" (the OAuth-only edge — drawn, not just asserted, D18)
This is the one SSO edge that will generate ICP support tickets (a plumber who signed up with "Continue
with Apple" now wants to log in on a shop desktop without their phone). Spec it, don't hand-wave it.

- **Linked-methods list.** Read Supabase's `user.identities` array and render a compact list —
  **Google · Apple · Password** — each row a **present/absent** state (a quiet stone check when linked, a
  muted "Not linked" otherwise). No provider colors; stone chrome; this is a status list, not a
  management console.
- **"Set a password" appears only for OAuth-only accounts** — i.e. **no `password` identity present**.
  It is the `supabase.auth.updateUser({ password })` call from §1.6 (no reauth nonce needed on a fresh
  session), turning the SSO account into a dual-login account so the user can sign in on any device.
  When a password identity already exists, this row is the normal **"Change password"** (§1.6) instead.
- **Apple private-relay case.** When the email is an Apple private-relay address, show it **read-only**
  with one plain line: "Email is routed through Apple." Do not offer inline email edit for a relay
  address; the account may have **no reachable real email**, so "Set a password" is the reliable
  desktop-login path for these users. (Persisted from first consent per D18 — never assume Apple
  re-sends it.)
- **Out of MVP:** manual identity **unlink** (D18). The list is read-with-one-action (set/change
  password), not a full linking manager. One petrol element on the Account screen (the primary save),
  everything else stone.

---

## 2. Attachments storage — notes & tasks (D19)

### 2.1 Shape (lowest-upkeep)
One generic table + one private bucket, parallel to (not merged with) the MMS `message_attachments` /
`mms-media` machinery (D7). Rationale: MMS is Telnyx-sourced, image-biased, downloaded in the webhook path,
and metered; note/task attachments are user-uploaded, any type, un-metered, no Telnyx origin. Keeping them
separate keeps the webhook ingest clean; a single polymorphic table (vs table-per-owner) is the least
machinery.

**`attachments` (new migration):**
| column | notes |
|---|---|
| `id` | pk |
| `company_id` | NOT NULL, tenant scope |
| `owner_type` | text CHECK IN (`'note'`,`'task'`) |
| `owner_id` | uuid — the `messages` row (note) or `tasks` row (task); app-enforced, not polymorphic FK |
| `conversation_id` | uuid NULL — denormalized so the gallery (D21) queries cheaply |
| `storage_path` | text NOT NULL |
| `file_name`, `content_type`, `size_bytes` | metadata |
| `uploaded_by_user_id` | uuid FK profiles |
| `created_at`, `deleted_at` | append-friendly; soft-delete |

Indexes: `(company_id, conversation_id) WHERE deleted_at IS NULL`,
`(owner_type, owner_id) WHERE deleted_at IS NULL`.

**Trigger/timestamp posture (state once — no drift).** The generic `attachments` table is
**append-only + soft-delete** (`created_at`, `deleted_at`): **no `updated_at`, no `moddatetime`**. (By
contrast the `tasks` table (D17/TASKS.md T1) **does** get `updated_at` + `moddatetime`.) There is **no**
`task_attachments` table and **no** `task-media` bucket — task attachments are `owner_type='task'` rows
in *this* table (D17/D19), so there is no separate task-attachment trigger to add.

### 2.2 Bucket + path
- Private bucket **`attachments`**, distinct from `mms-media` (different MIME/size limits).
- Path: `attachments/{company_id}/{owner_type}/{owner_id}/{uuid}-{safe_filename}`.
- **`company_id` is path segment after the bucket** → one RLS predicate authorizes the whole tenant tree.

### 2.3 Upload (Worker-mediated, D8 preserved)
- Browser never writes Storage directly. `POST /v1/attachments` (multipart or a two-step signed-URL):
  1. verify membership + that the caller owns/《can edit》the owner note/task;
  2. validate declared type/size, then re-validate **content-type from the bytes** (never trust the client);
  3. small files: Worker streams to Storage with the `sb_secret_` key. Large files: Worker mints
     `createSignedUploadUrl`, returns it, browser does one `uploadToSignedUrl`, then confirms → row inserted.
- **Defense-in-depth RLS** on `storage.objects`: any authenticated path must satisfy
  `(storage.foldername(name))[2] = <caller company>` — so even if grants widen later, no cross-tenant read/
  write. (Primary control is still the Worker; this is belt-and-suspenders per D8.)

### 2.4 Limits (decisive, sane, un-metered)
- Per-file **25 MB** (bucket `file_size_limit`).
- `allowed_mime_types`: `image/*`, `application/pdf`, Office/OpenDocument, `text/plain`, `text/csv`,
  `application/zip`. The realistic tradesperson set: a photo of a part, a quote PDF, a spec sheet.
- **Blocked** (rejected before signing): executables/scripts — `.exe/.bat/.cmd/.sh/.js/.html` and
  `application/x-*` executable types.
- **Soft cap 10 attachments per owner** (a note/task shouldn't become a dump).
- **Not metered** — D5 meters outbound SMS only.

### 2.5 Serving & cleanup
- Short-lived **signed download URLs** (`createSignedUrl`, 60–300s), minted by the API on demand (D7).
  Image thumbnails reuse the existing blur-up/lightbox path.
- Deleting a note/task soft-deletes its `attachments` rows; a best-effort sweep cron removes the Storage
  objects (never blocks the user's action).

---

## 3. Contacts — export / vCard / picker (D20)

No schema change; contacts already exist (UNIQUE(company_id, phone_e164), D7). All three are additive on
the existing CSV-import surface. **None of these send** — import populates contacts only (D4; no bulk-blast).

### 3.1 CSV export — `GET /v1/contacts/export`
- Streams UTF-8 CSV (BOM for Excel): name, phone_e164, tags, consent_source, consent_at, created_at.
- Respects the **current filter/search** ("export what I'm looking at"). Excludes soft-deleted.
- Columns round-trip with the importer → export→edit→import is lossless. Any member (read-only visibility).

### 3.2 vCard import — `POST /v1/contacts/import-vcard`
- Accepts one `.vcf` with one-or-many `VCARD` blocks (phone/Google/Apple export format).
- Parse **vCard 3.0 + 4.0**: `FN`/`N` → name, `TEL` → phone.
- **Normalize each `TEL` to E.164** against the company default country (US/CA, D2); drop
  un-normalizable / non-mobile-shaped numbers with a per-row reason.
- A card with multiple valid `TEL`s → one contact per **distinct valid** number (contacts are phone-keyed).
- Reuse the **exact upsert + dedupe + consent-attestation** the CSV importer enforces
  (`consent_source='import'`, D4) — vCard is a second *parser* into the same idempotent upsert, not a
  second pipeline. Same preview→confirm UI + per-row error report as CSV.

### 3.3 Web Contacts Picker — progressive enhancement (client-only)
- **Feature-detect:** `('contacts' in navigator) && ('ContactsManager' in window)`. Supported: **Chrome on
  Android only** — no iOS/Safari, no desktop. So it is strictly additive; the button isn't rendered where
  unsupported.
- **Must run inside the tap gesture**, secure top-level context:
  `await navigator.contacts.select(['name','tel'], { multiple: true })`.
- Map results → the same normalize→preview→confirm flow as vCard/CSV → shared upsert route. **No new server
  surface** beyond the existing upsert.

### 3.4 Native address book = roadmap
True OS contact sync needs native apps (out of MVP, D9/D11). Documented as a fast-follow; the Picker is the
MVP progressive-enhancement stand-in.

### 3.5 UI
One shared import surface with source tabs — **CSV file · vCard file · Pick from phone** (the last only on
supported browsers) — a single preview→confirm step, one petrol confirm action.

---

## 4. Conversation-view API support (D21)

The UX (segmented in-thread filter, attachments gallery) is in `docs/APP-LAYOUT-V2.md`. The data/API:

### 4.1 In-thread filter — no new endpoint
- Notes = `messages` rows `direction='note'`; events = `conversation_events` (D7). `GET /v1/conversations/:id`
  already embeds both.
- **All | Messages | Notes | Events** is a **client-side filter** over data already on the page (existing
  message cursor handles "load more"). Optional future server filter = additive `?kind=` param on the
  messages list — not needed for MVP.

### 4.2 Attachments gallery — one new endpoint, a TWO-table union with DIFFERENT join shapes
`GET /v1/conversations/:id/attachments` → a single date-sorted list **unioning exactly two sources**.
The two arms have **different join shapes** because `message_attachments` has **no `conversation_id`
column** (SPEC.md: it carries `message_id, company_id, storage_path, content_type, size_bytes,
source_url, created_at` only) while the generic `attachments` table (D19) **denormalizes**
`conversation_id`:

1. **MMS arm (needs a join):**
   `message_attachments ma JOIN messages m ON m.id = ma.message_id
    WHERE m.conversation_id = :id AND m.company_id = :company`
   — the conversation scope comes from `messages`, not from `message_attachments`. The join rides the
   existing `messages(conversation_id, created_at)` index (SPEC.md) plus the
   `message_attachments(message_id)` FK lookup (confirm that index exists — it is the FK — or **add
   one**).
2. **Generic arm (no join):**
   `attachments WHERE conversation_id = :id AND company_id = :company AND deleted_at IS NULL`
   — supplies **both** note (`owner_type='note'`) and task (`owner_type='task'`) attachments, so task
   attachments (D17/D19) appear here **for free**.

Because the two arms differ, **do not** express this as a single SQL sort over a view. The API fetches
each arm, tags each item's `source`, and merges/sorts **`(created_at, id) DESC` in the API layer**.

**Canonical item shape (pinned here; APP-LAYOUT-V2 §5.2 cites this, does not restate it):**
```json
{ "id": "...", "source": "mms|note|task", "kind": "image|file",
  "file_name": "...", "content_type": "...", "size_bytes": 12345,
  "created_at": "...", "thumbnail": "…?", "url": "<freshly-signed short-lived>" }
```
- **`source` enum = `'mms' | 'note' | 'task'`**, derived: `'mms'` from the `message_attachments` arm;
  `'note'` / `'task'` from the generic arm's `owner_type`. The UI maps these to display tags
  **Message | Note | Task** in the UI layer only. `kind: 'image' | 'file'` drives the **Images | Files**
  tabs (client-side).
- The endpoint is the **single place** that authorizes (membership on the conversation) and mints signed
  URLs (D7/D19) — the browser never holds a Storage grant. MMS items reuse the existing MMS signed-URL
  path; generic items use `GET /v1/attachments/:id/url` (D19). There is **no** `/v1/task-attachments/:id/url`.
- Cursor-paginated `(created_at, id) DESC` (D10). **Images | Files** tabs filter client-side.
- UI: stone-surfaced grid, lazy-loaded; click → existing lightbox (images) or signed-URL download
  (files). Telegram "Shared Media," trimmed to a tradesperson's reality. **Single entry point:** the
  thread-header overflow (not also a panel section — APP-LAYOUT-V2 §5.2/§1.5); the panel shows only a
  quiet "View all attachments (N)" row that opens the same gallery.

---

## 5. Auditability — done/undone + task/attachment events (D22)

Everything lands in the existing `conversation_events` table (D7) and the **Events** segment of the
in-thread filter (D21). One timeline, no second log. Append-only.

**Shipped column names are canonical.** `conversation_events` has columns **`type`** (the
`conversation_event_type` enum — **not** `event_type`), **`payload`** (jsonb — **not** `meta`), and
**`actor_user_id`**. Every write below uses these three names. **The full enum-addition list is pinned
in one place — `docs/TASKS.md` T8 — and this section cites it, not a divergent copy.** **The
`conversation_events_conv_required` CHECK does NOT change** — every new event type carries a non-null
`conversation_id`, so the shipped constraint (which only permits null for
`'opted_out','opt_out_revoked','consent_attested'`) is satisfied as-is; no `ALTER` (D14/D7 forbid
editing a shipped constraint).

### 5.1 Done / undone (closes the D14 gap)
- `PATCH /v1/messages/:id {done}` (D14) additionally inserts, **in the same transaction** as the `done_at`
  write: **`type`**=`'message_done'` / `'message_undone'`, `actor_user_id`, **`payload`** `{ message_id }`.
- **Body is joined live, never copied.** The timeline renders "Sam marked a message done" by joining the
  **live** `messages.body` at display time (as the timeline already does for status/assign lines) — the
  event stores **only** `{ message_id }`, so there is no stale excerpt copy and no new PII surface (D8).
- **Idempotent with D14's no-op:** a mark-done that changes nothing writes **no** event — only real
  transitions are audited (no timeline spam). The `message.status` broadcast (D9/D14) is unchanged; the
  event row is the durable record behind it.

### 5.2 Task lifecycle (D17)
- `type`=`task_created` (promote), `task_assigned` (payload from/to user), `task_due_set`, `task_deleted`
  — each a `conversation_events` row on the source conversation, actor-stamped.
- A task's **done/undone is not re-audited** — it flows through the underlying message's
  `message_done`/`message_undone` (shared truth, D17). Exactly one audit event per real completion.
  **There is no `task_completed`/`task_reopened` event** (dropped — they would double-log; TASKS.md T8).

### 5.3 Attachment events (D19)
- `note_attachment_added` / `note_attachment_removed` (payload: `file_name`, `attachment_id`) on the note's
  conversation; `task_attachment_added` / `task_attachment_removed` on the task's source conversation.
  Actor-stamped.

### 5.4 Rendering
- All appear as centered stone-400 timeline lines under **Events** — invisible until the user selects that
  segment (nothing fights for attention, APP-UI-ELEVATION). Existing event types (status/assign/tag/opt-out,
  D3/D7) are unchanged and share the row style.

---

## 6. Cross-references
- Layout / composer / filter UX, in-thread filter & gallery visuals → `docs/APP-LAYOUT-V2.md`
- Binding decisions → `docs/DECISIONS.md` **D17–D22** (and D1–D16 for inherited conventions)
- Calm/aesthetic bar → `docs/APP-UI-ELEVATION.md`
- Message-done floor these build on → `docs/DECISIONS.md` **D14**
