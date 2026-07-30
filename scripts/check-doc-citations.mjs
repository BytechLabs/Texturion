#!/usr/bin/env node
/**
 * Every repository path a document cites must exist.
 *
 * WHY (#442). `docs/deploy/README.md` sets an unusually good standard: "Every
 * command, secret name, dashboard setting, and URL below was verified against the
 * committed source — each fact cites its `file:line`. Nothing is invented."
 *
 * That practice is exactly what breaks hardest under a rename. A doc saying "see
 * the deploy workflow" degrades gracefully; a doc saying `deploy.yml:52-55` is
 * either right or actively misleading. When the workflows were renamed, 36
 * citations across 8 files became misleading in one afternoon — and the audience
 * is an operator standing up or repairing production, with no staging environment
 * to be wrong in.
 *
 * WHAT THIS CHECKS, and deliberately not more:
 *
 *   Every cited path RESOLVES. Not line numbers, not content. Checking a line
 *   number would fail on every ordinary edit and teach people to delete the
 *   citation; checking that the file exists catches the rename class, which is
 *   the one that actually happened.
 *
 * WHAT REPLACED THE LINE NUMBERS (#442 ask 3). Line citations broke within a
 * single day of being written, so re-deriving them would have rebuilt the same
 * fragility. Workflow references now name a JOB or STEP instead:
 *
 *   `.github/workflows/ship.yml` → the `backend` job's "Push database migrations" step
 *
 * That survives every edit which does not rename the thing being pointed at, and a
 * rename makes the reference read as wrong rather than silently pointing at an
 * unrelated line. This guard checks the file half; the anchor half is prose a
 * human reads, and pretending to verify it would be the line-number mistake again
 * in a new costume.
 *
 * Usage: node scripts/check-doc-citations.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** Roots to scan. PRODUCTION.md and the deploy set are the operator-facing ones. */
const ROOTS = ["docs", "."];

/**
 * Path shapes worth checking: the ones that are real repository paths rather than
 * prose. Kept narrow on purpose — a wider net would start matching URLs, package
 * names and example paths inside fenced blocks, and a guard with false positives
 * gets switched off.
 */
const CITATION = /`([.]github\/workflows\/[A-Za-z0-9._-]+\.ya?ml|(?:apps|packages|supabase|scripts)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)(?::[0-9,\-\s]+)?`/g;

/**
 * A document that records work already DONE may legitimately cite paths that are
 * gone — often deleted BY the work it describes. `V4-REDO-PLAN.md` cites two
 * components that its own purge removed.
 *
 * Marked in the document rather than listed here on purpose: an ignore list in a
 * script is invisible to the person reading the doc, and "add it to the ignore
 * list" is how a guard stops guarding. A visible banner tells the reader the
 * citations are historical, which is the thing they actually need to know.
 *
 * Matched against the head of the file so a passing mention deep in prose cannot
 * silence the whole document.
 */
const HISTORICAL = /^#+.*\b(SUPERSEDED|COMPLETED)\b|^>\s*#+\s*(⛔|✅)/m;
const HISTORICAL_HEAD_LINES = 25;

function isHistorical(text) {
  return HISTORICAL.test(text.split(/\r?\n/).slice(0, HISTORICAL_HEAD_LINES).join("\n"));
}

function isGlob(path) {
  return path.includes("*");
}

/** Every markdown file under a root, non-recursive for "." so only top-level. */
function markdownFiles(root) {
  const out = [];
  const walk = (dir, recurse) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recurse) walk(path, true);
      } else if (entry.name.endsWith(".md")) {
        out.push(path);
      }
    }
  };
  if (root === ".") walk(".", false);
  else if (existsSync(root) && statSync(root).isDirectory()) walk(root, true);
  return out;
}

const problems = [];
const skipped = [];
let checked = 0;

for (const root of ROOTS) {
  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, "utf8");
    if (isHistorical(text)) {
      skipped.push(file);
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(CITATION)) {
        const cited = match[1];
        if (isGlob(cited)) continue;
        checked += 1;
        if (!existsSync(cited.split("/").join(sep))) {
          problems.push({ path: cited, where: `${file}:${index + 1}` });
        }
      }
    });
  }
}

/**
 * A citation to a GITIGNORED path is fine, and this guard shipped without knowing
 * that — it passed on my machine and failed in CI on `README.md` telling a reader
 * to create `apps/api/.dev.vars`. That instruction is correct documentation; the
 * file is absent from a fresh checkout by design, which is the whole point of
 * mentioning it.
 *
 * So a missing path is only a problem if git is NOT ignoring it. Checked in one
 * batched call, and only when something is already missing, so the normal run pays
 * nothing. It also makes the guard machine-independent, which was the actual defect
 * here: I validated it where those files happened to exist.
 */
function ignoredByGit(paths) {
  if (paths.length === 0) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "--stdin"], {
      input: paths.join("\n"),
      encoding: "utf8",
    });
    return new Set(out.split(/\r?\n/).filter(Boolean));
  } catch (cause) {
    // `git check-ignore` exits 1 when NOTHING matched, which is not an error.
    const out = String(cause.stdout ?? "");
    return new Set(out.split(/\r?\n/).filter(Boolean));
  }
}

const ignored = ignoredByGit([...new Set(problems.map((p) => p.path))]);
const real = problems.filter((problem) => !ignored.has(problem.path));

if (real.length > 0) {
  console.error(
    `\n${real.length} document citation(s) point at a path that does not exist:\n`,
  );
  for (const problem of real) {
    console.error(`  ${problem.where}  cites ${problem.path}`);
  }
  console.error(
    `\nThe operator reading these has no staging environment to be wrong in, so a\n` +
      `citation to a file that moved is worse than no citation. Update it to where\n` +
      `the thing lives now, and prefer a job or step NAME over a line number: a line\n` +
      `citation breaks on every edit, and this whole class of failure came from 36 of\n` +
      `them going stale in one afternoon (#442).\n`,
  );
  process.exit(1);
}

console.log(
  `Document citations: ${checked} cited path(s) all resolve` +
    (ignored.size > 0
      ? `, ${ignored.size} gitignored path(s) the docs tell you to create`
      : "") +
    (skipped.length > 0
      ? `, and ${skipped.length} historical document(s) skipped.`
      : "."),
);
