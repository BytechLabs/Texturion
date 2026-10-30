#!/usr/bin/env node
/**
 * D142: only `apps/api/src/environments/` may read DEPLOY_ENV.
 *
 * Production and the rig run the same code, which is safe only because rig
 * mode can only ADD restrictions. That is checkable only if every difference
 * lives in one directory: a `DEPLOY_ENV === "rig"` branch in a route or a cron
 * is a difference nobody reviewing the environments module would see, and
 * nothing would stop it from relaxing a gate instead of adding one.
 *
 * Three rules, over every production source in apps/api/src:
 *   1. `DEPLOY_ENV` appears in code only under src/environments/, plus once in
 *      src/env.ts as the schema key that validates it.
 *   2. Nothing outside src/environments/ imports `environments/mode`, the
 *      module that reads it.
 *   3. The few exports that answer "which deployment is this?" outright,
 *      rather than a question about one request, are imported only by the
 *      files that need them. Anywhere else they are rule 1 spelled
 *      differently. Imports from the directory must name what they take, so a
 *      namespace import, a re-export of everything or a dynamic import, which
 *      would hide that, is refused too.
 *
 * What no static rule can stop is a module asking a refusal function a
 * question it already knows the answer to, to learn the mode. Rule 3 keeps the
 * honest route the only short one; the rest is review.
 *
 * Comments are not code, so prose explaining the rule is not a breach. Tests
 * and src/test/ fixtures are skipped: they set DEPLOY_ENV to drive the module,
 * which is a write, and none of them ships in the Worker.
 *
 * Usage: node scripts/check-deploy-env-branches.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_SRC = "apps/api/src";
const ENVIRONMENTS_DIR = "apps/api/src/environments/";
const ENV_SCHEMA = "apps/api/src/env.ts";
const READER = "apps/api/src/environments/mode.ts";

const SKIP = new Set(["node_modules", "dist", "coverage", ".wrangler", ".turbo"]);

const TEST_SUPPORT_DIR = "apps/api/src/test/";

/**
 * Blank comments to whitespace, keeping offsets and line numbers. A block
 * comment is recognised only where one can start (line start, or after
 * `(`, `,`, `=`, `{`, `return`), so `image/*` in a string does not open one;
 * the same rule as apps/api/src/test/source-tree.ts.
 */
