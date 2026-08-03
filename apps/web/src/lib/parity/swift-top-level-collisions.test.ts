/**
 * Swift breaks that only CI can see, caught before the push.
 *
 * WHY THIS IS A TYPESCRIPT TEST. There is no Xcode on the machines this repo is
 * written on, so CI's `Gate / iOS` job is the first and only thing that compiles
 * Swift. Every Swift-only break therefore reaches main, goes red, and is found
 * one push later — twice in a row during #233, on two different mistakes.
 *
 * Each check below is one of those mistakes, generalised no further than the
 * shape that actually happened. A guard invented for a break that has not
 * occurred is a guess; these are transcriptions.
 *
 * ---------------------------------------------------------------------------
 * 1. A `private` top-level helper may not shadow an `internal` one.
 *
 * `ScheduledSend.swift` added a `private func daysUntilNextMonday(_:calendar:)`
 * that `SnoozeLogic.swift` already declared without a modifier, and Swift
 * answered "invalid redeclaration".
 *
 * `private` AT TOP LEVEL IS THE TRAP, and the shape of the trap is specific:
 *
 *  - two `private` helpers with the same signature in different files are FINE
 *    — top-level `private` scopes the name to its file, and this codebase does
 *    it deliberately (`previewCall`, `previewTask` in the SwiftUI previews);
 *  - two `internal` ones with the same name and different parameter types are
 *    an ordinary overload, also fine (`formatBytes(_: Int)` and
 *    `formatBytes(_: Int?)`);
 *  - one of each is the redeclaration. It reads like the safest of the three —
 *    `private` looks like it is keeping the copy out of everyone's way, and the
 *    ScheduledSend one even carried a comment explaining why it was a
 *    deliberate copy rather than a call — and it is the one that does not
 *    compile.
 *
 * So this checks exactly that mix, which is why it has no allowlist: a rule
 * with no false positives does not need an escape hatch, and an escape hatch is
 * how a guard becomes a formality.
 *
 * ---------------------------------------------------------------------------
 * 2. A struct holding a property wrapper cannot synthesise `Equatable`.
 *
 * `@Default<DefaultEmptyString> var phone_e164: String` stores a `Default<…>`,
 * not a `String`, and that wrapper is not Equatable — so `struct X: Equatable`
 * fails with "does not conform to protocol". The wrapper exists for decoding
 * resilience and is used on dozens of models here; `Equatable` is the thing
 * that has to give, and it is nearly always reached for out of habit rather
 * than because anything compares the value.
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
  "apps/ios",
);

function swiftFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Build products and package checkouts are not ours to police, and
    // Starscream alone would bury the signal.
    if (entry === "build" || entry === ".build" || entry === "DerivedData") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      swiftFiles(path, out);
    } else if (entry.endsWith(".swift")) {
      out.push(path);
    }
  }
  return out;
}

interface Declaration {
  /** `daysUntilNextMonday(_:calendar:)` — the name Swift actually resolves. */
  signature: string;
  fileScoped: boolean;
}

/**
 * Top-level function declarations, with their argument labels.
 *
 * Anchored to column zero, which is what makes "top level" mechanical rather
 * than a parse: anything nested inside a type or a function is indented in this
 * codebase, and anything at column zero is in the module namespace.
 *
 * Only `func` — a type cannot be overloaded, so a duplicate `struct` name is a
 * plain redeclaration the compiler catches for every access level, and the
 * private/internal subtlety this file exists for does not arise.
 */
function topLevelFunctions(source: string): Declaration[] {
  const pattern = /^(private |fileprivate |public |internal )?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/gm;
  const found: Declaration[] = [];
  for (const match of source.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const params = balancedSlice(source, open);
    if (params === null) continue;
    found.push({
      signature: `${match[2]}(${argumentLabels(params).join("")})`,
      fileScoped:
        match[1] === "private " || match[1] === "fileprivate ",
    });
  }
  return found;
}

