#!/usr/bin/env node
/**
 * [#444, #581] Nobody outside this repository decides what our workflows run —
 * or whether they run at all.
 *
 *   node scripts/check-action-pins.mjs                     # every workflow
 *   node scripts/check-action-pins.mjs path/to/fixture.yml # one file
 *
 * Offline and dependency-free: it reads the workflow files and checks the SHAPE
 * of what it finds. No network, so it cannot rate-limit — which matters, because
 * the incident this guard descends from WAS a rate-limited lookup taking a deploy
 * down.
 *
 * ---------------------------------------------------------------------------
 * WHICH FILES MUST PIN, AND WHY IT IS NO LONGER A LIST OF NAMES.
 *
 * The first version of this guard named `ship.yml` and exempted the rest, on this
 * rationale:
 *
 *     "`checks.yml` and `main.yml` keep readable major tags on purpose. A
 *      surprise there costs a red build, which is the system working."
 *
 * That is true of `checks.yml`, which grants `contents: read` and can only make a
 * build red. It was never true of `main.yml`, which grants `contents: write`,
 * `pull-requests: write` and `issues: write` and ran a third party's action on a
 * major tag with all three in scope (#581). One sentence covered two files and
 * described only one of them, and the file it described wrongly is the one that
 * holds the token.
 *
 * So the tier is DERIVED FROM WHAT THE FILE HOLDS rather than typed:
 *
 *   STRICT — every non-local `uses:` must be a 40-character commit SHA with the
 *            release in a comment beside it. A file is strict when it grants any
 *            write scope that can change this repository, when it declares no
 *            workflow-level `permissions:` at all (the inherited default is a
 *            repository SETTING this script cannot read, so unknown counts as
 *            privileged), or when it is one of ALWAYS_STRICT below.
 *
 *   LENIENT — a readable major tag is allowed, and that is still deliberate: ten
 *            hand-maintained SHAs for a solo founder buys nothing where a
 *            surprise costs a red build, and a guard that is more work than the
 *            risk is the #403 failure where people learn to click past it. What
 *            is NOT allowed is a ref that is not even version-shaped —
 *            `@main`, `@latest`, a branch name, or no ref at all.
 *
 * A version-shaped ref can still secretly be a branch: `supabase/setup-cli@v1`
 * was one, and it was the least pinned thing in the deploy path while carrying
 * the comment about the outage. Offline shape-checking cannot tell those apart,
 * which is exactly why the privileged tier demands a SHA instead.
 *
 * ALWAYS_STRICT is a FLOOR, not the rule. Derivation alone would let a file
 * downgrade its own coverage by relaxing its permissions block, and the deploy
 * path is not something to work that out about from a diff.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VERSION COMMENT IS MANDATORY.
 *
 * A bare SHA is unreadable. `# v4.4.0` beside it is the only thing telling a
 * human what they are looking at, and it is what makes the quarterly bump
 * possible at all — `scripts/ops/bump-action-pins.mjs` reports drift against
 * these comments. A pin without one is a pin nobody can maintain, so it fails
 * here rather than being tidied up later.
 *
 * ---------------------------------------------------------------------------
 * AND THE SECOND QUESTION: WHETHER THE CHECK RUNS.
 *
 * Pinning answers "whose code runs". It says nothing about "does the job run at
 * all", and #581 was both: every job in `checks.yml` and `security.yml` was
 * gated on the head BRANCH NAME, which on a pull request from a fork is chosen by
 * the contributor. Name a branch `release-please--x` and twelve jobs skipped —
 * and GitHub reports a skipped job as a pass. Same class of defect as a floating
 * tag (somebody outside the repository steering our pipeline), same scan, so it
 * is asked here rather than left to a guard nobody wrote. It would read better as
 * its own `check-workflow-trust.mjs`; splitting it is a rename, not a rethink.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const WORKFLOW_DIR = ".github/workflows";

/**
 * Strict no matter what their permissions say. `ship.yml` is the only file whose
 * output reaches customers (docs/ENVIRONMENTS.md: one environment, no staging)
 * and `main.yml` is the only thing that calls it.
 */
const ALWAYS_STRICT = new Set(["ship.yml", "main.yml"]);

/**
 * Write scopes that cannot change this repository or reach a customer.
 *
 * `security-events: write` files code-scanning alerts and nothing else — it
 * cannot edit a file, open a pull request, or deploy. CodeQL requires it on every
 * run, so counting it would drag six more pins into `security.yml` and buy
 * against a threat whose worst outcome is a false alert.
 */
const NOT_REPO_WRITE = new Set(["security-events"]);

