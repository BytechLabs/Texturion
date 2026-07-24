#!/usr/bin/env node
/**
 * Commit messages are the product changelog, so they are validated like one.
 *
 * `feat`, `fix`, `perf` and `revert` subjects are published verbatim in release
 * notes — a customer reads them. Those are held to a real standard. Everything
 * else (chore/ci/docs/test/refactor/build/style) is hidden from the changelog
 * and only has to be a well-formed Conventional Commit, so internal work stays
 * frictionless. Enforce hard on what users read; stay out of the way otherwise.
 *
 * Usage:
 *   node scripts/check-commit-message.mjs .git/COMMIT_EDITMSG   # commit-msg hook
 *   node scripts/check-commit-message.mjs --range <from>..<to>  # CI
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TYPES = [
  "feat", "fix", "perf", "revert",
  "docs", "test", "refactor", "chore", "ci", "build", "style",
];
/** The types that reach a customer's release notes. */
const PUBLISHED = new Set(["feat", "fix", "perf", "revert"]);

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;

const MIN_SUBJECT = 12;
const MAX_SUBJECT = 72;

/** Vague words that describe nothing to a reader. */
const VAGUE = /\b(stuff|things|various|misc|miscellaneous|wip|tweaks?|minor|small fixes?|some fixes?|cleanup|clean-up|nits?)\b/i;
/** Internal shorthand that means nothing outside this repo. */
const INTERNAL = /\b(round[- ]?\d+|batch\s*\d*|part\s*\d+|phase\s*\d+|follow[- ]?up|per review|as discussed|pr feedback)\b/i;
/** Conventional Commits is present-tense: "add", not "added". */
const PAST_TENSE = /^(fixed|added|updated|removed|changed|improved|refactored|implemented|created|deleted|renamed|moved)\b/i;

function checkOne(message) {
  const lines = message.split("\n");
  // A commit-msg file carries comments and may end with a trailing blank.
  const header = lines.find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  const errors = [];

  const match = HEADER.exec(header);
  if (!match?.groups) {
    return {
      header,
      errors: [
        `not a Conventional Commit. Expected "<type>(<scope>): <subject>".`,
      ],
    };
  }

  const { type, subject } = match.groups;

  if (!TYPES.includes(type)) {
    errors.push(`unknown type "${type}". Use one of: ${TYPES.join(", ")}.`);
  }

  // Structural rules apply to every commit.
  if (subject.endsWith(".")) {
    errors.push("subject must not end with a period.");
  }
  if (/^[A-Z][a-z]/.test(subject)) {
    errors.push(`subject should start lowercase ("${subject[0].toLowerCase()}…", not "${subject[0]}…").`);
  }

  // Editorial rules apply only to what a customer will actually read.
  if (PUBLISHED.has(type)) {
    if (subject.length < MIN_SUBJECT) {
      errors.push(
        `subject is ${subject.length} chars; a release-note line needs at least ${MIN_SUBJECT}. Say what changed for the user.`,
      );
    }
    if (subject.length > MAX_SUBJECT) {
      errors.push(
        `subject is ${subject.length} chars; keep it under ${MAX_SUBJECT} so it reads in a list. Put the detail in the body.`,
      );
    }
    if (VAGUE.test(subject)) {
      errors.push(
        `subject is vague ("${subject.match(VAGUE)[0]}"). A reader must learn what changed.`,
      );
    }
    if (INTERNAL.test(subject)) {
      errors.push(
        `subject uses internal shorthand ("${subject.match(INTERNAL)[0]}") that means nothing to a customer. Describe the change itself; keep the tracking reference in the body.`,
      );
    }
    if (PAST_TENSE.test(subject)) {
      const verb = subject.match(PAST_TENSE)[0];
      errors.push(`use present tense — "${verb.replace(/ed$/, "")}", not "${verb}".`);
    }
    if (/^#?\d+$/.test(subject.trim()) || /^(#\d+|[A-Z]+-\d+)\b/.test(subject)) {
      errors.push("subject must describe the change, not just reference an issue.");
    }
  }

  return { header, errors };
}

const USAGE = `
Format:  <type>(<scope>): <subject>

  type    ${TYPES.join(", ")}
  scope   optional — web, api, android, ios, shared
  subject what CHANGED, in present tense, no trailing period

feat/fix/perf/revert subjects are published verbatim in the release notes, so
they are held to a higher bar than internal commits.

  good   fix(web): the dialer no longer reports a call it never placed
  good   feat(ios): tap a map pin to get directions to the job site
  bad    fix(web): 6 round-4 fixes            <- internal shorthand
  bad    fix: fixed some things               <- past tense, vague
  bad    feat(api): #221                      <- a reference, not a description
`;

const args = process.argv.slice(2);
const rangeFlag = args.indexOf("--range");

let subjects;
if (rangeFlag !== -1) {
  const range = args[rangeFlag + 1];
  if (!range) {
    console.error("--range needs a <from>..<to>");
    process.exit(2);
  }
  const raw = execFileSync("git", ["log", "--format=%B%x00", range], {
    encoding: "utf8",
  });
  subjects = raw.split("\0").map((m) => m.trim()).filter(Boolean);
} else {
  const file = args[0];
  if (!file) {
    console.error("pass a commit-message file, or --range <from>..<to>");
    process.exit(2);
  }
  subjects = [readFileSync(file, "utf8")];
}

const failures = [];
for (const message of subjects) {
  // A merge commit is generated by git, not written by a human.
  if (/^Merge (branch|pull request|remote-tracking)/.test(message.trim())) continue;
  // release-please writes its own release commits.
  if (/^chore\(main\): release/.test(message.trim())) continue;
  const { header, errors } = checkOne(message);
  if (errors.length > 0) failures.push({ header, errors });
}

if (failures.length === 0) {
  if (rangeFlag !== -1) {
    console.log(`${subjects.length} commit message(s) checked — all good.`);
  }
  process.exit(0);
}

console.error(
  `\nCommit message rejected — these lines become the product changelog.\n`,
);
for (const { header, errors } of failures) {
  console.error(`  ${header || "(empty)"}`);
  for (const e of errors) console.error(`      - ${e}`);
  console.error("");
}
console.error(USAGE);
process.exit(1);
