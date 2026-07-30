#!/usr/bin/env node
/**
 * [#444] The deploy path may not execute code chosen by somebody else.
 *
 *   node scripts/check-action-pins.mjs
 *
 * Offline and dependency-free: it reads `ship.yml` and checks the SHAPE of each
 * `uses:` ref. No network, so it cannot rate-limit — which matters, because the
 * incident this guard descends from WAS a rate-limited lookup taking a deploy
 * down.
 *
 * ---------------------------------------------------------------------------
 * WHY ship.yml AND NOT THE OTHERS.
 *
 * `ship.yml` deploys api + web + database to the one environment that exists
 * (docs/ENVIRONMENTS.md: no staging), and builds the two artifacts that go to
 * the stores. An action that changes behaviour mid-release changes what
 * customers get.
 *
 * `checks.yml` and `main.yml` keep readable major tags on purpose. A surprise
 * there costs a red build, which is the system working. #444 asked for exactly
 * this asymmetry and it is the reason this file names one workflow rather than
 * globbing the directory — SHA-pinning everything is the textbook answer and
 * the wrong one here, because ten hand-maintained SHAs for a solo founder is
 * the #403 failure where a guard becomes a thing people click past.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VERSION COMMENT IS MANDATORY.
 *
 * A bare SHA is unreadable. `# v4.4.0` beside it is the only thing telling a
 * human what they are looking at, and it is what makes the quarterly bump
 * possible at all — `scripts/ops/bump-action-pins.mjs` reports drift against
 * these comments. A pin without one is a pin nobody can maintain, so it fails
 * here rather than being tidied up later.
 */
import { readFileSync } from "node:fs";

// Overridable so the failure paths can be exercised against a fixture. A guard
// whose red branch has never run once is a guess about what it would do.
const FILE = process.argv[2] ?? ".github/workflows/ship.yml";

/**
 * Local composite actions (`./.github/actions/x`) and reusable workflows
 * (`./.github/workflows/y.yml`) are IN this repository — they already cannot
 * change without a commit here, which is the whole property being enforced.
 */
const LOCAL = /^\.\//;

const source = readFileSync(FILE, "utf8");
const problems = [];
let pinned = 0;

source.split(/\r?\n/).forEach((line, index) => {
  // `- uses: owner/repo@ref # comment` or `uses: owner/repo@ref`, at any indent.
  const match = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(?:#\s*(.*))?$/.exec(line);
  if (!match) return;
  const [, ref, comment] = match;
  const where = `${FILE}:${index + 1}`;

  if (LOCAL.test(ref)) return;

  const at = ref.lastIndexOf("@");
  if (at === -1) {
    problems.push(`${where}: \`${ref}\` has no ref at all — it floats freely.`);
    return;
  }
  const version = ref.slice(at + 1);

  if (!/^[0-9a-f]{40}$/.test(version)) {
    problems.push(
      `${where}: \`${ref}\` is pinned to "${version}", which is mutable.\n` +
        "      A tag or branch is moved by its publisher, so what this deploy " +
        "runs\n      can change with no commit in this repository. Resolve it:\n" +
        "        node scripts/ops/bump-action-pins.mjs",
    );
    return;
  }

  // A SHA nobody can read is a SHA nobody will ever bump.
  if (!comment || !/v?\d+\.\d+/.test(comment)) {
    problems.push(
      `${where}: \`${ref.slice(0, at)}\` is pinned but says nothing about ` +
        "which version that is.\n      Add the release beside it, e.g. " +
        "`# v4.4.0`.",
    );
    return;
  }
  pinned += 1;
});

// A guard that matches nothing passes forever. ship.yml has had at least a
// checkout and an artifact upload in every version of this file; if a rename or
// a syntax change stops the regex matching, say so rather than reporting green
// over a file that was never read.
if (pinned === 0 && problems.length === 0) {
  console.error(
    `\nNo action refs found in ${FILE}. Either the file moved or the parser ` +
      "stopped matching. A check that silently sees nothing is worse than one " +
      "that fails.\n",
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`\n${FILE} is the deploy path, and it must not float:\n`);
  for (const problem of problems) console.error(`  x ${problem}`);
  console.error(
    "\n#444: a major tag is mutable, so a third party decides what production " +
      "runs.\nThat is what took a deploy down on 2026-07-24, one layer lower.\n" +
      "checks.yml and main.yml keep major tags deliberately — there, a " +
      "surprise costs\na red build and nothing more.\n",
  );
  process.exit(1);
}

console.log(
  `Deploy-path actions: ${pinned} pinned to a commit, each naming its version.`,
);
