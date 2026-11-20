#!/usr/bin/env node
/**
 * Checks that every shard ran exactly the files the plan gave it, reports the
 * totals, and on a full run writes the history the next plan selects from.
 *
 *   node scripts/ci/test-report.mjs --plan plan.json --results dir [--history-out h.json --sha <sha>]
 *
 * Fails when a planned file has no result, when a file ran in a shard the plan
 * did not give it to, when a shard is missing, when anything failed, or when
 * the plan found no test files at all.
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { writeHistory } from "./test-history.mjs";

const { values: args } = parseArgs({
  options: {
    plan: { type: "string" },
    results: { type: "string" },
    "history-out": { type: "string" },
    sha: { type: "string" },
  },
});

const plan = JSON.parse(readFileSync(args.plan, "utf8"));
const problems = [];
const failures = [];
if (plan.universe === 0) problems.push("the plan found no test files");

const shardResults = new Map();
for (const entry of readdirSync(args.results, { recursive: true })) {
  if (!String(entry).endsWith(".json")) continue;
  const result = JSON.parse(readFileSync(join(args.results, String(entry)), "utf8"));
  if (shardResults.has(result.shard)) problems.push(`shard ${result.shard} reported twice`);
  shardResults.set(result.shard, result);
}

const ranIn = new Map();
const files = new Map();
const states = {};
for (const [position, shard] of plan.shards.entries()) {
  const index = position + 1;
  const result = shardResults.get(index);
  if (!result) {
    problems.push(`shard ${index} reported nothing`);
    continue;
  }
  const planned = new Set(shard.files);
  for (const [file, entry] of Object.entries(result.files)) {
    if (!planned.has(file)) problems.push(`${file} ran in shard ${index}, which the plan did not give it`);
    if (ranIn.has(file)) problems.push(`${file} ran in shards ${ranIn.get(file)} and ${index}`);
    ranIn.set(file, index);
    files.set(file, entry);
    states[entry.state] = (states[entry.state] ?? 0) + 1;
    if (entry.state !== "passed" && entry.state !== "skipped") failures.push(`${file}: ${entry.state}`);
  }
  for (const file of planned) if (!(file in result.files)) problems.push(`${file} was planned for shard ${index} and has no result`);
}

const totalMs = [...files.values()].reduce((sum, entry) => sum + entry.ms, 0);
const lines = [
  `## Tests: ${problems.length + failures.length === 0 ? "passed" : "failed"}`,
  "",
  `${files.size} of ${plan.selected} planned file(s) reported (${plan.universe} in the workspace, mode ${plan.mode}).`,
  `States: ${JSON.stringify(states)}. ${Math.round(totalMs / 1000)}s of test time across ${plan.shards.length} shard(s).`,
  "",
  "| shard | files | estimate | measured |",
  "| ---: | ---: | ---: | ---: |",
  ...plan.shards.map((shard, position) => {
    const measured = shard.files.reduce((sum, file) => sum + (files.get(file)?.ms ?? 0), 0);
    return `| ${position + 1} | ${shard.files.length} | ${Math.round(shard.estimateMs / 1000)}s | ${Math.round(measured / 1000)}s |`;
  }),
];
if (problems.length > 0) lines.push("", "### Coverage problems", "", ...problems.slice(0, 200).map((p) => `- ${p}`));
if (failures.length > 0) lines.push("", "### Failed files", "", ...failures.slice(0, 200).map((p) => `- ${p}`));
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);

// A file that failed may have stopped before reading what it normally reads,
// so its record is marked unknown and it runs on every pull request until it
// passes on main again.
if (args["history-out"]) {
  if (plan.mode !== "full") throw new Error("history is only written from a full run");
  if (problems.length > 0) {
    console.log("Not writing history from a run that did not cover the plan.");
  } else {
    const history = new Map();
    for (const [file, entry] of files) {
      const passed = entry.state === "passed" || entry.state === "skipped";
      history.set(file, {
        ms: entry.ms,
        imports: entry.imports,
        reads: entry.reads,
        lists: entry.lists,
        spawns: entry.spawns || !passed,
      });
    }
    writeHistory(args["history-out"], { sha: args.sha, files: history });
    console.log(`History written for ${history.size} file(s).`);
  }
}

process.exit(problems.length + failures.length > 0 ? 1 : 0);
