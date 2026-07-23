# Loonext Mobile — "Paper & Olive" design system (BINDING)

Source of truth: the founder's Claude Design project **“Loonext mobile redesign
review”** (`42514b71-f208-41e7-9f15-5f77b8b0eee7`, file `Loonext Mobile.dc.html`,
33 screens). This doc is the implementation contract for BOTH apps
(`apps/android`, `apps/ios`). Values are lifted verbatim from the canvas — do
not eyeball-adjust.

## Tokens

| Role | Light | Dark |
|---|---|---|
| Screen background (canvas) | `#F3F3EE` | `#141610` |
| Card / raised ("paper") | `#FDFDF9` | `#1F2218` |
| Ink (text, dark buttons, pill nav) | `#191B14` | `#F0F1E5` |
| Muted ladder | `#4A4D3C · #5C5F4E · #6E7163 · #8B8E7D · #9A9D8B · #A6A996 · #B4B7A6 · #BEC1AF` | `#8F927E · #7F826F · #6F7260` |
| Inset / dividers | `#F0F0E8` (deep: `#E7E9DC`) | `#23261A` (deep: `#262A1D`, raised: `#2C2F22`) |
| Avatar tint | `#E4E6D7` | `#2C2F22` |
| Olive (counts, links, emphasis) | `#66801F` | — |
| Lime fill (Answer, selected) | `#C9DE54` (bright mark: `#A9C42B`) | `#B9CF57` |
| Lime chip | bg `#E3EFA3`, text `#3A430F` | bg `#39421A`, text `#D6E77E` |
| Selection wash | `#D6E77E` | — |
| Coral attention dot (unread — NEVER error) | `#D96C47` | `#E0764B` |
| Cream well (pinned/starred) | `#EFE3CE` | — |
| Destructive (warm brick) | `#B0442B` / container `#F4DAD2` | `#E08B72` |
| Outline (checkbox rings etc.) | `#B4B7A6`/`#BEC1AF` | `#4A4D3C` |

Android: `ui/theme/Color.kt` (`BrandColor`), mapped into Material roles in
`Theme.kt` — **prefer `MaterialTheme.colorScheme.*`**; reach for `BrandColor`
only for tokens with no Material role (Coral, Lime marks, Cream).

## Brand (#206)

The double-o is THE mark; `brand/README.md` is the source of truth. Anywhere
either app shows the logo, it is the double-o (launcher icons, splash, empty
states — never the old loon-on-petrol tile). The wordmark is "Loonext" in Golos
Text SemiBold with **only the second o** in the accent (olive `#66801F` light,
lime `#B9CF57` dark), built as styled text spans in Compose/SwiftUI, never an
image.

## Type

- **Golos Text** — everything functional (body, labels, titles).
- **Bricolage Grotesque** — display ONLY: the big screen headings
  (30sp, SemiBold, −0.01em → `MaterialTheme.typography.headlineMedium` at 30sp,
  or `ui/common/Ds.kt → ScreenTitle`).
- Section micro-headers: 10.5sp, Bold, +0.12em tracking, UPPERCASE, muted
  (`Ds.kt → SectionHeader`), with olive tabular count.
- Meta/hint text: 11–11.5sp muted ladder. Row titles: 13.5sp SemiBold.

## Grammar

- **Cards**: paper, radius 22 (`MaterialTheme.shapes.large`), rows inside with
  1px `#F0F0E8` dividers (`outlineVariant`), row padding ~11–12dp v / 16dp h.
- **Screens**: radius-30 world (sheets use `extraLarge`); page padding 18dp.
- **Nav**: floating ink pill, 66dp tall, 14dp inset, radius pill; slots
  For you (bolt) · Inbox · Calls (phone) · Tasks (checklist) · avatar 34dp.
  Active slot = 46dp paper circle w/ ink icon; idle = paper @ 52%; coral dot on
  avatar = unread notifications. Content fades out behind it (130dp gradient).
  NO labels, NO numeral badges. (Shipped in `features/shell/Shell.kt`.)
- **IA change**: Calls is a NAV TAB; Contacts moved under the You sheet
  (You sheet rows: Notifications · Contacts · Settings · Sign out).
- **Icon buttons**: 44dp paper circles w/ 17dp stroke icons, subtle shadow.
- **FABs**: 54dp ink circle (compose = pencil, right 18dp, above nav).
- **Chips**: pill, 10sp Bold (`Ds.kt → DsChip`).
- **Avatars**: circles w/ `AvatarTint` bg + 11–13sp SemiBold initials.
- Icons are outline-stroke (~1.8px weight) — Material `Icons.Outlined.*`.

## Per-screen specs

Each of the 33 canvas screens is split to a standalone HTML file whose inline
styles are the spec: `scratchpad/design/screens/NN-*.html` (this session), with
`{{ bindings }}`/`<sc-for>` marking live data. Dark variants: 29–32.

## Rules

1. UI-only: never change ViewModels, repos, telephony/state logic in a reskin
   pass. CallActivity/Telecom answer/decline logic is FROZEN (see
   memory: calls hardening) — restyle visuals only.
2. Use theme roles first, `BrandColor` second, raw hex NEVER in feature code.
3. Both themes always; dark screens 29–32 pin the dark grammar.
4. Keep every existing behavior (deep links, badges→counts, a11y content
   descriptions, paging, error/loading states). Tests must stay green.
