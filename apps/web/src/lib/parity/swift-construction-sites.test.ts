/**
 * A new required parameter must reach every call site in the same file.
 *
 * WHY THIS IS A TYPESCRIPT TEST. Same reason as its neighbour
 * `swift-top-level-collisions.test.ts`: there is no Xcode on the machines this
 * repo is written on, so CI's `Gate / iOS` job is the first thing that compiles
 * Swift. A break found there costs a red main and a second push.
 *
 * THE BREAK THIS TRANSCRIBES, which has now happened twice on different issues.
 * Adding `let satisfaction: SatisfactionReport?` to a `View` struct compiles
 * fine at the declaration and at the one call site anybody thinks about — and
 * silently breaks the THREE `#Preview` blocks at the bottom of the same file,
 * which construct the same struct and are invisible from the diff you are
 * reading. Swift's answer is "missing argument for parameter", three times, in
 * CI, ten minutes later.
 *
 * A Swift optional does NOT get an implicit default: `let x: T?` is a required
 * argument. That is the whole reason this fails where the equivalent TypeScript
 * would not, and it is why the mistake keeps looking safe.
 *
 * WHAT THIS DOES NOT DO. It is not a Swift parser. It reads declarations and
 * call sites within ONE file, which is where previews live and where this break
 * occurs; a cross-file construction site is out of scope and is exactly what CI
 * still exists for. The narrowness is deliberate — a heuristic that guesses
 * more would produce false failures, and a guard people learn to override is
 * worse than no guard.
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

/** The body of `struct <name>` … its matching close brace, or null. */
function structBody(text: string, start: number): string | null {
  const open = text.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The stored `let`s that a caller MUST pass.
 *
 * Depth-1 only: a `let` inside a computed property or a closure is a local,
 * and counting it would invent a parameter that does not exist. Anything with
 * an `=` has a default and is excluded, as is anything the compiler would treat
 * as computed (`{` on the same line).
 */
function requiredLets(body: string): string[] {
  const required: string[] = [];
  let depth = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (depth === 0) {
      const match = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+$/.exec(line);
      if (match && !line.includes("{")) required.push(match[1]);
    }
    for (const char of rawLine) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
  }
  return required;
}

/**
 * Argument labels passed at a call site starting at `open`, and whether a
 * trailing closure follows.
 *
 * The trailing closure matters: `PrimaryButton(title: "Send") { … }` passes the
 * `action` parameter with no label at all, and a guard that did not know this
 * would report every button in the app as broken. Swift fills the LAST
 * parameter that way, which is why the caller drops exactly one.
 */
function callSite(
  text: string,
  open: number,
): { labels: Set<string>; trailingClosure: boolean } {
  let depth = 0;
  let end = open;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const args = text.slice(open + 1, end);
  const labels = new Set(
    [...args.matchAll(/(?:^|[,(\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map(
      (match) => match[1],
    ),
  );

  // Multiple trailing closures (Swift 5.3): the FIRST is unlabelled and fills
  // the first unfilled closure parameter; every one after it carries its label
  // outside the parens. `ChangePlanSheet(scope:company:) { … } onDismiss: { … }`
  // passes three arguments and only two of them are inside the brackets.
  const after = text.slice(end + 1);
  const trailingClosure = /^\s*\{/.test(after);
  if (trailingClosure) {
    for (const match of after.matchAll(
      /\}\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{/g,
    )) {
      labels.add(match[1]);
    }
  }

  return { labels, trailingClosure };
}

describe("a Swift struct's required parameters reach every call site", () => {
  const files = swiftFiles(IOS_ROOT);

  it("reads the iOS sources, so a passing run means something", () => {
    // Without this, a moved directory turns the whole suite into a no-op that
    // reports success — the failure mode every file-walking guard has.
    expect(files.length).toBeGreaterThan(50);
  });

  it("passes every required argument at each same-file construction site", () => {
    const problems: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const short = file.slice(file.indexOf("Loonext"));

      for (const declaration of text.matchAll(
        /(?:^|\n)\s*(?:private\s+|internal\s+|public\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*View\s*\{/g,
      )) {
        const name = declaration[1];
        const body = structBody(text, declaration.index ?? 0);
        if (body === null) continue;
        // A struct with its OWN `init` decides its own labels, and they need
        // not match the stored properties at all — `LinkButton` stores `title`
        // and takes it unlabelled as `_ title`. Reading the memberwise labels
        // off the properties is only valid when the compiler is the one
        // synthesising the initialiser.
        if (/(?:^|[\r\n])\s*init\s*\(/.test(body)) continue;

        const required = requiredLets(body);
        if (required.length === 0) continue;

        // Call sites in the same file: `Name(` not preceded by an identifier
        // character (so `SomeName(` never matches `Name(`) and not the
        // declaration itself.
        for (const call of text.matchAll(
          new RegExp(`(^|[^A-Za-z0-9_.])${name}\\s*\\(`, "g"),
        )) {
          const open = text.indexOf("(", call.index ?? 0);
          if (open === -1) continue;
          const { labels, trailingClosure } = callSite(text, open);
          const unfilled = required.filter((label) => !labels.has(label));
          // The unlabelled trailing closure accounts for the first parameter it
          // could fill — drop exactly one, never more.
          const missing = trailingClosure ? unfilled.slice(1) : unfilled;
          const expected = trailingClosure ? required.slice(1) : required;
          // All-or-nothing: a site passing NONE of them is something else
          // entirely — a type reference, a `some View` return — and flagging it
          // would be the false positive that gets this guard switched off.
          if (missing.length > 0 && missing.length < expected.length) {
            const line = text.slice(0, open).split("\n").length;
            problems.push(
              `${short}:${line} — ${name}(…) is missing ${missing.join(", ")}`,
            );
          }
        }
      }
    }

    expect(
      problems,
      `A required parameter was added without updating every construction ` +
        `site in the same file — usually a #Preview block. Swift optionals get ` +
        `NO implicit default, so these are compile errors:\n  ` +
        problems.join("\n  "),
    ).toEqual([]);
  });
});
