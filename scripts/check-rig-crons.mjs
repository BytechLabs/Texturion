#!/usr/bin/env node
/**
 * D142: every cron a Worker declares says what the rig does with it.
 *
 *   node scripts/check-rig-crons.mjs              # this checkout
 *   node scripts/check-rig-crons.mjs --ref v0.18.0
 *
 * The rig fires each cron in the deployed ref's own config. `tools/rig/crons.json`
 * classifies each as `run`, `run-expect-refusal` (rig mode refuses an
 * account-wide Telnyx request with `rig_endpoint_refused`) or `skip`. R00 fails
 * on any Sentry fingerprint nothing explains, so an unclassified cron is a
 * standing red.
 *
 * Fails when a config declares a cron the registry does not classify, the
 * registry classifies one no config declares, an entry is malformed, an API
 * cron's jobs differ from `CRON_JOBS` (the jobs are what is classified), or a
 * refusal names an endpoint rig mode does not refuse.
 *
 * `--ref` reads the configs and sources from that ref. There, entries and jobs
 * the ref lacks are notes, since the registry may be newer; an unclassified
 * cron still fails.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REGISTRY_FILE = "tools/rig/crons.json";
export const SCHEMA = "loonext.rig-crons.v1";
export const CLASSES = ["run", "run-expect-refusal", "skip"];
export const REFUSAL_CODE = "rig_endpoint_refused";

export const JOB_SOURCES = { "apps/api/wrangler.jsonc": "apps/api/src/index.ts" };
export const POLICY_FILE = "apps/api/src/environments/policy.ts";

const CONFIG_NAME = /(?:^|\/)wrangler\.(?:jsonc?|toml)$/;
const CRON_FIELD = /^[0-9*/,-]+$/;

const ENTRY_KEYS = {
  run: ["config", "cron", "class", "jobs", "note", "expected_events"],
  "run-expect-refusal": ["config", "cron", "class", "jobs", "note", "refusals", "expected_events"],
  skip: ["config", "cron", "class", "jobs", "reason", "fingerprints"],
};
const REFUSAL_KEYS = ["job", "code", "telnyx_paths", "when", "fingerprints"];

/** Comments and trailing commas out, outside strings only: a `//` in a URL is not a comment. */
export function stripJsonc(source) {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
    } else if (c === ",") {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j])) j += 1;
      if (source[j] !== "}" && source[j] !== "]") out += c;
    } else {
      out += c;
    }
  }
  return out;
}

export function cronsFromConfig(file, text) {
  if (file.endsWith(".toml")) {
    throw new Error(`${file}: a TOML Worker config cannot be read here; use wrangler.jsonc`);
  }
  const config = JSON.parse(stripJsonc(text.replace(/\r\n/g, "\n")));
  const crons = config?.triggers?.crons ?? [];
  if (!Array.isArray(crons) || crons.some((cron) => typeof cron !== "string")) {
    throw new Error(`${file}: triggers.crons is not a list of strings`);
  }
  return crons;
}

/**
 * `CRON_JOBS` as cron -> job keys, or null when the source has no map in a
 * shape this reads. Read as text up to the first `};` at the start of a line,
 * comments removed first because they quote job keys.
 */
export function cronJobsFromSource(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.startsWith("export const CRON_JOBS"));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^};\s*$/.test(line));
  if (end === -1) return null;
  const body = stripJsonc(lines.slice(start + 1, end).join("\n"));
  const jobs = new Map();
  let current = null;
  for (const match of body.matchAll(/"([^"\n]+)"\s*:\s*\[|\bjob\(\s*"([^"\n]+)"/g)) {
    if (match[1] !== undefined) {
      current = match[1];
      jobs.set(current, []);
    } else if (current !== null) {
      jobs.get(current).push(match[2]);
    }
  }
  // Keys without job() calls are an older ref's plain function lists; read as
  // empty, every listed job would look stale.
  const total = [...jobs.values()].reduce((sum, list) => sum + list.length, 0);
  return total > 0 ? jobs : null;
}

/**
 * The Telnyx path families rig mode refuses, read from the regex in
 * policy.ts, or null when the ref predates rig mode.
 */
