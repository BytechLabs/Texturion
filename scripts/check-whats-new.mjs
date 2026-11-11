#!/usr/bin/env node
/**
 * #756: a release that ships a feature says so in What's new.
 *
 * Reads the commits since the previous release (the last `chore: release main`
 * commit) and how many entries or quiet-release records were added to
 * `packages/shared/whats-new.json` since then, and asks
 * `packages/shared/src/whats-new-rule.ts` for a verdict.
 *
 * On the push that merges a release, features with nothing added FAIL the
 * gates, so nothing is tagged or shipped until an entry lands; the next push
 * releases it. On any other push the same finding is a warning, so it shows up
 * well before a release without blocking work in between.
 *
 * Add an entry with `node scripts/generate-whats-new.mjs` after editing the
 * JSON; a release with no customer-facing change adds a quiet-release record
 * instead (docs/RELEASING.md).
 */
import { execFileSync } from "node:child_process";

import { judgeWhatsNew, RELEASE_SUBJECT } from "../packages/shared/src/whats-new-rule.ts";

const FILE = "packages/shared/whats-new.json";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function isShallow() {
  return git("rev-parse", "--is-shallow-repository") === "true";
}

/** The newest release commit at or before `ref`, or null within the history we have. */
function releaseAtOrBefore(ref) {
  const lines = git("log", "--format=%H%x09%s", ref).split("\n");
  const hit = lines.map((line) => line.split("\t")).find(([, subject]) => RELEASE_SUBJECT.test(subject ?? ""));
  return hit ? hit[0] : null;
}

/** Entry ids and quiet-release records in the JSON at `ref`; none when it did not exist. */
function recordsAt(ref) {
  let text;
  try {
    text = git("show", `${ref}:${FILE}`);
  } catch {
    return new Set();
  }
  const data = JSON.parse(text);
  return new Set([
    ...(data.entries ?? []).map((entry) => `entry:${entry.id}`),
    ...(data.quietReleases ?? []).map((quiet) => `quiet:${quiet.date}:${quiet.reason}`),
  ]);
}

const releasing = RELEASE_SUBJECT.test(git("log", "-1", "--format=%s"));
// The commits a release ships are the ones before its own release commit.
const tip = releasing ? "HEAD~1" : "HEAD";

let previous = releaseAtOrBefore(tip);
if (previous === null && isShallow()) {
  // CI checks out 50 commits; a long release window reaches further back.
  git("fetch", "--quiet", "--deepen=1000", "origin");
  previous = releaseAtOrBefore(tip);
}
if (previous === null) {
  console.log("What's new: no earlier release in this history, so there is no window to check.");
  process.exit(0);
}

const subjects = git("log", "--format=%s", `${previous}..${tip}`).split("\n").filter(Boolean);
const before = recordsAt(previous);
const added = [...recordsAt("HEAD")].filter((record) => !before.has(record)).length;
const verdict = judgeWhatsNew({ subjects, added, releasing });

const window = `${subjects.length} commit(s) since the last release (${previous.slice(0, 8)})`;
if (verdict.kind === "ok") {
  console.log(
    `What's new: ${window}, ${verdict.features.length} feature(s), ${added} entry or quiet record(s) added.`,
  );
  process.exit(0);
}

const list = verdict.features.map((subject) => `  - ${subject}`).join("\n");
const ask =
  `add an entry to ${FILE} and run node scripts/generate-whats-new.mjs, ` +
  "or record a quiet release with its reason (docs/RELEASING.md)";
if (verdict.kind === "warn") {
  console.log(`::warning title=What's new::${verdict.features.length} feature(s) since the last release and no What's new entry yet: ${ask}.`);
  console.log(`What's new: ${window}. Features waiting for an entry:\n${list}`);
  process.exit(0);
}
console.error(
  `What's new: this release ships ${verdict.features.length} feature(s) and adds nothing to What's new.\n` +
    `${list}\n\nBefore it can ship, ${ask}.`,
);
process.exit(1);
