#!/usr/bin/env node
/**
 * Runs exactly the given test files of one package and records, per file, its
 * result, how long it took and the modules it imported.
 *
 *   node scripts/ci/vitest-run.mjs --package apps/web --files list.json --out result.json
 *
 * Files are matched to vitest's own specifications by path, not by vitest's
 * substring filter, which would also run `a.test.tsx` when asked for
 * `a.test.ts`. A listed file vitest does not know is an error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openVitest, REPO_ROOT, testDependencies, toRepoPath } from "./test-suites.mjs";

const { values: args } = parseArgs({
  options: {
    package: { type: "string" },
    files: { type: "string" },
    out: { type: "string" },
  },
});

const wanted = new Set(JSON.parse(readFileSync(args.files, "utf8")));
const reporters = process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"];
const ctx = await openVitest(args.package, { reporters });

let exitCode = 0;
const results = {};
try {
  await ctx.standalone();
  const specs = (await ctx.globTestSpecifications()).filter((spec) => wanted.has(toRepoPath(spec.moduleId)));
  const found = new Set(specs.map((spec) => toRepoPath(spec.moduleId)));
  const missing = [...wanted].filter((file) => !found.has(file));
  if (missing.length > 0) throw new Error(`vitest in ${args.package} has no test file ${missing.join(", ")}`);

  const run = await ctx.runTestSpecifications(specs, false);
  if (run.unhandledErrors.length > 0) exitCode = 1;
  for (const module of run.testModules) {
    const file = toRepoPath(module.moduleId);
    const d = module.diagnostic();
    const ms = d.environmentSetupDuration + d.prepareDuration + d.collectDuration + d.setupDuration + d.duration;
    const state = module.state();
    if (state !== "passed" && state !== "skipped") exitCode = 1;
    const previous = results[file];
    results[file] = {
      state: previous && previous.state !== "passed" ? previous.state : state,
      ms: (previous?.ms ?? 0) + ms,
      imports: [...new Set([...(previous?.imports ?? []), ...(await importsOf(module))])],
    };
  }
  const ran = new Set(Object.keys(results));
  const notRun = [...wanted].filter((file) => !ran.has(file));
  if (notRun.length > 0) {
    console.error(`vitest reported no result for ${notRun.join(", ")}`);
    exitCode = 1;
  }
  if (run.unhandledErrors.length > 0) console.error(`${run.unhandledErrors.length} unhandled error(s)`);
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await ctx.close();
}

writeFileSync(resolve(REPO_ROOT, args.out), JSON.stringify({ package: args.package, results }));
process.exit(exitCode);

async function importsOf(module) {
  const spec = { project: module.project, moduleId: module.moduleId };
  try {
    return await testDependencies(ctx, spec);
  } catch {
    return [toRepoPath(module.moduleId)];
  }
}
