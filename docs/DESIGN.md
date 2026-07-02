# JobText — Design System & UX Decisions

Binding design decisions for the web app. Same authority as DECISIONS.md: implement, don't
re-litigate. The buyer is a plumber, landscaper, cleaner, or salon owner — often on a phone,
in a truck, between jobs. Every screen must feel calm, obvious, and fast. The emotional
target: "this thing respects my time."

---

## G1. Design principles

1. **Calm.** Warm neutrals, one confident accent, generous whitespace, border-first surfaces
   (shadows only on overlays). No gradients-as-decoration, no marketing chrome inside the app.
2. **The conversation is the hero.** Everything else (nav, panels, meta) recedes. Message
   text is the largest, darkest thing on the inbox screens.
3. **Plain language.** No jargon: "Texting activates in about a week" not "10DLC campaign
   vetting pending". Compliance complexity is absorbed by the product, explained in one
   sentence, never dumped on the user.
4. **Mobile is not a viewport, it's the primary user.** Every flow works one-handed on a
   375px screen. Desktop is the enhancement.
5. **Nothing mysterious.** Every async state (provisioning, registration, sending, delivery)
   is visible, named, and honest. No spinners without words.
6. **Fast by feel.** Optimistic UI on send (the queued row IS the optimism), realtime
   everywhere, skeletons over spinners, 150–200ms ease-out transitions, no bounce.

## G2. Design tokens

Implemented as CSS variables in `globals.css` (shadcn/ui convention, light + dark).

- **Typography:** Inter (variable, self-hosted via `next/font`; `font-feature-settings:
  "cv11","ss01"`; tabular numbers for usage/billing figures). Scale: 13px meta, 14px body-ui,
  15px message text (16px on mobile — prevents iOS zoom), 18/24/30px headings. Line-height
  1.5 body, 1.2 headings. Weight: 400/500/600 only.