/**
 * Local composite actions (`./.github/actions/x`) and reusable workflows
 * (`./.github/workflows/y.yml`) are IN this repository — they already cannot
 * change without a commit here, which is the whole property being enforced.
 */
const LOCAL = /^\.\//;

/** A SHA is 40 hex characters; anything else upstream can move. */
const SHA = /^[0-9a-f]{40}$/;

/** `v4`, `v4.4.0`, `2.109.1` — shaped like a release rather than a branch. */
const VERSION_SHAPED = /^v?\d+(?:\.\d+)*$/;

/** The submitter picks the head branch on a fork pull request. */
const SUBMITTER_CHOSEN = /github\.head_ref|github\.event\.pull_request\.head\.ref\b/;

/** The one comparison a submitter cannot satisfy: is this branch OURS? */
const FORK_TEST = new RegExp(
  "github\\.event\\.pull_request\\.head\\.repo\\.full_name\\s*==\\s*github\\.repository" +
    "|github\\.repository\\s*==\\s*github\\.event\\.pull_request\\.head\\.repo\\.full_name",
);

/**
 * Every `write` this file hands out, at workflow OR job level.
 *
 * A hand parser rather than a YAML dependency, for the same reason the rest of
 * this script is offline: it runs in the gate before `pnpm install`. Job-level
 * `permissions:` REPLACES the workflow-level block rather than narrowing it, so a
 * read-only workflow can still contain a job holding write — both are read here.
 */
function grantedWriteScopes(source) {
  const scopes = new Set();
  let blockIndent = null;
  for (const line of source.split(/\r?\n/)) {
    if (blockIndent !== null) {
      const entry = /^(\s*)([\w-]+):\s*(read|write|none)\s*$/.exec(line);
      if (entry && entry[1].length > blockIndent) {
        if (entry[3] === "write") scopes.add(entry[2]);
        continue;
      }
      // Blank lines and comments do not end a block; a dedent does.
      if (line.trim() === "" || /^\s*#/.test(line)) continue;
      blockIndent = null;
    }
    const header = /^(\s*)permissions:\s*(\S*)\s*$/.exec(line);
    if (!header) continue;
    if (header[2] === "write-all") scopes.add("write-all");
    else if (header[2] === "") blockIndent = header[1].length;
  }
  return scopes;
}

function tierFor(name, source) {
  if (ALWAYS_STRICT.has(name)) {
    return { strict: true, why: "the deploy path, or the file that calls it" };
  }
  if (!/^permissions:/m.test(source)) {
    return {
      strict: true,
      why: "no workflow-level `permissions:` block, so its token is whatever the " +
        "repository default grants — a setting this script cannot read",
    };
  }
  const writes = [...grantedWriteScopes(source)].filter(
    (scope) => !NOT_REPO_WRITE.has(scope),
  );
  if (writes.length > 0) {
    return {
      strict: true,
      why: `grants ${writes
        .map((scope) => (scope === "write-all" ? "permissions: write-all" : `${scope}: write`))
        .join(", ")}`,
    };
  }
  return { strict: false, why: "read-only token" };
}

/** Every `if:` in the file, with block scalars folded back into one line. */
function ifExpressions(source) {
  const lines = source.split(/\r?\n/);
  const found = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const head = /^(\s*)if:\s*(.*?)\s*$/.exec(lines[cursor]);
    if (!head) {
      cursor += 1;
      continue;
    }
    const [, indent, inline] = head;
    const at = cursor + 1;
    let text = inline;
    cursor += 1;
    // `>-`, `>` or `|`: the expression is on the lines below, each indented past
    // the key. Anything at or left of the key's indent ends it.
    if (/^[>|][-+]?$/.test(inline)) {
      text = "";
      while (cursor < lines.length) {
        const line = lines[cursor];
        if (line.trim() !== "" && /^\s*/.exec(line)[0].length <= indent.length) break;
        text += ` ${line.trim()}`;
        cursor += 1;
      }
    }
    found.push({ line: at, text: text.trim() });
  }
  return found;
}

