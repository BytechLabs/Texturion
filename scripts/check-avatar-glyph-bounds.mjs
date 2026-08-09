#!/usr/bin/env node
/**
 * #569 — an initials badge must not let its glyph outgrow its box.
 *
 * The bug: a `Box(Modifier.size(38.dp))` holding `Text(fontSize = 12.5.sp)`. `dp` is
 * fixed and `sp` carries the reader's OS font setting, so at large text the letters
 * outgrew the circle and clipped. Measured off the shipped Golos Text face, two
 * initials run about 1.6x the font size wide and a wide pair about 1.86x, so a 30dp
 * circle held roughly 31dp of ink at the top of the system slider.
 *
 * ## Why a guard and not just a fix
 *
 * `InitialsAvatar` was supposed to be the one implementation. A survey of the tree
 * found **nine** hand-rolled copies of it, including on the inbox list and the
 * thread header — the two surfaces named in the issue. Fixing the shared component
 * alone would have closed #569 with both of them still broken.
 *
 * They existed because nothing connected the two numbers: the box was a literal
 * `dp`, the glyph an unrelated literal `sp`, so there was no ratio to inherit and
 * copying was easier than parameterising. That is a shape that regrows. This fails
 * the build when it does.
 *
 * ## What this checks, precisely
 *
 * A composable that sets a FIXED `Modifier.size(<n>.dp)` and, inside the same
 * function, sets `fontSize = <n>.sp` on a literal — with no bound between them. The
 * fix is to call `InitialsAvatar`, which caps the rendered glyph, or to bound the
 * glyph the same way and say why.
 *
 * `check-native-a11y` cannot catch this and says so in its own header: it checks
 * that text is sized in `sp` rather than `dp` — which every one of these copies did,
 * correctly — and explicitly not whether a layout survives 200%.
 *
 * ## What it deliberately does NOT flag
 *
 * A fixed box around an ICON. An icon is not text and does not scale with the font
 * setting, so a `34.dp` box holding a `15.dp` icon is correct. The issue as filed
 * claimed the call log's dial-back control had this bug; it does not, and reading
 * the code is what settled it.
 */
import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/android/app/src/main/kotlin";

/**
 * Functions allowed to pair a fixed box with a literal glyph.
 *
 * `InitialsAvatar` is the implementation of the bound, so it is the one place the
 * pairing is correct. Everything else should call it.
 */
const ALLOWED = new Set(["InitialsAvatar"]);

/**
 * Copies not yet converted, each with the size pair it still carries.
 *
 * These are real instances of the same bug on quieter surfaces, and they are listed
 * rather than silently skipped so the guard can go in NOW and hold the line while
 * they are worked through. **#569 stays open until this map is empty** — an
 * allowlist with nothing driving it to zero is how a known bug becomes a permanent
 * one.
 *
 * Names come from this guard's own output rather than from reading, because the
 * enclosing composable is often not the one you would guess: two of these are both
 * inside `AccountSheetContent`, and the assignee filter pill lives inside
 * `FiltersSheet`. An earlier version of this list guessed the names and half of them
 * matched nothing, which would have silenced the guard for entries that did not
 * exist while leaving the real ones failing.
 */
const KNOWN_UNCONVERTED = new Map([
  ["ContactDetailBody", "#569 — contact detail hero, 78dp box / 24.sp glyph"],
  ["FiltersSheet", "#569 — assignee filter pill, 24dp box / 9.sp glyph"],
  ["KindBadge", "#569 — notifications row, 38dp box / 12.sp glyph"],
  ["IdentityCard", "#569 — settings identity card, 46dp box / 14.sp glyph"],
  ["AccountSheetContent", "#569 — account sheet, 44dp and 30dp boxes / 13.sp and 11.sp"],
  ["ContactRow", "#569 — contacts list, 40dp box / 12.5.sp glyph"],
  ["AssigneeChip", "#569 — task-from-message sheet, 26dp box / 10.sp glyph"],
]);

function kotlinFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...kotlinFiles(full));
    else if (entry.endsWith(".kt")) out.push(full);
  }
  return out;
}

/** Strip comments so prose about a bug is not read as the bug. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The enclosing `fun` name for a line, so a finding can name the composable. */
function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const match = /^(?:private |internal |public )?fun (\w+)\s*\(/.exec(lines[i]);
    if (match) return match[1];
  }
  return "(top level)";
}

