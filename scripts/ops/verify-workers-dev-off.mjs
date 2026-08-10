#!/usr/bin/env node
/**
 * [#578] Ask the wire whether the second front door is actually shut.
 *
 *   node scripts/ops/verify-workers-dev-off.mjs
 *
 * Both Workers used to answer on their `*.workers.dev` hostname as well as their
 * custom domain, because `workers_dev` was ABSENT from both `wrangler.jsonc`
 * files rather than false — and absent defaults to on. On that hostname the
 * marketing/app host split is inert by design (`hosts.ts` returns null for a host
 * it does not recognise, so previews and tunnels are left alone), which means app
 * routes served there skip the redirect and the cache rule #559 anchored.
 *
 * The setting is now declared in the repo. This exists because the previous
 * attempt at this was a dashboard toggle, and a dashboard toggle survives exactly
 * until the next `wrangler deploy` — so the question worth asking is not "is it
 * configured" but "is it off right now".
 *
 * Measured 2026-08-10, BEFORE the config landed: the api answered 200 on
 * `/health` at its workers.dev name, and the web Worker served `/` and `/login`
 * at 200 on its own. Run this after the next release and both should refuse.
 *
 * Read-only. Two GETs, no credentials, no customer data.
 */

const SUBDOMAIN = process.env.WORKERS_DEV_SUBDOMAIN ?? "hayaturehmanahmadzai";

const TARGETS = [
  { worker: "loonext-api", path: "/health" },
  { worker: "loonext-web", path: "/login" },
];

/**
 * A hostname that certainly does not exist, asked first.
 *
 * `workers_dev: false` makes Cloudflare answer the subdomain with its own
 * "there is nothing here" page rather than routing to the Worker — which is the
 * same thing a typo produces. Without this, a wrong subdomain in the env var
 * would read as a clean pass on both Workers, and the script would report the
 * door shut because it knocked on a wall.
 */
const CANARY = `loonext-no-such-worker-${"578"}`;

async function probe(host, path) {
  try {
    const response = await fetch(`https://${host}${path}`, {
      headers: { "User-Agent": "loonext-ops/1.0 (+scripts/ops/verify-workers-dev-off.mjs)" },
      redirect: "manual",
    });
    return { status: response.status };
  } catch (cause) {
    // DNS failure is the strongest possible "off" — the name does not resolve.
    return { status: null, why: cause.message };
  }
}

const canary = await probe(`${CANARY}.${SUBDOMAIN}.workers.dev`, "/");
if (canary.status !== null && canary.status < 400) {
  console.error(
    `The probe cannot tell the difference between on and off: a Worker that ` +
      `does not exist answered ${canary.status} on ` +
      `${CANARY}.${SUBDOMAIN}.workers.dev. Either the subdomain is wrong ` +
      `(set WORKERS_DEV_SUBDOMAIN) or workers.dev is behaving differently than ` +
      `this script assumes. Nothing below would mean anything.`,
  );
  process.exit(2);
}
console.log(
  `Probe works: a non-existent Worker on this subdomain answers ` +
    `${canary.status ?? "no DNS"}.`,
);

const open = [];
for (const { worker, path } of TARGETS) {
  const host = `${worker}.${SUBDOMAIN}.workers.dev`;
  const { status, why } = await probe(host, path);
  const shut = status === null || status >= 400;
  console.log(
    `${shut ? "shut " : "OPEN "} ${host}${path}  ${status ?? `no DNS (${why})`}`,
  );
  if (!shut) open.push(`${host}${path} answered ${status}`);
}

if (open.length > 0) {
  console.error(
    [
      "",
      "A Worker is still answering on workers.dev:",
      ...open.map((line) => `  ${line}`),
      "",
      "That is a second origin with different rules — no host redirect, and the",
      "cache rule anchored to a known host does not apply. `workers_dev: false`",
      "is set in both wrangler.jsonc files; if this is failing, either the",
      "release carrying it has not shipped yet (production deploys on a release,",
      "not on a merge) or something is deploying from a different config.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("\nOK: neither Worker answers on workers.dev.");
