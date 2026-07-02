# JobText App UI Elevation — "Wealthsimple-grade: beautiful, clean, easy"

**Status: BINDING.** Same authority as `docs/DESIGN.md`. This spec elevates the **look and feel**
of the authenticated web app (inbox list, conversation thread + composer, contacts, onboarding,
auth, settings) to the interaction *quality* of Wealthsimple — calm, clean, effortless,
friendly-premium, a complex domain made to feel simple — **while keeping JobText's own identity:
warm stone neutrals, petrol `#0F766E`, Inter, border-first, mobile-first.** We adopt
Wealthsimple's *principles and craft, not its palette.*

**Precedence.** This doc keeps DESIGN.md's information architecture (G3), product behavior, and
component inventory unchanged. Where it raises the bar on *look/feel* (spacing, hierarchy, color
restraint, motion, copy tone), **it supersedes DESIGN.md's G1/G2/G4–G10 look-and-feel details.**
Implement, don't re-litigate. When a rule here refines a DESIGN.md token, treat it as a
*tightening* at the same authority.

**Sequencing (read first).** The BUILD is a **separate wave**, sequenced with the marketing track
because both share `apps/web/src/app/globals.css`, `src/components/ui/*` (shadcn), and the Inter
setup. The token block below is the **calm base that serves both surfaces** — nothing here may
break the marketing-only utilities already fenced in `globals.css` (`.display-numeral`,
`.display-hero`, `.marketing-glow`, `[data-reveal]`). A **design-QA pass will audit the running
seeded app against this spec** screen by screen after the build wave; every rule here is written so
that audit is a pass/fail check, not a matter of taste.

**Audience anchor.** A plumber, landscaper, cleaner, or salon owner — in a truck, on a phone all
day, at a desktop between jobs. "Approachable and premium" — never precious, never designer-elitist,
never slow. **Calm ≠ empty. Calm = nothing fights for attention while you get a reply out fast.**

---

## 1. The bar

**Wealthsimple-grade for JobText means:** the conversation and the customer are the only bright,
heavy things on any screen; everything else — nav, meta, timestamps, system chrome — recedes into
quiet warm stone. Hierarchy comes from **type weight + size + a soft near-black**, never from boxes,
shadows, or a second color. The petrol accent is spent like it costs money: **at most one petrol
element competes for the eye in any region** — the next action, *or* the unread dot, *or* the active
nav pill — never all three, never decoration. Whitespace does the work that borders and color would
otherwise do. Every hard thing in this domain (10DLC, segments, opt-out, billing, registration) is
absorbed by the product and explained in **one warm plain sentence** with at most one action. Every
screen has **exactly one obvious next thing to do.** Routine actions are **optimistic with a 5-second
undo**, not a confirm gauntlet. The whole delight budget is spent at **three earned moments** — the
activation number reveal, a genuinely kind zero state, the onboarding "your number is ready" reveal —
and everywhere else motion means only feedback and closure. The result reads premium *because* it is
understated, and it stays fast enough that a tradesperson never waits on the UI.

**Do**
- Keep petrol `#0F766E` + warm stone + Inter + border-first + mobile-first. This is a tightening of
  the existing system, not a reskin.
- Recede secondary content aggressively to `stone-400/500`; keep only message text + customer name
  near-black.
- Add air on the *calm* surfaces (settings, onboarding, auth, empty states, contact panel).
- Give every view one primary action in petrol; demote all other actions to ghost/neutral.
- Say every compliance/billing/system state in one plain sentence + at most one action.
- Make routine actions instant + undoable; reserve confirms for the truly irreversible.
- Reserve big tabular type and real delight for the three emotional moments only.

**Don't**
- Don't clone Wealthsimple's hue (teal-as-brand), serif, 3D, or marketing motion. Petrol stays ours.
- Don't become **precious**: no stock-people illustration, no glassmorphism, no decorative
  gradients, no confetti, no bouncy/springy motion, no poster type scattered across working screens.
