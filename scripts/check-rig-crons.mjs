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
 * A refusal's `outcome` says what Sentry receives. `job-fails`: the job lets
 * the error out, so it arrives inside the cron's AggregateError and the job's
 * liveness alert follows. `captured`: the job catches it at `caught_in`,
 * reports it as its own event and returns normally, so no liveness alert
 * follows, and suppressing one would hide a real failure.
 *
 * A skipped API cron lists the liveness alerts that follow. The rig fires
 * only the API's crons (`rig cron` takes the API's), so any
 * other Worker's (the edge's, the guard's) is a skip, and it lists no
 * fingerprint: that Worker reports nowhere the rig's relay reads, so anything
 * listed could only match an event the rig's own API raises, and hide it.
 *
 * Fails when a config declares a cron the registry does not classify, the
 * registry classifies one no config declares, an entry is malformed, an API
 * cron's jobs differ from `CRON_JOBS` (the jobs are what is classified),
 * another Worker's cron is not a skip or lists a fingerprint, a
 * refusal names an endpoint rig mode does not refuse, or a `caught_in`
 * function does not exist.
 *
 * `--ref` reads the configs and sources from that ref. There, entries and jobs
 * the ref lacks are notes, since the registry may be newer. A ref whose
 * CRON_JOBS cannot be read, or that predates the app's own refusal, fails: the
 * registry does not describe it, and passing would claim it does.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { API_CONFIG } from "../tools/rig/src/cron.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REGISTRY_FILE = "tools/rig/crons.json";
export const SCHEMA = "loonext.rig-crons.v1";
export const CLASSES = ["run", "run-expect-refusal", "skip"];
export const REFUSAL_CODE = "rig_endpoint_refused";

/** The one config whose crons the rig fires, and where its jobs are listed. */
export const FIRED_CONFIG = API_CONFIG;
export const JOB_SOURCES = { [FIRED_CONFIG]: "apps/api/src/index.ts" };
export const POLICY_FILE = "apps/api/src/environments/policy.ts";

const CONFIG_NAME = /(?:^|\/)wrangler\.(?:jsonc?|toml)$/;
const CRON_FIELD = /^[0-9*/,-]+$/;

const ENTRY_KEYS = {
  run: ["config", "cron", "class", "jobs", "note", "expected_events", "defects"],
  "run-expect-refusal": ["config", "cron", "class", "jobs", "note", "refusals", "expected_events", "defects"],
  skip: ["config", "cron", "class", "jobs", "reason", "fingerprints"],
};
export const OUTCOMES = ["job-fails", "captured"];
const REFUSAL_KEYS = ["job", "code", "outcome", "telnyx_paths", "when", "caught_in", "fingerprints", "follow_on_events"];
const CAUGHT_IN = /^([\w./-]+\.ts)#(\w+)$/;

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

/** Whether `text` declares a function or function-valued binding named `name`. */
export function declaresFunction(text, name) {
  return new RegExp(`\\bfunction\\s*\\*?\\s*${name}\\s*[<(]|\\b(?:const|let|var)\\s+${name}\\s*[:=]`).test(text);
}

const isStringList = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");
const isFingerprint = (value) => isStringList(value);
const sameFingerprint = (a, b) => a.length === b.length && a.every((part, i) => part === b[i]);
const isSentence = (value) => typeof value === "string" && value.trim() !== "";