- **Color (light):** background `stone-50` (#FAFAF9); surfaces white; text `stone-900`/
  `stone-500` secondary; borders `stone-200`.
  **Accent — "petrol":** deep blue-green, `#0F766E` (teal-700) as primary, `teal-800` hover,
  `teal-50` tinted backgrounds. Trustworthy, calm, distinct from generic SaaS indigo.
  Semantic (muted, used sparingly): success `emerald-600`, warning `amber-600`, danger
  `red-600`, info `sky-600`.
- **Color (dark):** background `stone-950`, surfaces `stone-900`, borders `stone-800`,
  accent `teal-500` on dark. Dark mode ships in MVP: system-follow + manual toggle in
  settings (class strategy, `next-themes`).
- **Radius:** `--radius: 0.625rem` (10px). Pills fully rounded. **Shadows:** none on cards
  (1px border instead); `shadow-lg` only on popovers/dialogs/drawers.
- **Spacing:** 4px grid; screen gutters 16px mobile / 24px desktop; section spacing 24/32px.
- **Motion:** 150ms ease-out micro (hover, focus), 200ms ease-out overlays/panels,
  new-message arrival = 200ms fade + 4px rise. `prefers-reduced-motion` disables all.
- **Icons:** lucide-react, 16px in-line / 20px nav, `stroke-width={1.75}`.

## G3. App architecture & navigation

- **Desktop (≥1024px):** three-region shell.
  Left sidebar 240px: logo wordmark, primary nav (Inbox, Contacts, Templates), spacer,
  Settings, usage meter mini-bar, company/user block at bottom. `stone-100` background,
  active item = white pill + petrol text.
  Middle: conversation list, 360px, own scroll.
  Right: thread pane (flexible) with a 320px contact panel toggled by an info button
  (persisted preference).
- **Tablet (768–1023px):** sidebar collapses to 64px icon rail; list+thread as master-detail.
- **Mobile (<768px):** bottom tab bar (Inbox, Contacts, Settings) with 44px+ touch targets
  and safe-area padding; conversation list full-screen; thread pushes in as a full-screen
  view with back header; compose FAB (petrol, bottom-right, above tab bar) on the inbox tab.
- **URLs:** `/inbox` (list; `?status=&assignee=&tag=&q=` filters in the URL),
  `/inbox/[conversationId]` (thread), `/contacts`, `/contacts/[id]`, `/templates`,
  `/settings/{workspace|team|billing|usage|notifications|numbers|profile}`, `/onboarding/*`,
  auth at `/login`, `/signup`, `/reset-password`, `/invite/[token]`, `/join` → signup.
- **Command-K** (desktop): jump to conversation/contact, "new conversation", nav. Built on
  cmdk (ships with shadcn).

## G4. The inbox (list)

- Row anatomy (68px): unread dot (petrol, 8px) → contact name (or formatted number)
  600-weight when unread → last message snippet one line `stone-500` (prefix "You:" for
  outbound, note icon for notes) → right column: relative time (`2m`, `1h`, `Tue`) +
  assignee avatar (18px) + status pill.
- **Status pills** (11px, uppercase-free, tinted bg + text): New = petrol tint, Open = sky
  tint, Waiting = amber tint, Closed = plain `stone-100`. Spam never shows in the default
  list (filter chip reveals it).
- Filter bar above the list: segmented "Open | Mine | All | Closed" + overflow filter sheet
  (status, assignee, tag, unread) + search field (fires `/v1/search` ≥2 chars, debounced
  250ms, results grouped Conversations / Contacts with snippet highlights).
- Sort: `last_message_at` DESC, realtime re-sort animated via FLIP (subtle).
- Unread = bold name + dot; opening a thread posts `/read` immediately.
- **Empty states (bespoke, not generic):**
  - Brand new (no messages ever): the company number displayed huge (32px, tabular) with a
    copy button and: "This is your business number. Text it from your phone right now — your
    message will appear here." (This is the activation moment; make it feel like magic.)
  - Filtered-empty: "Nothing waiting on you. 🎉" one-liner, quiet.
- Skeleton rows (pulse) on first load only; realtime updates never skeleton.

## G5. The thread

- Header: contact name (tap → contact panel/mobile sheet), number below in 13px `stone-500`,
  right side: status select (inline pill dropdown), assignee select (avatar menu), overflow
  menu (Close/Reopen, Mark spam, Opt out contact, View contact).
- **Messages:** max-width 65% (85% mobile). Inbound: white card, 1px `stone-200` border,
  left-aligned. Outbound: `teal-50` bg / `teal-900` text (dark: `teal-950`/`teal-100`),
  right-aligned. 15/16px text, selectable. Timestamp + state in 11px `stone-400` under the
  last message of each cluster (cluster = same sender within 3 min).
  Delivery states: "Sending…" → "Sent" → "Delivered" (✓ then ✓ subtle); **Failed = red text
  "Not delivered — Retry"** (retry button inline when eligible; opted-out failures say
  "This customer opted out" instead).
  **Notes:** amber-50 card, dashed border, lock icon + "Internal note" label — visually
  unmistakable from SMS. **MMS:** image thumbnails (max 240px, rounded, click → lightbox),
  loading via signed-URL fetch with blur-up placeholder.
- Day dividers ("Today", "Yesterday", "Jun 12"). Timeline events (status changed, assigned,
  tagged, opt-out) render as centered 12px `stone-400` system lines with the actor's name.
- Infinite scroll-back with cursor pagination; anchored scroll position on prepend; jump-to-
  bottom pill appears when scrolled up and a new message arrives ("New message ↓").
- **Composer:** auto-growing textarea (1→6 rows), toolbar: template picker (`/` also opens
  it inline), attach image (max 3, previews as removable chips), emoji via native OS.
  Send = petrol button, Cmd/Ctrl+Enter sends, Enter = newline (SMS is not chat-app instant;
  deliberate sends). Character/segment meter appears at >120 chars: "2 segments" in 12px,
  amber at ≥4 segments — plain tooltip explains segments.
  **Banner states replace the composer** (full-width tinted card, one sentence + optional
  action): opted-out (red tint, "This customer opted out of texting. Sends are blocked.");
  registration pending for US destination (amber, "US texting activates once your
  registration is approved — usually 1–3 business days."); subscription past_due (amber,
  "Update your payment method to send messages." + button); usage cap (amber, owner gets
  "Raise cap" inline button, members see "Ask your account owner").
- New outbound conversation (compose flow): recipient field (searches contacts, accepts raw
  number with live E.164 formatting), consent checkbox ("This customer asked us to text
  them") required for new contacts, quiet-hours dialog when applicable ("It's 9:14 PM for
  this customer. Send anyway?" Send / Wait), first-message footer preview shown under the
  composer ("— Mike's Plumbing. Reply STOP to opt out" in `stone-400`, labeled "Added to
  your first message to this contact").

## G6. Contact panel / contacts

- Panel (thread right side / mobile bottom sheet): name (inline-editable), number with
  copy, consent status line ("Texted you first · Jun 3" or "Consent recorded by Sam ·
  May 12"), opt-out badge + revoke (if manual), address, notes (auto-saving textarea),
  tags on the conversation, prior conversations list (status + date), "Opt out this
  contact" in a quiet danger zone.
- `/contacts`: searchable table (name, number, last activity, opted-out badge), CSV import
  wizard (upload → column mapping with auto-detect → dry-run preview showing per-row
  results → import summary with skipped-row reasons downloadable). Import UI must make the
  `opted_out` column's meaning explicit.

## G7. Onboarding (the make-or-break flow)

One question per screen, progress dots, big friendly type, petrol primary buttons,
back always available, state persisted server-side (resumable). Flow:

1. **Account** (`/signup`): email+password or magic link; then company name.
2. **"Where do your customers text you?"** — country (US/CA) + area code picker (type a
   city or code; shows "(416) — Toronto" style hints from the NANP table).
3. **Business identity** (feeds the SMS footer + registration): legal/business name,
   address, website (optional), "Do you have an EIN/Business Number?" → yes (enter it) /
   no ("No problem — we'll register you as a sole proprietor", last-4 SSN/SIN + mobile for
   verification). Every field has a one-line plain-English "why we ask" hint. AUP checkbox.
4. **Plan** — two cards (Starter/Pro), feature deltas in 5 lines max, "$29/mo" huge,
   "500 outgoing texts included" in human terms, US one-time fee line shown to US companies
   with tooltip. **The honest-timeline card sits here, pre-payment**: "You'll get your
   number instantly. Receiving texts works right away. Sending to US numbers activates
   after carrier registration (usually 1–3 business days) — we handle it."
5. **Stripe Checkout** (hosted) → return to `/onboarding/setting-up`.
6. **Setting-up screen** (realtime-driven, no polling UI): three checklist rows animating
   pending→done via Broadcast events — "Creating your number" → reveals the number in
   36px tabular type with a copy button and confetti-free ✓; "Registering your business
   with carriers" (US: stays pending with the timeline sentence; CA-only: instant ✓);
   "Inbox ready" → CTA "Open your inbox". If sole-prop: OTP input row appears here
   ("Enter the code we texted to (…) ").
7. First inbox visit: the G4 activation empty state. A dismissible progress card tracks:
   number ✓ / first inbound / first reply / teammate invited — quiet checklist, not a tour.

Registration status after onboarding lives as: (a) a slim amber banner above the inbox list
("US texting activates soon — registration in review", link to `/settings/numbers`), (b) the
full state on `/settings/numbers` (submitted/pending/approved/rejected with dates, rejection
reason in plain language + "Fix and resubmit" form). Approval fires a realtime event → banner
swaps to a green "You're live — US texting is on" toast + email already sent server-side.

## G8. Settings

Left-nav settings layout (mobile: stacked list → detail pages). Sections:
- **Workspace:** company name, business identification (footer preview updates live),
  timezone display.
- **Team:** member rows (avatar, name, role select, deactivate), invite by email + role,
  pending invites with expiry + revoke, seat usage line ("3 of 3 seats — upgrade for more").
- **Numbers:** number card(s) with status, registration state machine rendered as a
  friendly stepper, DELETE guarded by typed confirmation.
- **Usage:** big period meter (used / included, petrol fill → amber at 80%), projected
  overage in dollars, cap control (owner: slider/preset 2×/3×/5×/no cap + confirmation),
  6-month history bars, plain explainer of segments.
- **Billing:** plan card, change-plan dialog (upgrade instant w/ proration note; downgrade
  explains what must be released first, blocked state lists exactly what to do), "Manage
  payment & invoices" → Stripe portal, cancel flow (portal) with honest copy about the
  30-day number grace.
- **Notifications:** per-user email/push toggles with sentence descriptions; push permission
  requested only from here or the first-visit prompt card (never a browser-permission ambush).
- **Profile:** display name, theme (System/Light/Dark), sign out.

## G9. Notifications & PWA

- Web Push (VAPID): notification = contact name + snippet, tap → deep-link to thread.
  In-page toast (bottom-left, quiet) when a new message arrives in a conversation you're
  NOT viewing; none when viewing (the message just appears).
- Unread favicon dot + `(3) Inbox — JobText` title count.
- PWA: manifest (name, petrol theme-color, maskable icon), service worker (push + offline
  app-shell fallback page that says "You're offline — JobText needs a connection"), iOS
  meta tags. Installability matters for the truck.

## G10. Voice & microcopy

- Sentence case everywhere. Contractions. Second person. No exclamation marks except the
  single activation moment. Errors: what happened + what to do, one sentence each ("That
  image is over 1 MB. Try a smaller photo."). Buttons are verbs ("Send", "Invite", "Raise
  cap"). Empty states may be warm; system states must be precise. Dates: relative under
  7 days, absolute after. Numbers formatted `(416) 555-0182` for display, E.164 under the
  hood, always.

## G11. Accessibility & quality bar

- WCAG 2.1 AA: 4.5:1 text contrast (petrol-on-tint verified in both themes), visible focus
  rings (2px petrol offset), full keyboard path through inbox → thread → composer,
  `aria-live=polite` for incoming messages, labels on every input, hit targets ≥44px on
  mobile, reduced-motion support, screen-reader text for delivery states.
- Performance: skeletons < 100ms, route-level code splitting, list virtualization
  (conversation list + thread) via `@tanstack/react-virtual`, images lazy + blur-up.
- Every interactive state designed: hover, focus, active, disabled, loading, error, empty.

## G12. Frontend architecture

- **Data:** TanStack Query over a typed API client (`packages/shared` zod schemas infer
  request/response types; client throws typed `ApiError` mapped to toasts/banners by code).
  Query keys per company; realtime Broadcast events invalidate/patch precisely (message
  arrives → patch thread + reorder list, no refetch storms; reconnect → refetch page 1).
- **Auth:** `@supabase/ssr` cookie session; middleware-guarded app routes; company context
  in a provider (X-Company-Id header injection); invite-accept flow completes membership then
  lands in `/inbox`.
- **State:** URL is the state for filters; React state for UI; no global store beyond Query.
- **Forms:** react-hook-form + zod resolvers (same schemas as the API).
- **Toasts:** sonner (quiet, bottom), only for async outcomes not visible in-place.
- New deps allowed for the UI wave: `@tanstack/react-query`, `@tanstack/react-virtual`,
  `next-themes`, `sonner`, `react-hook-form`, `@hookform/resolvers`, `cmdk`, `date-fns`,
  `papaparse` (CSV preview), lucide-react + required shadcn/ui components. Nothing else
  without cause.