- Don't become **slow**: no heavy animation libs, no scroll-cinema, no blocking transitions, no
  spinner where an optimistic update belongs.
- Don't let two CTAs, or two petrol elements, fight in one region.
- Don't build a KPI/triage dashboard as the home surface — the home is a conversation list.
- Don't leak jargon, and don't render pure black `#000` or harsh `#000` borders anywhere in the app.

---

## 2. Token & system elevations

All values below are **shared with marketing** via `globals.css`; the calm base must serve both. The
marketing-only utilities (fenced `MARKETING-ONLY additions`) are untouched. Add the new app tokens
inside `:root` / `.dark` and expose the ones utilities need through `@theme inline`. Where a value is
already correct in DESIGN.md/`globals.css`, it is restated as a *lock*, not a change.

### 2.1 Color — the "Dune duo" + a scarce accent

- **Never pure black.** `--foreground` (`stone-900`) on `--background` (`stone-50`) is JobText's
  white+Dune duo — already a warm near-black in `globals.css`. **Lock: no `#000` text, no `#000`
  border, no pure-black shadow anywhere in the app.** Marketing's one product-shadow exception does
  not apply to the app.
- **Recede secondary content one step further.** Introduce a dedicated *tertiary* text token so
  meta/timestamps/system-event lines sit even quieter than body-secondary:
  - `--muted-foreground` stays `stone-500` (secondary labels, snippets).
  - Add `--foreground-tertiary: stone-400` (`oklch(0.709 0.01 56.259)`) for timestamps, assignee
    names, system/timeline event lines, in-cluster delivery state, dividers-with-text. Dark:
    `stone-500` (`oklch(0.553 0.013 58.071)`) to cut glare.
- **Soften dividers.** Add `--border-subtle: stone-100` (`oklch(0.97 0.001 106.424)`) for *interior*
  rules (row separators, list dividers, in-card splits). Keep `--border` (`stone-200`) for surface
  edges (card/input borders). Interior lines should almost disappear; edges stay crisp.
- **Accent budget (the core discipline).** Petrol `--primary` is *the next action* and *unread*
  only. Enforce **one petrol element per visual region.** Everything else that used petrol as
  emphasis becomes stone or a quiet tint. Focus rings (`--ring`, petrol) are exempt — they only
  appear on the focused element.
- **Encouraging green, sparingly.** Map Wealthsimple's positive-money green to JobText's
  `--success` (`emerald-600`), used *only* for genuine positives: "You're live", "Delivered", a
  completed onboarding check, done. Never as a general accent.
- **Status pills stay tinted-and-quiet** (information, not color). Standardize their tokens so no pill
  ever reaches full-chroma:
  - New = petrol tint (`teal-50` bg / `teal-800` text), Open = sky tint, Waiting = amber tint,
    Closed = `stone-100` / `stone-600`. Pills are `11px`, `500`-weight, sentence-case, `2px 8px`
    padding, fully rounded. Dark mode uses the `*-950` bg / `*-200` text pairs already in DESIGN.md.

### 2.2 Typography — hierarchy from weight + size, not chrome

- **Weights: 400 body / 500 emphasis / 600 heading. Never heavier.** Lock (matches DESIGN.md G2).
- **The app type scale** (restate as the binding ladder; keep it small and disciplined):
  | role | size / line-height | weight | notes |
  |---|---|---|---|
  | meta / pill / timestamp | 11–13px / 1.4 | 400–500 | `stone-400/500`, tabular where numeric |
  | body-ui (labels, list) | 14px / 1.5 | 400/500 | default UI text |
  | message text | 15px desktop / **16px mobile** / 1.5 | 400 | 16px on mobile prevents iOS zoom |
  | section heading | 18px / 1.3 | 600 | settings/panel headings |
  | screen heading | 24px / 1.25 | 600 | page titles |
  | **hero line** (the "warm display moment") | 28–30px / 1.2, `-0.01em` tracking | 600 | **one per big screen only** |
  | **emotional number** | **32–36px / 1.1**, tabular, `-0.01em` | 600 | **three moments only** |
