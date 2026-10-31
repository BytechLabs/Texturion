#!/usr/bin/env node
/**
 * D142: no live production secret in any commit a push publishes.
 *
 * The checkout scan (scripts/check-local-secrets.mjs) reads the files in this
 * checkout, which is not what a push sends: a key added in one commit and
 * deleted in the next is still in the history, and `git push origin other`
 * sends commits this checkout does not hold. This reads every text line the
 * pushed commits add, merge resolutions included, with the same shapes.
 *
 * Input is what git hands a pre-push hook on stdin, one line per ref:
 * `<local ref> <local sha> <remote ref> <remote sha>`. The commits read are
 * those no remote-tracking ref already holds. Binary diffs are not read.
 *
 * Only the commit, the file and the shape's name print, never the text that
 * matched.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWED, findShapes } from "../scripts/check-local-secrets.mjs";

const NO_OBJECT = /^0+$/;

/**
 * The revisions each pushed ref sends: its tip, minus the remote's tip when
 * this clone holds it. A deleted ref sends nothing.
 */
export function pushedRevisions(stdin, exists) {
  const pushes = [];
  for (const line of stdin.split(/\r?\n/)) {
    const [ref, local, , remote] = line.trim().split(/\s+/);
    if (!local || NO_OBJECT.test(local)) continue;
    const revisions = [local];
    if (remote && !NO_OBJECT.test(remote) && exists(remote)) revisions.push(`^${remote}`);
    pushes.push({ ref, revisions });
  }
  return pushes;
}

/** What `%x00` in the log format puts before each commit's sha. */
const COMMIT = "\0";

/** The `git log` arguments whose output addedLines reads. */
export function logArguments(revisions) {
  return [
    "-c", "core.quotePath=false",
    "log", "-p", "-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames",
    "--diff-merges=remerge", "--format=%x00%H",
    ...revisions, "--not", "--remotes", "--",
  ];
}

function diffPath(header) {
  const path = header.slice(4);
  if (path === "/dev/null") return null;
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.replace(/^b\//, "");
}

/**
 * The lines each commit adds to each file, from `git log -p` output. A line
 * inside a hunk always starts with `+`, `-`, a space or `\`, so a commit or
 * diff header cannot be mistaken for content.
 */
export function addedLines(log) {
  const added = new Map();
  let commit = null;
  let file = null;
  let inHunk = false;
  for (const line of log.split("\n")) {
    if (line.startsWith(COMMIT)) {
      commit = line.slice(COMMIT.length).trim();
      file = null;
      inHunk = false;
    } else if (line.startsWith("diff --git ") || line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
      file = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith("+++ ")) {
      file = diffPath(line);
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && file && commit && line.startsWith("+")) {
      const key = `${commit}\n${file}`;
      added.set(key, `${added.get(key) ?? ""}${line.slice(1)}\n`);
    }
  }
  return [...added].map(([key, text]) => {
    const [sha, path] = key.split("\n");
    return { commit: sha, file: path, text };
  });
}

/** One line per commit and file that adds more of a shape than ALLOWED excuses there. */
export function judgeAdded(entries, allowed = ALLOWED) {
  const failures = [];
  for (const { commit, file, text } of entries) {
    const excused = allowed[file] ?? {};
    const over = findShapes(text)
      .filter(({ shape, count }) => count > (excused[shape] ?? 0))
      .map(({ shape, count }) => `${shape} (${count})`);
    if (over.length > 0) failures.push(`${commit.slice(0, 12)} ${file}: ${over.join(", ")}`);
  }
  return failures;
}

function git(args, cwd, stderr = "inherit") {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", stderr],
  });
}

function main() {
  const cwd = process.cwd();
  const exists = (sha) => {
    try {
      git(["cat-file", "-e", `${sha}^{commit}`], cwd, "ignore");
      return true;
    } catch {
      return false;
    }
  };
  const pushes = pushedRevisions(readFileSync(0, "utf8"), exists);
  const failures = [];
  let commits = 0;
  for (const { revisions } of pushes) {
    const entries = addedLines(git(logArguments(revisions), cwd));
    commits += new Set(entries.map((entry) => entry.commit)).size;
    failures.push(...judgeAdded(entries));
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error("");
    console.error(`check-pushed-commits: ${failures.length} commit file(s) add a live-secret shape.`);
    console.error("  This repository is public, so the push would publish it even if a later commit");
    console.error("  removed it. Rewrite those commits without the key, then rotate it if it ever left");
    console.error("  this machine. Nothing above prints one; `git show <commit> -- <file>` does.");
    process.exit(1);
  }
  console.log(
    `check-pushed-commits: no live-secret shape in the lines ${commits} commit(s) add across ` +
      `${pushes.length} pushed ref(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