/** `expected_events`, `defects` and `follow_on_events` are lists of a match and one explaining field. */
function checkEventList(list, field, explain, at, problems) {
  if (list === undefined) return;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${at}: ${field} must be a non-empty list when present`);
    return;
  }
  for (const [i, event] of list.entries()) {
    const ok =
      event !== null &&
      typeof event === "object" &&
      Object.keys(event).every((key) => key === "match" || key === explain) &&
      isSentence(event.match) &&
      isSentence(event[explain]);
    if (!ok) problems.push(`${at}: ${field}[${i}] needs exactly a match and a ${explain}`);
  }
}

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

function checkClassFields(entry, at, problems, families, sourceAt) {
  if (entry.config !== FIRED_CONFIG && entry.class !== "skip") {
    problems.push(
      `${at}: the rig fires only ${FIRED_CONFIG}'s crons, and rig deploy gives no other config a timer, so ` +
        `${entry.config}'s cron is never fired here; classify it skip, with the reason`,
    );
    return;
  }
  if (entry.jobs !== undefined && !isStringList(entry.jobs)) {
    problems.push(`${at}: jobs must be a non-empty list of job keys`);
  }
  if (entry.class !== "skip") {
    if (entry.note !== undefined && !isSentence(entry.note)) {
      problems.push(`${at}: note must be a sentence when present`);
    }
    checkEventList(entry.expected_events, "expected_events", "why", at, problems);
    // Never suppressed: R00 reports each with the cause given here.
    checkEventList(entry.defects, "defects", "means", at, problems);
  }
  if (entry.class === "run") return;
  if (entry.class === "skip") {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      problems.push(`${at}: a skip needs a reason`);
    }
    if (entry.fingerprints !== undefined && (!Array.isArray(entry.fingerprints) || !entry.fingerprints.every(isFingerprint))) {
      problems.push(`${at}: fingerprints must be a list of fingerprints`);
      return;
    }
    const listed = entry.fingerprints ?? [];
    // The API's liveness checker watches only the API's own crons and jobs: a
    // skipped one goes overdue and alerts under each key.
    if (entry.config === FIRED_CONFIG) {
      const owed = [["ops", `cron:${entry.cron}`], ...(entry.jobs ?? []).map((job) => ["ops", job])];
      for (const fingerprint of owed) {
        if (!listed.some((item) => sameFingerprint(item, fingerprint))) {
          problems.push(`${at}: a skip silences ${JSON.stringify(fingerprint)}, so list it in fingerprints`);
        }
      }
      return;
    }
    for (const item of listed) {
      problems.push(
        `${at}: ${entry.config} reports nowhere the rig's relay reads, so ${JSON.stringify(item)} could only ` +
          `match an event the rig's own API raises, and would hide it; list no fingerprints`,
      );
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
    if (!OUTCOMES.includes(refusal.outcome)) {
      problems.push(`${where}: outcome must be one of ${OUTCOMES.join(", ")}`);
      continue;
    }
    // One job can reach a refusal both ways, on different paths.
    const key = `${refusal.job} ${refusal.outcome}`;
    if (seen.has(key)) problems.push(`${where}: ${refusal.job} has two ${refusal.outcome} refusals; merge them`);
    seen.add(key);
    if (entry.jobs !== undefined && !entry.jobs.includes(refusal.job)) {
      problems.push(`${where}: ${refusal.job} is not one of this cron's jobs`);
    }
    if (refusal.code !== REFUSAL_CODE) {
      problems.push(`${where}: code must be ${REFUSAL_CODE}`);
    }
    if (!isSentence(refusal.when)) {
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
    checkEventList(refusal.follow_on_events, "follow_on_events", "why", where, problems);
    const liveness = ["ops", refusal.job];
    if (refusal.fingerprints !== undefined && (!Array.isArray(refusal.fingerprints) || !refusal.fingerprints.every(isFingerprint))) {
      problems.push(`${where}: fingerprints must be a list of fingerprints`);
      continue;
    }
    const listed = refusal.fingerprints ?? [];
    const listsLiveness = listed.some((item) => sameFingerprint(item, liveness));
    if (refusal.outcome === "job-fails") {
      if (refusal.caught_in !== undefined) {
        problems.push(`${where}: a job-fails refusal is not caught; drop caught_in, or make it captured`);
      }
      // The job withholds its heartbeat, and the liveness checker then alerts
      // on it under this fingerprint.
      if (!listsLiveness) problems.push(`${where}: fingerprints must include ${JSON.stringify(liveness)}`);
      continue;
    }
    if (listsLiveness) {
      problems.push(
        `${where}: a captured refusal leaves the job's heartbeat recorded, so ${JSON.stringify(liveness)} ` +
          `would only ever be a real failure; do not suppress it`,
      );
    }
    const pointer = CAUGHT_IN.exec(typeof refusal.caught_in === "string" ? refusal.caught_in : "");
    if (pointer === null) {
      problems.push(`${where}: a captured refusal names where it is caught, as caught_in "<file>.ts#<function>"`);
      continue;
    }
    if (sourceAt === null) continue;
    const [, file, name] = pointer;
    const text = sourceAt(file);
    if (text === null) {
      problems.push(`${where}: caught_in names ${file}, which does not exist here`);
    } else if (!declaresFunction(text, name)) {
      problems.push(
        `${where}: ${file} declares no ${name}. Find where the refused request is caught now, ` +
          `and whether it still is, before moving caught_in`,
      );
    }
  }
}

