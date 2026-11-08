# Accessibility conformance statement

**Status: CURRENT DIRECTION (#238).** A customer-facing statement of what
is verified and what is not. The verified table is generated from nothing —
it is maintained by hand — but every row names a test, and
`accessibility-statement.test.ts` fails if a named test stops existing.

**Standard:** WCAG 2.2 Level AA
**Applies to:** the Loonext web application, and the Android and iOS apps where stated
**Last verified:** 2026-11-07
**Basis:** `docs/APP-LAYOUT-V2.md` §7 (the canonical product contract)

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
| **2.5.3** Label in Name | Every control's accessible name contains the words it shows, in order, so a voice-control user can say what they see. Card rows are a link on their title stretched over the card, and initials are drawn by CSS like a photo | `scripts/check-app-a11y.mjs` (CI) |
| **4.1.2** Name, Role, Value — names | Interactive elements have an accessible name, computed the way an AT computes it | `scripts/theme-audit.mjs` (CI) |
| **4.1.2** Name, Role, Value — roles | `role="tab"` carries `aria-selected`; `role="tablist"` contains real tabs; `aria-live` states its politeness | `apps/web/src/app/layout-v2-roles.test.ts` |
| **4.1.3** Status Messages | Incoming messages announce politely; the composer's send state is announced rather than only styled | `apps/web/src/app/layout-v2-roles.test.ts` |
| **3.1.1** Language of Page | The document's `lang` follows the READER's own setting rather than the build's, so a screen reader speaks French with a French voice instead of an English one | `apps/web/src/i18n/document-language.test.tsx` |
| **1.3.5** Identify Input Purpose | Every field in sign-in, sign-up, onboarding, brand registration and profile that collects the person's own details names its `autocomplete` purpose with a registered token, or says `off` on purpose | `apps/web/src/app/wcag22-new-criteria.test.ts` |
| **3.3.8** Accessible Authentication (Minimum) | Nothing on the sign-in surface blocks paste, copy or drop; every password field says whether it is new or existing and every code field is `one-time-code`, so a password manager or the phone does the remembering | `apps/web/src/app/wcag22-new-criteria.test.ts` |
| **3.2.6** Consistent Help | Every signed-out screen shows the same help link in the same slot, because it is rendered by the auth layout and not by each page; the signed-in and marketing help routes are pinned where their screens expect them | `apps/web/src/app/wcag22-new-criteria.test.ts` |
| **1.4.10** Reflow | Every public page, in English and in French, fits a 320px viewport without the page scrolling sideways; text fields are 16px at phone widths so Mobile Safari does not zoom on focus | `scripts/check-app-a11y.mjs` (CI)  |

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
| **3.3.7** Redundant Entry | A multi-step flow shows an earlier answer back, prefilled, instead of asking again; confirming a new password is the criterion's own exception (§7) | Whether a flow re-asks a question is a judgement about that flow's content. `wcag22-new-criteria.test.ts` fixes the mechanism that makes prefilling work (named autocomplete purposes), not the flow design. |
| **1.1.1** Non-text Content | Alt text on every gallery thumbnail; timeline events are readable text, not icon-only (§7) | Presence of alt text is checked; whether it is *useful* is not machine-decidable. |

---

## Not verified — native apps

**§7 is a web-shell document.** The evidence table below and the manual protocol
that follows are the native verification contract. They do not turn an unperformed
TalkBack or VoiceOver pass into evidence. What we can state factually today:

| Point | Android | iOS |
|---|---|---|
| Icon-only controls with no accessible name | **None**, and enforced — `scripts/check-screen-reader-names.mjs` | **None**, and enforced — `scripts/check-screen-reader-names.mjs` |
| Large-text render coverage | **Yes** — `AccessibilityAuditTest` runs every primary-flow surface (sign in, sign up, reset, inbox, thread, composer, ringing, in-call, tasks, settings) at 100% and at Android's largest 200%, writes each 200% surface to `build/screenshots/a11y-*-fontscale2.png`, and fails on clipped text, a control off the screen or squeezed to nothing, and every other audit check at that size; `DashboardScreenshotTest` covers `LeadSourcesCard` at 200% | **Partial** — `DashboardScreenshotTests.testRepresentativeDashboardInBothThemesAndTextSizes` renders the full For You dashboard in both themes at `.accessibility5`, keeps paginated PNG attachments, and asserts that the large-text layout materially grows; it is not a primary-flow pass |
| Text sizes are declared in a scaling unit | **Yes**, and enforced — `scripts/check-native-a11y.mjs` | **Yes**, and enforced — `scripts/check-native-a11y.mjs` |
| In-app language attached to native accessibility content | **Yes, mechanically** — the Compose accessibility provider adds the resolved locale as `LocaleSpan` metadata while preserving node semantics and explicit per-content language spans; `AccessibilityLanguageTest` | **Yes, mechanically** — the app root publishes the resolved locale through SwiftUI's native `locale` environment above the lock gate; `AccessibilityLanguageTests` |
| The primary flows through the platform's own accessibility checks | **Yes, mechanically** — `apps/android/app/src/test/kotlin/com/loonext/android/a11y/AccessibilityAuditTest.kt` (details below) | **Yes, mechanically** — `apps/ios/LoonextUITests/AccessibilityAuditUITests.swift` runs `performAccessibilityAudit()` (details below) |

### What the automated audits cover, and what they are not

Since #238 each phone audits its primary flows on every build, with fixture data
behind the real views: sign in, sign up and password reset; the inbox list and
its filters; a thread with its composer; the call controls; a task list;
settings. Android runs each one at the default text size and again at 200%.

| | Android | iOS |
|---|---|---|
| What runs | The semantics tree Compose hands TalkBack, drawn under Robolectric. The questions are the Accessibility Test Framework's, asked by `apps/android/app/src/test/kotlin/com/loonext/android/a11y/SemanticsAudit.kt` | Apple's `performAccessibilityAudit()` on an iOS simulator, in the `Gate / iOS` job |
| Why not the stock tool | ATF's `enableAccessibilityChecks()` is in this Compose but cannot see Compose under Robolectric: it visited five Views, ran no check and reported green on the sign-in screen, where the real audit then found nine. `apps/android/app/src/test/kotlin/com/loonext/android/a11y/AtfRobolectricCanaryTest.kt` fails the day that stops being true | It is the stock tool |
| Fails the build | At both text sizes: a control with no name; a target under the product's 44dp (WCAG 2.5.5), measured on the laid-out box, which `ui/common/TouchTarget.kt`'s `touchTarget()` grows to 48dp around a control drawn smaller; a control off the screen or laid out with no room; text under WCAG 1.4.3, measured from the colour drawn and the pixels behind it; text cut off without an ellipsis; the status filter not saying which one is selected | Contrast, hit region, an element the OS cannot detect, a label that is not human-readable, a wrong trait; the first four again at the largest accessibility text size |
| Reported, not failed | Nothing | `dynamicType` and `textClipped`: the first flags small captions that do scale (through `relativeTo:`, which `scripts/check-native-a11y.mjs` enforces), the second one-line previews that truncate by design |
| Beyond these screens | `apps/android/app/src/test/kotlin/com/loonext/android/a11y/TextColorLintTest.kt` fails if any source file colours text with the theme's border grey | `scripts/check-screen-reader-names.mjs` |

What the audits found and the build now keeps fixed:

- **Android**: three form fields with no name (the label above them was a separate
  text), a show-password control that was a 16dp image, a Google mark read aloud as
  "G", a filter that did not say which one was on, a Retry control
  22dp tall, and text coloured with the border grey on 23 call sites (about 2:1 on
  paper; section blurbs, hints, the legal line, the day divider).
- **iOS**: Settings icons that VoiceOver would have read as symbol names
  ("person.2"), text-only controls whose tappable area was the glyphs (the links on
  the sign-in screens, Decline, the Text/Note switch, a tappable timeline line),
  a Retry control well under the hit-region floor, and an unlabelled password field.

Four iOS findings are exempted in `AccessibilityAuditUITests.swift`, each with its
reason beside it: contrast on a control that is switched off (WCAG exempts it),
contrast on the keypad's thin "*" glyph (ink on paper, about 16:1), and the hit
region of the password field, which SwiftUI's `SecureField` reports as its text
line while an email field of identical geometry passes, and text the OS reports
without being able to say which element it is (nothing to act on). The password field was
made to fill its row; whether a tap in the padding lands there is worth trying
on a device.

These are the checks a tool can make. They do not speak. Reading order, the
wording a user hears, whether a live region announces at the right moment, whether
a custom control exposes the right role and value, French pronunciation, and
whether someone can finish a flow eyes-closed on a physical device still need a
person with TalkBack and VoiceOver, which is the protocol below.

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
scale. Android renders and audits the primary flows (sending a message,
answering a call, completing a task, and the rest of the audit's surfaces) at
200%; iOS covers the For You dashboard at `.accessibility5` in both themes and
re-audits its flows at the largest size, but renders no primary flow.

**No TalkBack or VoiceOver pass has been performed**, on any flow. Nobody has
sat down with either screen reader and worked through sending a message,
answering a call, or completing a job. Until that happens, the correct answer
to "do the phone apps work with a screen reader" is *we do not know* — and the
labelling scan above is evidence that the groundwork is there, not evidence
that the flows work.

**iOS now has a large-text visual render for the For You dashboard.** Since
`5abac13d`, the iOS simulator renders it at `.accessibility5` in light and dark
themes and uploads every viewport as a CI attachment. No large-text render or
walkthrough exists for the messaging, inbound-call, or task-completion flows.

### Native manual evidence required for closure

A native pass is evidence only when its record contains all of the following:

1. The git SHA/app build, client, OS version, physical device model, assistive
   technology/version, tester and date. Emulator/simulator screenshots may
   supplement the record, but do not count as the TalkBack or VoiceOver pass.
2. The app locale, device locale and text-size setting. Each client must include
   English on an English device and in-app `fr-CA` on an English device, because
   pronunciation must follow the reader's app setting rather than happen to match
   the phone.
3. These three primary flows, completed on the physical device with the screen
   reader enabled and without looking at the screen: send a message from the
   inbox, answer and decline an inbound call, and complete a task.
4. For every flow: the focus/reading order, each control's name/role/state, all
   required actions, focus after state changes, incoming/status announcements,
   and French pronunciation.
5. The same three flows at the platform's largest supported text setting, with
   screenshots or a recording covering clipping, truncation and controls pushed
   off screen.
6. Every failure filed separately and linked from the record. A skipped step is
   `not run`, never a pass. Store the completed record under
   `docs/accessibility-runs/YYYY-MM-DD-<client>.md` so the result names the build
   it actually tested.

No record matching this protocol exists yet.

---

## Known gaps

Stated plainly, because a buyer who finds one of these themselves stops
believing the rest of the document.

- **No third-party audit** has been carried out. Everything here is
  first-party, which is exactly why each claim names the test behind it.
- **Native screen-reader flows are untested end to end.** Every icon-only
  control now has a name and a build fails if one loses it, and each phone's
  primary flows run through the platform's accessibility audit on every build —
  but a name is necessary and nowhere near sufficient, and an audit does not
  speak. Reading ORDER, whether a live region
  speaks at the right moment, whether a custom control exposes the right role
  and state, and whether a whole flow can be driven by TalkBack or VoiceOver
  all need a person with a phone. None of that is claimed.
- **Large-text render coverage is complete on Android only.** Android renders
  and audits the three primary flows in the protocol above at 200%, and fails
  on text cut off or a control pushed out. iOS covers the For You dashboard at
  `.accessibility5` in both themes, and its audit re-runs the main flows at the
  largest accessibility size for hit regions and unreadable elements, but it
  renders no primary flow, and its `dynamicType`/`textClipped` findings are
  logged for a person to read, not enforced.
- **Native spoken language remains unverified.** Android now attaches the resolved
  in-app locale to the text, labels, values and hints exposed by Compose as Android's
  `LocaleSpan` metadata; iOS publishes the same resolved value through SwiftUI's
  native `locale` environment at the app root. Tests enforce both mechanisms and
  preserve explicit per-content language metadata. They do not prove that TalkBack
  or VoiceOver selects the right voice or pronounces every French phrase correctly;
  no physical-device pass has measured that outcome.

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
