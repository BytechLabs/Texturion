#!/usr/bin/env node
/**
 * #578 — a Worker answers on its custom domain and nowhere else.
 *
 * `workers_dev` and `preview_urls` both DEFAULT TO ON. Absent from
 * `wrangler.jsonc`, each Worker also answers on a `*.workers.dev` hostname,
 * where the host split in `apps/web/src/lib/hosts.ts` is inert by design —
 * `decideHostRedirect` returns null for a host it does not recognise, so
 * previews and tunnels are left alone. App routes served from that origin skip
 * the marketing/app redirect and the cache rule #559 anchored to a known host.
 *
 * The setting was turned off in the DASHBOARD once. The next `wrangler deploy`
 * put it back, because a dashboard toggle is not configuration — which is why
 * f76a14bc moved it into both `wrangler.jsonc` files.
 *
 * What nothing prevented was somebody deleting those two lines again. They look
 * like defaults, they are three words long, and their absence is silent: the
 * Worker keeps working, the tests keep passing, and a second front door opens
 * on the next release. That is what this guard is for.
 *
 * ## It checks the VALUE, not the mention
 *
 * `"workers_dev": true` and a comment about workers_dev both contain the word.
 * The parse strips comments and reads the actual JSON, so the guard fails on a
 * flipped value rather than only on a deleted line.
 */
import { readFileSync } from "node:fs";

/** Both Workers, and the domain each one is supposed to answer on. */
const WORKERS = [
  { file: "apps/api/wrangler.jsonc", serves: "api.loonext.com" },
  { file: "apps/web/wrangler.jsonc", serves: "loonext.com and app.loonext.com" },
];

/** The settings that must be present AND false. */
const MUST_BE_FALSE = ["workers_dev", "preview_urls"];

/**
 * JSONC → JSON.
 *
 * Both files are heavily commented — deliberately, since the reasoning for
 * these two lines is the thing most likely to be lost. Stripping is done with
 * a string-aware scan rather than a regex, because a `//` inside a URL in a
 * comment or a value would otherwise eat the rest of the line and change what
 * the guard reads.
 */
function stripJsonc(source) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += next ?? ""; i += 1; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && next === "/") { inLine = true; i += 1; continue; }
    if (c === "/" && next === "*") { inBlock = true; i += 1; continue; }
    out += c;
  }
  return out;
}

const problems = [];

for (const worker of WORKERS) {
  let config;
  try {
    config = JSON.parse(stripJsonc(readFileSync(worker.file, "utf8")));
  } catch (cause) {
    problems.push(
      `${worker.file} did not parse after comment stripping: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
    continue;
  }
  for (const key of MUST_BE_FALSE) {
    if (config[key] === false) continue;
    problems.push(
      config[key] === undefined
        ? `${worker.file} does not set "${key}". ABSENT MEANS ON — this Worker ` +
            `would answer on a *.workers.dev hostname as well as ` +
            `${worker.serves}, where the host split is inert by design and the ` +
            `cache rule does not apply. Set it to false here rather than in the ` +
            `dashboard, which the next deploy overwrites.`
        : `${worker.file} sets "${key}" to ${JSON.stringify(config[key])}, ` +
            `which opens a second front door onto ${worker.serves}.`,
    );
  }
}

if (problems.length > 0) {
  console.error("Worker front doors (#578):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Worker front doors: ${WORKERS.length} Worker(s), each declaring ` +
    `${MUST_BE_FALSE.join(" and ")} false in the repo.`,
);
