/**
 * [#586] Ask production whether the API's security headers are actually on the wire.
 *
 *   node scripts/ops/verify-api-headers.mjs
 *   node scripts/ops/verify-api-headers.mjs --base https://api-staging.loonext.com
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * #586 was found by measuring, not by reading code: the absence of a module is
 * not something a code search surfaces. `apps/api/src/http/security-headers.ts`
 * now exists and is unit-tested, and a unit test proves the middleware sets the
 * headers — it cannot prove the deployed build has it, that Cloudflare did not
 * strip something in front, or that a later route stopped honouring the default.
 *
 * Those are the failures that produced #586 in the first place, so the check
 * that closes it has to be the same kind of check that opened it: a real request
 * to the real host.
 *
 * NOTHING IS RETYPED HERE. The expected headers are parsed out of
 * `security-headers.ts` at run time. Adding a header there and forgetting this
 * script is impossible; changing a value in one place and not the other is
 * impossible. A second hand-maintained copy of the list would drift, and a
 * drifting checker is worse than none because it reports on a spec nobody holds.
 *
 * UNAUTHENTICATED IS SUFFICIENT, and that is a property of the fix rather than a
 * shortcut. The middleware is mounted first with `app.use("*")`, so a 401 gets
 * the same headers a 200 does. The ORIGINAL #586 measurement did need a real
 * token — a 401 body is not worth caching, so its missing `Cache-Control` proved
 * nothing about responses that carry customer data — but that question was about
 * severity. This one is "is the middleware live", and the 401 answers it without
 * minting a user or touching an account.
 *
 * ---------------------------------------------------------------------------
 * THE TRAP THIS SCRIPT IS BUILT AROUND (#596).
 *
 * The edge in front of this Worker refuses one specific client signature: a user
 * agent BEGINNING with `Python-urllib` (case-sensitive, any version, `urllib3`
 * included) gets a Cloudflare block page — HTTP 403, `text/plain`, carrying
 * `X-Frame-Options` and a `post-check=0` cache header. Measured 2026-08-09; every
 * other signature tried was served normally, including `curl`, `okhttp`,
 * `CFNetwork/Darwin`, `Python-requests`, `Go-http-client`, `Wget`, and no UA at all.
 *
 * A narrow block, and it still cost a wrong answer. Python's `urllib` is exactly
 * what an audit script reaches for, the block page LOOKS like a real answer from a
 * real server, and it appears to carry security headers of its own — so during #586
 * it was measured and briefly believed.
 *
 * So this script REFUSES to grade a response that smells like a block page rather
 * than reporting on it. A probe that cannot tell our answer from an edge refusal is
 * worse than no probe: it produces a confident number about the wrong server. The
 * detector is deliberately not tied to the `Python-urllib` signature, because the
 * lesson is the shape, not that one library.
 *
 * Read-only. One GET per path, no credentials, no customer data.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../../apps/api/src/http/security-headers.ts");

const DEFAULT_BASE = "https://api.loonext.com";

/**
 * Say who we are, rather than inherit whatever the runtime sends.
 *
 * Node's default is accepted today, so this is not a workaround for #596 — it is
 * so the identity is a fact of this file instead of a property of the Node version
 * it runs under. A probe whose user agent changes when the runtime is upgraded is a
 * probe that can start being refused for reasons nobody changed.
 */
const PROBE_UA = "Loonext-Ops/1.0 (+scripts/ops/verify-api-headers.mjs)";

/**
 * The paths worth grading, and why each one is here.
 *
 *   /health   Unauthenticated 200. The only path that proves the headers land on
 *             a SUCCESS response without a token — a 401-only check would pass on
 *             a build that somehow only decorated errors.
 *   /v1/me    Unauthenticated 401 from the same middleware chain that serves every
 *             authenticated route. Its own `Cache-Control` is not interesting; the
 *             point is that the global layer ran.
 */
const PATHS = ["/health", "/v1/me"];

