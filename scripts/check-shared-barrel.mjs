#!/usr/bin/env node
/**
 * Everything a shared module exports has to leave the package — or say why not.
 *
 * ## The defect this exists for
 *
 * `packages/shared` has ONE entry point. Its `package.json` declares
 * `"exports": { ".": "./src/index.ts" }` and nothing else, so there is no subpath a
 * client can reach a module by — `@loonext/shared/handover-confirmation` does not
 * resolve. Every symbol therefore has to be re-exported from `src/index.ts` by hand,
 * and `src/index.ts` is 81 named lists somebody types out.
 *
 * A rule was added to the handover vocabulary (#581/#7) saying WHERE the six digits
 * somebody types are checked: our API for the code it emailed, Supabase in the client
 * for both factor demands. It shipped with its module and its tests, and it was left
 * out of the barrel — so the clients that were supposed to read it could not, and the
 * one that tried imported `undefined` and threw on every confirmation.
 *
 * Nothing caught it. The module's own tests import `./handover-confirmation` directly,
 * so they passed. `tsc` was happy, because nothing was importing the missing name yet.
 * Seventeen guards did not look. It surfaced only because an agent tried to use the
 * new rule and got a TypeError.
 *
 * ## Why a guard and not just the one-line fix
 *
 * This is the shape that keeps recurring in this repo: a hand-maintained list, inside
 * code, with nothing comparing it to reality. `v_tables` missed 21 tables. The
 * anonymise column list missed columns. A published "exhaustive" list in a doc was
 * wrong for months. Adding an export is two lines in two files and the second one is
 * the one people forget, because forgetting it is silent right up until a client needs
 * the value.
 *
 * So the list is DERIVED here instead of trusted: read what each module declares, read
 * what the barrel forwards, and compare.
 *
 * ## The one way out, and why it is not a list
 *
 * A module sometimes exports a helper only so its own test can reach it. Forcing those
 * into the package's public API would make this guard a one-way ratchet on what
 * `@loonext/shared` promises — a policy decision riding in on a bug fix. So a
 * declaration may opt out by carrying `@internal` in the doc comment immediately above
 * it.
 *
 * Deliberately NOT a list in this file. An exemption written next to the thing it
 * exempts explains itself, shows up in the diff that needs it, and cannot go stale the
 * way a central roster does — which is the failure mode this whole guard exists to end.
 *
 * ## What this checks
 *
 * For every non-test module in `packages/shared/src`: it is referenced by the barrel,
 * and every `export`ed name in it is either forwarded or marked `@internal`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "packages/shared/src";
const BARREL = `${SRC}/index.ts`;

/**
 * Comments are prose. Without this, a barrel that DOCUMENTS a name it forgot to
 * forward would satisfy the check by talking about it — the same trap the sign-out
 * guard's break test found.
 */
function stripComments(source) {
  return source
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*(\/\/|\*).*$/gm, "");
}

/**
 * What the barrel forwards, per module: a Set of names, or `null` for "all of them".
 *
 * Matched FORWARD, from the `export` keyword through its own clause to its own `from`.
 * The first version of this scanned BACKWARD from each `from` to the nearest brace pair,
 * which quietly read the PREVIOUS statement's list for every statement but the first —
 * so `export * from` was never recognised, and a star-exported module inherited its
 * neighbour's names. A guard that compares the wrong two things reports confidently
 * either way.
 */
function forwarded(barrel) {
  const byModule = new Map();
  const statement =
    /export\s+(?:type\s+)?(\*|\{[^}]*\})\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*"\.\/([\w-]+)"/g;
  for (const match of barrel.matchAll(statement)) {
    const [, clause, name] = match;
    if (clause === "*") {
      // Forwards whatever the module has, so there is no list to drift.
      byModule.set(name, null);
      continue;
    }
    if (byModule.get(name) === null) continue;
    const names = byModule.get(name) ?? new Set();
    for (const raw of clause.slice(1, -1).split(",")) {
      const symbol = raw.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/)[0];
      if (symbol) names.add(symbol);
    }
    byModule.set(name, names);
  }
  return byModule;
}

/**
 * Every name a module exports, and whether it asked to stay in.
 *
 * Covers the declaration forms these modules actually use plus the `export { … }` list
 * form, which is the commonest alternative and therefore the likeliest place for the
 * omission this guard exists to catch.
 */