- **The "warm display moment" without a new font.** Wealthsimple pairs a warm serif with a clean
  sans; JobText stays Inter-only and gets the same *effect* by rendering **the one hero line per big
  screen** (the onboarding question, the activation caption, the empty-state headline) in the hero row
  above — slightly larger Inter, tighter tracking, extra air around it. This is an app-local treatment,
  **not** the marketing `.display-hero` utility. Everything else stays in the functional ladder.
- **Tabular numerals everywhere numeric.** Reuse the existing `.tabular-nums` utility for every count,
  meter, timestamp, segment count, price, and phone number. Lock.
- **`cv11` + `ss01`** stay on `body` (already in `globals.css`). Lock.

### 2.3 Spacing — editorial whitespace on the calm surfaces

- **4px grid.** Lock.
- **Screen gutters:** 16px mobile / **24px desktop** (lock).
- **Section spacing:** raise the desktop default **24 → 32px** on calm surfaces (settings pages,
  onboarding steps, auth, empty states, contact panel). The inbox list and thread stay dense — they
  are working queues — but with clean vertical rhythm (see §3).
- **Card / panel padding:** raise toward **20–24px** on calm surfaces (settings cards, onboarding
  cards, contact panel, auth card). Inbox rows and message bubbles keep their tighter working padding.
- **One CTA per region.** Never stack two competing primary buttons; the secondary is always
  ghost/neutral and quieter.

### 2.4 Radius, borders, shadows

