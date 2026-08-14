import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #228 — the extractor behind the hardcoded-strings ledger, tested in both
 * directions.
 *
 * The ledger is the only number that says how much of #228 is left, and it is
 * produced entirely by these three functions. That makes them the kind of code
 * where BOTH failure modes cost something real:
 *
 *   OVER-REPORTING   the ledger counts `blobLime` and "Jordan Lee" as sentences
 *                    somebody must translate, and the genuine remainder hides
 *                    behind the noise. Android read 51 when the true number was
 *                    29 — 43% of the reported work did not exist.
 *
 *   UNDER-REPORTING  far worse and much quieter. A rule added to silence the
 *                    noise above could equally silence "Update", "Dismiss" or
 *                    "Country", and the ledger would shrink while the app
 *                    stayed English. A guard that stops seeing is
 *                    indistinguishable from work getting done.
 *
 * So every exclusion rule below is tested by a pair: the thing it must reject,
 * and the nearest real sentence it must NOT.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { findKotlinLiterals, findSwiftLiterals, isScannable } = (await import(
  join(REPO, "scripts", "check-hardcoded-strings.mjs")
)) as {
  findKotlinLiterals: (source: string) => string[];
  findSwiftLiterals: (source: string) => string[];
  isScannable: (path: string, exts: string[]) => boolean;
};

describe("which files get scanned at all", () => {
  it("skips a catalogue directory whatever its capitals", () => {
    // The bug this pins: Android keeps its catalogue in `core/i18n` and iOS in
    // `Core/I18n`, and the skip list is a Set of lowercase names. The
    // case-sensitive lookup skipped one and scanned the other, so 1,476
    // FINISHED iOS translations — the French ones included — were reported as
    // translation work outstanding.
    expect(isScannable("apps/android/app/.../core/i18n/ShellStrings.kt", [".kt"])).toBe(
      false,
    );
    expect(isScannable("apps/ios/Loonext/Core/I18n/ShellStrings.swift", [".swift"])).toBe(
      false,
    );
  });

  it("still scans an ordinary feature file", () => {
    expect(isScannable("apps/ios/Loonext/Features/Inbox/InboxTab.swift", [".swift"])).toBe(
      true,
    );
  });

  it("skips tests, which are not read by a customer", () => {
    expect(isScannable("apps/android/.../AuthScreensTest.kt", [".kt"])).toBe(false);
  });
});

describe("the Kotlin extractor still finds real copy", () => {
  it("finds a sentence in a Text", () => {
    expect(findKotlinLiterals('Text("Your texting is live")')).toContain(
      "Your texting is live",
    );
  });

  it("finds a contentDescription, which nobody sees but TalkBack reads", () => {
    expect(
      findKotlinLiterals('Icon(x, contentDescription = "Dismiss update notice")'),
    ).toContain("Dismiss update notice");
  });

  it("finds a ONE-WORD label on a field", () => {
    // The rule that removed `blobLime` keys on a capital INSIDE a lowercase
    // token, precisely so single words of real copy survive it.
    expect(findKotlinLiterals('AuthField(label = "Country", value = v)')).toContain(
      "Country",
    );
  });

  it("finds one-word button copy", () => {
    for (const word of ["Update", "Dismiss"]) {
      expect(findKotlinLiterals(`Button(onClick = {}) { Text("${word}") }`)).toContain(
        word,
      );
    }
  });

  it("finds copy that merely CONTAINS an interpolation", () => {
    // Distinct from a literal that is nothing BUT interpolation: "Remove " is
    // a word a person reads, and it needs translating.
    expect(
      findKotlinLiterals('IconButton(contentDescription = "Remove ${entry.phone_e164}")'),
    ).toContain("Remove ${entry.phone_e164}");
  });
});

describe("the Kotlin extractor rejects what nobody reads", () => {
  it("rejects a camelCase animation label", () => {
    const source = `
      val drift by transition.animateFloat(
        animationSpec = tween(2600),
        label = "backdropDrift",
      )`;
    expect(findKotlinLiterals(source)).toEqual([]);
  });

  it("rejects an all-lowercase animation label, told apart by its siblings", () => {
    // "shimmer" has no capital to key on, so the string cannot settle this. The
    // sibling `animationSpec` is what identifies the call as an animation.
    const source = `
      val sweep by motion.animateFloat(
        animationSpec = infiniteRepeatable(tween(1200)),
        label = "sweep",
      )`;
    expect(findKotlinLiterals(source)).toEqual([]);
  });

  it("rejects an AnimatedContent label", () => {
    const source = `AnimatedContent(targetState = detail.done, label = "statusChip") { }`;
    expect(findKotlinLiterals(source)).toEqual([]);
  });

  it("rejects a literal that is nothing but interpolation", () => {
    expect(findKotlinLiterals('RawResponse(code, body, label = "$method $path")')).toEqual(
      [],
    );
  });

  it("rejects fixture copy inside a preview body", () => {
    const source = `
      @Preview(name = "In call")
      @Composable
      private fun InCallScreenPreview() {
          CallerAvatar("Jordan Lee", badge = true)
          Text("On the way to the site")
      }`;
    expect(findKotlinLiterals(source)).toEqual([]);
  });

  it("rejects fixture copy behind a MULTI-preview annotation", () => {
    // `@ResponsivePreviews` is one annotation that expands to five `@Preview`s.
    // Matching only `@Preview` left every one of these bodies in the count.
    const source = `
      @ResponsivePreviews
      @Composable
      private fun InCallScreenPreview() {
          CallerAvatar("Jordan Lee", badge = true)
      }`;
    expect(findKotlinLiterals(source)).toEqual([]);
  });

  it("does NOT let @PreviewParameter swallow a real function's body", () => {
    // The near-miss that would make this whole file a lie: `@PreviewParameter`
    // annotates an argument, not a preview, and treating it as one would strip
    // a shipping composable's copy out of the ledger.
    const source = `
      @Composable
      fun StatusRow(@PreviewParameter(P::class) state: State) {
          Text("The carriers need something changed")
      }`;
    expect(findKotlinLiterals(source)).toContain(
      "The carriers need something changed",
    );
  });

  it("keeps counting copy that FOLLOWS a preview block", () => {
    // Brace matching, checked by putting a real sentence on the other side of
    // the block. A counter that ran away would take the rest of the file with it.
    const source = `
      @Preview
      @Composable
      private fun Sample() { Text("Jordan Lee calling") }

      @Composable
      fun Real() { Text("Your texting is live") }`;
    const found = findKotlinLiterals(source);
    expect(found).toContain("Your texting is live");
    expect(found).not.toContain("Jordan Lee calling");
  });
});

