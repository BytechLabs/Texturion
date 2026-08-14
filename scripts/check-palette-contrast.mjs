#!/usr/bin/env node
/**
 * #238 — the phone palettes are measured, not remembered.
 *
 *   node scripts/check-palette-contrast.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * `APP-LAYOUT-V2` §7 states contrast as a RULE — "anything carrying essential
 * meaning bumps to stone-500" — and #238's whole thesis is that nothing
 * verified it. On web, `theme-audit.mjs` runs axe over real pages and does.
 * On the two phones there was nothing at all.
 *
 * What stood in for it was #320: somebody worked the ratios out by hand and
 * wrote the answers into `Color.kt` and `BrandColor.swift` as comments —
 * *"0xFF909090 was 4.28:1 on surfaceContainerHigh/Highest, 0xFF949494 clears
 * every one (4.51:1 worst)"*. Those numbers are correct and they are a
 * PHOTOGRAPH. Nothing re-takes them when a colour moves, and the tightest pair
 * in the whole set clears its bar by 0.05.
 *
 * The cost of not having this is on the record twice over. #320 found a dark
 * `errorContainer` pointing at the pale-lime chip fill, so every error box on a
 * dark phone rendered green — "nothing caught it because nothing had ever read
 * this table". And #556 found the nav capsule drawn in fixed ink on the dark
 * canvas, five parts in 255, invisible.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE PAIRINGS COME FROM, AND WHY THEY ARE NOT INVENTED
 *
 * A contrast checker is only worth its output if it checks the pairs that
 * actually meet on a screen. Guessing them produces a number for a combination
 * nobody ever draws.
 *
 * ANDROID declares them. `lightColorScheme`/`darkColorScheme` are Material's
 * own contract: `onSurface` is the foreground drawn on `surface`, `onPrimary`
 * on `primary`, and so on for every role. So the table is read out of
 * `Theme.kt` and no pairing here is a judgement call.
 *
 * IOS declares none — `BrandColor.swift` is a flat list of adaptive colours
 * with no on/off relation. But the file's own comments say what the text rungs
 * land on, in the sentence that reports #320's bug: *"muted500 alone carries 77
 * Text views ... that measured 3.01:1 on the canvas ground"*. Text on this app
 * sits on the canvas or on paper, so every muted rung is checked against BOTH,
 * in BOTH themes. That is the file's stated intent rather than mine.
 *
 * ---------------------------------------------------------------------------
 * THE BAR, AND WHAT IS DELIBERATELY NOT CHECKED
 *
 * 4.5:1, WCAG AA for normal text. Material's `onX` roles and this app's muted
 * ladder are text and icon foregrounds, so the text bar is the right one; using
 * 3:1 because some of them are occasionally large would be choosing the number
 * that fails least.
 *
 * NOT checked: component boundaries (1.4.11, 3:1). The nav capsule that started
 * this is a boundary rather than a foreground, and it is guarded where it can be
 * seen instead — `ShellWidthRenderTest` renders the real shell in both themes
 * and measures the capsule against the ground beside it. A palette file cannot
 * answer "does this control have an edge", because that depends on what is drawn
 * behind it, and a guard that pretended otherwise would be measuring pairs that
 * never meet.
 */
import { readFileSync } from "node:fs";

const ANDROID_COLOR =
  "apps/android/app/src/main/kotlin/com/loonext/android/ui/theme/Color.kt";
const ANDROID_THEME =
  "apps/android/app/src/main/kotlin/com/loonext/android/ui/theme/Theme.kt";
const IOS_COLOR = "apps/ios/Loonext/Theme/BrandColor.swift";

/** WCAG AA for normal text. */
const FLOOR = 4.5;

// ---------------------------------------------------------------------------
// Colour maths

function luminance(rgb) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((rgb >> 16) & 0xff) +
    0.7152 * channel((rgb >> 8) & 0xff) +
    0.0722 * channel(rgb & 0xff)
  );
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Android: the scheme declares every pairing

/** `val DarkCanvas = Color(0xFF151515)` → `{ DarkCanvas: 0x151515 }`. */
function androidPalette() {
  const source = readFileSync(ANDROID_COLOR, "utf8");
  const out = {};
  for (const m of source.matchAll(/val\s+(\w+)\s*=\s*Color\(0x([0-9A-Fa-f]{8})\)/g)) {
    out[m[1]] = parseInt(m[2].slice(2), 16);
  }
  return out;
}

/** One scheme's role table: `{ onSurface: "Ink", surface: "Paper", … }`. */
function androidScheme(source, opener) {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`${opener} not found in Theme.kt`);
  const end = source.indexOf("\n)", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  const roles = {};
  for (const m of body.matchAll(/^\s*(\w+)\s*=\s*BrandColor\.(\w+)/gm)) {
    roles[m[1]] = m[2];
  }
  return roles;
}