export function refusedFamiliesFromPolicy(text) {
  const match = /ACCOUNT_WIDE_TELNYX_PATH\s*=\s*\/\^\\\/v2\\\/\(\?:([a-z0-9_|]+)\)/.exec(text);
  return match ? match[1].split("|") : null;
}

const isStringList = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");
const isFingerprint = (value) => isStringList(value);
const sameFingerprint = (a, b) => a.length === b.length && a.every((part, i) => part === b[i]);

function validEntryShape(entry, at, problems) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    problems.push(`${at}: not an object`);
    return false;
  }
  if (!CLASSES.includes(entry.class)) {
    problems.push(`${at}: class ${JSON.stringify(entry.class)} is not one of ${CLASSES.join(", ")}`);
    return false;
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS[entry.class].includes(key)) {
      problems.push(`${at}: "${key}" is not a field of a ${entry.class} entry`);
    }
  }
  if (typeof entry.config !== "string" || entry.config === "") {
    problems.push(`${at}: config is missing`);
    return false;
  }
  const fields = typeof entry.cron === "string" ? entry.cron.trim().split(/\s+/) : [];
  if (fields.length !== 5 || !fields.every((field) => CRON_FIELD.test(field))) {
    problems.push(`${at}: cron ${JSON.stringify(entry.cron)} is not a five-field cron expression`);
    return false;
  }
  return true;
}

function checkClassFields(entry, at, problems, families) {
  if (entry.jobs !== undefined && !isStringList(entry.jobs)) {
    problems.push(`${at}: jobs must be a non-empty list of job keys`);
  }
  if (entry.class === "run") {
    if (entry.note !== undefined && (typeof entry.note !== "string" || entry.note.trim() === "")) {
      problems.push(`${at}: note must be a sentence when present`);
    }
    for (const [i, event] of (entry.expected_events ?? []).entries()) {
      const ok =
        event !== null &&
        typeof event === "object" &&
        typeof event.match === "string" &&
        event.match.trim() !== "" &&
        typeof event.why === "string" &&
        event.why.trim() !== "";
      if (!ok) problems.push(`${at}: expected_events[${i}] needs a match and a why`);
    }
    return;
  }
  if (entry.class === "skip") {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      problems.push(`${at}: a skip needs a reason`);
    }
    // A cron that never fires silences its liveness keys, and the checker
    // alerts on each one.
    const owed = [["ops", `cron:${entry.cron}`], ...(entry.jobs ?? []).map((job) => ["ops", job])];
    const listed = Array.isArray(entry.fingerprints) ? entry.fingerprints : [];
    for (const fingerprint of owed) {
      if (!listed.some((item) => isFingerprint(item) && sameFingerprint(item, fingerprint))) {
        problems.push(`${at}: a skip silences ${JSON.stringify(fingerprint)}, so list it in fingerprints`);
      }
    }
    return;
  }
  if (!Array.isArray(entry.refusals) || entry.refusals.length === 0) {
    problems.push(`${at}: run-expect-refusal needs at least one refusal`);
    return;
  }
  const seen = new Set();
  for (const [i, refusal] of entry.refusals.entries()) {
    const where = `${at} refusals[${i}]`;
    if (refusal === null || typeof refusal !== "object") {
      problems.push(`${where}: not an object`);
      continue;
    }
    for (const key of Object.keys(refusal)) {
      if (!REFUSAL_KEYS.includes(key)) problems.push(`${where}: "${key}" is not a refusal field`);
    }
    if (typeof refusal.job !== "string" || refusal.job === "") {
      problems.push(`${where}: job is missing`);
      continue;
    }
    if (seen.has(refusal.job)) problems.push(`${where}: ${refusal.job} is listed twice`);
    seen.add(refusal.job);
    if (entry.jobs !== undefined && !entry.jobs.includes(refusal.job)) {
      problems.push(`${where}: ${refusal.job} is not one of this cron's jobs`);
    }
    if (refusal.code !== REFUSAL_CODE) {
      problems.push(`${where}: code must be ${REFUSAL_CODE}`);
    }
    if (typeof refusal.when !== "string" || refusal.when.trim() === "") {
      problems.push(`${where}: when must say what work makes the job reach the refusal`);
    }
    if (!isStringList(refusal.telnyx_paths) || !refusal.telnyx_paths.every((path) => path.startsWith("/v2/"))) {
      problems.push(`${where}: telnyx_paths must list /v2/ paths`);
    } else if (families !== null) {
      for (const path of refusal.telnyx_paths) {
        const family = path.slice("/v2/".length).split("/")[0];
        if (!families.includes(family)) {
          problems.push(
            `${where}: rig mode does not refuse ${path} (policy.ts refuses ${families.join(", ")}), ` +
              `so this job is not expected to fail there`,
          );
        }
      }
    }
    // A job that throws withholds its own heartbeat, and the liveness checker
    // then alerts on it under this fingerprint.
    const owed = ["ops", refusal.job];
    const listed = Array.isArray(refusal.fingerprints) ? refusal.fingerprints : [];
    if (!listed.every(isFingerprint) || !listed.some((item) => sameFingerprint(item, owed))) {
      problems.push(`${where}: fingerprints must include ${JSON.stringify(owed)}`);
    }
  }
}

