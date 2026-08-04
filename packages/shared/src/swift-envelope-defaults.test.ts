/**
 * A field added to a shared Swift model must not break its call sites.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `Page` gained `hidden_count` (#286) as `let hidden_count: Int?`. A stored
 * property with no default is a required argument of Swift's synthesized
 * memberwise init, so all eight `Page(data:next_cursor:)` calls in
 * `apps/ios/LoonextTests` stopped compiling and Gate went red.
 *
 * That is the SIXTH time a required Swift parameter has broken CI in this
 * repo, and the fifth time the sweep looked at `apps/ios/Loonext` while the
 * call sites sat in `apps/ios/LoonextTests` — a sibling directory, not a
 * child. The repo notes already said both of those things in as many words.
 * "Remember to grep" has now failed enough times to stop being a plan.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * On the model types below — the ones every feature decodes and several
 * suites construct by hand — an OPTIONAL stored property must carry `= nil`.
 * With it, the memberwise init defaults the argument and no call site
 * changes; without it, every site is a required edit in a language this
 * machine cannot compile.
 *
 * Non-optional properties are exempt: those are genuinely required, and a
 * type that needs one should break its call sites so somebody looks.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const IOS_ROOT = join(import.meta.dirname, "..", "..", "..", "apps", "ios");

/**
 * The shared envelopes. Small on purpose — this is not a style rule for every
 * struct, it is a rule for the handful whose shape ripples across the app and
 * both test targets.
 */
const SHARED_MODELS = ["Page"];

/**
 * Optional fields that are REQUIRED arguments on purpose.
 *
 * The rule above is "an optional field must default", and it is wrong for a
 * field whose absence means something. `next_cursor` is pagination state: with
 * a default, `Page(data: rows)` compiles and silently claims to be the last
 * page. Breaking the call sites is the correct behaviour there — somebody has
 * to decide what the cursor is.
 *
 * So the exemption is a roster with a reason rather than a looser rule. Each
 * entry is a claim that forgetting this field should be a compile error.
 */
const REQUIRED_BY_DESIGN: Record<string, string> = {
  "Page.next_cursor":
    "Pagination state. A default would let Page(data:) compile and report " +
    "itself as the last page, which is a silent wrong answer rather than a " +
    "loud one.",
};

/** Every `.swift` under apps/ios — BOTH targets, which is the whole point. */
function swiftFiles(): string[] {
  return readdirSync(IOS_ROOT, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".swift"))
    .map((name) => join(IOS_ROOT, name));
}

/** A struct's body, from its declaration to the matching closing brace. */
function structBody(source: string, name: string): string | null {
  const match = new RegExp(`struct\\s+${name}\\b[^{]*\\{`).exec(source);
  if (!match) return null;
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") depth -= 1;
    i += 1;
  }
  return source.slice(start, i - 1);
}

describe("a shared Swift model can gain a field without breaking its call sites", () => {
  const files = swiftFiles();

  it("SE-1: reads BOTH iOS targets, app and tests", () => {
    // The specific failure this guard replaces: a sweep of apps/ios/Loonext
    // that could not see apps/ios/LoonextTests, which is beside it rather
    // than inside it. If this ever stops finding test files, the guard has
    // quietly become the mistake it was written for.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.includes("LoonextTests"))).toBe(true);
    expect(files.some((f) => f.includes(join("Loonext", "Core")))).toBe(true);
  });

  it("SE-3: the exemption roster names fields that exist", () => {
    // A roster entry for a field that has been renamed or removed exempts
    // nothing and hides the next one — the same staleness every roster in
    // this repo guards against.
    const source = files
      .filter((f) => f.includes(join("Core", "Model")))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const key of Object.keys(REQUIRED_BY_DESIGN)) {
      const field = key.split(".")[1];
      expect(
        new RegExp(`\\b(let|var)\\s+${field}\\s*:`).test(source),
        `${key} is exempted and no longer exists`,
      ).toBe(true);
    }
  });

  it("SE-2: every optional field on a shared envelope carries a default", () => {
    const offenders: string[] = [];

    for (const model of SHARED_MODELS) {
      let found = false;
      for (const file of files) {
        const body = structBody(readFileSync(file, "utf8"), model);
        if (body === null) continue;
        found = true;

        for (const line of body.split("\n")) {
          const property = /^\s*(let|var)\s+(\w+)\s*:\s*([^=\n]+?)\s*$/.exec(line);
          if (!property) continue;
          const [, , name, type] = property;
          // Optional means `?` or an explicit Optional<…>. Only those are
          // covered: a non-optional field is genuinely required, and should
          // break its call sites so somebody looks at them.
          if (!/\?\s*$|^Optional</.test(type)) continue;
          if (`${model}.${name}` in REQUIRED_BY_DESIGN) continue;
          offenders.push(`${model}.${name}: ${type.trim()} (${file.split("apps")[1]})`);
        }
      }
      expect(found, `${model} was not found in apps/ios — the roster is stale`).toBe(true);
    }

    expect(
      offenders,
      "These optional fields on a shared Swift envelope have no `= nil`, so " +
        "they are REQUIRED arguments of the memberwise init and every " +
        "construction site must be edited — in a language this machine " +
        "cannot compile, where the sites live in two directories that look " +
        "like one. Add `= nil`:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});
