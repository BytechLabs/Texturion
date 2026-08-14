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

const { findKotlinLiterals, findSwiftLiterals } = (await import(
  join(REPO, "scripts", "check-hardcoded-strings.mjs")
)) as {
  findKotlinLiterals: (source: string) => string[];
  findSwiftLiterals: (source: string) => string[];
};

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