/**
 * `configs` maps each Worker config to its crons; `jobs` maps a config to its
 * cron-to-jobs map, null when unreadable; `families` is null when unreadable.
 * `exact` is false for `--ref`, where entries and jobs the ref lacks are notes.
 */
export function judge({ registry, configs, jobs = {}, families = null, exact = true }) {
  const problems = [];
  const notes = [];
  if (registry === null || typeof registry !== "object" || registry.schema !== SCHEMA) {
    return { problems: [`${REGISTRY_FILE}: schema must be "${SCHEMA}"`], notes, counts: null };
  }
  const match = registry.refusal_match;
  if (
    match === null ||
    typeof match !== "object" ||
    match.code !== REFUSAL_CODE ||
    match.message_contains !== `[codes ${REFUSAL_CODE}]` ||
    typeof match.exception_type !== "string" ||
    typeof match.why !== "string"
  ) {
    problems.push(
      `${REGISTRY_FILE}: refusal_match must name code ${REFUSAL_CODE}, its exception type, ` +
        `the message text "[codes ${REFUSAL_CODE}]" and why`,
    );
  }
  if (!Array.isArray(registry.crons)) {
    return { problems: [...problems, `${REGISTRY_FILE}: crons must be a list`], notes, counts: null };
  }

  const declared = new Map();
  for (const [config, crons] of Object.entries(configs)) {
    for (const cron of crons) declared.set(`${config}\u0000${cron}`, { config, cron });
  }

  const classified = new Map();
  const counts = { run: 0, "run-expect-refusal": 0, skip: 0, refusals: 0, jobs: 0 };
  for (const [i, entry] of registry.crons.entries()) {
    const at = `${REGISTRY_FILE} crons[${i}]${typeof entry?.cron === "string" ? ` "${entry.cron}"` : ""}`;
    if (!validEntryShape(entry, at, problems)) continue;
    const key = `${entry.config}\u0000${entry.cron}`;
    if (classified.has(key)) {
      problems.push(`${at}: ${entry.config} "${entry.cron}" is classified twice`);
      continue;
    }
    classified.set(key, entry);
    checkClassFields(entry, at, problems, families);

    if (!declared.has(key)) {
      const message = `${at}: no tracked Worker config declares "${entry.cron}" in ${entry.config}`;
      if (exact) problems.push(`${message}; delete the entry`);
      else notes.push(`${message} at this ref; fine if the registry is newer than the ref`);
      continue;
    }
    counts[entry.class] += 1;
    if (entry.class === "run-expect-refusal" && Array.isArray(entry.refusals)) {
      counts.refusals += entry.refusals.length;
    }

    if (!(entry.config in JOB_SOURCES)) {
      if (entry.jobs !== undefined) {
        problems.push(`${at}: ${entry.config} has no job map to check jobs against; remove jobs`);
      }
      continue;
    }
    const map = jobs[entry.config];
    if (map === null || map === undefined) continue;
    const actual = map.get(entry.cron) ?? [];
    const listed = Array.isArray(entry.jobs) ? entry.jobs : [];
    counts.jobs += actual.length;
    const unlisted = actual.filter((job) => !listed.includes(job));
    const stale = listed.filter((job) => !actual.includes(job));
    if (unlisted.length > 0) {
      problems.push(
        `${at}: CRON_JOBS runs ${unlisted.join(", ")} on this cron and the registry does not ` +
          `list it. Read what the job does in rig mode, then add it (and a refusal if it reaches one)`,
      );
    }
    if (stale.length > 0) {
      const message = `${at}: lists ${stale.join(", ")}, which CRON_JOBS does not run on this cron`;
      if (exact) problems.push(`${message}; remove it`);
      else notes.push(`${message} at this ref`);
    }
  }

  for (const [key, { config, cron }] of declared) {
    if (!classified.has(key)) {
      problems.push(
        `${config} declares cron "${cron}" and ${REGISTRY_FILE} does not classify it. ` +
          `Add an entry: run, run-expect-refusal or skip`,
      );
    }
  }

  for (const [config, source] of Object.entries(JOB_SOURCES)) {
    if (!(config in configs)) continue;
    if (jobs[config] === null || jobs[config] === undefined) {
      notes.push(`${source} has no readable CRON_JOBS at this ref; jobs were not compared`);
    }
  }
  if (families === null) {
    notes.push(`${POLICY_FILE} has no account-wide refusal list at this ref; refusal paths were not compared`);
  }

  if (declared.size === 0) {
    problems.push("No crons found in any tracked Worker config. This check is reading nothing; fix the config discovery");
  }
  return { problems, notes, counts: { ...counts, crons: declared.size, configs: Object.keys(configs).length } };
}

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A tracked file's text at a ref, or in the working tree; null when absent. */
function readAt(ref, file) {
  if (ref === null) {
    try {
      return readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      return null;
    }
  }
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

/**
 * Worker configs at the ref, or in the checkout including unstaged new files.
 * Derived configs (wrangler.ci.jsonc, wrangler.rig.jsonc) are named otherwise
 * and not read.
 */
function trackedConfigs(ref) {
  const listing =
    ref === null
      ? git(["ls-files", "--cached", "--others", "--exclude-standard"])
      : git(["ls-tree", "-r", "--name-only", ref]);
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((file) => CONFIG_NAME.test(file))
    .sort();
}

function parseArgs(argv) {
  const at = argv.indexOf("--ref");
  if (at === -1) return { ref: null };
  const ref = argv[at + 1];
  if (!ref || ref.startsWith("--")) throw new Error("--ref needs a git ref");
  return { ref };
}

function main() {
  const { ref } = parseArgs(process.argv.slice(2));
  if (ref !== null) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    } catch {
      console.error(`check-rig-crons: ${ref} is not a commit in this checkout.`);
      process.exit(1);
    }
  }
  const configs = {};
  const jobs = {};
  for (const file of trackedConfigs(ref)) {
    const text = readAt(ref, file);
    // Listed by git but deleted from the checkout.
    if (text === null) continue;
    configs[file] = cronsFromConfig(file, text);
    if (file in JOB_SOURCES) {
      const source = readAt(ref, JOB_SOURCES[file]);
      jobs[file] = source === null ? null : cronJobsFromSource(source);
    }
  }
  const policy = readAt(ref, POLICY_FILE);
  const families = policy === null ? null : refusedFamiliesFromPolicy(policy);
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY_FILE), "utf8"));
  const { problems, notes, counts } = judge({ registry, configs, jobs, families, exact: ref === null });

  const where = ref === null ? "this checkout" : `ref ${ref}`;
  for (const note of notes) console.log(`  - ${note}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`\ncheck-rig-crons: ${problems.length} problem(s) against ${where}.`);
    process.exit(1);
  }
  console.log(
    `check-rig-crons: ${counts.crons} cron(s) in ${counts.configs} Worker config(s) at ${where}, ` +
      `${counts.jobs} job(s) compared with CRON_JOBS; ${counts.run} run, ` +
      `${counts["run-expect-refusal"]} run-expect-refusal (${counts.refusals} refused job(s)), ` +
      `${counts.skip} skip.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