/**
 * `configs` maps each Worker config to its crons; `jobs` maps a config to its
 * cron-to-jobs map, null when unreadable; `families` is null when unreadable;
 * `sources` maps each `caught_in` file to its text, null when absent. `exact`
 * is false for `--ref`, where entries and jobs the ref lacks are notes.
 */
export function judge({ registry, configs, jobs = {}, families = null, sources = {}, exact = true }) {
  const problems = [];
  const notes = [];
  const sourceAt = (file) => sources[file] ?? null;
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
  const counts = { run: 0, "run-expect-refusal": 0, skip: 0, "job-fails": 0, captured: 0, jobs: 0 };
  const refusing = [];
  for (const [i, entry] of registry.crons.entries()) {
    const at = `${REGISTRY_FILE} crons[${i}]${typeof entry?.cron === "string" ? ` "${entry.cron}"` : ""}`;
    if (!validEntryShape(entry, at, problems)) continue;
    const key = `${entry.config}\u0000${entry.cron}`;
    if (classified.has(key)) {
      problems.push(`${at}: ${entry.config} "${entry.cron}" is classified twice`);
      continue;
    }
    classified.set(key, entry);
    // A cron the ref lacks need not have its catch sites there either.
    const isDeclared = declared.has(key);
    checkClassFields(entry, at, problems, families, isDeclared || exact ? sourceAt : null);

    if (!isDeclared) {
      const message = `${at}: no tracked Worker config declares "${entry.cron}" in ${entry.config}`;
      if (exact) problems.push(`${message}; delete the entry`);
      else notes.push(`${message} at this ref; fine if the registry is newer than the ref`);
      continue;
    }
    counts[entry.class] += 1;
    if (entry.class === "run-expect-refusal" && Array.isArray(entry.refusals)) {
      refusing.push(entry.cron);
      for (const refusal of entry.refusals) {
        if (OUTCOMES.includes(refusal?.outcome)) counts[refusal.outcome] += 1;
      }
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

  // Both are what the classification rests on, so a ref without them is one
  // this registry does not describe.
  for (const [config, source] of Object.entries(JOB_SOURCES)) {
    if (!(config in configs)) continue;
    if (jobs[config] === null || jobs[config] === undefined) {
      problems.push(
        `${source} has no CRON_JOBS in a shape this reads at this ref, so the jobs each cron runs, ` +
          `which are what is classified, cannot be compared`,
      );
    }
  }
  if (families === null && refusing.length > 0) {
    problems.push(
      `${POLICY_FILE} has no account-wide refusal list at this ref, so the app does not refuse those ` +
        `requests itself. They reach the guard, whose 403 carries no ${REFUSAL_CODE} code, and the refusals ` +
        `listed for ${refusing.map((cron) => `"${cron}"`).join(", ")} match nothing this ref raises`,
    );
  } else if (families === null) {
    notes.push(`${POLICY_FILE} has no account-wide refusal list at this ref, and no cron here expects a refusal`);
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

/** What `judge` reads, from a ref or (null) from this checkout. */
export function readInput(ref = null) {
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
  const sources = {};
  for (const entry of Array.isArray(registry.crons) ? registry.crons : []) {
    for (const refusal of Array.isArray(entry?.refusals) ? entry.refusals : []) {
      const pointer = CAUGHT_IN.exec(typeof refusal?.caught_in === "string" ? refusal.caught_in : "");
      if (pointer !== null && !(pointer[1] in sources)) sources[pointer[1]] = readAt(ref, pointer[1]);
    }
  }
  return { registry, configs, jobs, families, sources, exact: ref === null };
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
  const { problems, notes, counts } = judge(readInput(ref));

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
      `${counts["run-expect-refusal"]} run-expect-refusal (${counts["job-fails"]} refusal(s) that fail the job, ` +
      `${counts.captured} the job captures), ${counts.skip} skip.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
