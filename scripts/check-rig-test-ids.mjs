#!/usr/bin/env node
/**
 * D142: the ids the rig's drivers find call controls by, checked both ways.
 *
 *   node scripts/check-rig-test-ids.mjs
 *
 * The rig drives the Pixel and the emulators with UIAutomator scripts that
 * live outside the app, and they find the ring, answer and in-call controls by
 * the Compose test tags in CallTestTags.kt. A renamed tag fails a rig scenario
 * days later as "element not found", with nothing in the app's diff to say
 * why. `tools/rig/test-ids.json` is the contract the drivers read, and this
 * fails when it and the source disagree in either direction:
 *
 * - an id in the registry that no source declares, or under another constant;
 * - an id a source declares that the registry does not list.
 *
 * The web and iOS call surfaces are scanned too. They declare no ids today, so
 * the first `data-testid` or `accessibilityIdentifier` added there has to be
 * registered before a driver relies on it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REGISTRY_FILE = "tools/rig/test-ids.json";
export const SCHEMA = "loonext.rig-test-ids.v1";

const TEST_FILE = /(?:\.test\.[a-z]+$|\/tests?\/|Tests\/|\.spec\.[a-z]+$)/;

/** Kotlin source with comments blanked, outside string literals. */
export function stripKotlinComments(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 1;
      } else if (c === '"' || c === "\n") {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else {
      out += c;
    }
  }
  return out;
}

const KOTLIN_VAL = /^[ \t]*(?:(?:private|internal|public|protected)\s+)?(const\s+)?val\s+(\w+)\s*(?::\s*([^=\n]+?))?\s*=\s*(.*)$/gm;
const KOTLIN_COLLECTION = /^(?:listOf|setOf|arrayOf|listOfNotNull)\(/;

/** How each kind of id is written in source, and which files can hold one. */
export const KINDS = {
  "compose-test-tag": {
    files: /\.kt$/,
    // One form only, `const val NAME = "literal"`: CallTestTagsTest reads tags
    // in no other. The tag list (`listOf(...)`) is not a tag.
    extract(text) {
      const ids = [];
      const problems = [];
      const source = stripKotlinComments(text);
      const read = new Set();
      for (const match of source.matchAll(KOTLIN_VAL)) {
        const [, isConst, name, type, rawValue] = match;
        read.add(name);
        const value = rawValue.trim();
        if (KOTLIN_COLLECTION.test(value)) continue;
        const literal = /^"([^"\\$]*)"$/.exec(value);
        if (isConst && type === undefined && literal) {
          ids.push({ id: literal[1], constant: name });
        } else if (isConst && type === undefined) {
          problems.push(`${name} is not a plain string literal, so its value cannot be checked`);
        } else {
          problems.push(
            `${name} is not written \`const val ${name} = "..."\`, the one form this check and ` +
              `CallTestTagsTest read as a tag`,
          );
        }
      }
      for (const match of source.matchAll(/\bval\s+(\w+)/g)) {
        if (!read.has(match[1])) problems.push(`${match[1]} is a val this check cannot read; declare it on one line`);
      }
      return { ids, problems };
    },
  },
  "data-testid": {
    files: /\.(?:tsx|jsx|ts|js)$/,
    extract(text) {
      const ids = [];
      const problems = [];
      for (const match of text.matchAll(/data-testid=(?:"([^"]*)"|'([^']*)'|\{\s*(["'])([^"']*)\3\s*\}|(\{[^}]*\}))/g)) {
        if (match[5] !== undefined) {
          problems.push(`data-testid=${match[5]} is computed, so a driver cannot rely on it; use a literal`);
        } else {
          ids.push({ id: match[1] ?? match[2] ?? match[4] });
        }
      }
      return { ids, problems };
    },
  },
  "accessibility-identifier": {
    files: /\.swift$/,
    extract(text) {
      const ids = [];
      const problems = [];
      for (const match of text.matchAll(/\.accessibilityIdentifier\(\s*([^)]*)\)/g)) {
        const literal = /^"([^"\\]*)"$/.exec(match[1].trim());
        if (literal) ids.push({ id: literal[1] });
        else problems.push(`accessibilityIdentifier(${match[1]}) is computed, so a driver cannot rely on it; use a literal`);
      }
      return { ids, problems };
    },
  },
};

/**
 * Compare one platform's registered ids with what its source files declare.
 * `files` is [{ file, text }] already narrowed to the platform's sources.
 */
