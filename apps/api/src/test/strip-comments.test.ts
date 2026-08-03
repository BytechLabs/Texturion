/**
 * #519 — the shared comment stripper, which four guards depend on and which
 * was wrong in a way that made them stop looking without saying so.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { productionSources, sourceText, stripComments } from "./source-tree";

const API_SRC = join(import.meta.dirname, "..");

describe("#519 stripComments", () => {
  it("SC-1: does not open a comment inside a string literal", () => {
    // THE BUG. `image/*` in attachments.ts opened a block comment that the old
    // regex closed at the next doc block, blanking everything between — so any
    // query in that region was outside the tenant-scope scan and nothing said
    // so. The reach of the highest-stakes guard in this repo was decided by
    // where a slash-star happened to fall in an unrelated MIME type.
    const source = [
      'const accept = `image/*`;',
      "",
      "/** A doc block, well after it. */",
      "",
      'const query = db.from("tasks").eq("company_id", id);',
    ].join("\n");
    const stripped = stripComments(source);
    expect(stripped).toContain('db.from("tasks")');
    expect(stripped).toContain("image/*");
    expect(stripped).not.toContain("A doc block");
  });

  it("SC-2: still removes the comments it exists to remove", () => {
    // Both shapes, and the reason: a docstring is full of commas and
    // semicolons, and `db-scope` cuts a statement window at the first one.
    const source = [
      "/**",
      " * A sentence with a comma, and a semicolon; both of them.",
      " */",
      'db.from("tasks")',
      '  .eq("company_id", id); // trailing prose, with a comma',
    ].join("\n");
    const stripped = stripComments(source);
    expect(stripped).not.toContain("A sentence with a comma");
    expect(stripped).not.toContain("trailing prose");
    expect(stripped).toContain('db.from("tasks")');
    expect(stripped).toContain('.eq("company_id", id);');
  });

  it("SC-3: keeps every offset and line number exact", () => {
    // `db-scope` slices a window out of the result by index, so a stripper
    // that shortened the text would point its failures at the wrong line.
    const source = [
      "const a = 1; /* gone */ const b = 2;",
      "// gone too",
      "const c = 3;",
    ].join("\n");
    const stripped = stripComments(source);
    expect(stripped.length).toBe(source.length);
    expect(stripped.split("\n").length).toBe(source.split("\n").length);
    expect(stripped.indexOf("const b")).toBe(source.indexOf("const b"));
  });

  it("SC-4: leaves a URL inside a string alone", () => {
    const source = 'const base = "https://example.test/v1"; // the API root';
    const stripped = stripComments(source);
    expect(stripped).toContain("https://example.test/v1");
    expect(stripped).not.toContain("the API root");
  });

  it("SC-5: hides no query anywhere in the real tree", () => {
    // The property the guards actually need, asserted against the tree rather
    // than a fixture: stripping comments must never remove a `.from(` call.
    // If it does, the tenant-scope scan is not looking at that query and its
    // "436 sites checked" is a count of what it happened to see.
    // Counted on CODE lines only. A docblock that mentions `.from(` in prose
    // — this file's own does — is a comment, and removing it is the whole
    // point. The proxy is deliberately crude and stated as one: a line whose
    // first non-space character opens or continues a comment is not code.
    const codeFroms = (source: string): number =>
      source
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n")
        .match(/\.from\(/g)?.length ?? 0;

    const hiding: string[] = [];
    for (const path of productionSources(API_SRC)) {
      const source = sourceText(path);
      const before = codeFroms(source);
      const after = codeFroms(stripComments(source));
      if (before !== after) {
        hiding.push(`${path.slice(API_SRC.length)} (${before - after} hidden)`);
      }
    }
    expect(
      hiding,
      "Stripping comments removed queries from these files, so the " +
        "tenant-scope scan cannot see them:\n  " + hiding.join("\n  "),
    ).toEqual([]);
  });
});
