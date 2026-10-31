import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * These pin that the pre-push hook reads what a push publishes: every line
 * the pushed commits add, including a key a later commit deleted and the
 * commits of a branch that is not checked out, and that it never prints the
 * key. Fixtures are assembled at run time from a readable stem, so this file
 * holds nothing a secret scanner would stop.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, ".githooks", "check-pushed-commits.mjs");
const NONE = "0".repeat(40);
const KEY = ["sk", "live", "readablestemforthistest"].join("_");

type Entry = { commit: string; file: string; text: string };
const hook = (await import(SCRIPT)) as {
  pushedRevisions: (stdin: string, exists: (sha: string) => boolean) => { ref: string; revisions: string[] }[];
  addedLines: (log: string) => Entry[];
  judgeAdded: (entries: Entry[], allowed?: Record<string, Record<string, number>>) => string[];
};

describe("what a push sends", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);

  it("reads a ref from the remote's tip, or whole when the remote's tip is unknown here", () => {
    const stdin = `refs/heads/x ${a} refs/heads/x ${b}\nrefs/heads/y ${a} refs/heads/y ${NONE}\n`;
    expect(hook.pushedRevisions(stdin, () => true)).toEqual([
      { ref: "refs/heads/x", revisions: [a, `^${b}`] },
      { ref: "refs/heads/y", revisions: [a] },
    ]);
    expect(hook.pushedRevisions(`refs/heads/x ${a} refs/heads/x ${b}`, () => false)).toEqual([
      { ref: "refs/heads/x", revisions: [a] },
    ]);
  });

  it("reads nothing from a deleted ref", () => {
    expect(hook.pushedRevisions(`(delete) ${NONE} refs/heads/x ${a}\n`, () => true)).toEqual([]);
  });
});

describe("the lines a commit adds", () => {
  const log = [
    "\0" + "c1",
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,0 +2,2 @@",
    "+first",
    "+++ an added line that starts with two plus signs",
    "-removed",
    "diff --git a/gone.txt b/gone.txt",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-was here",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
    "\0" + "c2",
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -3,0 +4 @@",
    "+second",
  ].join("\n");

  it("keeps each commit's added lines by file, content that looks like a header included", () => {
    expect(hook.addedLines(log)).toEqual([
      { commit: "c1", file: "src/a.ts", text: "first\n++ an added line that starts with two plus signs\n" },
      { commit: "c2", file: "src/a.ts", text: "second\n" },
    ]);
  });

  it("fails a commit that adds a shape, by commit, file and shape only", () => {
    const failures = hook.judgeAdded([{ commit: "c".repeat(40), file: "fixture.env", text: `STRIPE=${KEY}\n` }]);
    expect(failures).toEqual([`${"c".repeat(12)} fixture.env: stripe-live-secret-key (1)`]);
    expect(failures.join("\n")).not.toContain(KEY);
  });

  it("excuses a vendor's published example only as often as ALLOWED says, in its own file", () => {
    const entry = { commit: "c", file: "spec.json", text: `${KEY}\n` };
    expect(hook.judgeAdded([entry], { "spec.json": { "stripe-live-secret-key": 1 } })).toEqual([]);
    expect(hook.judgeAdded([{ ...entry, text: `${KEY}\n${KEY}\n` }], { "spec.json": { "stripe-live-secret-key": 1 } })).toHaveLength(1);
    expect(hook.judgeAdded([{ ...entry, file: "other.json" }], { "spec.json": { "stripe-live-secret-key": 1 } })).toHaveLength(1);
  });
});

describe("a push from a real clone", () => {
  let root: string | null = null;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  const git = (...args: string[]) => {
    const result = spawnSync(
      "git",
      ["-c", "user.name=rig-test", "-c", "user.email=", "-c", "commit.gpgsign=false", ...args],
      { cwd: root ?? undefined, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const push = (stdin: string) => {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: root ?? undefined, input: stdin, encoding: "utf8" });
    return { status: result.status, output: result.stdout + result.stderr };
  };

  it("fails a key a later commit deleted, and a branch that is not checked out", { timeout: 60_000 }, () => {
    root = mkdtempSync(join(tmpdir(), "pushed-commits-"));
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "README.md"), "nothing here\n");
    const clean = commit("clean");
    writeFileSync(join(root, "fixture.env"), `STRIPE=${KEY}\n`);
    const added = commit("adds a key");
    unlinkSync(join(root, "fixture.env"));
    const removed = commit("removes it");

    const history = push(`refs/heads/main ${removed} refs/heads/main ${clean}\n`);
    expect(history.status).toBe(1);
    expect(history.output).toContain(`${added.slice(0, 12)} fixture.env: stripe-live-secret-key (1)`);
    expect(history.output).not.toContain(KEY);

    expect(push(`refs/heads/main ${removed} refs/heads/main ${removed}\n`).status).toBe(0);
    expect(push(`(delete) ${NONE} refs/heads/main ${removed}\n`).status).toBe(0);

    git("checkout", "-q", "-b", "other", clean);
    writeFileSync(join(root, "notes.md"), `pasted ${KEY}\n`);
    const other = commit("other branch");
    git("checkout", "-q", "main");
    const elsewhere = push(`refs/heads/other ${other} refs/heads/other ${NONE}\n`);
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.output).toContain(`${other.slice(0, 12)} notes.md: stripe-live-secret-key (1)`);
  });

  it("passes a push whose commits add no shape", { timeout: 60_000 }, () => {
    root = mkdtempSync(join(tmpdir(), "pushed-commits-"));
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "README.md"), "nothing here\n");
    const tip = commit("clean");
    const result = push(`refs/heads/main ${tip} refs/heads/main ${NONE}\n`);
    expect(result.status).toBe(0);
    expect(result.output).toContain("1 commit(s)");
  });
});
