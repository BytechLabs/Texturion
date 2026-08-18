#!/usr/bin/env node
/**
 * Every public page answers, asked of the deployed origin.
 *
 * ## Why this exists
 *
 * On 2026-08-17, `/legal/accessibility`, `/legal/dpa` and
 * `/legal/vulnerability-disclosure` were all returning **HTTP 500 in
 * production** — and had been since the commit that published each of them.
 * The other nine legal pages were fine. Nobody knew, because nothing asked.
 *
 * The cause was a page reading repo markdown while rendering, which is correct
 * in `next dev`, correct in `next build`, and fatal in a Worker whose
 * `process.cwd()` is `/`. That specific bug now has its own guard
 * (`apps/web/src/app/no-runtime-fs.test.ts`). This script is for the SHAPE of
 * it: every gate in this repo is a build or a Node test, and a page can pass
 * all of them and still be a 500 on the wire. There is no local signal for that
 * class at all — only asking the deployed origin.
 *
 * Same lesson, and deliberately the same treatment, as #578's
 * `verify-workers-dev-off.mjs`: "production ships on a release and nothing
 * re-checked afterwards" was a thing somebody had to remember.
 *
 * ## What it does
 *
 * Enumerates the marketing route group from the REPO rather than from a hand
 * list — a roster of URLs maintained beside the pages is a second copy that
 * goes stale, and the whole failure here was a page nobody was looking at.
 * Then it asks the origin for each one.
 *
 * Credential-free: unauthenticated GETs of pages any visitor can open. It does
 * not touch the signed-in app, which needs a session and is a different job.
 *
 * ## It knocks on a wall first
 *
 * Before trusting a single pass it asks for a path that certainly does not
 * exist and requires a 404. A base URL that resolves to something friendly —
 * a parked page, a captive portal, a wildcard host — would otherwise answer
 * 200 to everything and read as a perfect score. This repo has shipped a guard
 * that passed by measuring the wrong thing; this one is built to fail first.
 *
 * Usage:  node scripts/ops/verify-public-routes.mjs [--base https://loonext.com]
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = (baseArg >= 0 ? args[baseArg + 1] : "https://loonext.com").replace(
  /\/$/,
  "",
);

const ROOT = join(import.meta.dirname, "..", "..");
const MARKETING = join(ROOT, "apps", "web", "src", "app", "(marketing)");

/**
 * Route paths, from the directories that hold a `page.tsx`.
 *
 * Route GROUPS — `(marketing)` and friends — are parentheses-wrapped and
 * contribute nothing to the URL, so they are dropped rather than mapped.
 */
function routes(dir, prefix = "", out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
    out.push(prefix === "" ? "/" : prefix);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // A parallel/intercepted route or a private folder is not a URL.
    if (name.startsWith("@") || name.startsWith("_")) continue;
    const segment = name.startsWith("(") && name.endsWith(")") ? "" : `/${name}`;
    routes(join(dir, name), prefix + segment, out);
  }
  return out;
}

const all = routes(MARKETING).sort();

/**
 * Dynamic segments are skipped and SAID OUT LOUD.
 *
 * A probe that silently drops what it cannot construct a URL for reports "all
 * green" while meaning "all of the easy ones". There are none today; if a
 * `[slug]` route appears, this prints it rather than quietly shrinking.
 */
const dynamic = all.filter((r) => r.includes("["));
const paths = all.filter((r) => !r.includes("["));

if (paths.length === 0) {
  console.error(
    "Public routes: found NONE under the marketing group. That is a broken " +
      "walk, not a clean repo — refusing to report a pass.",
  );
  process.exit(1);
}

async function ask(path) {
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: { "user-agent": "loonext-release-check" },
    });
    return res.status;
  } catch (cause) {
    return `network: ${String(cause?.message ?? cause).slice(0, 80)}`;
  }
}

// The wall. A 404 here is the evidence that a 200 anywhere else means something.
const WALL = "/__this-route-does-not-exist-" + "9f3c1a";
const wall = await ask(WALL);
if (wall !== 404) {
  console.error(
    `Public routes: ${BASE}${WALL} answered ${wall}, not 404. Something is ` +
      `answering for paths that do not exist, so every result below would be ` +
      `meaningless. Check the base URL and any wildcard host in front of it.`,
  );
  process.exit(1);
}

// Serial rather than parallel: 53 requests is nothing, and a burst from one IP
// against our own edge is the kind of thing that gets a runner rate-limited
// into a false failure.
const broken = [];
for (const path of paths) {
  const status = await ask(path);
  // 2xx is the answer; 3xx is a deliberate redirect and its target is its own
  // route. Anything else is a page a visitor cannot read.
  const ok = typeof status === "number" && status >= 200 && status < 400;
  if (!ok) broken.push({ path, status });
}

if (dynamic.length > 0) {
  console.log(
    `Public routes: SKIPPED ${dynamic.length} dynamic route(s) — no URL to ` +
      `build without params: ${dynamic.join(", ")}`,
  );
}

if (broken.length > 0) {
  console.error(
    `Public routes: ${broken.length} of ${paths.length} do not answer on ${BASE}.\n` +
      broken.map((b) => `  ${String(b.status).padEnd(8)} ${b.path}`).join("\n") +
      `\n\nThese are pages a visitor can reach from the site. A 500 here is ` +
      `invisible to every other gate in this repo — the build is green, the ` +
      `HTML prerenders, the route tests pass, and the URL is still broken. ` +
      `That is exactly how three legal pages, including the published ` +
      `accessibility statement, stayed 500 for months.`,
  );
  process.exit(1);
}

console.log(
  `Public routes: ${paths.length} page(s) answered on ${BASE}, and a path ` +
    `that does not exist correctly 404s.`,
);
