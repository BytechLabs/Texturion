/**
 * [#581] Ask the zone AND the wire what TLS versions production still accepts.
 *
 *   node scripts/ops/verify-tls-floor.mjs             # report, exit 0
 *   node scripts/ops/verify-tls-floor.mjs --assert    # exit 1 if below the floor
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS.
 *
 * The pen-test epic asked what our transport posture actually is. The answer
 * lived in a Cloudflare dashboard, which means it lived nowhere a person with a
 * clone could read, and nowhere a build could notice it changing.
 *
 * Measured 2026-08-14: the `loonext.com` zone carries `min_tls_version: "1.0"`,
 * and `api.loonext.com` completes a TLS 1.0 handshake and answers 200. TLS 1.0
 * and 1.1 were deprecated by RFC 8996 in 2021 and PCI DSS has required 1.2 or
 * better since 2018, so this is a floor worth raising — but raising it decides
 * WHO CAN CONNECT to production, so it is the operator's call and this script
 * deliberately cannot make it. Read-only: two GETs and a handshake.
 *
 * ---------------------------------------------------------------------------
 * TWO SOURCES, BECAUSE THEY CAN DISAGREE.
 *
 * The API says what is CONFIGURED. The handshake says what is SERVED. Those are
 * different claims, and this repo has been bitten by exactly that gap on the
 * neighbouring question — `workers_dev: false` has been correct in both
 * wrangler configs for weeks while both Workers went on answering on
 * *.workers.dev, because config is a statement of intent and only the wire is a
 * statement of fact.
 *
 * So the handshake is the load-bearing half here and the setting is context. If
 * only one can run, the handshake is the one that matters.
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS SCRIPT REFUSES TO HAVE.
 *
 * Modern OpenSSL builds often refuse to speak TLS 1.0 at all, at compile time.
 * A probe that treats "my own client would not offer 1.0" as "the server
 * rejected 1.0" reports the door shut because it never knocked — the same shape
 * as a guard whose regex matched nothing and reported none found.
 *
 * Every probe below therefore returns one of THREE answers — accepted, refused,
 * or could-not-test — and `--assert` fails on could-not-test rather than
 * passing, because an untested floor is not a verified one.
 *
 * That third state is not theoretical. On the machine this was written on, ALL
 * THREE available clients refuse to offer TLS 1.0: Node's bundled OpenSSL and
 * mingw OpenSSL 3.5.4 both answer `no protocols available`, and curl is built on
 * Schannel, which honours the Windows policy and does not report the negotiated
 * version through `%{ssl_version}` at all.
 *
 * A curl run with `--tls-max 1.0` returning 200 was briefly taken as proof the
 * server accepts 1.0. It is not: the request succeeded because the client
 * negotiated something HIGHER, and the exit code says nothing about the version.
 * That mistake is why this file distinguishes the three states instead of two.
 *
 * So on a box like this the wire half is unanswerable and the CONFIGURED value
 * is what carries — which is fine, because Cloudflare's `min_tls_version` is
 * what the edge enforces, so reading it is authoritative for what will be
 * accepted. The distinction to keep is that this is an authoritative READ, not a
 * measurement, and the script says which it managed.
 */
import { connect } from "node:tls";

const ZONE_NAME = "loonext.com";
const HOSTS = ["api.loonext.com", "app.loonext.com"];

/** The floor we want. Anything below this is the finding. */
const REQUIRED = "1.2";

/** Node's names for the versions worth asking about. */
const LEGACY = ["TLSv1", "TLSv1.1"];

const assertMode = process.argv.includes("--assert");

/**
 * Try to complete a handshake at exactly one protocol version.
 *
 * `minVersion === maxVersion` pins it, so a server that only offers 1.3 fails
 * rather than silently negotiating up and reporting a 1.0 success.
 */
function handshake(host, version) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let socket;
    try {
      socket = connect(
        { host, port: 443, servername: host, minVersion: version, maxVersion: version },
        () => {
          const negotiated = socket.getProtocol();
          socket.destroy();
          done({ state: "accepted", negotiated });
        },
      );
    } catch (cause) {
      // Thrown synchronously when this OpenSSL build has the version compiled
      // out. NOT a refusal by the server.
      return done({ state: "untestable", reason: String(cause?.message ?? cause) });
    }
    socket.setTimeout(10_000, () => {
      socket.destroy();
      done({ state: "untestable", reason: "timed out" });
    });
    socket.on("error", (cause) => {
      const message = String(cause?.message ?? cause);
      // Distinguish "this client cannot speak it" from "that server said no".
      const clientSide =
        /no protocols available|unsupported protocol|version too low|library has no ciphers/i.test(
          message,
        );
      done({
        state: clientSide ? "untestable" : "refused",
        reason: message,
      });
    });
  });
}

/** The configured floor, when a token can read it. Context, not the verdict. */
async function configuredFloor() {
  const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_USER_TOKEN;
  if (!token) return { known: false, why: "no CLOUDFLARE_API_TOKEN/CLOUDFLARE_USER_TOKEN" };
  const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? (await lookupZone(token));
  if (!zoneId) return { known: false, why: `could not resolve the ${ZONE_NAME} zone` };
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/settings/min_tls_version`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await response.json();
    if (!body.success) {
      return { known: false, why: JSON.stringify(body.errors?.map((e) => e.message) ?? []) };
    }
    return { known: true, value: body.result?.value, editable: body.result?.editable };
  } catch (cause) {
    return { known: false, why: String(cause?.message ?? cause) };
  }
}

async function lookupZone(token) {
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/zones", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    return body.result?.find((zone) => zone.name === ZONE_NAME)?.id ?? null;
  } catch {
    return null;
  }
}

const config = await configuredFloor();
if (config.known) {
  console.log(
    `zone ${ZONE_NAME}: min_tls_version = ${config.value}` +
      (config.editable ? " (editable with this token)" : " (read-only for this token)"),
  );
} else {
  console.log(`zone ${ZONE_NAME}: min_tls_version unknown — ${config.why}`);
}

console.log("\nwhat the wire actually accepts:");
let accepted = 0;
let untestable = 0;
for (const host of HOSTS) {
  for (const version of LEGACY) {
    const result = await handshake(host, version);
    if (result.state === "accepted") {
      accepted += 1;
      console.log(`  ACCEPTED  ${host} at ${version} (negotiated ${result.negotiated})`);
    } else if (result.state === "refused") {
      console.log(`  refused   ${host} at ${version}`);
    } else {
      untestable += 1;
      console.log(`  UNTESTED  ${host} at ${version} — ${result.reason}`);
    }
  }
}

if (accepted > 0) {
  console.log(
    `\n${accepted} legacy handshake(s) succeeded. RFC 8996 deprecated TLS 1.0 and 1.1 ` +
      `in 2021; PCI DSS has required ${REQUIRED}+ since 2018.\n` +
      "\nRaising the floor is a one-call PATCH of the zone's min_tls_version, and it\n" +
      "decides who can still reach production — an operator decision, not this\n" +
      "script's. It is deliberately not automated here.",
  );
  process.exit(assertMode ? 1 : 0);
}

if (untestable > 0) {
  console.log(
    `\n${untestable} probe(s) could not run — this client cannot offer those versions, ` +
      "which is not the same as the server refusing them. The floor is UNVERIFIED.",
  );
  process.exit(assertMode ? 1 : 0);
}

console.log(`\nOK: no host completed a handshake below TLS ${REQUIRED}.`);
