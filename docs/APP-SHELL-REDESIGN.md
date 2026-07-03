# JobText App Shell Redesign (BINDING)

The app reads as bland and ugly, and the left text-sidebar is the worst of it. This resets the
app's look toward modern and crafted, and replaces the sidebar. Supersedes the sidebar/shell parts
of APP-LAYOUT-V2 and the flattest parts of APP-UI-ELEVATION. The information architecture and
product behavior stay; the look and the navigation change. This is the APP only; marketing has its
own identity. Keep the petrol brand and warm-stone base, but execute with real craft. No em-dashes
anywhere.

## 0. The core recalibration

The Wealthsimple-restraint pass went too flat: border-only surfaces, no depth, a plain text
sidebar. Flat and empty is not the same as calm and premium. The new bar is Linear / Height /
Superhuman / Campsite: precise spacing, considered color, tasteful depth, beautiful states, and
micro-interactions. Calm still, but crafted, not bare.

## 1. Kill the left sidebar. Primary nav moves to a refined top bar.

Explored alternatives: wide text sidebar (out), slim icon rail (still a sidebar), top bar,
command-first. Decision: a single refined TOP BAR holds global navigation, so the left edge is
freed for the actual work.

Top bar (h ~56px, sticky, a real surface not a hairline):
- Left: the JobText mark, then a compact workspace/company control if multi-company.
- Center-left: the primary surfaces as understated segmented tabs: For You, Inbox, Tasks,
  Contacts. The active tab gets the one crafted accent moment (a soft petrol underline or a filled
  pill with a subtle inset), not a flat block.
- Center/right: a prominent search field (the existing global search + command-K), inviting, not a
  tiny icon.
- Right: a compose action, the notifications bell, and the user avatar menu (settings, theme, sign
  out). Compact, balanced, beautiful.
- Mobile: keep the bottom tab bar (it is the right pattern on phones); the top bar collapses to the
  mark + search + avatar.

Below the top bar the content owns the full width: Inbox is (list | thread | optional context),
Tasks/Contacts are full-surface. No global left nav column. The build renders this and confirms it
reads better than a minimal icon rail; bias to the top bar per the brief, but if the render shows
the top bar cramps the inbox, a beautifully crafted 60px icon rail is the sanctioned fallback (not
a text sidebar).

## 2. Aesthetic elevation (fix "extremely ugly")

Apply across the app, tastefully:
- Depth: introduce soft, layered elevation on panels, cards, popovers, and the thread composer
  (a subtle shadow plus a hairline, not heavy). Surfaces should feel like surfaces, not flat paper.
- Surface + color: move off dead-flat stone. A very subtle warm-to-cool wash or a whisper of
  texture on the app background, tinted panels, crisp considered dividers. Spend one confident
  petrol moment per view (the active nav, the primary action), rationed.
- States: beautiful hover, active, focus, selected, and loading states with 150 to 200ms
  ease-out micro-interactions (respect reduced motion). The selected conversation, the active tab,
  a pressed button should feel alive and precise.
- Type + rhythm: tighten the type scale and vertical rhythm; confident hierarchy from weight and
  size; generous but purposeful spacing. Numbers in a tabular face where they matter. The app
  typeface is Golos Text (uncommon, UI-grade, self-hosted via next/font/local, variable wght
  100-900, tabular figures), replacing Inter everywhere in the app. It is NOT Inter and NOT the
  marketing display face; the source woff2 was fetched from Google Fonts OFL (golostext) and is
  staged for the build.
- Iconography: one cohesive, beautiful icon set, consistent weight and size, aligned to the grid.
- The inbox list, thread bubbles, contact panel, tasks, and settings all get the same crafted
  treatment so nothing looks like a wireframe.
- Dark mode gets equal craft (real dark surfaces with depth, not inverted flatness).

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
