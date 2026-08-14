#!/usr/bin/env node
/**
 * #238 — every icon-only control on the phones announces itself.
 *
 * The commonest screen-reader failure is not a wrong label, it is no label: a
 * button whose entire content is an icon, with the icon marked decorative.
 * TalkBack lands on it and says "button"; VoiceOver reads the SF Symbol's name
 * or nothing. Either way the person has to press it to find out what it does,
 * which on a "delete" is not a reasonable thing to ask.
 *
 * `contentDescription = null` is CORRECT on an icon inside something already
 * named — a "Send" button with a paper-plane glyph should announce once, not
 * twice — so the null is never the finding. The finding is a control whose only
 * child is a null-described icon and which carries no name of its own.
 *
 * ## What this does NOT claim
 *
 * A name is necessary and nowhere near sufficient. Whether the reading ORDER
 * makes sense, whether a live region speaks at the right moment, whether a
 * custom control exposes the right role and state, whether the flow can be
 * driven end to end — that needs a person with a phone, and
 * `docs/ACCESSIBILITY.md` says so rather than letting this guard imply
 * otherwise. This checks the one part that regresses silently.
 *
 * ## It reports how much it examined, and that is not decoration
 *
 * This guard read ZERO on a control planted to fail it, twice, for two
 * different reasons — both in the same predicate. See `DESCRIBES` below. A
 * guard whose healthy state is "0 findings" is indistinguishable from a broken
 * one unless it also says how many sites it looked at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const reportOnly = process.argv.includes("--report");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "build" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (statSync(full).isFile()) out.push(full.split("\\").join("/"));
  }
  return out;
}

/** The source from `open` to its matching close, searching from `from`. */
function block(source, from, open = "{", close = "}") {
  const start = source.indexOf(open, from);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/**
 * A description that is present and is not `null`.
 *
 * The negative lookahead MUST sit against a non-space character. Written the
 * obvious way — `=\s*(?!null)` — the engine backtracks `\s*` to zero width,
 * tests the lookahead against the SPACE before `null`, finds that a space does
 * not begin with "null", and passes. Every decorative icon then read as named
 * and this guard returned 0 on a button planted to fail it.
 *
 * The first attempt at a fix wrote `=\s*[a-z]` instead, which matched `null`'s
 * own leading `n`. Same zero, different reason. Requiring `\S` after the
 * lookahead is what makes the assertion land where it was meant to.
 */
const DESCRIBES = /contentDescription\s*=\s*(?!null\b)\S/;

const findings = [];
let checked = 0;

// ---------------------------------------------------------------------------
// Android: an IconButton whose lambda holds only a null-described Icon.
// ---------------------------------------------------------------------------
for (const file of walk("apps/android/app/src/main").filter((f) => f.endsWith(".kt"))) {
  const source = readFileSync(file, "utf8");
  let at = 0;
  for (;;) {
    const hit = source.indexOf("IconButton(", at);
    if (hit === -1) break;
    at = hit + 1;
    checked += 1;
    // The call's arguments, where a `modifier = Modifier.semantics { … }` or a
    // description passed as a parameter would live.
    const args = block(source, hit, "(", ")");
    // The trailing lambda: what the button draws.
    const body = block(source, hit + args.length, "{", "}");
    const named =
      DESCRIBES.test(body) ||
      DESCRIBES.test(args) ||
      /\bText\s*\(/.test(body) ||
      /semantics\s*\{/.test(args);
    if (!named && /Icon\s*\(/.test(body)) {
      const line = source.slice(0, hit).split("\n").length;
      findings.push(
        `${file}:${line} an IconButton whose only content is an icon with no ` +
          `description. TalkBack announces "button" and nothing else.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// iOS: a Button whose label is only an Image, with no accessibilityLabel.
// ---------------------------------------------------------------------------
for (const file of walk("apps/ios/Loonext").filter((f) => f.endsWith(".swift"))) {
  const source = readFileSync(file, "utf8");
  let at = 0;
  for (;;) {
    const hit = source.indexOf("Button", at);
    if (hit === -1) break;
    at = hit + 1;
    // A word ENDING in Button — `EditButton`, `saveButton` — is not this.
    if (/[A-Za-z0-9_]/.test(source[hit - 1] ?? "")) continue;
    const opener = source.slice(hit + "Button".length).match(/^\s*([({])/);
    if (!opener) continue;
    checked += 1;

    // A TITLED button names itself: `Button("Save")`, `Button(t("key"))`. Only
    // the closure-label forms can be nameless. Reading this as "starts with a
    // quote" reported every `Button(AppStrings.translate(…))` in the app — the
    // labelled ones.
    if (opener[1] === "(") {
      const args = block(source, hit, "(", ")");
      if (!/^\(\s*(action\s*:)?\s*\{/.test(args)) continue;
    }

    // Brace-match the label closure rather than reading a fixed number of
    // lines. A twelve-line window cut a tab button off two lines before its own
    // text, and cut another off two lines before its `.accessibilityLabel` —
    // reporting both as nameless.
    const labelAt = source.indexOf("label:", hit);
    const scopeFrom = labelAt !== -1 && labelAt - hit < 900 ? labelAt : hit;
    const scope = block(source, scopeFrom, "{", "}");
    if (!/Image\s*\(/.test(scope)) continue;
    if (/Text\s*\(|Label\s*\(/.test(scope)) continue;

    // The name sits on the Button itself, in the modifiers chained after its
    // closing brace — so the window starts THERE, not at the Button keyword.
    // Measured from `hit` it has to span the whole action closure and the whole
    // label closure before it reaches the modifiers, and a window wide enough
    // to do that on a long button is wide enough to catch the NEXT view's
    // label. Measuring from the end is both tighter and correct: 400 characters
    // of chained modifiers is generous, and it cannot reach a sibling.
    const scopeEnd = source.indexOf(scope, scopeFrom) + scope.length;
    const chained = source.slice(scopeEnd, scopeEnd + 400);
    if (/accessibilityLabel|accessibilityElement|accessibilityHidden/.test(chained)) continue;

    const line = source.slice(0, hit).split("\n").length;
    findings.push(
      `${file}:${line} a Button whose label is an image with no ` +
        `accessibilityLabel. VoiceOver reads the SF Symbol's name, or nothing.`,
    );
  }
}

if (checked < 200) {
  console.error(
    `Screen-reader names: only ${checked} control site(s) found across both ` +
      `phones, which is too few to believe. The scan is not reaching the ` +
      `source — a clean result from it would mean nothing.`,
  );
  process.exit(1);
}

console.log(
  `Screen-reader names: ${checked} icon-only control site(s) examined, ` +
    `${findings.length} with no accessible name.`,
);
for (const finding of findings) console.log(`  - ${finding}`);

if (findings.length > 0 && !reportOnly) process.exit(1);