export function judgePlatform(platform, files) {
  const problems = [];
  const at = `${REGISTRY_FILE} ${platform?.platform ?? "platform"}`;
  const kind = KINDS[platform?.kind];
  if (kind === undefined) {
    return { problems: [`${at}: kind must be one of ${Object.keys(KINDS).join(", ")}`], declared: 0, registered: 0 };
  }
  if (!Array.isArray(platform.ids)) {
    return { problems: [`${at}: ids must be a list`], declared: 0, registered: 0 };
  }
  if (files.length === 0) {
    problems.push(`${at}: its sources match no files, so the scan is blind; fix sources`);
  }

  const declared = new Map();
  for (const { file, text } of files) {
    const found = kind.extract(text);
    for (const problem of found.problems) problems.push(`${file}: ${problem}`);
    for (const entry of found.ids) {
      const where = declared.get(entry.id);
      if (where !== undefined && platform.kind === "compose-test-tag") {
        problems.push(`${file}: "${entry.id}" is declared by both ${where.constant} and ${entry.constant}`);
      }
      declared.set(entry.id, { ...entry, file });
    }
  }

  const registered = new Map();
  for (const [i, entry] of platform.ids.entries()) {
    const where = `${at} ids[${i}]`;
    if (typeof entry?.id !== "string" || entry.id === "") {
      problems.push(`${where}: id is missing`);
      continue;
    }
    if (registered.has(entry.id)) problems.push(`${where}: "${entry.id}" is listed twice`);
    registered.set(entry.id, entry);
    if (typeof entry.on !== "string" || entry.on.trim() === "") {
      problems.push(`${where}: say which surface carries "${entry.id}"`);
    }
    const source = declared.get(entry.id);
    if (source === undefined) {
      problems.push(
        `${where}: no ${platform.platform} source declares "${entry.id}". A driver looking for it ` +
          `will not find it; restore the id or remove it here and from the driver`,
      );
      continue;
    }
    if (platform.kind === "compose-test-tag" && entry.constant !== source.constant) {
      problems.push(`${where}: "${entry.id}" is ${source.constant} in ${source.file}, not ${entry.constant}`);
    }
  }
  for (const [id, source] of declared) {
    if (!registered.has(id)) {
      problems.push(
        `${source.file} declares "${id}"${source.constant ? ` (${source.constant})` : ""} and ` +
          `${REGISTRY_FILE} does not list it. Register it, so a driver may rely on it`,
      );
    }
  }
  return { problems, declared: declared.size, registered: registered.size, files: files.length };
}

export function judge(registry, filesFor) {
  if (registry === null || typeof registry !== "object" || registry.schema !== SCHEMA) {
    return { problems: [`${REGISTRY_FILE}: schema must be "${SCHEMA}"`], results: [] };
  }
  if (!Array.isArray(registry.platforms) || registry.platforms.length === 0) {
    return { problems: [`${REGISTRY_FILE}: platforms is empty`], results: [] };
  }
  const problems = [];
  const results = [];
  const seen = new Set();
  for (const platform of registry.platforms) {
    if (seen.has(platform?.platform)) problems.push(`${REGISTRY_FILE}: ${platform.platform} is listed twice`);
    seen.add(platform?.platform);
    if (!Array.isArray(platform?.sources) || platform.sources.length === 0) {
      problems.push(`${REGISTRY_FILE} ${platform?.platform}: sources must list files or directories`);
      continue;
    }
    const kind = KINDS[platform.kind];
    const files = kind === undefined ? [] : filesFor(platform.sources, kind.files);
    const result = judgePlatform(platform, files);
    problems.push(...result.problems);
    results.push({ platform: platform.platform, kind: platform.kind, ...result });
  }
  const total = results.reduce((sum, r) => sum + r.declared, 0);
  if (total === 0) {
    problems.push("No source declares a single test id. This check is reading nothing; fix the sources");
  }
  return { problems, results };
}

/** Tracked, non-test files under the given paths whose names fit the kind. */
function trackedFiles(sources, pattern) {
  const listed = execFileSync("git", ["ls-files", "--", ...sources], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  return listed
    .filter((file) => pattern.test(file) && !TEST_FILE.test(file))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), "utf8") }));
}

function main() {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY_FILE), "utf8"));
  const { problems, results } = judge(registry, trackedFiles);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`\ncheck-rig-test-ids: ${problems.length} problem(s).`);
    process.exit(1);
  }
  const lines = results.map(
    (r) => `${r.platform} ${r.registered}/${r.declared} ${r.kind} id(s) registered, from ${r.files} file(s)`,
  );
  console.log(`check-rig-test-ids: ${lines.join("; ")}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
