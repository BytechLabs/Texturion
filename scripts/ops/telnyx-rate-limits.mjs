#!/usr/bin/env node
/**
 * Telnyx's own rate limits, asked of Telnyx.
 *
 * ## Why this exists
 *
 * `docs/CAPACITY.md` §2a's list of what is still unmeasured about calls opens
 * with: "Telnyx's account-level rate limit and our aggregate against it: every
 * budget in this subsystem is scoped to a single session, so twelve concurrent
 * calls authorise up to 288 dial POSTs and nothing bounds their sum."
 *
 * That was written as though the number were unobtainable. It is in a response
 * header on every request we already make. This repo has paid for that mistake
 * before — a P1 sat on "needs a vendor quote" while the figure was published —
 * so the rule is: fetch the primary source, date it, make it load-bearing.
 *
 * ## Read-only, and deliberately incomplete
 *
 * Every probe is a GET. Nothing here places a call or sends a message, because
 * both cost money and one of them rings a real phone.
 *
 * The consequence is a real limitation, stated rather than glossed: Telnyx
 * buckets per endpoint, and what we care about most is `POST /v2/calls` — the
 * dial. This measures `GET /v2/calls/{id}`, the same route family. Treat the
 * dial figure as "the call-control family's published bucket, observed from a
 * GET", not as a measurement of the POST. If they diverge, they diverge in a
 * direction only Telnyx can tell us.
 *
 * Usage:  node scripts/ops/telnyx-rate-limits.mjs
 */

const KEY = process.env.TELNYX_API_KEY;
if (!KEY) {
  console.error(
    "TELNYX_API_KEY is not set. This probe reads rate-limit headers from " +
      "Telnyx; without the key there is nothing to read and reporting a " +
      "number from memory is the failure this script exists to prevent.",
  );
  process.exit(1);
}

/** A nonexistent id: the route family answers, and no object is touched. */
const NOWHERE = "00000000-0000-4000-8000-000000000000";

const PROBES = [
  {
    family: "call control (the dial)",
    path: `calls/${NOWHERE}`,
    matters: "POST /v2/calls is every ring leg we fan out.",
  },
  {
    family: "messaging",
    path: `messages/${NOWHERE}`,
    matters: "POST /v2/messages is every outbound text.",
  },
  {
    family: "number management",
    path: "phone_numbers?page%5Bsize%5D=1",
    matters: "Search and ordering during onboarding.",
  },
  {
    family: "call control apps",
    path: "call_control_applications?page%5Bsize%5D=1",
    matters: "Read at provisioning time.",
  },
];

/** `ratelimit-limit: 2000, 2000;w=1` → { limit: 2000, window: 1 } */
function parseLimit(header) {
  if (!header) return null;
  const limit = Number(header.split(",")[0].trim());
  const window = Number(/w=(\d+)/.exec(header)?.[1] ?? "1");
  return Number.isFinite(limit) ? { limit, window } : null;
}

const results = [];
for (const probe of PROBES) {
  let res;
  try {
    res = await fetch(`https://api.telnyx.com/v2/${probe.path}`, {
      headers: { authorization: `Bearer ${KEY}` },
    });
  } catch (cause) {
    results.push({ ...probe, error: String(cause?.message ?? cause).slice(0, 90) });
    continue;
  }
  const parsed = parseLimit(res.headers.get("ratelimit-limit"));
  results.push({ ...probe, status: res.status, ...(parsed ?? {}) });
}

const measured = results.filter((r) => typeof r.limit === "number");
if (measured.length === 0) {
  console.error(
    "No rate-limit headers came back from any endpoint. Either Telnyx stopped " +
      "publishing them or the key was rejected — do not read this as 'no limit'.",
  );
  process.exit(1);
}

console.log(`Telnyx rate limits, observed ${new Date().toISOString().slice(0, 10)}:\n`);
for (const r of results) {
  const value = r.error
    ? `network: ${r.error}`
    : typeof r.limit === "number"
      ? `${r.limit}/${r.window}s`.padEnd(12) + `(HTTP ${r.status})`
      : `no header (HTTP ${r.status})`;
  console.log(`  ${r.family.padEnd(24)} ${value}`);
  console.log(`  ${" ".repeat(24)} ${r.matters}`);
}

/*
 * Our worst case against the dial bucket.
 *
 * Kept in sync with transitions.ts by name rather than by value — if somebody
 * raises MAX_LEGS_PER_SESSION this printout goes stale silently, which is the
 * same failure the CAPACITY headline had. The unit test beside the constants
 * is what pins the numbers; this is the arithmetic a person reads.
 */
const dial = measured.find((r) => r.family.startsWith("call control (the dial)"));
if (dial) {
  const MAX_LEGS = 24; // MAX_LEGS_PER_SESSION
  const BATCH = 6; // DIAL_BATCH_SIZE
  const BATCH_SECONDS = 0.5; // ~300-800ms per POST, the CALLS-V3 estimate
  const perSessionPerSecond = BATCH / BATCH_SECONDS;
  const sessionsToSaturate = Math.floor(dial.limit / perSessionPerSecond);
  console.log(
    `\nAgainst the dial bucket (${dial.limit}/${dial.window}s):\n` +
      `  in flight per session      ${BATCH} (bounded parallelism)\n` +
      `  sustained per session      ~${perSessionPerSecond}/s at a ${BATCH_SECONDS * 1000}ms round trip\n` +
      `  worst case for one session ${MAX_LEGS} POSTs total\n` +
      `  concurrent ringing calls to saturate: ~${sessionsToSaturate}\n\n` +
      `  The round trip is an ESTIMATE from docs/CALLS-V3.md, not a measurement,\n` +
      `  and every figure on this line is linear in it. A slower Telnyx makes\n` +
      `  the ceiling further away, not nearer, so this errs the safe way.`,
  );
}