/** The text inside the parens starting at `open`, or null if unbalanced. */
function balancedSlice(source: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(" || char === "[" || char === "<") depth += 1;
    if (char === ")" || char === "]" || char === ">") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * `["_:", "calendar:"]` for `(_ date: Date, calendar: Calendar)`.
 *
 * The external label is what Swift resolves on: the first token when there are
 * two before the colon, otherwise the parameter name itself.
 */
function argumentLabels(params: string): string[] {
  if (params.trim() === "") return [];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of params) {
    if (char === "(" || char === "[" || char === "<") depth += 1;
    if (char === ")" || char === "]" || char === ">") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => {
    const head = part.split(":")[0].trim().split(/\s+/);
    return `${head[0]}:`;
  });
}

describe("Swift top-level helpers", () => {
  const files = swiftFiles(IOS_ROOT);

  it("finds the Swift sources, so a move cannot make this vacuous", () => {
    // A path that stopped resolving would make the assertion below pass by
    // checking nothing at all.
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no private copy of a helper that already exists module-wide", () => {
    const bySignature = new Map<
      string,
      { file: string; fileScoped: boolean }[]
    >();
    for (const file of files) {
      const relative = file.slice(IOS_ROOT.length + 1).replace(/\\/g, "/");
      for (const decl of topLevelFunctions(readFileSync(file, "utf8"))) {
        bySignature.set(decl.signature, [
          ...(bySignature.get(decl.signature) ?? []),
          { file: relative, fileScoped: decl.fileScoped },
        ]);
      }
    }

    const collisions = [...bySignature.entries()]
      .filter(([, sites]) => {
        // Overloads inside ONE file are the author's deliberate choice, and the
        // compiler checks those on every build.
        const files = new Set(sites.map((s) => s.file));
        if (files.size < 2) return false;
        // The only illegal mix: a file-scoped copy of a module-wide name.
        return (
          sites.some((s) => s.fileScoped) && sites.some((s) => !s.fileScoped)
        );
      })
      .map(
        ([signature, sites]) =>
          `  ${signature}\n` +
          sites
            .map(
              (s) => `    ${s.fileScoped ? "private " : "internal"} ${s.file}`,
            )
            .join("\n"),
      );

    expect(
      collisions,
      `\n\nA private top-level func shadows a module-wide one of the same\n` +
        `signature. Swift answers "invalid redeclaration" — \`private\` does NOT\n` +
        `avoid it, because the declaration still occupies the module namespace:\n\n` +
        collisions.join("\n") +
        `\n\nRename the private one so it says whose it is (e.g. a feature\n` +
        `prefix), or call the existing one if it is genuinely the same helper.\n`,
    ).toEqual([]);
  });

  it("declares no Equatable type that stores a property wrapper", () => {
    // A wrapped property stores the WRAPPER, and `Default<…>` is not Equatable,
    // so the synthesised conformance fails to compile. Scoped to the wrappers
    // this repo actually has rather than to `@` in general: `@MainActor` and
    // `@Observable` sit on types all over the codebase and are not storage.
    const offenders: string[] = [];
    for (const file of files) {
      const relative = file.slice(IOS_ROOT.length + 1).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      // Each `struct … {` and the body up to the first line-start `}` — the
      // same column-zero rule the top-level scan uses, so a nested type cannot
      // be mistaken for the one being declared.
      for (const match of source.matchAll(
        /^(?:(?:public|internal|fileprivate|private|final)\s+)*struct\s+(\w+)\s*:([^{]*)\{([\s\S]*?)\n\}/gm,
      )) {
        const [, name, conformances, body] = match;
        if (!/\bEquatable\b/.test(conformances)) continue;
        const wrapped = [...body.matchAll(/^\s*@(Default)</gm)];
        if (wrapped.length > 0) offenders.push(`${name} (${relative})`);
      }
    }

    expect(
      offenders,
      `\n\nThese Swift structs declare Equatable and store a property wrapper:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\n\nA wrapped property stores the wrapper, and \`Default<…>\` is not\n` +
        `Equatable, so the synthesised conformance does not compile. Drop\n` +
        `Equatable — it is almost always reached for out of habit, and\n` +
        `Identifiable is what SwiftUI lists actually need — or write \`==\` by\n` +
        `hand over the unwrapped values.\n`,
    ).toEqual([]);
  });
});