/** The expected header set, read out of the product source rather than restated. */
function expectedHeaders() {
  const source = readFileSync(SOURCE, "utf8");

  const block = source.match(
    /export const API_SECURITY_HEADERS[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!block) {
    console.error(
      `Could not find API_SECURITY_HEADERS in ${SOURCE}. If it was renamed or ` +
        `moved, fix this parser — do not paste the values in here, or the two ` +
        `will drift and this script will start grading a spec nobody holds.`,
    );
    process.exit(2);
  }

  const expected = {};
  for (const line of block[1].split("\n")) {
    const entry = line.match(/^\s*"([^"]+)":\s*"([^"]*)",?\s*$/);
    if (entry) expected[entry[1]] = entry[2];
  }

  const fallback = source.match(
    /export const DEFAULT_CACHE_CONTROL\s*=\s*"([^"]*)"/,
  );
  if (!fallback) {
    console.error(`Could not find DEFAULT_CACHE_CONTROL in ${SOURCE}.`);
    process.exit(2);
  }
  expected["Cache-Control"] = fallback[1];

  // A parse that silently found nothing would pass everything. Four is what the
  // module holds today; the floor is "more than the Cache-Control we just added".
  if (Object.keys(expected).length < 2) {
    console.error(
      `Parsed only ${Object.keys(expected).length} expected header(s) from ` +
        `${SOURCE}. That is a parser failure, not an empty module.`,
    );
    process.exit(2);
  }
  return expected;
}

/**
 * Does this response look like an edge refusal rather than our Worker? (#596)
 *
 * Deliberately generous: any `text/plain` non-2xx/401 from a JSON API is not us.
 * A false positive here costs a re-run; a false negative costs a wrong answer in
 * a security audit, which is what actually happened.
 */
function looksLikeBlockPage(response) {
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 403 && !type.includes("json")) return true;
  return type.startsWith("text/plain") && ![200, 401].includes(response.status);
}

function baseFromArgv() {
  const flag = process.argv.findIndex((arg) => arg === "--base");
  if (flag === -1) return DEFAULT_BASE;
  const value = process.argv[flag + 1];
  if (!value || value.startsWith("--")) {
    console.error("--base needs a URL, e.g. --base https://api.loonext.com");
    process.exit(2);
  }
  return value.replace(/\/$/, "");
}

async function main() {
  const base = baseFromArgv();
  const expected = expectedHeaders();
  const names = Object.keys(expected);

  console.log(`target         ${base}`);
  console.log(`expectations   ${SOURCE.replace(/\\/g, "/")}`);
  console.log("");

  const problems = [];

  for (const path of PATHS) {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: { "User-Agent": PROBE_UA, Accept: "application/json" },
      });
    } catch (cause) {
      problems.push(`${path}: request failed (${cause.message})`);
      console.log(`${path}  REQUEST FAILED`);
      continue;
    }

    if (looksLikeBlockPage(response)) {
      // Refuse rather than grade. See the #596 note at the top.
      problems.push(
        `${path}: answered HTTP ${response.status} as ` +
          `${response.headers.get("content-type") ?? "no content-type"} — that is ` +
          `an edge refusal, not our Worker (#596). Nothing was graded.`,
      );
      console.log(`${path}  BLOCKED AT THE EDGE (HTTP ${response.status})`);
      continue;
    }

    console.log(`${path}  HTTP ${response.status}`);
    for (const name of names) {
      const actual = response.headers.get(name);
      const want = expected[name];
      if (actual === null) {
        console.log(`  ${name.padEnd(26)} ABSENT (want "${want}")`);
        problems.push(`${path}: ${name} absent`);
        continue;
      }
      // Cache-Control is a DEFAULT, not a fixed value: two routes set their own on
      // purpose. Any value that keeps the response out of a shared cache is fine;
      // what would be a defect is nothing at all, or something public.
      if (name === "Cache-Control") {
        const priv = /(?:no-store|private)/i.test(actual);
        console.log(`  ${name.padEnd(26)} ${actual}${priv ? "" : "  <- PUBLIC"}`);
        if (!priv) {
          problems.push(
            `${path}: Cache-Control is "${actual}", which does not keep an ` +
              `authenticated response out of a shared cache`,
          );
        }
        continue;
      }
      if (actual !== want) {
        console.log(`  ${name.padEnd(26)} ${actual}  <- want "${want}"`);
        problems.push(`${path}: ${name} is "${actual}", source says "${want}"`);
        continue;
      }
      console.log(`  ${name.padEnd(26)} ${actual}`);
    }
    console.log("");
  }

  if (problems.length === 0) {
    console.log(
      `OK — every header the source declares is on the wire for ${PATHS.join(" and ")}.`,
    );
    process.exit(0);
  }

  console.error("FAILED:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  console.error(
    "If the headers are absent everywhere, the most likely cause is that the fix " +
      "is merged but not released — production ships on a release, not on a merge. " +
      "Check the deployed version before treating this as a regression.",
  );
  process.exit(1);
}

await main();
