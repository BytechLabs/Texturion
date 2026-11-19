#!/usr/bin/env node
/**
 * Runs one shard of a test plan, package by package, and writes what each test
 * file did: result, duration, imports, and (from fs-trace.mjs) what it read,
 * listed or started.
 *
 *   node scripts/ci/test-shard.mjs --plan plan.json --shard 3 --out shard-3.json
 *
 * Every package runs even after one fails, so a single run reports every
 * failure and records every duration.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { REPO_ROOT } from "./test-suites.mjs";

const HERE = import.meta.dirname;

const { values: args } = parseArgs({
  options: {
    plan: { type: "string" },
    shard: { type: "string" },
    out: { type: "string" },
  },
});

const plan = JSON.parse(readFileSync(args.plan, "utf8"));
const index = Number(args.shard);
const shard = plan.shards[index - 1];
if (!shard) throw new Error(`the plan has ${plan.shards.length} shard(s), not ${index}`);

const byPackage = new Map();
for (const file of shard.files) {
  const pkg = plan.pkgOf[file];
  if (!byPackage.has(pkg)) byPackage.set(pkg, []);
  byPackage.get(pkg).push(file);
}

const work = mkdtempSync(join(tmpdir(), "loonext-shard-"));
const traceDir = join(work, "trace");
mkdirSync(traceDir);
const preload = pathToFileURL(join(HERE, "fs-trace.mjs")).href;

const files = {};
let failed = false;
for (const [pkg, list] of byPackage) {
  console.log(`\n▸ ${pkg}: ${list.length} file(s)`);
  const listFile = join(work, `${pkg.replaceAll("/", "_")}.files.json`);
  const resultFile = join(work, `${pkg.replaceAll("/", "_")}.result.json`);
  writeFileSync(listFile, JSON.stringify(list));
  const run = spawnSync(
    process.execPath,
    [join(HERE, "vitest-run.mjs"), "--package", pkg, "--files", listFile, "--out", resultFile],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
        LOONEXT_FS_TRACE_DIR: traceDir,
        LOONEXT_FS_TRACE_ROOT: REPO_ROOT,
      },
    },
  );
  if (run.status !== 0) failed = true;
  if (!existsSync(resultFile)) {
    console.error(`${pkg}: vitest wrote no result`);
    failed = true;
    continue;
  }
  const { results } = JSON.parse(readFileSync(resultFile, "utf8"));
  for (const [file, result] of Object.entries(results)) {
    files[file] = { ...result, reads: [], lists: [], spawns: false };
  }
}

for (const entry of readdirSync(traceDir)) {
  for (const line of readFileSync(join(traceDir, entry), "utf8").split("\n")) {
    if (!line) continue;
    const { t, k, p } = JSON.parse(line);
    const file = files[relative(REPO_ROOT, t).split(sep).join("/")];
    if (!file) continue;
    if (k === "s") file.spawns = true;
    else if (k === "l") file.lists.push(p);
    else file.reads.push(p);
  }
}
for (const file of Object.values(files)) {
  file.reads = [...new Set(file.reads)];
  file.lists = [...new Set(file.lists)];
}
rmSync(work, { recursive: true, force: true });

writeFileSync(args.out, JSON.stringify({ shard: index, planned: shard.files, files }));
const counts = {};
for (const { state } of Object.values(files)) {
  counts[state] = (counts[state] ?? 0) + 1;
}
console.log(`\nshard ${index}: ${shard.files.length} planned, results ${JSON.stringify(counts)}`);
process.exit(failed ? 1 : 0);
