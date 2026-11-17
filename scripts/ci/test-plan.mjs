#!/usr/bin/env node
/**
 * Decides which vitest files CI runs and splits them into shards.
 *
 *   node scripts/ci/test-plan.mjs --out plan.json [--history h.json] [--changed-since <sha>]
 *
 * Without --changed-since every test file runs (pushes to main, release PRs).
 * With it, only the files the diff can reach: through vitest's own import
 * graph at this commit, and through what the last full run on main recorded
 * each file reading, listing, importing or starting. Anything unknown runs.
 *
 * Shards are balanced by each file's recorded duration; with no history they
 * are balanced by file count. --github-output writes `shards` (a JSON list for
 * the matrix) and `mode` to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { readHistory } from "./test-history.mjs";
import { fullRunTrigger, parseNameStatus, partition, selectAffected, shardCountFor } from "./test-selection.mjs";
import {
  openVitest,
  REPO_ROOT,
  testDependencies,
  toRepoPath,
  vitestPackages,
  workspaceDependencies,
} from "./test-suites.mjs";

const TRACEABLE_POOLS = new Set(["forks", "threads", "vmForks", "vmThreads"]);

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    history: { type: "string" },
    "changed-since": { type: "string" },
    "target-ms": { type: "string", default: "300000" },
    "max-shards": { type: "string", default: "6" },
    "fallback-shards": { type: "string", default: "4" },
    "github-output": { type: "boolean", default: false },
  },
});
if (!args.out) throw new Error("--out is required");

const affected = args["changed-since"] !== undefined;
const history = readHistory(args.history);
const packages = vitestPackages();

const units = [];
const graph = new Map();
const untraced = new Map();
const setupTriggers = [];
for (const pkg of packages) {
  const ctx = await openVitest(pkg.dir);
  try {
    const specs = await ctx.globTestSpecifications();
    if (specs.length === 0) throw new Error(`${pkg.dir}: vitest found no test files`);
    const seen = new Set();
    for (const spec of specs) {
      const file = toRepoPath(spec.moduleId);
      if (seen.has(file)) continue;
      seen.add(file);
      units.push({ path: file, pkg: pkg.dir });
    }
    if (ctx.projects.some((project) => !TRACEABLE_POOLS.has(String(project.config.pool)))) {
      untraced.set(pkg.dir, [pkg.dir, ...workspaceDependencies(pkg).map((dep) => dep.dir)]);
    }
    if (affected) {
      for (const project of ctx.projects) {
        const setup = [project.config.setupFiles, project.config.globalSetup].flat().filter(Boolean);
        for (const file of setup) {
          const closure = await testDependencies(ctx, { project, moduleId: path.resolve(file) });
          setupTriggers.push({ paths: new Set(closure), reason: `a setup file of ${pkg.dir}` });
        }
      }
      await Promise.all(
        specs.map(async (spec) => {
          const file = toRepoPath(spec.moduleId);
          try {
            const closure = new Set(await testDependencies(ctx, spec));
            const existing = graph.get(file);
            // A file in two projects keeps a failed graph from either one.
            if (existing === null) return;
            graph.set(file, existing ? new Set([...existing, ...closure]) : closure);
          } catch (error) {
            console.log(`  graph failed for ${file}: ${String(error?.message ?? error).split("\n")[0]}`);
            graph.set(file, null);
          }
        }),
      );
    }
  } finally {
    await ctx.close();
  }
}
process.chdir(REPO_ROOT);

let mode = "full";
let reason = "every test runs on this event";
let reasons = new Map();
let changes = [];
if (affected) {
  changes = parseNameStatus(
    execFileSync("git", ["diff", "--name-status", "-M", args["changed-since"], "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }),
  );
  const trigger = fullRunTrigger(changes, setupTriggers);
  if (trigger) reason = `${trigger.path} changed, which is ${trigger.reason}`;
  else if (history) {
    mode = "affected";
    reason = `${changes.length} changed path(s) since ${args["changed-since"].slice(0, 12)}`;
    reasons = selectAffected({ units, changes, graph, history: history.files, untraced });
  }
  else {reason = "there is no recorded test history to select from";}
}

const selected = mode === "full" ? units.map((unit) => unit.path) : [...reasons.keys()];
const durations = new Map();
for (const [unit, entry] of history?.files ?? []) durations.set(unit, entry.ms);
const shardCount = shardCountFor(selected, durations, {
  targetMs: Number(args["target-ms"]),
  fallback: Number(args["fallback-shards"]),
  max: Number(args["max-shards"]),
});
const { timing, shards } = partition(selected, durations, shardCount);
const pkgOf = Object.fromEntries(units.map((unit) => [unit.path, unit.pkg]));

const plan = {
  mode,
  reason,
  timing,
  historySha: history?.sha ?? null,
  universe: units.length,
  selected: selected.length,
  packages: Object.fromEntries(
    packages.map((pkg) => {
      const all = units.filter((unit) => unit.pkg === pkg.dir).length;
      const chosen = selected.filter((file) => pkgOf[file] === pkg.dir).length;
      return [pkg.dir, { files: all, selected: chosen }];
    }),
  ),
  pkgOf: Object.fromEntries(selected.map((file) => [file, pkgOf[file]])),
  reasons: Object.fromEntries(reasons),
  shards: shards.map((shard) => ({ files: shard.files, estimateMs: Math.round(shard.weight) })),
};
mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
writeFileSync(args.out, JSON.stringify(plan, null, 1));

const lines = [
  `## Test plan: ${mode}`,
  "",
  `${plan.selected} of ${plan.universe} test files selected: ${reason}.`,
  `${plan.shards.length} shard(s), balanced by ${timing === "recorded" ? "recorded duration" : "file count"}.`,
  "",
  "| package | selected | files |",
  "| --- | ---: | ---: |",
  ...Object.entries(plan.packages).map(([dir, n]) => `| ${dir} | ${n.selected} | ${n.files} |`),
];
if (mode === "affected") {
  lines.push("", "<details><summary>Why each file runs</summary>", "");
  for (const [file, why] of reasons) lines.push(`- \`${file}\`: ${why}`);
  lines.push("", "</details>");
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
if (args["github-output"]) {
  const indexes = JSON.stringify(plan.shards.map((_, index) => index + 1));
  appendFileSync(process.env.GITHUB_OUTPUT, `shards=${indexes}\nmode=${mode}\n`);
}