/**
 * A fixed box and a literal glyph WITHIN A FEW LINES OF EACH OTHER.
 *
 * The proximity window is the whole precision of this guard, and the first version
 * did not have one: it split files by `fun` and matched any box against any glyph in
 * the same function, which in a long composable pairs two unrelated widgets. That
 * reported `FiltersSheet` as a 24dp box holding a 21sp glyph — two things hundreds of
 * lines apart, neither of them an avatar. One false finding in six is the rate at
 * which people stop reading a guard's output, so the window is not a refinement, it
 * is the difference between a check and a nuisance.
 *
 * Fifteen lines is what a real `Box { Text }` badge spans, allowing for a background,
 * an alignment and a style block.
 */
const WINDOW = 15;

function pairs(source) {
  const lines = source.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const box = /\.size\((\d+(?:\.\d+)?)\.dp\)/.exec(lines[i]);
    if (!box) continue;
    const slice = lines.slice(i, i + WINDOW).join("\n");
    const glyph = /fontSize\s*=\s*(\d+(?:\.\d+)?)\.sp/.exec(slice);
    if (!glyph) continue;
    // Only a text badge is at risk — an icon in a fixed box is correct, which is
    // why the dial-back control the issue accused is not a finding.
    if (!/initialsOf\(/.test(slice)) continue;
    found.push({
      line: i + 1,
      box: box[1],
      glyph: glyph[1],
      name: enclosingFunction(lines, i),
    });
  }
  return found;
}

const problems = [];
let scanned = 0;
let pairsFound = 0;

for (const file of kotlinFiles(ROOT)) {
  const source = stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  scanned += 1;
  for (const pair of pairs(source)) {
    pairsFound += 1;
    if (ALLOWED.has(pair.name)) continue;
    if (KNOWN_UNCONVERTED.has(pair.name)) continue;

    problems.push(
      `${file}:${pair.line} — \`${pair.name}\` pairs a fixed ${pair.box}.dp box ` +
        `with a literal ${pair.glyph}.sp glyph and no bound between them, so the ` +
        `initials outgrow the box at large OS text (#569). Call InitialsAvatar — it ` +
        `takes a \`shape\` and a \`glyph\`, so passing the literal keeps it ` +
        `pixel-identical at the default setting — or add it to KNOWN_UNCONVERTED ` +
        `with an issue behind it.`,
    );
  }
}

// The component's OWN bound, which the allowlist above would otherwise excuse.
//
// Found by breaking it: removing the cap from InitialsAvatar left this guard green,
// because `ALLOWED` skips the one function whose job is to implement the bound. An
// allowlist that exempts the implementation exempts the thing being guarded.
{
  const component = readFileSync(join(ROOT, "com/loonext/android/ui/common/Ui.kt"), "utf8");
  const body = /fun InitialsAvatar\(([\s\S]*?)\n}/.exec(component);
  if (body === null) {
    problems.push(
      "cannot find InitialsAvatar in ui/common/Ui.kt — this guard has lost the " +
        "component it exists to protect.",
    );
  } else {
    // The cap: a rendered size derived by taking the SMALLER of what the caller
    // wanted and what the box can hold.
    if (!/minOf\(/.test(body[1]) || !/fontSize\s*=\s*rendered/.test(body[1])) {
      problems.push(
        "InitialsAvatar no longer bounds its glyph to its box (#569). The whole " +
          "point of the component is that `fontSize` is a `rendered` value capped " +
          "by `minOf(wanted, ceiling)`; without it every caller inherits the bug " +
          "again and the allowlist above silently excuses all of them.",
      );
    }
    if (!/lineHeight\s*=\s*rendered/.test(body[1])) {
      problems.push(
        "InitialsAvatar no longer bounds its lineHeight (#569). The inherited " +
          "20.sp is 34dp at the top of the system slider, which spills out of the " +
          "28-32dp avatars even when the glyph itself fits.",
      );
    }
    if (!/softWrap\s*=\s*false/.test(body[1])) {
      problems.push(
        "InitialsAvatar no longer refuses to wrap (#569). Two initials are one " +
          "word; with wrapping on, Compose breaks the pair mid-word once it stops " +
          "fitting and clips the second letter — which is how the inbox row failed.",
      );
    }
  }
}

if (scanned === 0 || pairsFound === 0) {
  // Loud rather than vacuous: a walk that matched nothing would pass by default and
  // read exactly like a clean bill of health. `InitialsAvatar` itself is one pair,
  // so zero means the patterns have stopped matching reality.
  problems.push(
    `scanned ${scanned} Kotlin files and found ${pairsFound} box/glyph pairs — ` +
      `expected at least one (InitialsAvatar itself). The patterns no longer match ` +
      `the tree, so this guard is not checking anything.`,
  );
}

if (problems.length > 0) {
  console.error("An initials badge must bound its glyph to its box (#569):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Avatar glyphs: ${pairsFound} fixed-box/literal-glyph pair(s) across ${scanned} ` +
    `Kotlin files, each either the bounded component or a filed exception.`,
);
