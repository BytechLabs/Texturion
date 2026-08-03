/**
 * #291 — the parity tests' own reader, which was wrong in a way that made
 * three of them read a file with a hole in it.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parityCode } from "./parity-source";

function fixture(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return path;
}

describe("#291 the parity source reader", () => {
  it("PS-1: does not treat a MIME type as the start of a comment", () => {
    // THE BUG. `arrayOf("text/*", …)` in ContactsTab.kt opened a block comment
    // that the naive stripper closed at the next doc block, deleting four
    // hundred lines. The assertion reading that file then checked nothing, and
    // said so by passing.
    const path = fixture(
      "Tab.kt",
      [
        'val kinds = arrayOf("text/*", "text/vcard")',
        "",
        "/** A doc block, well after it. */",
        "",
        'val copy = "Nobody matches that yet"',
      ].join("\n"),
    );
    const code = parityCode(path);
    expect(code).toContain("Nobody matches that yet");
    expect(code).toContain('arrayOf("text/*"');
  });

  it("PS-2: still removes the doc blocks it exists to remove", () => {
    // The whole point: prose about a rule must not satisfy an assertion about
    // the rule.
    const path = fixture(
      "Card.tsx",
      [
        "/**",
        ' * Why "Not asked" is a third state and not a no.',
        " */",
        "export const label = \"Yes\";",
      ].join("\n"),
    );
    const code = parityCode(path);
    expect(code).not.toContain("Not asked");
    expect(code).toContain('export const label = "Yes";');
  });

  it("PS-3: removes line comments without eating a URL in a string", () => {
    const path = fixture(
      "Api.swift",
      [
        '        let base = "https://example.test/v1"  // the API root',
        '        let keep = "kept"',
      ].join("\n"),
    );
    const code = parityCode(path);
    expect(code).not.toContain("the API root");
    expect(code).toContain("https://example.test/v1");
    expect(code).toContain('let keep = "kept"');
  });

  it("PS-4: leaves an indented doc block stripped, and its neighbours intact", () => {
    const path = fixture(
      "Nested.kt",
      [
        "class A {",
        "    /** Explains the rule using the word Everyone. */",
        '    val chip = "Everyone"',
        "}",
      ].join("\n"),
    );
    const code = parityCode(path);
    // One occurrence, from the code — not two, one of which is the comment.
    expect(code.split("Everyone").length - 1).toBe(1);
  });
});
