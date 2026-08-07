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
import { fileURLToPath } from "node:url";

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

/**
 * ONE CHANGE PER SUBJECT. A changelog line describes a single thing a customer
 * can understand; "6 fixes — a call reported but never placed, a dead-end gate"
 * is three entries crammed into one and reads as noise in release notes. Split
 * the commit, or if the work genuinely belongs together, name the single
 * user-visible outcome and leave the parts in the body.
 */
const BATCHED = [
  [/^\d+\s+(fix|fixes|change|changes|improvement|improvements|update|updates|issue|issues)\b/i,
   "starts with a COUNT of changes"],
  [/\b(several|multiple|assorted|a few|a bunch of|batch of|various)\b/i,
   "describes a group of changes rather than one"],
  [/\s[—–]\s/, "uses a dash to staple two statements together"],
  [/;/, "uses a semicolon to join separate statements"],
  [/,[^,]*,/, "contains a list (two or more commas)"],
];

/**
 * Implementation vocabulary. These name CODE, not what a customer experiences —
 * the audience here is field-service crews, not engineers. "the dialer no longer
 * reports a call it never placed" is the same fix described in their terms.
 *
 * Deliberately NOT banned: words that name a user-VISIBLE symptom, even if they
 * look technical (NaN, undefined, a blank screen). Those belong in release notes.
 */
const JARGON = [
  /\b(refactor(?:s|ed|ing)?|reducer|middleware|rpc|durable object|migration|endpoint|payload|mutex|regexp?|enum|schema|useeffect|callback|closure|promise|boolean|null[- ]check|memoi[sz]e|dedupe|idempotenc[ey]|webhook)\b/i,
  /\b(wire up|hook up|plumb|extract|inline|rename|bump|wrap|gate|guard|swallow|propagate|instrument)\b/i,
];

/**
 * WHICH CLIENT A SCOPE CLAIMS.
 *
 * Release-please routes a commit to a changelog by the FILES it touches, and
 * for the store apps the generated notes are the "What's new" text. So a
 * `feat(android)` that also edits `apps/ios/**` lands in the iOS changelog with
 * the word "android" as its first word — which is exactly what af2f2b5 shipped
 * to the App Store (#441). The subject was well-formed and the routing was
 * right; the only wrong thing was a fact about the diff, which no string check
 * can see.
 *
 * Only CLIENT scopes are listed, because only they make a platform claim a
 * customer reads. `api`, `db`, `shared` and every feature scope (`contacts`,
 * `compose`, …) are absent on purpose: a server change shipping its own
 * migration, or a shared helper consumed by all three clients, is normal work
 * and not a mislabel.
 */
const CLIENT_SCOPES = {
  web: ["apps/web"],
  android: ["apps/android"],
  ios: ["apps/ios"],
  /** Both phones — the two-store cross-platform scope. */
  mobile: ["apps/android", "apps/ios"],
  /** All three — the convention already in use across ~39 commits. */
  clients: ["apps/web", "apps/android", "apps/ios"],
};
const CLIENT_ROOTS = ["apps/web", "apps/android", "apps/ios"];

/** The scope a diff touching exactly these clients should have used. */
function suggestScope(roots) {
  const set = new Set(roots);
  for (const [scope, owns] of Object.entries(CLIENT_SCOPES)) {
    if (owns.length === set.size && owns.every((r) => set.has(r))) return scope;
  }
  return null;
}

/**
 * Does the scope contradict the diff? `files` null = unknown, so no opinion —
 * the check fails open rather than inventing a verdict from missing data.
 */
export function scopeErrors(scope, files) {
  if (!scope || !files || files.length === 0) return [];
  const owns = CLIENT_SCOPES[scope];
  if (!owns) return [];

  const touched = CLIENT_ROOTS.filter((root) =>
    files.some((f) => f.startsWith(`${root}/`)),
  );
  const foreign = touched.filter((root) => !owns.includes(root));
  if (foreign.length === 0) return [];

  const suggestion = suggestScope(touched);
  const names = foreign.map((r) => r.replace("apps/", "")).join(" and ");
  return [
    `scope "(${scope})" contradicts the diff — it also changes ${names}. ` +
      `A customer reading the ${names} release notes sees "${scope}:" as the ` +
      `first word. ` +
      (suggestion
        ? `Use "(${suggestion})" for this diff, or split the commit.`
        : `Use a scope covering every client it touches, or split the commit.`) +
      `\n        offending paths: ${files
        .filter((f) => foreign.some((root) => f.startsWith(`${root}/`)))
        .slice(0, 5)
        .join("\n                         ")}`,
  ];
}

