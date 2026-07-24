#!/usr/bin/env node
/**
 * Cut a product release.
 *
 * ONE version for the whole product. Loonext 1.3.0 means the same thing in the
 * web app, the API, and both store listings — because to a customer it IS one
 * product. Five independent semver streams would just make "what version are we
 * on?" a question with five answers.
 *
 * What this does, in order:
 *   1. reads the current version from version.txt
 *   2. works out the next one from the Conventional Commits since the last tag
 *      (a `!`/BREAKING CHANGE -> major, any `feat` -> minor, else patch), unless
 *      you passed an explicit bump
 *   3. writes version.txt, the Android versionName and the iOS MARKETING_VERSION
 *   4. prepends a grouped section to CHANGELOG.md
 *   5. commits and tags v<version>
 *
 * Build NUMBERS are deliberately not here: versionCode / CURRENT_PROJECT_VERSION
 * come from the git commit count at build time (monotonic by construction), so
 * there is nothing to remember and nothing to collide.
 *
 * Usage:
 *   node scripts/release.mjs            # bump inferred from the commits
 *   node scripts/release.mjs minor      # force a bump
 *   node scripts/release.mjs --dry-run  # print everything, change nothing
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

/** Same, but a failure is expected and its stderr is not worth showing. */
const gitQuiet = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const explicitBump = args.find((a) => ["major", "minor", "patch"].includes(a));

// ---- 1. where we are -------------------------------------------------------

const current = readFileSync("version.txt", "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(current)) {
  throw new Error(`version.txt holds "${current}", which is not a semver`);
}

// The previous release tag, or the repo root when this is the first release.
let since;
try {
  since = gitQuiet("describe", "--tags", "--abbrev=0", "--match", "v*");
} catch {
  // No release tag yet — fall back to the root commit. (In this repo v1.0.0 is
  // tagged as the baseline, so this branch is only for a fresh clone of a repo
  // that has never released.)
  since = git("rev-list", "--max-parents=0", "HEAD");
}

// ---- 2. what changed ------------------------------------------------------

const SEP = ""; // unit separator — cannot occur in a commit subject
const raw = git("log", `${since}..HEAD`, `--format=%H${SEP}%s${SEP}%b${SEP}`);
const commits = raw
  .split("\n")
  .join("\n")
  .split(`${SEP}\n`)
  .map((entry) => entry.split(SEP))
  .filter((parts) => parts.length >= 2 && parts[1])
  .map(([sha, subject, body = ""]) => ({ sha: sha.trim(), subject, body }));

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const parsed = commits
  .map((c) => {
    const m = CONVENTIONAL.exec(c.subject);
    if (!m) return null;
    const [, type, scope, bang, summary] = m;
    const breaking = Boolean(bang) || /^BREAKING CHANGE:/m.test(c.body);
    return { ...c, type, scope: scope ?? null, summary, breaking };
  })
  .filter(Boolean);

if (parsed.length === 0 && !dryRun) {
  console.log(`No conventional commits since ${since} — nothing to release.`);
  process.exit(0);
}

// ---- 3. the next version --------------------------------------------------

const inferred = parsed.some((c) => c.breaking)
  ? "major"
  : parsed.some((c) => c.type === "feat")
    ? "minor"
    : "patch";
const bump = explicitBump ?? inferred;

const [major, minor, patch] = current.split(".").map(Number);
const next =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

// ---- 4. the changelog section ---------------------------------------------

// Only what a reader cares about. Everything else (chore/ci/docs/test/refactor)
// is still in git; it just does not belong in release notes.
const SECTIONS = [
  ["breaking", "⚠ Breaking Changes"],
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance"],
  ["revert", "Reverts"],
];

const bucketed = new Map(SECTIONS.map(([key]) => [key, []]));
for (const c of parsed) {
  const key = c.breaking ? "breaking" : c.type;
  if (bucketed.has(key)) bucketed.get(key).push(c);
}

const today = new Date().toISOString().slice(0, 10);
const lines = [`## ${next} (${today})`, ""];
for (const [key, heading] of SECTIONS) {
  const entries = bucketed.get(key);
  if (entries.length === 0) continue;
  lines.push(`### ${heading}`, "");
  for (const c of entries) {
    const scope = c.scope && !c.scope.startsWith("#") ? `**${c.scope}:** ` : "";
    lines.push(`* ${scope}${c.summary} (${c.sha.slice(0, 7)})`);
  }
  lines.push("");
}
const section = lines.join("\n");

// ---- 5. write ------------------------------------------------------------

const edits = [
  ["version.txt", (t) => `${next}\n`],
  [
    "apps/android/app/build.gradle.kts",
    (t) =>
      t.replace(
        /(\.orNull \?: )"(\d+\.\d+\.\d+)"( \/\/ x-release-version)/,
        `$1"${next}"$3`,
      ),
  ],
  [
    "apps/ios/project.yml",
    (t) =>
      t.replace(
        /(MARKETING_VERSION: )(\d+\.\d+\.\d+)( # x-release-version)/,
        `$1${next}$3`,
      ),
  ],
  [
    "CHANGELOG.md",
    (t) => {
      const header = "# Changelog\n\n";
      const rest = t.startsWith(header) ? t.slice(header.length) : t;
      return `${header}${section}\n${rest}`;
    },
  ],
];

console.log(`${current} -> ${next}  (${bump}${explicitBump ? "" : ", inferred"})`);
console.log(`${parsed.length} conventional commit(s) since ${since}\n`);
console.log(section);

if (dryRun) {
  console.log("--dry-run: nothing written.");
  process.exit(0);
}

for (const [path, transform] of edits) {
  const before = existsSync(path) ? readFileSync(path, "utf8") : "# Changelog\n\n";
  const after = transform(before);
  if (after === before && path !== "CHANGELOG.md") {
    throw new Error(
      `${path} was not updated — its version marker is missing or changed shape`,
    );
  }
  writeFileSync(path, after);
}

git("add", ...edits.map(([p]) => p));
git("commit", "-m", `chore(release): v${next}`);
git("tag", "-a", `v${next}`, "-m", `v${next}`);

console.log(`\nCommitted and tagged v${next}.`);
console.log("Push it with:  git push origin main --follow-tags");
