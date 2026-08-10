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
 * `X-Frame-Options` and a `post-check=0` cache header. Measured 2026-08-09 and
 * again 2026-08-10; every other signature tried was served normally, including
 * `curl`, `okhttp`, `CFNetwork/Darwin`, `Python-requests`, `Go-http-client`,
 * `Wget`, and no UA at all.
 *
 * The body is seventeen bytes and names the cause: `error code: 1010`, which is
 * Cloudflare's BROWSER INTEGRITY CHECK — a zone setting that refuses user agents
 * matching known-abusive signatures. So the rule is identified without reading the
 * zone, which matters because neither token here can: `zones/{id}/rulesets`,
 * `/bot_management` and `/firewall/rules` all answer `10000 Authentication
 * error`, and `/settings` answers `9109 Unauthorized`, while `zones?name=` lists
 * the zone fine. The setting stays ON deliberately — it costs us no client, and
 * `Python-urllib` is overwhelmingly a scanner signature.
 *
 * A narrow block, and it still cost a wrong answer. Python's `urllib` is exactly
 * what an audit script reaches for, the block page LOOKS like a real answer from a
 * real server, and it appears to carry security headers of its own — so during #586
 * it was measured and briefly believed.
 *
 * So this script refuses to grade a response it cannot POSITIVELY identify as
 * ours. A probe that cannot tell our answer from an edge refusal is worse than no
 * probe: it produces a confident number about the wrong server. The first attempt
 * at that guard matched the block page by shape and never fired once — see
 * `identify` below, which is the corrected version and the more useful lesson.
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
 * Did this response come from our Worker? (#596)
 *
 * ---------------------------------------------------------------------------
 * THIS ASKS THE POSITIVE QUESTION, AND THE FIRST VERSION DID NOT.
 *
 * It used to look for a block page by its shape — a `text/plain` body on a
 * non-2xx — which was measured with `curl` and then deployed into a script that
 * does not send curl's headers. **Cloudflare content-negotiates its block page**,
 * and all three variants are the same 403:
 *
 *   Accept: * / *                 text/plain   `error code: 1010`
 *   Accept: application/json    application/json   a Cloudflare problem document
 *   (no Accept header)           text/html    the full interstitial
 *
 * This script sends `Accept: application/json`, so the one shape it can actually
 * receive is the one the old test could not see: a 403 whose content type is
 * exactly what our own errors carry. The guard had therefore never fired once in
 * the conditions it runs under, while reading as though the hazard was handled —
 * and it reported six confident header failures against a server it never reached,
 * complete with a hint about the fix not being released yet.
 *
 * So: recognise OUR answer instead of enumerating Cloudflare's. Headers are what
 * the edge is imitating; the body is not. Every response from this Worker is JSON
 * that is either a success or `{"error":{"code":…}}`. Anything else did not come
 * from us, whatever it claims in its headers, and is refused rather than graded.
 * ---------------------------------------------------------------------------
 */
function identify(status, bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ours: false, why: "the body is not JSON" };
  }
  if (body && typeof body === "object" && typeof body.error?.code === "string") {
    return { ours: true };
  }
  if (status >= 200 && status < 300 && body && typeof body === "object") {
    return { ours: true };
  }
  // Cloudflare's JSON block page is an RFC 9457 problem document, and its `type`
  // points at their own docs. Named so the failure says what happened rather
  // than "unrecognised".
  if (typeof body?.type === "string" && body.type.includes("cloudflare.com")) {
    return { ours: false, why: "it is a Cloudflare block page" };
  }
  return { ours: false, why: "it is JSON but carries no error.code" };
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

    // Read the body before grading a single header. See `identify`: the headers
    // are the part an edge refusal imitates convincingly.
    const bodyText = await response.text().catch(() => "");
    const verdict = identify(response.status, bodyText);
    if (!verdict.ours) {
      problems.push(
        `${path}: answered HTTP ${response.status} as ` +
          `${response.headers.get("content-type") ?? "no content-type"}, but ` +
          `${verdict.why} — so it did not come from our Worker (#596). Nothing ` +
          `was graded. First bytes: ${JSON.stringify(bodyText.slice(0, 120))}`,
      );
      console.log(`${path}  NOT OUR WORKER (HTTP ${response.status})`);
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