export function stripComments(source) {
  const blank = (text) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/(^|[(,={]|\breturn\b)([ \t]*)\/\*[\s\S]*?\*\//gm, (match, lead, gap) =>
      lead + gap + blank(match.slice(lead.length + gap.length)),
    )
    .replace(/(^|\s)\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
}

const MENTION = /\bDEPLOY_ENV\b/g;
const SCHEMA_KEY = /^\s*DEPLOY_ENV\s*:\s*z\./;
const MODE_IMPORT = /\bfrom\s+["'][^"']*environments\/mode(?:\.ts)?["']|\bimport\(\s*["'][^"']*environments\/mode(?:\.ts)?["']\s*\)/g;

/**
 * Exports that name the deployment, and the only files that may import each.
 * Sentry has to file events under the right environment, the Worker entry has
 * to decide whether the rig's routes exist, and the FCM sender has to know
 * whether it may mint a Google token (its answer differs only on the rig).
 */
export const MODE_REVEALING_IMPORTERS = {
  sentryEnvironment: [
    "apps/api/src/observability/sentry.ts",
    "apps/api/src/observability/do-sentry-canary.ts",
  ],
  servesRigRoutes: ["apps/api/src/index.ts"],
  fcmCredential: ["apps/api/src/notifications/fcm.ts"],
};

const ENVIRONMENTS_SPECIFIER = /(?:^|\/)environments\/[\w.-]+$/;
const STATIC_IMPORT =
  /\b(import|export)\s+(?:type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?|[\w$]+))\s*from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** The names an import or export-from clause takes, under their exported names. */
function importedNames(clause) {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return [];
  return braces[1]
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((name) => name.length > 0);
}

/**
 * Rule 3 over one file's code. Also returns which revealing names the file
 * imports, so the caller can tell that the parser saw the sanctioned imports.
 */
function environmentImports(path, code) {
  const offences = [];
  const revealed = [];
  for (const match of code.matchAll(STATIC_IMPORT)) {
    const [, keyword, clause, specifier] = match;
    const line = lineOf(code, match.index);
    const fromEnvironments = ENVIRONMENTS_SPECIFIER.test(specifier);
    const withoutBraces = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (fromEnvironments && withoutBraces.length > 0) {
      offences.push({
        path,
        line,
        rule: `${keyword}s src/environments/ without naming what it takes (${withoutBraces})`,
      });
    }
    for (const name of importedNames(clause)) {
      const allowed = MODE_REVEALING_IMPORTERS[name];
      if (allowed === undefined) continue;
      // Passing the name on, or taking it from a file that passed it on, is
      // the same import with one more hop.
      if (keyword === "export") {
        offences.push({ path, line, rule: `re-exports ${name}, which names the deployment` });
      } else if (!fromEnvironments || !allowed.includes(path)) {
        offences.push({
          path,
          line,
          rule: `imports ${name}, which names the deployment; only ${allowed.join(", ")} may, from src/environments/`,
        });
      } else {
        revealed.push(name);
      }
    }
  }
  for (const match of code.matchAll(DYNAMIC_IMPORT)) {
    // The reader itself is rule 2's, which already reports it.
    if (!ENVIRONMENTS_SPECIFIER.test(match[1]) || /environments\/mode(?:\.ts)?$/.test(match[1])) {
      continue;
    }
    offences.push({
      path,
      line: lineOf(code, match.index),
      rule: "imports src/environments/ dynamically, which hides what it takes",
    });
  }
  return { offences, revealed };
}

/**
 * Offences in a set of files. `files` holds repo-relative POSIX paths and their
 * contents, so a test can hand it any tree it likes.
 */
export function deployEnvOffences(files) {
  const offences = [];
  for (const { path, text } of files) {
    if (path.startsWith(ENVIRONMENTS_DIR) || path.startsWith(TEST_SUPPORT_DIR)) continue;
    const code = stripComments(text);
    const lines = code.split("\n");

    for (const match of code.matchAll(MENTION)) {
      const line = lineOf(code, match.index);
      if (path === ENV_SCHEMA && SCHEMA_KEY.test(lines[line - 1])) continue;
      offences.push({
        path,
        line,
        rule: "reads DEPLOY_ENV outside src/environments/",
      });
    }

    for (const match of code.matchAll(MODE_IMPORT)) {
      offences.push({
        path,
        line: lineOf(code, match.index),
        rule: "imports the DEPLOY_ENV reader outside src/environments/",
      });
    }

    offences.push(...environmentImports(path, code).offences);
  }

  // The schema key may appear once; a second spelling in env.ts is a reader.
  const schema = files.find((file) => file.path === ENV_SCHEMA);
  if (schema) {
    const keys = stripComments(schema.text)
      .split("\n")
      .filter((line) => SCHEMA_KEY.test(line)).length;
    if (keys > 1) {
      offences.push({ path: ENV_SCHEMA, line: 0, rule: "declares DEPLOY_ENV more than once" });
    }
  }
  return offences;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Every production source under apps/api/src, as `deployEnvOffences` takes them. */
export function apiProductionSources(root = REPO_ROOT) {
  return walk(join(root, API_SRC)).map((absolute) => ({
    path: relative(root, absolute).split(sep).join("/"),
    text: readFileSync(absolute, "utf8"),
  }));
}

/**
 * What the scan must be able to see before "no offences" means anything: the
 * one sanctioned reader, reading the variable. A walk that silently found no
 * files, or a reader that moved, would otherwise pass by not looking.
 */
export function coverageProblems(files) {
  const problems = [];
  if (files.length === 0) problems.push(`no production sources found under ${API_SRC}`);
  const reader = files.find((file) => file.path === READER);
  if (!reader) {
    problems.push(`${READER} is missing, so nothing is known to read DEPLOY_ENV`);
  } else if (!/\benv\.DEPLOY_ENV\b/.test(stripComments(reader.text))) {
    problems.push(`${READER} no longer reads env.DEPLOY_ENV; update this guard to the new reader`);
  }
  if (!files.some((file) => file.path === ENV_SCHEMA)) {
    problems.push(`${ENV_SCHEMA} is missing`);
  }
  // Each sanctioned importer must be seen importing its name. That proves the
  // import parser reads the real tree, and keeps a file that stopped needing
  // the name from keeping the permission.
  for (const [name, importers] of Object.entries(MODE_REVEALING_IMPORTERS)) {
    for (const importer of importers) {
      const file = files.find((entry) => entry.path === importer);
      const seen = file && environmentImports(file.path, stripComments(file.text)).revealed;
      if (!seen || !seen.includes(name)) {
        problems.push(
          `${importer} is allowed ${name} but does not import it; drop it from MODE_REVEALING_IMPORTERS`,
        );
      }
    }
  }
  return problems;
}

/** How many imports from src/environments/ the scan judged, for the report. */
function environmentImportCount(files) {
  return files
    .filter((file) => !file.path.startsWith(ENVIRONMENTS_DIR) && !file.path.startsWith(TEST_SUPPORT_DIR))
    .reduce(
      (count, file) =>
        count +
        [...stripComments(file.text).matchAll(STATIC_IMPORT)].filter((match) =>
          ENVIRONMENTS_SPECIFIER.test(match[3]),
        ).length,
      0,
    );
}

function main() {
  const files = apiProductionSources();
  const problems = coverageProblems(files);
  if (problems.length > 0) {
    console.error("check-deploy-env-branches: cannot vouch for the tree.\n");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const offences = deployEnvOffences(files);
  if (offences.length > 0) {
    console.error(
      "check-deploy-env-branches: which deployment this is gets read outside apps/api/src/environments/.\n",
    );
    for (const { path, line, rule } of offences) console.error(`  ${path}:${line}  ${rule}`);
    console.error(
      "\nAsk the environments module a policy question instead (see " +
        "apps/api/src/environments/policy.ts). Every rig difference must live " +
        "there, where it can be checked to be a restriction (D142).\n",
    );
    process.exit(1);
  }

  const judged = files.filter(
    (file) => !file.path.startsWith(ENVIRONMENTS_DIR) && !file.path.startsWith(TEST_SUPPORT_DIR),
  ).length;
  console.log(
    `check-deploy-env-branches: ${judged} production files in ${API_SRC} judged; ` +
      `none reads DEPLOY_ENV, which only ${READER} does. ` +
      `${environmentImportCount(files)} imports from src/environments/ judged; ` +
      "the deployment's name reaches only " +
      `${[...new Set(Object.values(MODE_REVEALING_IMPORTERS).flat())].join(", ")}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