- `--radius: 0.625rem` (10px); pills fully rounded. Lock.
- **Border-first.** 1px `stone-200` surface edges; interior rules use the new `--border-subtle`.
- **Shadows only on true overlays** (popover / dialog / drawer / command palette) — `shadow-lg`.
  **No card shadows in the app.** Lock. (Marketing's product-frame shadow is marketing-only.)

### 2.5 Motion tokens

- **Durations:** 150ms micro (hover/focus), 200ms overlay/panel, message arrival = 200ms fade + 4px
  rise. **Easing: ease-out, no bounce, no spring.** Lock (matches DESIGN.md G2).
- **`prefers-reduced-motion: reduce` disables all** — already enforced in `globals.css` `@layer base`.
  New app animations must be authored as CSS transitions/keyframes so that rule covers them for free;
  any JS-driven motion (FLIP re-sort, undo toast) must check the media query and no-op.
- **Meaning rule (binding):** animation always equals feedback or closure — a row leaving on close, a
  message arriving, a panel sliding, a subtle FLIP re-sort. **Never decoration.** One signature calm
  micro-moment is allowed: the gentle check cascade on the setting-up screen (§4).

---

## 3. Screen-by-screen elevation

Each screen lists the specific, auditable elevations. References use DESIGN.md's G-sections and the
route/component names it defines.

### 3.1 Inbox list (G4 · `/inbox`)

The one working surface that stays **dense** — density is correct for a queue — but everything except
name + snippet recedes.

- **Row (68px) hierarchy:** contact name near-black (`600` when unread, `500` when read); snippet one
  line in `stone-500`; **time + assignee avatar + status pill all drop to `--foreground-tertiary`
  (`stone-400`).** The **unread petrol dot (8px) is the only accent allowed in a row** — no petrol on
  the name, time, or pill.
- **Row rhythm:** 12px vertical padding, `--border-subtle` (stone-100) hairline between rows so the
  list reads as one calm column, not a stack of boxes. Hover = `stone-50→stone-100` fill at 150ms, no
  border change, no shadow.
- **Status pills** lower-chroma per §2.1; Spam never in the default list (filter chip reveals it).
- **Filter bar:** the segmented `Open | Mine | All | Closed` is the right-sized control — **resist
  adding tabs.** Active segment = quiet stone pill, *not* petrol (petrol is reserved for the compose
  FAB, the one action in this region). Search field debounced 250ms, results grouped
  Conversations / Contacts.
- **Compose action = the single petrol element for the screen** (desktop: a petrol "New" button in the
  list header; mobile: the petrol FAB, DESIGN.md G3).
- **Realtime re-sort** via subtle FLIP; new row rises 4px + fades in (200ms). Opening a thread posts
  `/read` immediately and the dot + bold clear optimistically.
- **Empty states (the delight moment #1 + #2):**
  - **Brand-new inbox** = the activation magic: the company number in the **36px tabular hero
    number**, a copy button, and one warm sentence: *"This is your business number. Text it from your
    phone right now — your message will appear here."* Big-number-plus-breathing-room, exactly the
    Wealthsimple balance-screen pattern. This is the app's **one exclamation-mark-free** peak of magic.
  - **Filtered-empty** = quiet and kind: *"Nothing waiting on you."* one line, centered, generous air,
    no illustration.
- **Skeleton rows** (pulse) on first load only; realtime updates never skeleton.

### 3.2 Conversation thread + composer (G5 · `/inbox/[conversationId]`)

The thread **is** the balance-screen hero: message text is the largest, darkest thing; everything
else defers.

- **Header recedes:** contact name `500`-weight near-black; number below in 13px `stone-500`; status
  select, assignee menu, overflow all in `stone-400` chrome. No petrol in the header.
- **Messages:** inbound = white card, 1px `stone-200`, left. Outbound = `teal-50` bg / `teal-900` text
  (dark `teal-950`/`teal-100`), right. 15/16px, selectable, max-width 65% (85% mobile). **Timestamps +
  delivery state drop to `--foreground-tertiary`** under the last message of a 3-min cluster.
  - Delivery: "Sending…" → "Sent" → "Delivered" (subtle ✓, ✓✓), all in `stone-400`. **Failed = red
    text** "Not delivered — Retry" (the one place red belongs, with the fix inline). Opted-out failure
    reads "This customer opted out" instead of a raw error.
  - **Notes:** `amber-50` card, dashed border, lock icon + "Internal note" — unmistakably not SMS.
  - **Timeline events** (status changed, assigned, tagged, opt-out) = centered 12px `stone-400` system
    lines with the actor's name. Quiet by design.
- **Composer stays calm until engaged:** auto-grow 1→6 rows, toolbar icons in `stone-500`. **Send is
  the single petrol element in this region.** Cmd/Ctrl+Enter sends; Enter = newline (SMS is
  deliberate, not chat-instant). Segment meter appears at >120 chars, `12px stone-400`, amber only at
  ≥4 segments, with a **plain tooltip** ("Longer texts are sent in parts — this one's 4 parts"),
  never the word "segment" alarmingly and never "concatenation".
- **Banner-replaces-composer states = the "absorb complexity in one sentence" pattern.** One tinted
  card, one plain sentence, at most one action:
  - opted-out (red tint): *"This customer opted out of texting. Sends are blocked."*
  - US registration pending (amber): *"US texting activates once your registration is approved —
    usually 3–7 business days."*
  - past-due (amber): *"Update your payment method to send messages."* + one button.
  - usage cap (amber): owner sees "Raise cap" inline; members see "Ask your account owner."
- **New outbound / compose flow:** recipient field with live E.164 formatting (shown as
  `(416) 555-0182`, never the raw `+1…` label); consent checkbox for new contacts; quiet-hours dialog
  framed as help not alarm — *"It's 9:14 PM for this customer. Send anyway?"* (Send / Wait);
  first-message footer preview in `stone-400`.

### 3.3 Contact panel & contacts (G6 · thread panel · `/contacts`)

- **Progressive disclosure (the key move here).** The thread is the hero; contact info, consent
  history, tags, and prior conversations live in the **toggled right panel (desktop) / bottom sheet
  (mobile)** — available, not always-on chrome. The info toggle in the header opens it; preference
  persists.
- **Panel is a calm surface:** 20–24px padding, 32px between groups, quiet auto-saving fields, labels
  in `stone-500`. Consent line in plain language: *"Texted you first · Jun 3"* or *"Consent recorded
  by Sam · May 12"*. Opt-out badge + revoke where manual.
- **Danger zone is genuinely quiet:** "Opt out this contact" sits alone at the bottom, neutral until
  hovered, no red scare-styling for a routine reversible action.
- **`/contacts` table:** name, number, last activity, opted-out badge — roomy rows, tabular numbers,
  one petrol "Import" / "Add contact" action.
- **CSV import wizard = "sequence the complexity"** (Wealthsimple onboarding applied to data): **one
  focus per step** — upload → column mapping (auto-detect) → dry-run preview (per-row results) →
  summary (skipped-row reasons, downloadable). One primary action per step; the `opted_out` column's
  meaning stated in one plain sentence on the mapping step.

### 3.4 Onboarding wizard (G7 · `/onboarding/*`)

Already one-question-per-screen — **lean harder** into the Wealthsimple move.

- **One question per screen, big and friendly:** the question rendered in the **hero line** treatment
  (28–30px, tighter tracking, extra air); the "why we ask" hint in quiet `stone-500`; **a single
  petrol primary button**; back always available; progress dots small and calm; state persisted
  server-side (resumable).
- **Plan step:** two cards, feature deltas in ≤5 lines, "$29/mo" in the hero-number treatment,
  "500 outgoing texts included" in human terms. **The honest-timeline card is the emotional peak** —
  one warm sentence, no wall of compliance text: *"You'll get your number instantly. Receiving texts
  works right away. Sending to US numbers activates after carrier registration (usually 3–7 business
  days) — we handle it."*
- **Setting-up screen = delight moment #3 (the signature micro-moment):** three checklist rows animate
  pending→done via realtime Broadcast (no polling UI). "Creating your number" resolves to **the number
  in the 36px tabular hero treatment** with a copy button and a **gentle green check cascade** (the one
  allowed signature motion; reduced-motion shows the final state instantly). This screen carries **the
  app's single exclamation mark** — "Your number is ready!" — and nowhere else.
- **First inbox visit** lands on the G4 activation empty state + a dismissible quiet progress card
  (number ✓ / first inbound / first reply / teammate invited) — a checklist, never a tour.

### 3.5 Auth (`/login`, `/signup`, `/reset-password`, `/invite/[token]`)

The first taste of "calm" — must feel effortless and premium before the user has any data.

- One centered card on a stone-50 field, generous air above the form (≥15vh top), 24px card padding.
- One field group visible at a time; **one petrol button**; plain reassuring subcopy (*"We'll email
  you a link to reset it."*). Sentence case, no jargon, no legal wall — links only.
- Errors inline, one sentence, what-happened + what-to-do (*"That email or password didn't match.
  Try again."*). Never a red banner for a routine wrong-password.
- Invite-accept shows who invited you and to what workspace in one warm line before the single action.

### 3.6 Settings (G8 · `/settings/*`)

Where Wealthsimple whitespace shines — **one concern per page.**

- **Left-nav + roomy detail pages:** 32px section spacing, 24px card padding, big confident 18–24px
  section headings, each explanation **one plain sentence.** Surface the one relevant control, tuck the
  rest (progressive disclosure).
- **Usage = a "balance"-style hero:** the used/included figure in the **32–36px tabular hero number**,
  a period meter with **petrol fill → amber at 80%**, projected overage in dollars, cap control, 6-month
  history bars, and a one-sentence plain explainer of how texts are counted (no "segment" jargon).
- **Numbers:** registration state machine rendered as a **friendly stepper**
  (submitted → pending → approved), plain-language rejection + "Fix and resubmit"; DELETE is the one
  place a **typed confirmation** is required (truly irreversible).
- **Billing:** plan card; upgrade instant with a proration note; **downgrade/blocked states list
  exactly what to do** in warm language, never a raw error code; cancel copy is honest about the 30-day
  number grace.
- **Team / Notifications / Profile:** member rows with quiet role selects; per-user toggles with
  one-sentence descriptions; push permission requested **only** from here or the first-visit card (no
  browser-permission ambush); Profile holds theme (System/Light/Dark) + sign out.

---

## 4. Micro-interaction & motion language

Restrained, delightful, alive but calm — every item reduced-motion-aware via the existing
`globals.css` base rule (JS motion must additionally check the media query).

- **Hover:** 150ms ease-out fill change only (`stone-50→stone-100` on rows, tint deepen on buttons).
  No lift, no shadow, no scale, no color jump.
- **Focus:** 2px petrol ring, 2px offset (DESIGN.md G11). Instant, always visible, keyboard-path
  complete.
- **Message arrival:** 200ms fade + 4px rise; `aria-live="polite"` announces it. Jump-to-bottom pill
  ("New message ↓") only when scrolled up.
- **List re-sort:** subtle FLIP (200ms ease-out) when realtime reorders the inbox; rows glide, never
  jump or flash.
- **Row/thread close, reopen, assign, mark-spam, archive = optimistic:** the row animates out (150ms
  slide/fade), focus moves to the next item, and a **sonner undo toast** (bottom, quiet, 5s) offers
  "Undo." No modal, no spinner. This is the single biggest "feels effortless" lever.
- **Send = optimistic:** the queued outbound bubble *is* the optimism (DESIGN.md G1.6); state updates
  in place ("Sending…" → "Sent" → "Delivered").
- **Panel / sheet:** 200ms slide (right panel desktop, bottom sheet mobile), backdrop fade; ESC and
  outside-click close.
- **Toasts (sonner):** only for async outcomes not visible in place; quiet, bottom, auto-dismiss,
  one line, one optional action.
- **The one signature moment:** the setting-up green check cascade (§3.4). No confetti anywhere.
- **Reduced motion:** all of the above collapse to instant state changes; nothing is lost, only the
  in-between frames.

---

## 5. Ease — concrete "make it easy" wins

- **Fewer steps:** replace confirm dialogs with optimistic action + 5s undo for close/reopen/assign/
  mark-spam/archive. Reserve typed confirmation only for delete-number and account-level destruction.
- **One obvious next action per view:** audit every screen so exactly one petrol element says "do this
  next." Demote everything else to ghost/neutral. Default inbox view is "what needs me now" (Open/Mine);
  everything else is one tap away.
- **Plain language everywhere:** no "10DLC", "E.164", "segment concatenation", "campaign vetting"
  reaches the surface. Every system/compliance/billing state = one warm sentence + at most one action.
- **Forgiving inputs:** phone field accepts any format and formats to `(416) 555-0182` live (E.164
  under the hood); area-code picker accepts a city name or a code; CSV import auto-detects columns and
  previews before committing; textareas auto-save.
- **Great empty states:** activation number reveal, "Nothing waiting on you.", one-human-line +
  one-petrol-button for contacts/templates. No generic "No data," no stock illustration.
- **Great loading states:** skeletons over spinners, < 100ms, first-load only; realtime updates never
  skeleton; every async state named honestly ("Creating your number", not a bare spinner).
- **Great error states:** what-happened + what-to-do in one sentence; retry inline where eligible;
  never a raw code, never a dead end.
- **Keyboard (desktop, optional + discoverable):** Command-K palette (cmdk) with the shortcut shown
  beside each row; J/K list navigation + Enter-to-open; E to close/archive; Cmd/Ctrl+Enter to send.
  **Strictly optional, invisible on mobile** — no keyboard-cult tax on the phone-first tradesperson.
- **Mobile ergonomics:** every flow one-handed on 375px; hit targets ≥44px (reuse `.tap-target`);
  16px message input to prevent iOS zoom; bottom tab bar + safe-area padding; compose FAB above the tab
  bar; PWA installable for the truck.

---

## 6. Guardrails

- **Fast:** no new animation libraries, no scroll-cinema, no canvas/WebGL, no blocking transitions.
  Motion is CSS transitions/keyframes + the existing FLIP; the reduced-motion base rule covers it.
  Keep list + thread virtualization (`@tanstack/react-virtual`), skeletons < 100ms, route-level code
  splitting, lazy blur-up images. The UI must never make a tradesperson wait.
- **Accessible (WCAG 2.1 AA):** 4.5:1 text contrast including petrol-on-tint verified in both themes;
  the new `--foreground-tertiary` (stone-400) is for *non-essential* meta only and must still clear
  4.5:1 on its background — verify stone-400 on white/stone-50 and bump to stone-500 anywhere it
  carries essential meaning. Visible 2px petrol focus rings; full keyboard path inbox → thread →
  composer; `aria-live=polite` incoming messages; labels on every input; screen-reader text for
  delivery states; reduced-motion honored.
- **On-brand:** petrol `#0F766E` + warm stone + Inter only. No second chromatic accent, no rainbow
  status coding (tinted pills are the ceiling), no gradient/glass/shadow decoration in the app. Do not
  import the marketing `.display-*` / `.marketing-glow` / `[data-reveal]` utilities into app screens —
  they are a different surface.
- **Honest:** every async state visible, named, truthful; no dark patterns; billing/downgrade/cancel
  copy states exactly what happens and what to do; no fake progress, no mystery spinners.
- **Right for tradespeople:** approachable, never intimidating, never designer-precious. Take
  Wealthsimple's smoothness and restraint; drop the Apple-elitism, the mandatory-keyboard religion, the
  high-touch onboarding drills, and the dense/dark developer aesthetic. Big poster type and real
  delight appear only at the three emotional moments; everywhere else is calm, plain, and quick.

---

## Sources (Wealthsimple + adjacent calm-app craft, verified 2026)

- Wealthsimple 2024 app redesign — three-tab split to reduce psychological friction, upfront
  hierarchy: https://product-news.wealthsimple.com/meet-our-re-designed-wealthsimple-app-appui
- Mobbin — white + "Dune" `#32302F` warm-near-black duo, color restraint:
  https://mobbin.com/colors/brand/wealthsimple
- ColorFYI — Dune `#32302F` as the single official brand color: https://colorfyi.com/brands/wealthsimple/
- Wealthsimple magazine — the "Human / Warm / Simple" rebrand brief, Caslon + Futura:
  https://www.wealthsimple.com/en-ca/magazine/new-wealthsimple-15
- Fabric (Wealthsimple design system) — bold+normal heading weights, four body sizes xs/sm/md/lg:
  https://fabric.wealthsimple.com/typography/
- Prabhjot Bains — reverse-engineered content voice ("natural and friendly, direct and clear,
  customer-focused", steps under ~3 lines):
  https://medium.com/@prabhjotbains96_67515/i-reverse-engineered-a-style-guide-for-wealthsimple-heres-what-i-learned-7e5dd5948049
- Finder 2026 review — "2–3 taps", no learning curve, consolidated simple dashboard:
  https://www.finder.com/ca/stock-trading/wealthsimple-review
- App Store — "UI is so much less intimidating than other options": https://apps.apple.com/ca/app/wealthsimple/id1403491709
- Adjacent calm-app craft (color restraint, optimistic+undo, progressive disclosure, one-earned-delight):
  Mercury, Linear, Superhuman, Copilot Money / Monarch, Notion Calendar, Stripe Dashboard — teardowns
  and reviews per the research brief.
