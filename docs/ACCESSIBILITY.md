# Accessibility conformance statement

**Status: CURRENT DIRECTION (#238).** A customer-facing statement of what
is verified and what is not. The verified table is generated from nothing —
it is maintained by hand — but every row names a test, and
`accessibility-statement.test.ts` fails if a named test stops existing.

**Standard:** WCAG 2.2 Level AA
**Applies to:** the Loonext web application, and the Android and iOS apps where stated
**Last verified:** 2026-08-14
**Basis:** `docs/APP-LAYOUT-V2.md` §7, `docs/APP-UI-ELEVATION.md` §6

This document exists to be handed to a buyer who asks (#285). Everything in it
is either **enforced by a test named below** or listed as **not yet verified**.
There is no third category, and nothing here is claimed because it is probably
true.

That is the point. A conformance statement written from a specification
describes what somebody intended; this one describes what a build fails over.
If a claim in the "verified" table stops being true, the named test goes red
and this document is wrong in a way somebody finds out about.

---

## What a buyer is usually asking

**"Is it accessible?"** is four questions. Answering them separately is more
useful than a single letter grade:

1. Can somebody who cannot see the screen use it? — screen reader support
2. Can somebody who cannot use a mouse use it? — keyboard and pointer
3. Can somebody who cannot see it *well* use it? — contrast, text size, motion
4. Can you prove any of it? — the column that is usually empty

---

## Verified mechanically

Each row fails a build if it stops being true. This is the whole table; there
is nothing verified that is not here.

| Criterion | What holds | Enforced by |
|---|---|---|
| **1.4.3** Contrast (Minimum) | Text token pairs recomputed from the actual hex values in `globals.css`, in **both** themes | `apps/web/src/app/globals.contrast.test.ts` |
| **1.4.3** Contrast, rendered | Rendered text measured against its actual background on real pages, both themes | `scripts/theme-audit.mjs` (CI) |
| **2.3.3** Animation from Interactions | One base rule zeroes motion under `prefers-reduced-motion`; the rule cannot be weakened or deleted | `apps/web/src/app/reduced-motion.test.ts` |
| **2.5.7** Dragging Movements | Every file that starts a drag records the code implementing its single-pointer alternative — on **all three** clients | `apps/web/src/app/dragging-alternatives.test.ts`, `scripts/check-gesture-alternatives.mjs` |
| **2.4.7** Focus Visible | Every control reached by pressing `Tab` has an outline or a ring, measured on the rendered page in both themes | `scripts/theme-audit.mjs` (CI), `apps/web/src/app/focus-appearance.test.ts` |
| **1.4.11** Non-text Contrast — focus | That indicator clears 3:1 against the surface behind it, with its alpha composited rather than assumed away | `scripts/theme-audit.mjs` (CI), `apps/web/src/app/focus-appearance.test.ts` |
| **2.4.11** Focus Not Obscured (Minimum) | The focused control is not entirely covered by a sticky header or overlay, sampled from the compositor rather than computed from rectangles | `scripts/theme-audit.mjs` (CI), `apps/web/src/app/focus-appearance.test.ts` |
| **2.5.8** Target Size (Minimum) | Interactive targets measured at 375px against 2.5.8's 24px floor; `.tap-target` (44px) credited above it | `scripts/theme-audit.mjs` (CI) |
| **4.1.2** Name, Role, Value — names | Interactive elements have an accessible name, computed the way an AT computes it | `scripts/theme-audit.mjs` (CI) |
| **4.1.2** Name, Role, Value — roles | `role="tab"` carries `aria-selected`; `role="tablist"` contains real tabs; `aria-live` states its politeness | `apps/web/src/app/layout-v2-roles.test.ts` |
| **4.1.3** Status Messages | Incoming messages announce politely; the composer's send state is announced rather than only styled | `apps/web/src/app/layout-v2-roles.test.ts` |

Every one of these guards has been **proven by breaking it** — the rule was
removed from the product, the test observed to fail, and the removal reverted.
A guard that has only ever passed is not evidence.

---

## Specified, implemented, not yet mechanically verified

These are real and were built deliberately. They are in this section rather
than the one above because no build fails when they regress, which means we
cannot promise they still hold on any given day.

| Criterion | What is specified | Why it is not in the table above |
|---|---|---|
| **2.1.1** Keyboard | A complete path — rail → list → thread → composer → panel — with focus never trapped in a scroll region, and `Tab` order following visual order across panes (§7) | Partly verified, and the honest split is worth stating: the walk in `theme-audit.mjs` does press `Tab` through each surface, so a focus TRAP now fails a build. Whether the order it visits matches the *visual* order is a judgement about layout that nothing mechanical makes. |
| **2.4.13** Focus Appearance | Visible focus throughout (§7) | AAA, and it adds minimum-area and enclosure rules on top of the 3:1 the row above verifies. Contrast is measured; area is not, so the criterion is not claimed. |
| **1.4.10** Reflow | Designed at 375px; one-handed throughout; 16px message field to defeat iOS zoom (§7) | No mechanical reflow check at 320px/400% yet. |
| **1.1.1** Non-text Content | Alt text on every gallery thumbnail; timeline events are readable text, not icon-only (§7) | Presence of alt text is checked; whether it is *useful* is not machine-decidable. |

---

## Not verified — native apps

**§7 is a web-shell document.** It does not cover Android or iOS, and no
equivalent specification exists for them. What we can state factually today,
from the source:

| Point | Android | iOS |
|---|---|---|
| Icon-only controls with no accessible name | **None**, and enforced — `scripts/check-screen-reader-names.mjs` | **None**, and enforced — `scripts/check-screen-reader-names.mjs` |
| A layout that survives the reader's largest text setting | **Rendered at 200% and fixed** — `DashboardScreenshotTest.the panels at 200 percent font scale` writes a PNG on every run | **Not rendered.** The same two defects were fixed on the same evidence, because the frames were the identical 104 and 28 points — but no iOS render exists on this machine |
| Text sizes are declared in a scaling unit | **Yes**, and enforced — `scripts/check-native-a11y.mjs` | **Yes**, and enforced — `scripts/check-native-a11y.mjs` |

### The iOS row above used to say "Partly", and the number in it was wrong

Until 2026-08-04 this table reported that 225 semantic text styles scaled and
134 fixed-point `.system(size:)` call sites were unconfirmed. Both halves were
wrong, in the direction that flattered us.

`Font.custom(_:size:)` does not scale with Dynamic Type either — only its
`relativeTo:` overload does — and the brand kit (`Font.golos`, `Font.display`)
was built on the bare form. The string `relativeTo:` appeared **nowhere** in the
iOS app. The real exposure was **723** non-scaling call sites, not 134.

That is the exact failure this document exists to prevent: a claim derived from
a specification and a one-off scan, published to buyers, with nothing that fails
when it stops being true. A hand scan is a photograph and it goes stale on the
next commit. It is now a build step, which is why the row cites a path.

**What the guard proves, and what it does not.** It proves the *mechanism*:
every font on both phones is declared in a unit that carries the reader's font
scale. It does not prove the *outcome* — that a screen still works at 200%, with
nothing clipped, truncated or pushed off. That needs a device and a person.

**No TalkBack or VoiceOver pass has been performed**, on any flow. Nobody has
sat down with either screen reader and worked through sending a message,
answering a call, or completing a job. Until that happens, the correct answer
to "do the phone apps work with a screen reader" is *we do not know* — and the
labelling scan above is evidence that the groundwork is there, not evidence
that the flows work.

**Dynamic Type to 200% has not been visually tested on iOS.** Since 2026-08-04
the text does scale rather than ignoring the setting, which is a precondition
for that test rather than a substitute for it.

---

## Known gaps

Stated plainly, because a buyer who finds one of these themselves stops
believing the rest of the document.

- **The thread panel's resize handle** offers arrow-key resizing and a
  double-click reset. The double-click is the single-pointer path but reaches
  only one width; an arbitrary width without dragging is keyboard-only.
- **No third-party audit** has been carried out. Everything here is
  first-party, which is exactly why each claim names the test behind it.
- **Native screen-reader flows are untested end to end.** Every icon-only
  control now has a name and a build fails if one loses it — but a name is
  necessary and nowhere near sufficient. Reading ORDER, whether a live region
  speaks at the right moment, whether a custom control exposes the right role
  and state, and whether a whole flow can be driven by TalkBack or VoiceOver
  all need a person with a phone. None of that is claimed.
- **iOS is not rendered anywhere.** Android's layout at 200% text is a picture
  produced on every test run; iOS has no equivalent on this machine, so its
  matching fix rests on the two apps having had identical measurements rather
  than on a second picture.

---

## How to keep this document true

Add a row to the verified table **only** when a named test enforces it, and
only after that test has been proven by breaking it. Moving a row up from
"specified" to "verified" without a test is the failure this file was written
to stop: #238 exists because a detailed, binding accessibility specification
was enforced by nothing but memory.

`apps/web/src/app/accessibility-statement.test.ts` checks that every test named
in the verified table still exists. It cannot check that a test is *good* —
only that a claim here has not outlived the file it points at.
