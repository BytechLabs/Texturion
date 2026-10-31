#!/usr/bin/env node
/**
 * D142: the rig's rate limiters never share a counter with production's.
 *
 * Cloudflare keeps one counter per namespace id across the whole account
 * (docs/RIG.md), and the rig's cloud Workers live in production's account.
 * A rig limiter on a production id spends production's limit with test
 * traffic, and a customer is refused for it. So:
 *   1. every limiter in a cloud Worker under tools/ (the edge and the guard)
 *      uses an id in 3001-3009;
 *   2. none of those ids is one production uses, read from apps/api and
 *      apps/web, or one RIG.md reserves for it (1001-1013 and 2001);
 *   3. no two rig limiters share an id, which would make one spend the other;
 *   4. production never takes an id from the rig's band.
 *
 * The rig's local Workers keep production's ids on purpose (docs/RIG.md):
 * `wrangler dev` emulates a limiter in its own process, so the ids count only
 * the rig's traffic. That holds only while the derived configs run locally, so
 * this also runs the deploy CLI's derivation and checks that:
 *   5. it keeps each limiter as the ref has it, never renumbered and never
 *      marked remote;
 *   6. `rig serve` starts them with `wrangler dev` on loopback, never
 *      `--remote`.
 *
 * Usage: node scripts/check-rig-ratelimit-band.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BAND = { first: 3001, last: 3009 };

/** The ids docs/RIG.md reserves for production, whether or not a config uses them yet. */
export const RESERVED_FOR_PRODUCTION = [
  ...Array.from({ length: 13 }, (_, index) => String(1001 + index)),
  "2001",
];

export const PRODUCTION_CONFIGS = ["apps/api/wrangler.jsonc", "apps/web/wrangler.jsonc"];

/** How `rig deploy` derives each production config (tools/rig/src/deploy.mjs). */
const DERIVE_OPTIONS = {
  "apps/api/wrangler.jsonc": { port: 8787, aiShim: true },
  "apps/web/wrangler.jsonc": { port: 8788 },
};

const inBand = (id) => /^\d+$/.test(id) && Number(id) >= BAND.first && Number(id) <= BAND.last;

/**
 * Every rate limiter a config declares: `unsafe.bindings` of type ratelimit,
 * the `ratelimits` list, and the same inside each `env` section.
 */
export function limiters(config, where = "") {
  const found = [];
  const add = (binding, at) =>
    found.push({ name: binding.name, id: String(binding.namespace_id), remote: binding.remote === true, at });
  for (const binding of config.unsafe?.bindings ?? []) {
    if (binding?.type === "ratelimit") add(binding, `${where}unsafe.bindings`);
  }
  for (const binding of config.ratelimits ?? []) add(binding, `${where}ratelimits`);
  for (const [name, env] of Object.entries(config.env ?? {})) {
    found.push(...limiters(env, `${where}env.${name}.`));
  }
  return found;
}

/**
 * Rules 1-4. `cloud` and `production` are `{ file, config }` pairs, so a test
 * can hand it any configs it likes.
 */
export function bandProblems({ cloud, production }) {
  const problems = [];
  const productionIds = new Map();
  for (const { file, config } of production) {
    for (const limiter of limiters(config)) {
      productionIds.set(limiter.id, `${file} ${limiter.name}`);
      if (inBand(limiter.id)) {
        problems.push(
          `${file}  ${limiter.name} uses ${limiter.id}, which is in the rig's band ` +
            `${BAND.first}-${BAND.last}; production must leave it to the rig`,
        );
      }
    }
  }
  for (const id of RESERVED_FOR_PRODUCTION) if (!productionIds.has(id)) productionIds.set(id, "docs/RIG.md 2.2");

  const rigIds = new Map();
  for (const { file, config } of cloud) {
    for (const limiter of limiters(config)) {
      const where = `${file} ${limiter.at} ${limiter.name}`;
      if (!inBand(limiter.id)) {
        problems.push(`${where}  uses ${limiter.id}; the rig's cloud Workers use ${BAND.first}-${BAND.last} only`);
      }
      if (productionIds.has(limiter.id)) {
        problems.push(`${where}  uses ${limiter.id}, which is production's (${productionIds.get(limiter.id)})`);
      }
      const owner = `${config.name ?? file} ${limiter.name}`;
      if (rigIds.has(limiter.id) && rigIds.get(limiter.id) !== owner) {
        problems.push(`${where}  shares ${limiter.id} with ${rigIds.get(limiter.id)}, so one spends the other's limit`);
      }
      rigIds.set(limiter.id, owner);
    }
  }
  return problems;
}