export function checkOne(message, files = null) {
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

  const { type, scope, subject } = match.groups;

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
    for (const [pattern, why] of BATCHED) {
      if (pattern.test(subject)) {
        errors.push(
          `one change per subject — this ${why}. Split the commit, or name the single user-visible outcome and put the parts in the body.`,
        );
        break; // one batching complaint is enough; they all have the same fix
      }
    }
    for (const pattern of JARGON) {
      const hit = subject.match(pattern);
      if (hit) {
        errors.push(
          `"${hit[0]}" names the code, not what the customer experiences. Describe the change from the user's side.`,
        );
        break;
      }
    }
    // The one rule that is a fact about the DIFF rather than the string. Held
    // to published types only, for the same reason as everything else in this
    // block: a chore's scope reaches no customer.
    errors.push(...scopeErrors(scope, files));
  }

  return { header, errors };
}

const USAGE = `
Format:  <type>(<scope>): <subject>

  type    ${TYPES.join(", ")}
  scope   optional — web, api, android, ios, shared, db, or a feature name
  subject what CHANGED, in present tense, no trailing period

feat/fix/perf/revert subjects are published verbatim in the release notes, so
they are held to a higher bar than internal commits.

A CLIENT scope is checked against the diff, because it is the one word a
customer reads first in a store's "What's new":

  web       apps/web only
  android   apps/android only
  ios       apps/ios only
  mobile    both phones
  clients   all three

  good   fix(web): the dialer no longer reports a call it never placed
  good   feat(mobile): tap a map pin to get directions to the job site
  bad    fix(web): 6 round-4 fixes            <- internal shorthand
  bad    fix: fixed some things               <- past tense, vague
  bad    feat(api): #221                      <- a reference, not a description
  bad    feat(android): …  (also edits apps/ios)  <- says one phone, changes two
`;

/** The files one commit touches. A merge shows nothing here, and is skipped anyway. */
function filesInCommit(sha) {
  try {
    return execFileSync("git", ["show", "--name-only", "--format=", sha], {
      encoding: "utf8",
    })
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return null; // unknown beats guessed — scopeErrors fails open on null
  }
}

/** What the hook can see: the change about to become the commit. */
function stagedFiles() {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const rangeFlag = args.indexOf("--range");

  /** @type {{message: string, files: string[] | null}[]} */
  let commits;
  if (rangeFlag !== -1) {
    const range = args[rangeFlag + 1];
    if (!range) {
      console.error("--range needs a <from>..<to>");
      process.exit(2);
    }
    // %H alongside the body, because the scope check needs the diff and
    // `git log --format=%B` alone throws the sha away.
    const raw = execFileSync("git", ["log", "--format=%H%x1f%B%x00", range], {
      encoding: "utf8",
    });
    commits = raw
      .split("\0")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const sep = entry.indexOf("\x1f");
        const sha = entry.slice(0, sep).trim();
        return { message: entry.slice(sep + 1).trim(), sha };
      })
      .map(({ message, sha }) => ({ message, files: filesInCommit(sha) }));
  } else {
    const file = args[0];
    if (!file) {
      console.error("pass a commit-message file, or --range <from>..<to>");
      process.exit(2);
    }
    commits = [{ message: readFileSync(file, "utf8"), files: stagedFiles() }];
  }

  const failures = [];
  for (const { message, files } of commits) {
    // A merge commit is generated by git, not written by a human.
    //
    // `Merge <sha> into <sha>` is the one GITHUB writes for a pull request's
    // merge ref, and it matched none of the three spellings below — so this
    // guard failed every pull request in the repository, on a commit nobody
    // authored and nobody can edit. #527 sat open behind it: the gate could not
    // go green no matter what the branch contained, which is the most expensive
    // shape a guard can have, because it stops being read as information.
    if (
      /^Merge (branch|pull request|remote-tracking)/.test(message.trim()) ||
      /^Merge [0-9a-f]{7,40} into [0-9a-f]{7,40}/i.test(message.trim())
    ) {
      continue;
    }
    // release-please writes its own release commits.
    if (/^chore\(main\): release/.test(message.trim())) continue;
    const { header, errors } = checkOne(message, files);
    if (errors.length > 0) failures.push({ header, errors });
  }

  if (failures.length === 0) {
    if (rangeFlag !== -1) {
      console.log(`${commits.length} commit message(s) checked — all good.`);
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
}

// Only when RUN, never when imported — `checkOne` and `scopeErrors` are
// unit-tested, and a test that imports this file must not shell out to git.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
