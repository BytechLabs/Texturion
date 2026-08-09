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
 * `InitialsAvatar` was supposed to be the one implementation. A sweep of the tree
 * found **ten** hand-rolled copies of it, including on the inbox list and the thread
 * header — the two surfaces named in the issue. Fixing the shared component alone
 * would have closed #569 with both of them still broken.
 *
 * They existed because nothing connected the two numbers: the box was a literal `dp`,
 * the glyph an unrelated literal `sp`, so there was no ratio to inherit and copying
 * was easier than parameterising. That is a shape that regrows.
 *
 * ## What this checks, and why it is not what it first checked
 *
 * The rule is now one sentence: **anything that renders initials must size them
 * through the bound.** Concretely, a function calling `initialsOf(` must set the
 * glyph's `fontSize` from `boundedGlyph(` — which is what `InitialsAvatar` does, so
 * calling the component satisfies it for free.
 *
 * The first version of this guard instead looked for the SHAPE of the bug: a fixed
 * `.size(N.dp)` within a few lines of a literal `fontSize = M.sp`. That found seven
 * copies and missed three, all of the same kind — a small wrapper taking `size: Dp`
 * and `fontSize: TextUnit` as parameters (`AvatarCircle` on For You, `TaskAvatar` on
 * Tasks, `SearchAvatar` in inbox search). In those, the box size and the glyph literal
 * never appeared in the same file: the wrapper had `.size(size)` and the callers had
 * `fontSize = 12.sp`. Each was as broken as the seven the pattern caught, and a
 * pattern-matcher could not see any of them — including the one wrapper the ORIGINAL
 * bug report was filed about.
 *
 * That is the general lesson and it is worth stating plainly: a guard written against
 * the shape of a known instance passes anything that launders the same defect through
 * one indirection. A guard written against the invariant does not care how many
 * indirections there are.
 *
 * `check-native-a11y` cannot catch this and says so in its own header: it checks that
 * text is sized in `sp` rather than `dp` — which every one of these copies did,
 * correctly — and explicitly not whether a layout survives 200%.
 *
 * ## What it deliberately does NOT flag
 *
 * A fixed box around an ICON. An icon is not text and does not scale with the font
 * setting, so a `34.dp` box holding a `15.dp` icon is correct. The issue as filed
 * claimed the call log's dial-back control had this bug; it does not, and reading the
 * code is what settled it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/android/app/src/main/kotlin";
const COMPONENT = join(ROOT, "com/loonext/android/ui/common/Ui.kt");

const IOS_ROOT = "apps/ios/Loonext";
const IOS_COMPONENT = join(IOS_ROOT, "Support/Ui.swift");
const IOS_SCALE = join(IOS_ROOT, "Theme/DesignSystem.swift");

/**
 * How far after an `initialsOf(` call the glyph's own `fontSize` can be.
 *
 * This is deliberately narrow. It is the distance from the text argument of a `Text`
 * to that same `Text`'s `fontSize`, allowing for a comment between them — not a
 * search of the enclosing function, which is how the first version of this guard
 * paired two unrelated widgets hundreds of lines apart and reported a 24dp box holding
 * a 21sp glyph. One false finding is roughly the point at which people stop reading a
 * guard's output.
 */
const WINDOW = 14;

function sourceFiles(dir, extension) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, extension));
    else if (entry.endsWith(extension)) out.push(full);
  }
  return out;
}

/** Strip comments so prose about a bug is not read as the bug. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The enclosing `fun` name for a line, so a finding can name the composable. */
function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const match = /^(?:private |internal |public )?fun (\w+)\s*\(/.exec(lines[i]);
    if (match) return match[1];
  }
  return "(top level)";
}

const problems = [];
let scanned = 0;
let sites = 0;