function checkRefs(file, source, strict) {
  const problems = [];
  let refs = 0;

  source.split(/\r?\n/).forEach((line, index) => {
    // `- uses: owner/repo@ref # comment` or `uses: owner/repo@ref`, at any indent.
    const match = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(?:#\s*(.*))?$/.exec(line);
    if (!match) return;
    const [, ref, comment] = match;
    const where = `${file}:${index + 1}`;

    if (LOCAL.test(ref)) return;
    refs += 1;

    const at = ref.lastIndexOf("@");
    if (at === -1) {
      problems.push(`${where}: \`${ref}\` has no ref at all — it floats freely.`);
      return;
    }
    const version = ref.slice(at + 1);

    if (SHA.test(version)) {
      // A SHA nobody can read is a SHA nobody will ever bump.
      if (!comment || !/v?\d+\.\d+/.test(comment)) {
        problems.push(
          `${where}: \`${ref.slice(0, at)}\` is pinned but says nothing about ` +
            "which version that is.\n      Add the release beside it, e.g. " +
            "`# v4.4.0`.",
        );
      }
      return;
    }

    if (strict) {
      problems.push(
        `${where}: \`${ref}\` is pinned to "${version}", which is mutable.\n` +
          "      A tag or branch is moved by its publisher, so what this " +
          "privileged job runs\n      can change with no commit in this " +
          "repository. Resolve it:\n" +
          "        node scripts/ops/bump-action-pins.mjs",
      );
      return;
    }

    if (!VERSION_SHAPED.test(version)) {
      problems.push(
        `${where}: \`${ref}\` is not even version-shaped — "${version}" reads ` +
          "as a branch.\n      A branch head moves on every push rather than " +
          "every release. A major tag is\n      allowed in this file; a moving " +
          "target with no version in its name is not.",
      );
    }
  });

  return { problems, refs };
}

function checkTrust(file, source) {
  const problems = [];
  const conditions = ifExpressions(source);

  for (const { line, text } of conditions) {
    if (!SUBMITTER_CHOSEN.test(text)) continue;
    if (FORK_TEST.test(text)) continue;
    problems.push(
      `${file}:${line}: this condition decides whether the job runs from the ` +
        "HEAD BRANCH NAME:\n" +
        `        ${text}\n` +
        "      On a pull request from a fork the contributor picks that name, and " +
        "GitHub\n      reports a skipped job as a PASS — so the answer to \"is " +
        "this safe to merge?\"\n      is chosen by the submitter. Ask whether the " +
        "branch is ours as well:\n" +
        "        github.event.pull_request.head.repo.full_name == github.repository",
    );
  }

  return { problems, conditions: conditions.length };
}

// Overridable so the failure paths can be exercised against a fixture. A guard
// whose red branch has never run once is a guess about what it would do.
const only = process.argv[2];
const files = only
  ? [only]
  : readdirSync(WORKFLOW_DIR)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => join(WORKFLOW_DIR, name));

const problems = [];
let refs = 0;
let conditions = 0;
const strictFiles = [];
const lenientFiles = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const tier = tierFor(basename(file), source);
  const pins = checkRefs(file, source, tier.strict);
  const trust = checkTrust(file, source);
  problems.push(...pins.problems, ...trust.problems);
  refs += pins.refs;
  conditions += trust.conditions;
  (tier.strict ? strictFiles : lenientFiles).push(`${basename(file)} (${tier.why})`);
}

// A guard that matches nothing passes forever, so every way this could see
// nothing is its own failure rather than a green tick over an unread directory.
const vacuous = [];
if (files.length === 0) vacuous.push(`No workflow files under ${WORKFLOW_DIR}.`);
if (refs === 0) vacuous.push("No third-party action refs found — the parser stopped matching.");
if (conditions === 0) vacuous.push("No `if:` conditions found — the parser stopped matching.");
if (!only && strictFiles.length === 0) {
  vacuous.push(
    "No workflow was classed as privileged, which cannot be true while a deploy " +
      "path exists.",
  );
}
if (!only) {
  const present = new Set(files.map((file) => basename(file)));
  for (const name of ALWAYS_STRICT) {
    if (!present.has(name)) {
      vacuous.push(`${name} is in ALWAYS_STRICT and is not in ${WORKFLOW_DIR} — it moved or was renamed.`);
    }
  }
}

if (vacuous.length > 0) {
  console.error("\nThis check was about to report on nothing:\n");
  for (const line of vacuous) console.error(`  x ${line}`);
  console.error("\nA check that silently sees nothing is worse than one that fails.\n");
  process.exit(1);
}

if (problems.length > 0) {
  console.error("\nSomebody outside this repository can steer these workflows:\n");
  for (const problem of problems) console.error(`  x ${problem}`);
  console.error(
    "\n#444: a major tag is mutable, so a third party decides what a job runs.\n" +
      "That is what took a deploy down on 2026-07-24, one layer lower.\n" +
      "#581: and a head branch name is the submitter's, so it cannot decide " +
      "whether\na job runs either. A read-only workflow may keep major tags — " +
      "there, a surprise\ncosts a red build and nothing more.\n",
  );
  process.exit(1);
}

console.log(
  `Privileged (commit pins required): ${strictFiles.join(", ")}\n` +
    `Read-only (major tags allowed):   ${lenientFiles.join(", ") || "none"}\n` +
    `${refs} action ref(s) and ${conditions} job/step condition(s) checked.`,
);