function androidPairs() {
  const palette = androidPalette();
  const theme = readFileSync(ANDROID_THEME, "utf8");
  const pairs = [];
  for (const [label, opener] of [
    ["android light", "lightColorScheme("],
    ["android dark", "darkColorScheme("],
  ]) {
    const roles = androidScheme(theme, opener);
    for (const [role, colorName] of Object.entries(roles)) {
      if (!role.startsWith("on") || role.length < 3) continue;
      // `onSurfaceVariant` → `surfaceVariant`.
      const groundRole = role[2].toLowerCase() + role.slice(3);
      const groundName = roles[groundRole];
      if (!groundName) continue; // e.g. an `onX` whose `X` this app never sets
      const fg = palette[colorName];
      const bg = palette[groundName];
      if (fg === undefined || bg === undefined) {
        throw new Error(
          `${label}: ${role}/${groundRole} names ${colorName}/${groundName}, ` +
            "which Color.kt does not define — the palette moved",
        );
      }
      pairs.push({
        scheme: label,
        what: `${role} on ${groundRole}`,
        detail: `${colorName} on ${groundName}`,
        ratio: contrast(fg, bg),
      });
    }

    /*
     * THE CONTAINER TINTS, which the `onX`/`X` derivation above cannot reach.
     *
     * Material declares no `onSurfaceContainerHigh`. The five container roles
     * are surfaces, and the foreground drawn on all of them is `onSurface` for
     * primary text and `onSurfaceVariant` for secondary — that is Material's
     * own specification, not a guess here.
     *
     * It is also precisely where #320's bug lived. Its note in `Color.kt` reads
     * "0xFF909090 ... was 4.28:1 on surfaceContainerHigh/Highest", a pair no
     * `onX`/`X` walk would ever have formed. Leaving it out would have made
     * this guard clean on the exact defect that motivated it.
     */
    for (const fgRole of ["onSurface", "onSurfaceVariant"]) {
      const colorName = roles[fgRole];
      if (!colorName) continue;
      for (const groundRole of Object.keys(roles)) {
        if (!groundRole.startsWith("surfaceContainer")) continue;
        const fg = palette[colorName];
        const bg = palette[roles[groundRole]];
        if (fg === undefined || bg === undefined) continue;
        pairs.push({
          scheme: label,
          what: `${fgRole} on ${groundRole}`,
          detail: `${colorName} on ${roles[groundRole]}`,
          ratio: contrast(fg, bg),
        });
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// iOS: no declared pairings, so the two GROUNDS text sits on

/** `static let canvas = adaptive(light: 0xF3F3F3, dark: 0x151515)`. */
function iosPalette() {
  const source = readFileSync(IOS_COLOR, "utf8");
  const out = {};
  for (const m of source.matchAll(
    /static let (\w+) = adaptive\(light: 0x([0-9A-Fa-f]{6}), dark: 0x([0-9A-Fa-f]{6})\)/g,
  )) {
    out[m[1]] = { light: parseInt(m[2], 16), dark: parseInt(m[3], 16) };
  }
  return out;
}

/**
 * The text rungs, and the two surfaces this app draws text on.
 *
 * `muted250` is excluded and the file says why in its own docblock: *"NOT a
 * text rung: chevrons, 1px dividers, stroke borders."* Holding a divider to a
 * text ratio would be measuring a pair that carries no words.
 */
const IOS_TEXT_RUNGS = ["ink", "muted900", "muted700", "muted600", "muted500", "muted400", "muted300"];
const IOS_GROUNDS = ["canvas", "paper"];

function iosPairs() {
  const palette = iosPalette();
  const pairs = [];
  for (const theme of ["light", "dark"]) {
    for (const rung of IOS_TEXT_RUNGS) {
      const fg = palette[rung];
      if (!fg) {
        throw new Error(`ios: BrandColor.${rung} is gone — the muted ladder moved`);
      }
      for (const ground of IOS_GROUNDS) {
        const bg = palette[ground];
        if (!bg) throw new Error(`ios: BrandColor.${ground} is gone`);
        pairs.push({
          scheme: `ios ${theme}`,
          what: `${rung} on ${ground}`,
          detail: `0x${fg[theme].toString(16)} on 0x${bg[theme].toString(16)}`,
          ratio: contrast(fg[theme], bg[theme]),
        });
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------

const pairs = [...androidPairs(), ...iosPairs()];

/*
 * COVERAGE FIRST.
 *
 * A checker that parses nothing reports nothing and passes, which is how this
 * repo has lost a focus walk that visited zero controls and a string guard whose
 * regex matched nothing. The floor is far below the real count (73 at the time
 * of writing) so it trips on a parse that broke, not on a colour somebody added.
 */
if (pairs.length < 40) {
  console.error(
    `Palette contrast: only ${pairs.length} pairing(s) resolved — the parse is ` +
      "broken, not the palette. Check Theme.kt's scheme calls and BrandColor.swift.",
  );
  process.exit(1);
}

const failures = pairs.filter((p) => p.ratio < FLOOR);
const schemes = [...new Set(pairs.map((p) => p.scheme))];

if (failures.length > 0) {
  console.error("\nPalette contrast — below WCAG AA for text:\n");
  for (const f of failures.sort((a, b) => a.ratio - b.ratio)) {
    console.error(
      `  ${f.ratio.toFixed(2)}:1  ${f.scheme} · ${f.what}  (${f.detail})`,
    );
  }
  console.error(
    `\n${failures.length} of ${pairs.length} pairing(s) under ${FLOOR}:1. ` +
      "These are the colours a person reads words in.\n",
  );
  process.exit(1);
}

const tightest = pairs.reduce((a, b) => (a.ratio < b.ratio ? a : b));
console.log(
  `Palette contrast: ${pairs.length} pairing(s) across ${schemes.length} scheme(s) ` +
    `clear ${FLOOR}:1. Tightest is ${tightest.ratio.toFixed(2)}:1 — ` +
    `${tightest.scheme} · ${tightest.what}.`,
);
