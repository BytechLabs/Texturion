# JobText Marketing — Art & Frame Inventory

**Status: reference for placement tracks.** This lists every reusable visual component in
`apps/web/src/components/marketing/frame/**` (device frames + texture/depth) and
`apps/web/src/components/marketing/art/**` (SVG spot illustrations + infographics), with its
intended use, prop API, and theming/motion notes. Built to VISUALS §1B/§1C/§1D/§4 and the
DESIGN.md brand tokens. All components are themeable (light/dark), reduced-motion safe, and
zero-CLS. Import everything from the two barrels:

```ts
import { BrowserFrame, PhoneFrame, GlowFrame, Texture, GradientMesh } from "@/components/marketing/frame";
import {
  OneNumberManyPeople, FieldWorkerTruck, CarrierPaperworkShield, CanadaMotif,
  TextBecomesTask, MissedCallToText,
  MissedTextMoney, FirstWeekTimeline, HowItWorksFlow, CoverageMapNA, FlatVsPerSeatChart,
  ArtReveal,
} from "@/components/marketing/art";
```

---

## Visual grammar (what makes the set cohesive)

Every illustration and infographic imports one shared grammar (`art/grammar.ts`) instead of
picking values ad hoc, so the whole system reads as one hand:

- **Stroke:** `1.75` everywhere (matches the app's lucide icons, DESIGN.md G2).
- **Radius:** `10px` app language (`RADIUS`), `6px` for small motifs (`RADIUS_SM`).
- **Color depth (bounded 2–3 tones):** petrol accent + a stone line ink + a faint stone fill,
  plus **amber reserved only for honesty/wait accents** (the timeline wait, the missed-call dot).
  Nothing else.
- **Theming:** each SVG paints with `var(--art-*)` custom properties installed by `<ArtRoot>`
  (`ART_VARS`), defaulting to the light palette and overridden under `.dark` — so **one set of
  SVGs is correct in both themes** with zero per-instance color props. Petrol = teal-700 (light)
  / teal-400–500 (dark); line/fill = stone; amber = the app's registration-banner accent.
- **Motion:** static/final-frame by default (LCP-safe, SSR-correct). Opt into the once-on-scroll
  reveal (VISUALS §2: 300ms rise-in, reduced-motion shows the final frame) by wrapping in
  `<ArtReveal>`.
- **Accessibility:** pass `title` for an accessible name (`role="img"` + `<title>`); omit it to
  mark the art decorative (`aria-hidden`). Infographics default to a descriptive `title` because
  they carry real information; spot illustrations default to decorative.

Shared shells (for authors, not usually placed directly):
`ArtRoot` (the themed `<svg>` wrapper), `ArtReveal` (motion wrapper over the existing `<Reveal>`),
and `grammar.ts` (`STROKE`, `RADIUS`, `RADIUS_SM`, `ink`, `ART_VARS`, `ArtProps`).

---

## Frame primitives — `frame/**`

Device chrome and background depth for framing screenshots AND live-DOM product renders alike.

| Component | Intended use | Key props |
|---|---|---|
| **`BrowserFrame`** | Desktop screenshots + live-DOM inbox/thread renders. Minimal stone browser chrome, **petrol leftmost dot**, `jobtext.app/inbox` URL slot ("it's just the web"). Feature heroes, bento tiles, deep-dive. | `url?` (default `jobtext.app/inbox`), `flat?` (drop shadow), `className`, `contentClassName` |
| **`PhoneFrame`** | Mobile screenshots + live-DOM dark-band thread. Neutral rounded bezel (stone ring, 28px), **no Apple/Android chrome** (honest PWA story). Optional web-push banner. | `pushBanner?: { title, body }`, `flat?`, `className`, `contentClassName` |
| **`GlowFrame`** | Wrap a `BrowserFrame`/`PhoneFrame` (or any node) with a contained petrol glow + gentle **settle-tilt** (capped ±2°, eases flat on scroll-in). The hero/feature-hero depth moment. **The one client island** in the set. | `tilt?` (deg, default 1.5, `0` disables), `glow?: "soft"｜"hero"｜"none"`, `className` |
| **`Texture`** | Faint section-background depth (dot-grid / line-grid / topographic). Tiny inline SVG tile + edge-fade mask. Kills the "empty" feeling; one or two per section max. | `variant?: "dots"｜"grid"｜"topo"`, `fade?: "radial"｜"top"｜"bottom"｜"none"`, `opacity?`, `className` |
| **`GradientMesh`** | Subtle petrol→transparent section wash (the placeable sibling of the home page's single `GlowBackdrop`). CSS gradients only, no blur. | `tone?: "petrol"｜"warm"｜"dual"`, `placement?: "hero"｜"center"｜"top"｜"bottom-left"｜"bottom-right"`, `variant?: "auto"｜"dark"`, `className` |

**Placement notes.** `Texture`/`GradientMesh`/`GlowFrame`'s glow are absolutely positioned — the
parent must be `relative`, and they sit at `-z-10` behind content. Keep the "one contained energy
area per section/theme" budget (BLUEPRINT §1.2): the home hero already owns the single
`GlowBackdrop`; use `GradientMesh` for *other* sections, not a second hero glow.

---

## Spot illustrations — `art/spot/**`

Crafted vector concepts a screenshot can't show. Same stroke/radius/palette; decorative by default
(pass `title` where the illustration is the sole meaning-bearer). Each accepts `ArtProps`
(`className`, `title`).

| Component | Depicts | Intended surfaces |
|---|---|---|
| **`OneNumberManyPeople`** | One petrol business-number bubble feeding three stone crew nodes, each with a "seen" presence dot — the shared-inbox core idea. | Home problem/positioning; `/features/shared-inbox` hero support |
| **`FieldWorkerTruck`** | A service van with a petrol number panel on its side (the business owns the number) and a text rising from it — "built for the truck, not the desk." | Trade heroes; dark-band / mobile beats |
| **`CarrierPaperworkShield`** | A petrol shield + check over a stack of registration forms — "we handle the carrier paperwork" (complexity reframed as done-for-you). | Home compliance beat; `/features/compliance` |
| **`CanadaMotif`** | A geometric petrol maple leaf on a teal-tint disc + a "day one" speech bubble — Canada-first, tasteful not flag-waving. | Home Canada beat; `/canada` |
| **`TextBecomesTask`** | An inbound message bubble transforming into a petrol-checked, struck-through handled item — "your text is a task" (the D14 done-mark). | Features / done-mark beats |
| **`MissedCallToText`** | A muted phone with an amber missed-call dot giving way to an answered petrol reply — "customers who won't leave a voicemail will text." | Missed-text-math breather (§3.7) |

---

## Infographics — `art/info/**`

Real information, drawn. Themeable, labelled with a descriptive `title` by default (real data →
not decorative). Subtle once-on-scroll animation available via `<ArtReveal>`. **Every number
traces to SPEC/COPY** (VISUALS §6).

| Component | Shows | Data source | Intended surfaces | Extra props |
|---|---|---|---|---|
| **`MissedTextMoney`** | Coins/bars: an amber "at risk" coin stack vs the flat `$29` petrol JobText coin. Visualises the calculator's live output — invents no default, asserts no industry stat. | The calculator's user-entered `monthly` (COPY §H8) | §3.7 calculator | `monthly: number` (required), `className` |
| **`FirstWeekTimeline`** | The honest US wait as a designed rail: **Day 0 live** → amber **"~3–7 business days" carrier review** → **Approved**. Win-first. | SPEC §4.1 checkout copy; COPY §H5 | Home §3.5 (SVG twin of the DOM version), `/pricing`, `/features/compliance` | `className`, `title` |
| **`HowItWorksFlow`** | Three numbered petrol circles + glyphs joined by a dashed petrol connector: Pick your number → Invite the crew → Text customers. | COPY §H5 | Home §3.5; onboarding-explainer surfaces | `className`, `title` |
| **`CoverageMapNA`** | Simplified US + Canada silhouettes with a petrol coverage wash + two location pins — local numbers in both countries. Stylized motif (AK/HI omitted by design, not a territory guarantee). | SPEC §1 ICP (US + Canada) | Home Canada beat; `/canada`; `/features/business-number` | `className`, `title` |
| **`FlatVsPerSeatChart`** | Flat petrol line ($29→$79) vs a climbing stone per-user line to $190 over 1–10 seats, with a **dated source footnote**. The static/no-JS/OG twin of the crew-size slider. | SPEC §2 plans; per-user $19/user/mo (July 2026) — matches `crew-size-slider.tsx`'s `PER_USER_MONTHLY`; sourced on `/compare/quo` | Home §3.9, `/pricing` (no-JS + OG) | `className`, `title` |

**Sourcing guard.** `FlatVsPerSeatChart`'s per-user figure ($19/user/mo, July 2026) must stay in
sync with `crew-size-slider.tsx`; both link the dated math to `/compare/quo` (§13.7 — no bare
unverified competitor number). If SPEC pricing or the competitor figure changes, update both plus
the slider the same day.

---

## Performance & honesty posture (why this is LCP-safe and on-brand)

- **All inline SVG / CSS** — no network, no raster, themeable, crisp at every DPR (VISUALS §5).
- **Server-render friendly** — every art component and every frame except `GlowFrame` is a server
  component; `GlowFrame` is the single small client island (one element, one observer) and
  degrades to a static glow with `tilt={0}`.
- **Zero-CLS** — art renders into a reserved box; reveals/tilts animate transform/opacity only.
- **Reduced-motion** — the tilt and `<ArtReveal>` both show the final frame under
  `prefers-reduced-motion`.
- **Honest** — illustrations are stylized but depict only real product behavior; every infographic
  number traces to SPEC/COPY or user input (VISUALS §6, BLUEPRINT §13).
