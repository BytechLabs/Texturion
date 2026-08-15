import { readFileSync } from "node:fs";
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

import { DEFAULT_REMINDER_RULES } from "./appointment-reminders";
import { DEFAULT_MCTB_MESSAGE } from "./mctb";
import { EMERGENCY_SAFETY_LINE } from "./emergency";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { findKotlinLiterals, findSwiftLiterals, findWebLiterals, isScannable } = (await import(
  join(REPO, "scripts", "check-hardcoded-strings.mjs")
)) as {
  findKotlinLiterals: (source: string) => string[];
  findWebLiterals: (source: string, path?: string) => string[];
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

  it("skips locale.ts, whose French is finished rather than outstanding", () => {
    // A catalogue that is one file rather than a directory, so SKIP_DIRS cannot
    // see it. Scanning it counted fifteen completed French message bodies as
    // French translations still to do.
    expect(isScannable("packages/shared/src/locale.ts", [".ts"])).toBe(false);
  });

  it("still scans the shared modules whose copy every client renders", () => {
    // The blind spot the fourth ledger exists for: 325 sentences, none counted,
    // while the web ledger read 26 and implied the app was nearly finished.
    expect(isScannable("packages/shared/src/send-failures.ts", [".ts"])).toBe(true);
  });

  it("does not let the locale.ts skip swallow a same-named file elsewhere", () => {
    expect(isScannable("apps/web/src/lib/locale.ts", [".ts"])).toBe(true);
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

  it("rejects a sentence that only logcat will ever read", () => {
    expect(
      findKotlinLiterals(
        'Log.w(TAG, "Device push token registration failed.", cause)',
      ),
    ).toEqual([]);
  });

  it("rejects a log from this app's own logger, not just android.util.Log", () => {
    expect(
      findKotlinLiterals(
        'CallFlowLog.log("socket", "Socket reconnected after the network came back.")',
      ),
    ).toEqual([]);
  });

  /*
   * The rule that would have been wrong. A wider "looks diagnostic" exclusion
   * takes this with it, and this one IS on a screen — it is what somebody reads
   * when a call will not connect. The receiver has to be a log, and
   * `CallStateMachine` is not.
   */
  it("still counts a sentence thrown by something that merely sounds diagnostic", () => {
    expect(
      findKotlinLiterals(
        'CallStateMachine.error(down, "Calling is temporarily unavailable.")',
      ),
    ).toEqual(["Calling is temporarily unavailable."]);
  });

  it("still counts copy on the line AFTER a log call", () => {
    expect(
      findKotlinLiterals(
        'Log.i(TAG, "Device push token registered.")\nText("Your number is ready to use.")',
      ),
    ).toEqual(["Your number is ready to use."]);
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

describe("the web extractor knows a generic from a tag", () => {
  it("does not read a .ts module's interfaces as JSX text", () => {
    /*
     * The JSX rule matches between a `>` and the next `<` and allows newlines,
     * which is correct for markup and catastrophic for a plain module: in
     * `lib/api/types.ts` it ran from the `>` closing one generic to the `<`
     * opening the next and reported every line between as copy. That file was
     * credited with 66 literals — `export interface Membership` among them,
     * which is not a string at all — and 66 was 53% of the entire web ledger.
     */
    const source = [
      "export interface Wrapper {",
      "  rows: Record<string, string>;",
      "}",
      "",
      "export interface Membership {",
      "  role: string;",
      "}",
      "",
      "export type Bag = Array<Membership>;",
    ].join("\n");
    expect(findWebLiterals(source, "apps/web/src/lib/api/types.ts")).toEqual([]);
  });

  it("still reads real JSX text in a .tsx component", () => {
    // The other half. `.ts` is scanned for rule 4's sake, and skipping the
    // tag-shaped rules there must not blind them where tags actually live.
    const source = "<p>Your subscription has lapsed, so this has not been sent.</p>";
    expect(findWebLiterals(source, "apps/web/src/components/x.tsx")).toContain(
      "Your subscription has lapsed, so this has not been sent.",
    );
  });

  it("still reads a sentence held in a .ts module", () => {
    // Rule 4 is exactly why `.ts` is scanned at all, so it must survive.
    const source = 'export const copy = { lapsed: "Your subscription has lapsed." };';
    expect(findWebLiterals(source, "apps/web/src/lib/copy.ts")).toContain(
      "Your subscription has lapsed.",
    );
  });
});

describe("the Swift extractor", () => {
  it("rejects a sentence only the Console will ever read", () => {
    expect(
      findSwiftLiterals(
        'let pushLog = Logger(subsystem: "app", category: "push")\n' +
          'pushLog.info("Device push token registered.")',
      ),
    ).toEqual([]);
  });

  /*
   * The reason the rule reads the declarations instead of matching names. A
   * method list alone would take this with it, and `.error` on something that
   * is not a logger is how a Swift view model hands a sentence to the screen.
   */
  it("still counts .error on a value that was never declared a Logger", () => {
    // The declaration has to be PRESENT for this to test anything. Without one
    // the rule short-circuits on "this file has no loggers" and the assertion
    // passes for a reason that has nothing to do with what it claims to check.
    expect(
      findSwiftLiterals(
        'let pushLog = Logger(subsystem: "app", category: "push")\n' +
          'state.error("We could not reach your number.")',
      ),
    ).toEqual(["We could not reach your number."]);
  });

  it("still counts copy on the line AFTER a log call", () => {
    expect(
      findSwiftLiterals(
        'let pushLog = Logger(subsystem: "app", category: "push")\n' +
          'pushLog.info("Device push token registered.")\n' +
          'Text("Your number is ready to use.")',
      ),
    ).toEqual(["Your number is ready to use."]);
  });

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

describe("#228 a statement is not a sentence", () => {
  /**
   * Nineteen of the web ledger's forty-five entries were shapes like these —
   * `finally` six times, `catch (cause)`, `interface NavRow`. Every one of them
   * sent whoever picked the file up next to look at a keyword.
   *
   * Each exclusion below is paired with the nearest REAL sentence it must not
   * eat, because a guard that silently drops copy is the failure this whole
   * file exists to prevent.
   */
  it("drops a reserved word standing alone", () => {
    for (const code of ["finally", "const", "catch", "interface"]) {
      expect(findWebLiterals(`<p>${code}</p>`, "a.tsx")).toEqual([]);
    }
  });

  it("drops a statement that OPENS with a reserved word", () => {
    for (const code of [
      "catch (cause)",
      "if (data.session)",
      "interface NavRow",
      "as const satisfies Record",
      "typeof window",
    ]) {
      expect(findWebLiterals(`<p>${code}</p>`, "a.tsx"), code).toEqual([]);
    }
  });

  it("keeps copy that merely CONTAINS a reserved word", () => {
    // THE ONE THAT MATTERS. "Delete this if you are sure" contains `if`, and a
    // rule reading "contains a keyword" would eat it. The rule keys on the
    // word OPENING the text, which a sentence about deleting does not.
    const kept = [
      "Delete this if you are sure.",
      "Try again in a moment.",
      "New customers are added here.",
      "Export everything as a spreadsheet.",
    ];
    for (const copy of kept) {
      expect(findWebLiterals(`<p>${copy}</p>`, "a.tsx"), copy).toContain(copy);
    }
  });

  it("keeps a one-word label that is not a keyword", () => {
    // The rule has to be narrow enough that "Update", "Dismiss" and "Back"
    // survive — those are real buttons, and they are one word each.
    for (const label of ["Update", "Dismiss", "Back", "Waiting"]) {
      expect(findWebLiterals(`<p>${label}</p>`, "a.tsx"), label).toContain(label);
    }
  });

  it("drops an expression carrying a boolean or arrow operator", () => {
    for (const code of [
      "0 && !markAllRead.isPending)",
      "value === other",
      "left !== right",
    ]) {
      expect(findWebLiterals(`<p>${code}</p>`, "a.tsx"), code).toEqual([]);
    }
  });

  it("keeps an ampersand a person would actually type", () => {
    // `&&` is code; a single `&` is how a trade writes its own name.
    const copy = "Ace Plumbing & Heating";
    expect(findWebLiterals(`<p>${copy}</p>`, "a.tsx")).toContain(copy);
  });
});

/*
 * #228 — a finished translation, read from the wrong end.
 *
 * `locale.ts` holds the French for every automated message and imports the
 * English from the module that owns it, so each of those sentences is one half
 * of a completed pair. Counting the English half as outstanding is the same
 * mistake that had the ledger reporting iOS's finished catalogue as work to do,
 * and it is the reason the shared count could never legitimately reach zero.
 */
describe("the ledger does not count a finished bilingual pair", () => {
  it("skips a carrier message whose French locale.ts already holds", () => {
    // The real constant, not a fixture: the rule reads locale.ts's imports, so
    // a made-up sentence would prove nothing about the mechanism.
    expect(findWebLiterals(`const x = ${JSON.stringify(EMERGENCY_SAFETY_LINE)};`)).toEqual([]);
    expect(
      findWebLiterals(`const x = ${JSON.stringify(DEFAULT_MCTB_MESSAGE)};`),
    ).toEqual([]);
  });

  it("still counts an ordinary sentence in the same file", () => {
    // The half that makes the rule safe. It excludes six named constants, not
    // "anything that looks like a text message" — a rule keyed on the shape of
    // the sentence would have swallowed most of the shared package.
    expect(
      findWebLiterals('const x = "Type a word first, then we can check it.";'),
    ).toEqual(["Type a word first, then we can check it."]);
  });

  /*
   * The join was not enough, which is how six finished bodies sat in the
   * ledger.
   *
   * A message long enough to need translating is long enough to be written as
   * a `+` chain across several lines, and the scan asks about ONE quoted run
   * at a time. The exclusion held the whole sentence and the scan asked about
   * its first line, so it missed every multi-line body: four modules, six
   * bodies, all of them already paired in `FR_CA_COPY`.
   *
   * Read out of the source rather than quoted here. What this pins is that
   * each RUN is excluded, and a test that named the runs would have to be
   * edited every time somebody rewords a default — which is how a pin turns
   * into a ceiling.
   */
  it("skips every line of a body written as a + chain", () => {
    const source = readFileSync(join(REPO, "packages", "shared", "src", "mctb.ts"), "utf8");
    const declaration = /export const DEFAULT_MCTB_MESSAGE\s*=\s*([\s\S]*?);/.exec(source);
    const runs = [...(declaration?.[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

    // Coverage before verdict: on a one-run constant every assertion below
    // passes without exercising the rule at all.
    expect(runs.length, "DEFAULT_MCTB_MESSAGE is no longer a multi-run body").toBeGreaterThan(1);
    for (const run of runs) {
      expect(findWebLiterals(`const x = ${JSON.stringify(run)};`), run).toEqual([]);
    }
  });

  it("skips the reminder bodies, which live inside an array", () => {
    // `DEFAULT_REMINDER_RULES` is a list of {offset_minutes, body}. The offsets
    // are the language-independent half and the bodies are paired in
    // `FR_CA_COPY.appointmentReminders` like every other automated message —
    // but this function's own note used to say an array had "no single
    // sentence to exclude", which was true of the array and not of what is in
    // it.
    expect(DEFAULT_REMINDER_RULES.length, "the ladder is empty").toBeGreaterThan(0);
    for (const rule of DEFAULT_REMINDER_RULES) {
      expect(findWebLiterals(`const x = ${JSON.stringify(rule.body)};`), rule.body).toEqual([]);
    }
  });

  it("does not excuse a + chain nobody paired", () => {
    // The negative half, and the one that matters: the rule is keyed on
    // locale.ts importing the constant, NOT on the sentence arriving in
    // pieces. Without this, "excluded because it was concatenated" would look
    // exactly like "excluded because it was translated".
    expect(
      findWebLiterals(
        'const x = "Nobody translated this sentence into French. " +\n' +
          '  "Nobody translated this one either, so both are still owed.";',
      ),
    ).toEqual([
      "Nobody translated this sentence into French. ",
      "Nobody translated this one either, so both are still owed.",
    ]);
  });
});
