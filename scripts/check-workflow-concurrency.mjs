#!/usr/bin/env node
/**
 * A release must not be dropped by the push that follows it.
 *
 *   node scripts/check-workflow-concurrency.mjs                     # the repo
 *   node scripts/check-workflow-concurrency.mjs path/to/workflows   # a fixture dir
 *
 * GitHub keeps one PENDING run per concurrency group and replaces it when the
 * next one arrives, whatever `cancel-in-progress` says. So a group shared by
 * every run on main lets a third push cancel a gate that is still waiting for a
 * runner. When that gate belongs to a release commit, release-please never runs
 * and nothing ships, with no failure reported (#532 in main.yml, and again in
 * checks.yml on 2026-11-11, run 42944874459).
 *
 * The rule: main.yml, and every workflow it calls with `uses: ./...`, keys its
 * group on `github.sha` (a pull request may key on the ref so a new push
 * replaces the old run). A workflow that must run one at a time across commits
 * is listed in SERIAL with its reason; a name there that no longer matches a
 * called workflow fails too.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SERIAL = {
  "ship.yml": "one production deploy at a time; a newer release supersedes a waiting one",
};

const dir = process.argv[2] ?? ".github/workflows";
const read = (name) => readFileSync(join(dir, name), "utf8");

/** The workflow-level `concurrency.group` value, or null when there is none. */
export function concurrencyGroup(text) {
  const match = /^concurrency:\s*\n(?:\s*#.*\n)*\s+group:\s*(.+)$/m.exec(text);
  return match ? match[1].trim() : null;
}

/** The local workflows a file calls with `uses: ./.github/workflows/<name>`. */
export function calledWorkflows(text) {
  return [...text.matchAll(/uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/g)].map(
    (match) => match[1],
  );
}

if (!existsSync(join(dir, "main.yml"))) {
  console.error(`check-workflow-concurrency: no main.yml in ${dir}`);
  process.exit(1);
}

const onPath = ["main.yml", ...new Set(calledWorkflows(read("main.yml")))];
const failures = [];
for (const name of onPath) {
  if (name in SERIAL) continue;
  if (!readdirSync(dir).includes(name)) {
    failures.push(`${name}: main.yml calls it but it does not exist`);
    continue;
  }
  const group = concurrencyGroup(read(name));
  if (group === null) continue;
  if (!group.includes("github.sha")) {
    failures.push(`${name}: concurrency group "${group}" is shared across commits on main`);
  }
}
for (const name of Object.keys(SERIAL)) {
  if (!onPath.includes(name)) failures.push(`SERIAL lists ${name}, which main.yml no longer calls`);
}

if (failures.length > 0) {
  console.error("check-workflow-concurrency: a later push could cancel a release's waiting run.");
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(
  `check-workflow-concurrency: ${onPath.length} workflows on the release path (${onPath.join(", ")}); each keys its group on the commit or is serial by design.`,
);