/** Rule 5: a derived config keeps the ref's limiters exactly, all of them local. */
export function derivedProblems(file, config, derived) {
  const problems = [];
  const key = (limiter) => `${limiter.name}=${limiter.id}`;
  const source = limiters(config).map(key).sort();
  for (const [label, section] of [["", derived], ["env.rig.", derived.env?.rig]]) {
    if (section === undefined) {
      problems.push(`${file}  derived config has no env.rig section, which rig serve selects`);
      continue;
    }
    const kept = limiters({ ...section, env: undefined });
    for (const limiter of kept) {
      if (limiter.remote) problems.push(`${file}  derived ${label}${limiter.name} is remote, so its counter is the account's`);
    }
    const keys = kept.map(key).sort();
    if (keys.join() !== source.join()) {
      problems.push(
        `${file}  derived ${label || "top-level "}limiters are [${keys.join(", ")}], not the ref's ` +
          `[${source.join(", ")}]; the rig keeps them as they are, emulated by wrangler dev`,
      );
    }
  }
  return problems;
}

/** Rule 6: what `rig serve` runs for a Worker. */
export function serveProblems(service, args) {
  const problems = [];
  if (args[0] !== "dev") problems.push(`rig serve ${service} runs wrangler ${args[0]}, not wrangler dev`);
  const ip = args[args.indexOf("--ip") + 1];
  if (!args.includes("--ip") || !["127.0.0.1", "localhost", "::1"].includes(ip)) {
    problems.push(`rig serve ${service} does not pin wrangler dev to loopback`);
  }
  for (const flag of ["--remote", "-r"]) {
    if (args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`))) {
      problems.push(`rig serve ${service} passes ${flag}, which runs it on the account with real counters`);
    }
  }
  return problems;
}

function trackedFiles(...patterns) {
  return execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", ...patterns], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

async function rigModule(path) {
  return import(pathToFileURL(join(REPO_ROOT, path)).href);
}

async function main() {
  const { parseJsonc } = await rigModule("tools/rig/src/jsonc.mjs");
  const { deriveRigConfig } = await rigModule("tools/rig/src/wrangler-config.mjs");
  const { DEFAULT_SETTINGS, rigLayout } = await rigModule("tools/rig/src/layout.mjs");
  const { serveArgs } = await rigModule("tools/rig/src/serve.mjs");
  const read = (file) => ({ file, config: parseJsonc(readFileSync(join(REPO_ROOT, file), "utf8")) });

  const cloud = trackedFiles("tools/**/wrangler.json", "tools/**/wrangler.jsonc").map(read);
  const production = PRODUCTION_CONFIGS.map(read);

  const coverage = [];
  if (cloud.length === 0) coverage.push("found no wrangler config under tools/");
  const productionCount = production.reduce((sum, { config }) => sum + limiters(config).length, 0);
  if (productionCount === 0) {
    coverage.push("found no limiter in apps/api or apps/web, so a clash with production could not be seen");
  }
  if (coverage.length > 0) {
    console.error("check-rig-ratelimit-band: cannot vouch for the tree.\n");
    for (const line of coverage) console.error(`  ${line}`);
    process.exit(1);
  }

  const problems = bandProblems({ cloud, production });
  let derivedCount = 0;
  for (const { file, config } of production) {
    try {
      const derived = deriveRigConfig(config, DERIVE_OPTIONS[file]);
      derivedCount += limiters({ ...derived, env: undefined }).length;
      problems.push(...derivedProblems(file, config, derived));
    } catch (cause) {
      problems.push(`${file}  the deploy CLI refuses to derive it: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  const layout = rigLayout({ RIG_HOME: "/var/lib/loonext-rig" });
  for (const service of ["api", "web"]) {
    const { args } = serveArgs(service, { root: layout.current, layout, settings: DEFAULT_SETTINGS });
    problems.push(...serveProblems(service, args));
  }

  if (problems.length > 0) {
    console.error("check-rig-ratelimit-band: a rig limiter can share a counter with production.\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      `\nThe rig's cloud Workers use namespace ids ${BAND.first}-${BAND.last}; its local ` +
        "Workers keep the ref's ids under wrangler dev (docs/RIG.md 2.2 and 3.3, D142).\n",
    );
    process.exit(1);
  }

  const cloudCount = cloud.reduce((sum, { config }) => sum + limiters(config).length, 0);
  console.log(
    `check-rig-ratelimit-band: ${cloudCount} limiter(s) in ${cloud.length} cloud Worker config(s) are in ` +
      `${BAND.first}-${BAND.last}, clear of production's ${productionCount}; ${derivedCount} derived ` +
      "limiter(s) kept as the ref has them, served by wrangler dev on loopback.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
