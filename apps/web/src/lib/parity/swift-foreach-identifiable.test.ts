/**
 * `ForEach(collection)` needs an Identifiable element, or an explicit `id:`.
 *
 * WHY THIS IS A TYPESCRIPT TEST. Same reason as its two neighbours in this
 * directory: there is no Xcode on the machines this repo is written on, so CI's
 * `Gate / iOS` job is the first thing that compiles Swift, and a break found
 * there costs a red main and a second push.
 *
 * THE BREAK THIS TRANSCRIBES. `ForEach(roster) { member in … }` over a
 * `[Member]` — and `Member` is a plain `Codable, Sendable` struct. Swift's
 * answer is "referencing initializer 'init(_:content:)' on 'ForEach' requires
 * that 'Member' conform to 'Identifiable'". It reads as obviously fine, because
 * a dozen other `ForEach(x)` calls in this codebase have no `id:` either — the
 * difference is invisible at the call site and lives on the model.
 *
 * WHAT THIS DOES NOT DO. It is not a type checker. It resolves a collection's
 * element type only when the property is declared in the SAME file, which is
 * the shape SwiftUI views actually take (`@State private var roster: [Member]`)
 * and the shape the break took. Anything it cannot resolve, it leaves alone —
 * a guard that guesses produces false failures, and a guard people learn to
 * override is worse than no guard.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const IOS_ROOT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "apps/ios/Loonext",
);

function swiftFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...swiftFiles(path));
    else if (entry.endsWith(".swift")) found.push(path);
  }
  return found;
}

/** Every type declared Identifiable anywhere in the iOS sources. */
function identifiableTypes(files: string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /\b(?:struct|class|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\n{]+)/g,
    )) {
      if (/\bIdentifiable\b/.test(match[2])) names.add(match[1]);
    }
    // `extension Foo: Identifiable` counts too.
    for (const match of text.matchAll(
      /\bextension\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\n{]+)/g,
    )) {
      if (/\bIdentifiable\b/.test(match[2])) names.add(match[1]);
    }
  }
  return names;
}

/** Element types of array-typed properties declared in this file. */
function arrayProperties(text: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const match of text.matchAll(
    /\b(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[([A-Za-z_][A-Za-z0-9_]*)\]/g,
  )) {
    properties.set(match[1], match[2]);
  }
  return properties;
}

describe("a SwiftUI ForEach can identify what it iterates", () => {
  const files = swiftFiles(IOS_ROOT);
  const identifiable = identifiableTypes(files);

  it("reads the iOS sources, so a passing run means something", () => {
    expect(files.length).toBeGreaterThan(50);
    // If this collapses, every check below passes by knowing nothing.
    expect(identifiable.size).toBeGreaterThan(5);
  });

  it("iterates only Identifiable elements, or names an id", () => {
    const problems: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const short = file.slice(file.indexOf("Loonext"));
      const properties = arrayProperties(text);

      for (const call of text.matchAll(
        /\bForEach\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
      )) {
        const element = properties.get(call[1]);
        // Unresolvable — a computed property, a parameter, another file. Left
        // alone deliberately; see the header.
        if (!element) continue;
        if (identifiable.has(element)) continue;

        const line = text.slice(0, call.index ?? 0).split("\n").length;
        problems.push(
          `${short}:${line} — ForEach(${call[1]}) iterates [${element}], ` +
            `which is not Identifiable. Pass id: \\.something.`,
        );
      }
    }

    expect(
      problems,
      "A SwiftUI ForEach cannot identify its elements. Swift refuses to " +
        "compile these:\n  " + problems.join("\n  "),
    ).toEqual([]);
  });
});
