#!/usr/bin/env node
/**
 * [#444] The quarterly bump for the deploy path's pinned actions.
 *
 *   node scripts/ops/bump-action-pins.mjs            # report drift
 *   node scripts/ops/bump-action-pins.mjs --write    # apply it
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL.
 *
 * SHA pins have one real cost and #444 names it: they **rot silently**. A
 * floating tag at least receives its publisher's security fixes; a pin sits at
 * whatever was current the day somebody wrote it, forever, and nothing anywhere
 * says so. Trading a loud failure for a quiet one is not obviously a win.
 *
 * So the cadence is part of the decision rather than an aspiration attached to
 * it: **quarterly, deliberately** (D93). "Deliberately" only means anything if
 * doing it is cheap — the alternative is ten manual tag lookups, which is the
 * kind of chore that gets skipped for a year and then done in a panic. This
 * turns it into one command.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT RUN IN CI, AND THAT IS THE POINT.
 *
 * If a job bumped these automatically we would be back where we started: a
 * third party deciding what production runs, with the repo's commit log
 * providing a thin coat of paint over it. The whole value of a pin is that a
 * person looked. This prints; a human commits.
 *
 * It reads the `# v4.4.0` comment beside each pin to say what is changing in
 * human terms, which is why `check-action-pins.mjs` insists that comment exists.
 *
 * Needs GITHUB_TOKEN (or gh's) only to avoid the unauthenticated rate limit —
 * the same limit that caused the 2026-07-24 outage. Without one it still works
 * for a handful of actions and says so if it gets throttled.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = ".github/workflows/ship.yml";
const WRITE = process.argv.includes("--write");

/**
 * The major line each action is TRACKED ON. A pin bump moves along its major;
 * crossing a major is a breaking change somebody reads release notes for, not
 * something a maintenance script decides. `actions/checkout` is on v7 upstream
 * while we run v4 — that gap is a deliberate, separate decision.
 */
const MAJOR = {
  "actions/checkout": "v4",
  "pnpm/action-setup": "v4",
  "actions/setup-node": "v4",
  "actions/setup-java": "v4",
  "actions/upload-artifact": "v4",
  "gradle/actions": "v4",
  "android-actions/setup-android": "v3",
  // A BRANCH, not a tag — see the comment in ship.yml. Resolving it is what
  // told us that, and it is why this looks up refs generically rather than
  // assuming everything upstream is tagged sensibly.
  "supabase/setup-cli": "v1",
};

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

async function api(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "loonext-action-pin-bump",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 403 || response.status === 429) {
    throw new Error(
      "GitHub rate-limited this lookup. Set GITHUB_TOKEN — unauthenticated " +
        "resolution is the exact failure that took the deploy down on " +
        "2026-07-24.",
    );
  }
  return response.ok ? response.json() : null;
}

/** Follow a ref to a commit, through however many annotated tags. */
async function commitFor(repo, major) {
  let object =
    (await api(`repos/${repo}/git/ref/tags/${major}`))?.object ??
    (await api(`repos/${repo}/git/ref/heads/${major}`))?.object;
  if (!object) return null;
  // gradle/actions chains tag -> tag -> commit. Stopping at the first object
  // yields a TAG sha, which Actions rejects, so this loops rather than derefs
  // once.
  for (let hops = 0; object.type === "tag" && hops < 5; hops += 1) {
    object = (await api(`repos/${repo}/git/tags/${object.sha}`))?.object;
    if (!object) return null;
  }
  return object.type === "commit" ? object.sha : null;
}

/** The most specific release tag at a commit — what makes the pin readable. */
async function versionAt(repo, sha) {
  for (let page = 1; page <= 3; page += 1) {
    const tags = await api(`repos/${repo}/tags?per_page=100&page=${page}`);
    if (!tags?.length) break;
    const exact = tags
      .filter((tag) => tag.commit.sha === sha)
      .map((tag) => tag.name)
      .filter((name) => /\d+\.\d+/.test(name));
    if (exact.length > 0) return exact.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}

const original = readFileSync(FILE, "utf8");
const lines = original.split(/\r?\n/);
const eol = original.includes("\r\n") ? "\r\n" : "\n";

const changes = [];
for (const [index, line] of lines.entries()) {
  const match = /^(\s*(?:-\s+)?uses:\s*)(\S+?)@([0-9a-f]{40})(\s*#\s*)(\S+)\s*$/.exec(line);
  if (!match) continue;
  const [, lead, path, sha, gap, stated] = match;
  // `gradle/actions/setup-gradle` lives in the `gradle/actions` repo.
  const repo = Object.keys(MAJOR).find(
    (name) => path === name || path.startsWith(`${name}/`),
  );
  if (!repo) {
    console.error(`  ? ${path} is not in MAJOR — add it, or it never bumps.`);
    process.exitCode = 1;
    continue;
  }
  const latest = await commitFor(repo, MAJOR[repo]);
  if (!latest) {
    console.error(`  ? could not resolve ${repo}@${MAJOR[repo]}`);
    process.exitCode = 1;
    continue;
  }
  if (latest === sha) continue;
  const version = (await versionAt(repo, latest)) ?? MAJOR[repo];
  changes.push({ line: index, path, from: stated, to: version });
  lines[index] = `${lead}${path}@${latest}${gap}${version}`;
}

if (changes.length === 0) {
  console.log(
    `${FILE}: every pin is already where its major tag points. Nothing to bump.`,
  );
  process.exit(process.exitCode ?? 0);
}

console.log(`\n${FILE} — ${changes.length} pin(s) have moved:\n`);
for (const change of changes) {
  console.log(`  ${change.path}: ${change.from} -> ${change.to}`);
}

if (!WRITE) {
  console.log("\nRe-run with --write to apply. Read the release notes first:");
  for (const change of changes) {
    console.log(`  https://github.com/${change.path.split("/").slice(0, 2).join("/")}/releases`);
  }
  console.log();
  process.exit(process.exitCode ?? 0);
}

writeFileSync(FILE, lines.join(eol));
console.log(
  `\nWritten. Commit it yourself — an unreviewed pin bump is a floating tag ` +
    `with extra steps.\n`,
);
