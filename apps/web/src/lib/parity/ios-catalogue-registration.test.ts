/**
 * Every iOS catalogue section is registered, and the check derives the answer.
 *
 * ## The defect this exists for
 *
 * `AppStrings.swift` says it out loud: "A section missing from this list is
 * unreachable, which the tests check." The test that was supposed to check it
 * reads:
 *
 *     let names = AppStrings.sections.map(\.name)
 *     XCTAssertTrue(names.contains("CommonStrings"))
 *     XCTAssertTrue(names.contains("PaymentsStrings"))
 *
 * Those two have been registered since the day the file existed and cannot
 * stop being, so the assertion has never been capable of failing. Its own
 * comment names the mistake it cannot catch — "writing a section file and
 * forgetting the line in `sections`. It would compile, its own tests would
 * pass, and every screen reading it would render bare keys."
 *
 * That is not hypothetical. #243's `WebhooksStrings.swift` was written,
 * generated, guarded by `check-ios-catalogue-keys`, and left out of the list.
 * Every sentence on the new screen would have rendered as its own key on a
 * customer's phone, in both languages, and nothing in the repository would
 * have said so.
 *
 * ## Why it lives here and not in Swift
 *
 * The Swift test would need to read the source tree from inside a unit test,
 * and iOS compiles only in CI — so a mistake in the guard itself would cost a
 * full red-main round trip to discover. This runs in the fast gate, locally,
 * against the same two files. The Swift test stays as it is; this is the half
 * that can actually fail.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const I18N_DIR = join(REPO_ROOT, "apps/ios/Loonext/Core/I18n");

/**
 * Files in `Core/I18n` that are not catalogue sections.
 *
 * Named rather than pattern-matched, so a new one has to be a decision. Both
 * of these are machinery: the registry itself, and the locale vocabulary.
 */
const NOT_SECTIONS = new Set(["AppStrings.swift", "UiLocale.swift"]);

describe("the iOS catalogue registry knows about every section", () => {
  const files = readdirSync(I18N_DIR).filter(
    (name) => name.endsWith(".swift") && !NOT_SECTIONS.has(name),
  );
  const registry = readFileSync(join(I18N_DIR, "AppStrings.swift"), "utf8");

  it("finds section files at all, so an empty read cannot pass this", () => {
    // Without this, a wrong path would make `files` empty and every assertion
    // below would vacuously agree — the shape of a guard that has quietly
    // stopped guarding, which is the exact fault it was written to replace.
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const enumName = file.replace(/\.swift$/, "");
    it(`${enumName} is in AppStrings.sections`, () => {
      // The registry line is `WebhooksStrings.section,` — matched precisely so
      // a mention in a comment or a docstring does not count as registration.
      const registered = new RegExp(
        `^\\s*${enumName}\\.section,\\s*$`,
        "m",
      ).test(registry);
      expect(
        registered,
        `${file} defines a catalogue section that AppStrings.sections never lists. ` +
          `Every screen reading it renders bare keys, in both languages.`,
      ).toBe(true);
    });

    it(`${enumName} declares the name AppStrings reports it by`, () => {
      // `Section.name` exists so a failing test can say WHICH section
      // disagrees with itself. A name that does not match the file is a report
      // that sends the next person to the wrong place.
      const source = readFileSync(join(I18N_DIR, file), "utf8");
      expect(source).toContain(`name: "${enumName}"`);
    });
  }
});
