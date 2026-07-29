/**
 * A Swift attribute must stay attached to the declaration it modifies.
 *
 * This exists because the failure is silent in the worst way. Inserting a new
 * declaration "before `private struct Foo`" is the obvious edit, and when an
 * attribute line sits above that struct the insertion lands BETWEEN them:
 *
 *     /// Doc comment about Foo.
 *     @MainActor          ← now modifies Bar
 *     /// Doc comment about Bar.
 *     private struct Bar { … }
 *
 *     private struct Foo { … }   ← lost its @MainActor and its documentation
 *
 * Three things break at once and only one of them is loud. Foo silently loses
 * the attribute; Bar silently gains one; and Foo's documentation now sits above
 * Bar, describing something it is not attached to. If Bar already declared the
 * same attribute the compiler catches it — "declaration can not have multiple
 * global actor attributes" — and if it did not, nothing catches it at all.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES HERE RATHER THAN IN THE iOS BUILD.
 *
 * There is no Xcode on the machines this repository is usually edited from, so
 * the first signal is a macOS CI job several minutes into a run. This check is
 * a regex over text: it runs on the Linux gate in under a second, and it
 * catches the version the compiler cannot see at all.
 *
 * It is not a Swift parser and does not pretend to be. It asserts one thing:
 * between an attribute and its declaration there is nothing but more
 * attributes. Doc comments belong above the attribute, which is also the
 * convention every file here already follows.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const IOS_ROOT = join(__dirname, "..", "..", "..", "apps", "ios");

function swiftFiles(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "build" || entry === ".build" || entry === "DerivedData") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(swiftFiles(full));
    else if (entry.endsWith(".swift")) out.push(full);
  }
  return out;
}

/** A line that is nothing but an attribute, e.g. `@MainActor`. */
const BARE_ATTRIBUTE = /^\s*@[A-Za-z_][A-Za-z0-9_]*\s*$/;
/** Another attribute, possibly with arguments — fine to follow one. */
const ANY_ATTRIBUTE = /^\s*@[A-Za-z_]/;
const DOC_COMMENT = /^\s*\/\/\//;

describe("Swift attributes stay attached to their declarations", () => {
  const files = swiftFiles(IOS_ROOT);

  it("finds the iOS sources at all", () => {
    // A scan that silently matched nothing would pass forever.
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no attribute separated from its declaration by a doc comment", () => {
    const offences: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length - 1; i += 1) {
        if (!BARE_ATTRIBUTE.test(lines[i])) continue;
        const next = lines[i + 1];
        // Another attribute is a legitimate stack (@MainActor @Observable).
        if (ANY_ATTRIBUTE.test(next)) continue;
        if (!DOC_COMMENT.test(next)) continue;
        offences.push(
          `${file.slice(IOS_ROOT.length + 1)}:${i + 1} — ` +
            `${lines[i].trim()} is separated from its declaration by a doc comment`,
        );
      }
    }
    expect(offences).toEqual([]);
  });
});