function declared(raw) {
  const source = stripComments(raw);
  const found = new Map();

  const declaration =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\s*\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(declaration)) {
    found.set(match[1], internalAt(raw, source, match[1]));
  }

  // `export { a, b as c }` with no `from`: names declared above and exported below.
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.replace(/^\s*type\s+/, "").trim();
      const exported = name.split(/\s+as\s+/).pop()?.trim();
      if (exported) found.set(exported, internalAt(raw, source, exported));
    }
  }

  return found;
}

/**
 * Is this name's declaration marked `@internal`?
 *
 * Read off the ORIGINAL source, because the marker lives in the doc comment that
 * `stripComments` removes. Looks only at the comment block immediately above the
 * declaration — a stray `@internal` elsewhere in the file exempts nothing.
 */
function internalAt(raw, _stripped, name) {
  const declaration = new RegExp(
    `^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:const|let|var|function\\s*\\*?|class|type|interface|enum)\\s+${name}\\b`,
    "m",
  );
  const at = raw.replace(/\r\n/g, "\n").search(declaration);
  if (at === -1) return false;
  const before = raw.replace(/\r\n/g, "\n").slice(0, at);
  const closes = before.lastIndexOf("*/");
  if (closes === -1) return false;
  // Nothing but whitespace between the comment and the declaration, or it belongs to
  // something else.
  if (before.slice(closes + 2).trim() !== "") return false;
  const opens = before.lastIndexOf("/*", closes);
  if (opens === -1) return false;
  return /@internal\b/.test(before.slice(opens, closes));
}

const barrel = stripComments(readFileSync(BARREL, "utf8"));
const byModule = forwarded(barrel);

const modules = readdirSync(SRC).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "index.ts",
);

const problems = [];
let checkedModules = 0;
let checkedNames = 0;
let keptInternal = 0;

for (const file of modules) {
  const name = file.replace(/\.ts$/, "");
  const names = byModule.get(name);
  if (names === undefined) {
    problems.push(
      `${SRC}/${file} is not re-exported by the barrel at all. ` +
        `packages/shared has no subpath exports, so nothing outside the package can ` +
        `reach a single line of it — including the clients it was written for.`,
    );
    continue;
  }
  if (names === null) continue;
  checkedModules += 1;
  const raw = readFileSync(join(SRC, file), "utf8");

  // A multi-declarator export cannot be read reliably from a line, so it is REFUSED
  // rather than half-checked. A guard that silently covers the first name and not the
  // second is the stale list again, one declaration wide.
  for (const match of stripComments(raw).matchAll(
    /^export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*[^\n;=]*=[^\n;]*,\s*[A-Za-z_$][\w$]*\s*=/gm,
  )) {
    problems.push(
      `${SRC}/${file} declares more than one name in one \`export\` statement ` +
        `(\`${match[0].slice(0, 60).trim()}…\`). Split them, so this guard can see ` +
        `every name rather than the first one.`,
    );
  }

  for (const [symbol, internal] of declared(raw)) {
    if (internal) {
      keptInternal += 1;
      continue;
    }
    checkedNames += 1;
    if (names.has(symbol)) continue;
    problems.push(
      `${SRC}/${file} exports \`${symbol}\`, and the barrel does not forward it. ` +
        `Add it to the \`from "./${name}"\` list in ${BARREL}. Until then the name ` +
        `exists, typechecks and passes its own tests, and every client that imports ` +
        `it from @loonext/shared gets \`undefined\` at runtime. If it is only exported ` +
        `so this module's own tests can reach it, mark its declaration \`@internal\`.`,
    );
  }
}

// Loud rather than vacuous. If the barrel is refactored into a shape this parse does
// not recognise, every check above passes by matching nothing.
if (checkedModules < modules.length / 2 || checkedNames === 0) {
  problems.push(
    `parsed ${checkedModules} of ${modules.length} module(s) and ${checkedNames} ` +
      `exported name(s) out of the barrel — far too few. The statement shapes in ` +
      `${BARREL} have changed and this guard is no longer reading it, so a pass here ` +
      `means nothing.`,
  );
}

if (problems.length > 0) {
  console.error("packages/shared exports that never leave the package:\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Shared barrel: ${checkedNames} exported name(s) across ${checkedModules} ` +
    `module(s), every one forwarded from index.ts` +
    (keptInternal > 0 ? `; ${keptInternal} marked @internal.` : "."),
);