describe("the sentence rule, which is where most of the copy actually is", () => {
  it("finds a sentence held in a plain assignment, not an attribute", () => {
    // `RegistrationProgress` builds a `title`, a `next` and an `expected` for
    // every carrier state. Only `title` sat in an attribute the older rules
    // knew, so the sentence a person actually reads was counted nowhere.
    const source = `
      Step(
          title = "Sent to the carriers",
          next = "The carriers review it next. Nothing needed from you.",
      )`;
    expect(findKotlinLiterals(source)).toContain(
      "The carriers review it next. Nothing needed from you.",
    );
  });

  it("finds a sentence in a when branch", () => {
    const source = `val message = when (step) {
        is GateStep.Enrol -> "This workspace needs two-factor"
        else -> "Open your authenticator app and type the six digits it shows."
    }`;
    const found = findKotlinLiterals(source);
    expect(found).toContain("This workspace needs two-factor");
    expect(found).toContain(
      "Open your authenticator app and type the six digits it shows.",
    );
  });

  it("counts one literal once when several rules see it", () => {
    // `Text("…")` is also a string literal, so without dedupe a file would
    // report twice the work left in it.
    const found = findKotlinLiterals('Text("The carriers need something changed")');
    expect(found.filter((s) => s === "The carriers need something changed")).toHaveLength(
      1,
    );
  });

  it("rejects a Swift string built only of interpolations", () => {
    // Swift's `\(…)` needed stripping of its own; only Kotlin's `${…}` was
    // handled, so every one of these counted as a sentence to translate.
    expect(findSwiftLiterals('Text("\\(facts.name) · \\(facts.price)")')).toEqual([]);
  });

  it("still counts Swift copy that merely contains an interpolation", () => {
    expect(findSwiftLiterals('Text("Current period ends \\(date).")')).toContain(
      "Current period ends \\(date).",
    );
  });

  it("rejects a date format pattern", () => {
    // Every token is one letter repeated — `MMMM`, `yyyy`. No English word is
    // built that way, so this rule cannot swallow copy.
    expect(findKotlinLiterals('val fmt = "MMMM d, yyyy"')).toEqual([]);
    expect(findKotlinLiterals('val fmt = "EEE, d MMM yyyy"')).toEqual([]);
  });

  it("rejects a Kotlin precondition's message lambda", () => {
    const source =
      'require(length in 43..128) { "PKCE verifier must be 43-128 chars" }';
    expect(findKotlinLiterals(source)).toEqual([]);
  });

  it("still counts a sentence thrown as an error", () => {
    // The reason the precondition rule is narrow rather than "anything that
    // looks like an assertion". Measured on this repo, the broad version
    // rejected 26 literals of which 24 were real copy — errors carry sentences
    // the UI renders verbatim.
    expect(
      findKotlinLiterals('throw ApiException("Calling is temporarily unavailable.")'),
    ).toContain("Calling is temporarily unavailable.");
  });

  it("does NOT reject a sentence made of short words", () => {
    // The nearest real sentence to a date pattern: several short tokens. It
    // survives because its tokens are not single repeated letters.
    expect(findKotlinLiterals('val s = "We do not have it yet"')).toContain(
      "We do not have it yet",
    );
  });
});

describe("the Swift extractor", () => {
  it("finds a sentence in a Text", () => {
    expect(findSwiftLiterals('Text("Your texting is live")')).toContain(
      "Your texting is live",
    );
  });

  it("finds an accessibilityLabel", () => {
    expect(
      findSwiftLiterals('.accessibilityLabel("Dismiss update notice")'),
    ).toContain("Dismiss update notice");
  });

  it("rejects fixture copy inside a #Preview", () => {
    const source = `
      #Preview("In call") {
          InCallView(caller: "Jordan Lee")
          Text("On the way to the site")
      }`;
    expect(findSwiftLiterals(source)).toEqual([]);
  });

  it("keeps counting copy that follows a #Preview", () => {
    const source = `
      #Preview { Text("Jordan Lee calling") }

      struct Real: View { var body: some View { Text("Your texting is live") } }`;
    const found = findSwiftLiterals(source);
    expect(found).toContain("Your texting is live");
    expect(found).not.toContain("Jordan Lee calling");
  });
});
