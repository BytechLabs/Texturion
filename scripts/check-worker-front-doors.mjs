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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every Worker, and where each one is supposed to answer.
 *
 * D142: the rig's edge is the one Worker whose door IS workers.dev, which is
 * cross-site to loonext.com; a preview URL would still be a second edge
 * nobody watches. The guard has no public door: the edge's service binding is
 * its only way in.
 */
export const WORKERS = [
  { file: "apps/api/wrangler.jsonc", serves: "api.loonext.com" },
  { file: "apps/web/wrangler.jsonc", serves: "loonext.com and app.loonext.com" },
  {
    file: "tools/edge/wrangler.jsonc",
    serves: "its own workers.dev name, the rig's only public door",
    workersDev: true,
  },
  { file: "tools/guard/wrangler.jsonc", serves: "nothing: only the edge's service binding" },
];

/** The settings each Worker must declare, and the value it must declare. */
export function expectedDoors(worker) {
  return { workers_dev: worker.workersDev === true, preview_urls: false };
}

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

/**
 * What is wrong with each Worker's doors. `read` returns a config's text by
 * repo-relative path, so a test can hand it any configs it likes.
 */
export function frontDoorProblems(workers, read) {
  const problems = [];
  for (const worker of workers) {
    let config;
    try {
      config = JSON.parse(stripJsonc(read(worker.file)));
    } catch (cause) {
      problems.push(
        `${worker.file} did not parse after comment stripping: ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      );
      continue;
    }
    for (const [key, expected] of Object.entries(expectedDoors(worker))) {
      if (config[key] === expected) continue;
      if (expected) {
        problems.push(
          `${worker.file} must set "${key}" to true: workers.dev is how it serves ` +
            `${worker.serves}, and the repo has to say so rather than rely on a default.`,
        );
      } else {
        problems.push(
          config[key] === undefined
            ? `${worker.file} does not set "${key}". ABSENT MEANS ON — this Worker ` +
                `would answer on a *.workers.dev hostname besides ` +
                `${worker.serves}, a door nothing on that origin was built for. ` +
                `Set it to false here rather than in the dashboard, which the ` +
                `next deploy overwrites.`
            : `${worker.file} sets "${key}" to ${JSON.stringify(config[key])}, ` +
                `which opens a second front door besides ${worker.serves}.`,
        );
      }
    }
  }
  return problems;
}

function main() {
  const problems = frontDoorProblems(WORKERS, (file) => readFileSync(join(REPO_ROOT, file), "utf8"));
  if (problems.length > 0) {
    console.error("Worker front doors (#578):\n");
    for (const problem of problems) console.error(`  - ${problem}\n`);
    process.exit(1);
  }
  const open = WORKERS.filter((worker) => expectedDoors(worker).workers_dev);
  console.log(
    `Worker front doors: ${WORKERS.length} Worker(s) declare workers_dev and ` +
      `preview_urls in the repo; all ${WORKERS.length} have preview_urls false, and ` +
      `workers_dev is on only for ${open.map((worker) => worker.file).join(", ")}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