for (const file of sourceFiles(ROOT, ".kt")) {
  const source = stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  scanned += 1;
  const lines = source.split("\n");

  // Names bound to the bound, e.g. `val rendered = boundedGlyph(size, glyph)`, so a
  // component can compute it once and use it for both fontSize and lineHeight.
  const bound = new Set();
  for (const line of lines) {
    const assigned = /\bval\s+(\w+)\s*=\s*boundedGlyph\(/.exec(line);
    if (assigned) bound.add(assigned[1]);
  }

  for (let i = 0; i < lines.length; i += 1) {
    // The declaration of the helper itself is not a use of it.
    if (/fun initialsOf\(/.test(lines[i])) continue;
    if (!/\binitialsOf\(/.test(lines[i])) continue;
    sites += 1;

    const slice = lines.slice(i, i + WINDOW).join("\n");
    const glyph = /fontSize\s*=\s*([^,\n]+)/.exec(slice);
    const name = enclosingFunction(lines, i);

    if (glyph === null) {
      problems.push(
        `${file}:${i + 1} — \`${name}\` renders initials but sets no \`fontSize\` ` +
          `within ${WINDOW} lines, so this guard cannot tell whether the glyph is ` +
          `bounded (#569). Render initials through InitialsAvatar.`,
      );
      continue;
    }

    const expression = glyph[1].trim();
    const isBounded =
      expression.startsWith("boundedGlyph(") ||
      bound.has(expression.replace(/\s*\*.*$/, "").trim());

    if (!isBounded) {
      problems.push(
        `${file}:${i + 1} — \`${name}\` renders initials at \`fontSize = ` +
          `${expression}\`, which is not bounded to the badge's box, so the letters ` +
          `outgrow it at large OS text (#569). Call InitialsAvatar — it takes a ` +
          `\`shape\`, a \`glyph\` and a colour pair, so passing the literals you have ` +
          `keeps it pixel-identical at the default setting. If the badge truly cannot ` +
          `be that component (only CallerAvatar, which paints a ring behind its own ` +
          `Box), size the glyph with \`boundedGlyph(size, wanted)\`.`,
      );
    }
  }
}

// The bound itself, and the component's use of it. `InitialsAvatar` satisfies the rule
// above by construction, so without this the whole check could be defeated by gutting
// the one function every caller now trusts — which is exactly what happened when an
// earlier version simply exempted it by name.
{
  const component = readFileSync(COMPONENT, "utf8").replace(/\r\n/g, "\n");

  const helper = /fun boundedGlyph\(([\s\S]*?)\n}/.exec(component);
  if (helper === null) {
    problems.push(
      "cannot find boundedGlyph in ui/common/Ui.kt — this guard has lost the rule it " +
        "exists to enforce, and every check above would pass vacuously.",
    );
  } else if (!/minOf\(/.test(helper[1])) {
    problems.push(
      "boundedGlyph no longer takes the SMALLER of what the caller wanted and what " +
        "the box can hold (#569). Without a `minOf` it is not a bound, and every " +
        "caller inherits the original bug while reading as if it were fixed.",
    );
  }

  const avatar = /fun InitialsAvatar\(([\s\S]*?)\n}/.exec(component);
  if (avatar === null) {
    problems.push(
      "cannot find InitialsAvatar in ui/common/Ui.kt — this guard has lost the " +
        "component it exists to protect.",
    );
  } else {
    if (!/boundedGlyph\(/.test(avatar[1])) {
      problems.push(
        "InitialsAvatar no longer bounds its glyph (#569). It is the badge every " +
          "surface in the app now renders through, so an unbounded glyph here is the " +
          "bug back in all ten places at once.",
      );
    }
    if (!/lineHeight\s*=\s*rendered/.test(avatar[1])) {
      problems.push(
        "InitialsAvatar no longer bounds its lineHeight (#569). The inherited 20.sp " +
          "is 34dp at the top of the system slider, which spills out of the 24-32dp " +
          "avatars even when the glyph itself fits.",
      );
    }
    if (!/softWrap\s*=\s*false/.test(avatar[1])) {
      problems.push(
        "InitialsAvatar no longer refuses to wrap (#569). Two initials are one word; " +
          "with wrapping on, Compose breaks the pair mid-word once it stops fitting " +
          "and clips the second letter — which is how the inbox row failed.",
      );
    }
  }
}

// --- iOS -------------------------------------------------------------------------
//
// The same defect existed here and was worse: SwiftUI's `.frame` does not clip, so the
// letters spilled OUT of the badge over the name beside them, and iOS sized its glyph
// at `size * 0.38` (bigger than Android's `size / 3`) so it ran out of room sooner.
// iOS had the discipline Android did not — one `InitialsAvatar` behind 20 surfaces —
// but three hand-rolled copies had still appeared, one of them the same
// parameterised-wrapper shape that hid three on Android.
let iosSites = 0;
for (const file of sourceFiles(IOS_ROOT, ".swift")) {
  const source = stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    // A BADGE, not the string helper. `initialsOf` on its own is a pure function and
    // the tests are entitled to call it; only initials being DRAWN need the bound.
    if (!/Text\(\s*initialsOf\(/.test(lines[i])) continue;
    iosSites += 1;
    // Looks BACKWARD as well as forward, unlike the Kotlin half. In Compose the glyph
    // size is an argument of the `Text` itself; in SwiftUI it is a `let` computed just
    // above the view, because a `.font()` modifier cannot declare one.
    const slice = lines.slice(Math.max(0, i - 4), i + WINDOW).join("\n");
    if (!/boundedGlyph\(/.test(slice)) {
      problems.push(
        `${file}:${i + 1} — initials are drawn here without \`TypeScale.boundedGlyph\`, ` +
          `so at large Dynamic Type they grow past the fixed \`.frame\` and, because ` +
          `SwiftUI does not clip, spill over whatever sits beside them (#569). Render ` +
          `them with \`InitialsAvatar\`, which takes a \`glyph\`, a \`shape\`, a ` +
          `\`typeface\` and a colour pair — passing the values you have keeps it ` +
          `identical at the default text size.`,
      );
    }
  }
}

if (iosSites === 0) {
  problems.push(
    "found no initials badge in the iOS sources — InitialsAvatar draws one, so zero " +
      "means this half of the guard has stopped matching the tree.",
  );
}

// The ceiling is ONE rule and it is written in two languages. Nothing but this
// comparison stops them drifting, and a divisor that disagrees by platform is how
// "the same badge" ends up clipping on one phone and not the other.
{
  const kotlin = readFileSync(COMPONENT, "utf8");
  const swift = readFileSync(IOS_SCALE, "utf8");
  const kotlinCeiling = /val ceiling = size\.value \/ (\d+(?:\.\d+)?)f/.exec(kotlin);
  const swiftCeiling = /avatarGlyphDivisor: CGFloat = (\d+(?:\.\d+)?)/.exec(swift);

  if (kotlinCeiling === null || swiftCeiling === null) {
    problems.push(
      `cannot read the glyph ceiling from both platforms (Kotlin: ` +
        `${kotlinCeiling?.[1] ?? "not found"}, Swift: ${swiftCeiling?.[1] ?? "not found"}) ` +
        `— without both this guard cannot tell whether they still agree.`,
    );
  } else if (kotlinCeiling[1] !== swiftCeiling[1]) {
    problems.push(
      `the glyph ceiling has drifted: Kotlin caps at size/${kotlinCeiling[1]} and Swift ` +
        `at size/${swiftCeiling[1]} (#569). It is one measurement — two initials run ` +
        `about 1.86x the point size wide — so the two platforms clipping at different ` +
        `text settings is a bug in whichever one moved.`,
    );
  }
}

if (scanned === 0 || sites === 0) {
  // Loud rather than vacuous: a walk that matched nothing would pass by default and
  // read exactly like a clean bill of health. `InitialsAvatar` itself is one site, so
  // zero means the patterns have stopped matching reality.
  problems.push(
    `scanned ${scanned} Kotlin files and found ${sites} initials call site(s) — ` +
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
  `Avatar glyphs: ${sites} initials call site(s) across ${scanned} Kotlin files and ` +
    `${iosSites} on iOS, every one sized through the #569 bound, and both platforms ` +
    `capping at the same fraction of the box.`,
);
