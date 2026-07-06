# Loonext App Shell Redesign (BINDING)

The app reads as bland and ugly, and the left text-sidebar is the worst of it. This resets the
app's look toward modern and crafted, and replaces the sidebar. Supersedes the sidebar/shell parts
of APP-LAYOUT-V2 and the flattest parts of APP-UI-ELEVATION. The information architecture and
product behavior stay; the look and the navigation change. This is the APP only; marketing has its
own identity. Keep the petrol brand and warm-stone base, but execute with real craft. No em-dashes
anywhere.

## 0. The core recalibration (REVISED: calm, not elevated)

Two failed passes bound the target. Pass one was flat and bland (border-only, no craft), which read
as unfinished. Pass two over-corrected into raised cards and shadows everywhere, which read as heavy
and cluttered. Neither is Wealthsimple. The real target is CALM: generous whitespace, quiet
restraint, hairlines instead of cards, near-zero shadow, few things on screen, refined type and
spacing. The craft lives in the spacing rhythm, the type hierarchy, and the restraint, NOT in depth
or decoration. Sleek, clean, calm. When in doubt, remove. Reference: the calm mockup
(scratchpad/shell-mockup-calm.html, Artifact calm-v1).

## 1. A calm left sidebar (REVISED: sidebar with visuals, not a top bar)

The user prefers a sidebar to the top bar, done well: with icons and visuals, calm and clean, not
the bare-text version that was rejected. So the global nav is a left SIDEBAR. Reference: the sidebar
mockup (scratchpad/shell-mockup-sidebar.html, Artifact sidebar-v1).

Sidebar (~230px, white, a single hairline right border, NO shadow):
- Top: a company/workspace switcher tile (a small petrol logo tile + company name + plan, a
  double-chevron); on hover a whisper-grey fill.
- A prominent petrol "New message" compose button.
- Primary nav as icon + label rows: For you, Inbox, Tasks, Contacts. Each has a calm line icon, a
  label, and a right-aligned count or unread dot where it earns it. Active = a soft petrol-tint fill
  with petrol-deep text and icon (not a heavy block); hover = whisper grey. Generous padding.
- A quiet "Shortcuts" group below (Saved replies, Numbers), smaller and muted.
- Pinned to the bottom: the user tile (avatar + name + role) opening the account menu (settings,
  theme, sign out).
Everything calm: hairlines, whitespace, one rationed petrol accent (the active item + compose), no
shadows, flat single-tone avatars.

To the right of the sidebar: Inbox is (list | thread | optional context); the list gets a slim
header (search + the All/Unread/Mine segment); Tasks, Contacts, For-you are full surfaces with their
own calm headers. Global search stays reachable (the list search + command-K). Mobile: the sidebar
collapses to a bottom tab bar with the same icons; compose is a FAB. The prior top-bar shell is
retired; the top-bar components built earlier are repurposed or removed.

## 2. Calm surface treatment (REVISED: remove the shadows and the clutter)

The reference is the calm mockup (scratchpad/shell-mockup-calm.html). Apply across the app:
- No shadows. Remove the raised/elevated look entirely. Surfaces are separated by generous
  whitespace and a single 1px hairline, not by drop shadows or lifted cards. At most one
  barely-there shadow on a true floating layer (a menu, the detail drawer), never on rows, panels,
  bubbles, or the composer.
- Whitespace first. Generous padding and row height, calm gaps, a confident measure. The list
  breathes: clean rows with air between them, no per-row card or border. Fewer elements per screen.
- De-clutter. Drop decorative chips and busy tags from the default view; show one piece of metadata
  where it earns its place. Lighten every divider to a hairline. Flat single-tone avatars (a soft
  tint, not gradients).
- Quiet color. A near-white warm ground, white surfaces, one rationed petrol accent (the active
  tab, the primary button, the selected row as a soft petrol tint). No gradients, no petrol-tinted
  shadows.
- States are subtle tints, not lifts. Selected = a soft petrol-tint fill; hover = a whisper of warm
  grey. Calm ~150ms transitions, reduced-motion safe.
- Type + rhythm carry it. Golos Text (self-hosted, latin-subset woff2 via next/font/local, variable
  wght, tabular figures) with a clear, calm hierarchy from size and weight; this is where the
  crafted feeling comes from, not decoration. Golos replaces Inter everywhere in the app.
- Bubbles are flat: inbound white with a hairline, outbound solid petrol, no shadow, generous
  spacing. The composer is a clean bordered field, no shadow.
- Same calm treatment across inbox, thread, contacts, tasks, settings, so nothing is heavy and
  nothing is a wireframe. Dark mode mirrors it with calm dark surfaces and hairlines, no glow.

## 3. Guardrails

- Fast: no heavy libraries for the look; CSS and the existing primitives. Keep the app quick.
- Accessible: AA contrast, visible focus rings, 44px mobile targets, keyboard paths, reduced
  motion.
- On brand: petrol and warm-stone stay the anchor; the marketing identity does not leak into the
  app (the app uses Golos Text, never Inter and never the marketing display font, no marker
  language).
- Behavior preserved: realtime, filters, the composer, done, tasks, everything keeps working.

## 4. Build + validation

A serialized app-scope wave, after the marketing rework commits. Order: (a) render a quick
exploration of the top-bar shell (and the icon-rail fallback) with the real seeded app, screenshot,
lock the nav; (b) rebuild the shell to the locked nav; (c) apply the aesthetic elevation across
inbox, thread, contacts, tasks, settings; (d) design-QA on the running seeded app against a hard
bar: "would a design director at Linear or Height ship this, is it modern and beautiful, is the
old sidebar gone." Then surface screenshots for a look before it is called done. Quality floor and
green bar as always.
