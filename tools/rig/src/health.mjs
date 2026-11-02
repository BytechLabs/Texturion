/**
 * `rig health`: the parts of R00 that need no emulator.
 * Each check passes or fails with a reason; a check that
 * cannot measure fails too, because "unknown" is not a pass. The result is
 * also written to state/health.json, with the guard's room, for rigd to
 * publish, and it is written even when nothing could be measured.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { classifyCrons, readCronRegistry } from "./cron.mjs";
import { DEPLOY_HOLD_MAX_AGE_MS, deployHoldPath, readDeployHold } from "./deploy-hold.mjs";
import { run, systemctlUser } from "./exec.mjs";
import { parseDevVars } from "./dev-vars.mjs";
import { GUARD_ROUTES } from "../../rig-protocol/src/index.ts";
import { adbAnswers } from "../lanes/src/android/adb.ts";
import { ADB_VM_PORT, HOSTD_PORT } from "../lanes/src/android/devices.ts";
import { guardGet } from "./guard.mjs";
import { parseJsonc } from "./jsonc.mjs";
import { stripeSandboxKey } from "./stripe.mjs";
import { psql } from "./supabase.mjs";

/** Zones the tenants and the hermetic tests use, at instants either side of rule changes. */
export const TZ_PROBE_ZONES = [
  "America/Toronto",
  "America/Edmonton",
  "America/Vancouver",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/Regina",
  "America/New_York",
  "America/Los_Angeles",
];

export function tzProbeInstants(now = Date.now()) {
  const day = 86_400_000;
  return [0, 45, 90, 135, 180, 270, 365, 500].map((offset) => new Date(Math.floor((now + offset * day) / day) * day + 12 * 3_600_000));
}

/** Minutes east of UTC that Node's own tz database gives a zone at an instant. */
export function nodeOffsetMinutes(zone, instant) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName").value;
  const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name);
  if (!match || !match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

export function tzProbeSql(zones, instants) {
  const rows = [];
  for (const zone of zones) {
    for (const instant of instants) rows.push(`('${zone}', '${instant.toISOString()}'::timestamptz)`);
  }
  return (
    "select z || '|' || to_char(t at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') || '|' || " +
    "(extract(epoch from (t at time zone z) - (t at time zone 'UTC')) / 60)::int " +
    `from (values ${rows.join(", ")}) as p(z, t);`
  );
}

/** The (zone, instant) pairs where Node and Postgres disagree. */
export function tzMismatches(postgresRows) {
  const mismatches = [];
  for (const row of postgresRows) {
    const [zone, iso, minutes] = row.split("|");
    if (!zone || !iso) continue;
    const node = nodeOffsetMinutes(zone, new Date(iso));
    if (node !== Number(minutes)) mismatches.push({ zone, at: iso, node, postgres: Number(minutes) });
  }
  return mismatches;
}

/**
 * The guard re-runs its start-up checks when they are six hours old, on the
 * next request that needs them; a result much older means they stopped
 * running.
 */
export const GUARD_SAFETY_MAX_AGE_MS = 6 * 3_600_000 + 15 * 60_000;

/**
 * The checks that read only the store, rigd's state files and the VM itself,
 * so a rig with nothing deployed or its stack down still says whether the
 * guard, hostd, the tunnel and the firewall are right.
 */
export const DEPLOY_FREE_CHECKS = new Set(["guard", "nonprodApps", "uplink", "deployHold", "sentry", "hostd", "adbTunnel", "nftables"]);

function readJsonFile(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function fresh(at, maxAgeMs, now = Date.now()) {
  const time = typeof at === "number" ? at : Date.parse(at ?? "");
  return Number.isFinite(time) && now - time <= maxAgeMs;
}

const short = (sha) => (typeof sha === "string" ? sha.slice(0, 12) : String(sha));

/**
 * R00's Sentry half, from rigd's state/sentry-relay.json. A defect is an event
 * the cron registry says means the seed or a scenario's setup is wrong, so it
 * fails as surely as an unexplained one, and with the registry's cause.
 */
export function sentryFailure(state) {
  const { unexplained_24h: unexplained, defects_24h: defects } = state;
  if (!Array.isArray(unexplained) || !Array.isArray(defects)) {
    return "the relay's report does not list unexplained_24h and defects_24h";
  }
  const reasons = [];
  if (unexplained.length > 0) reasons.push(`${unexplained.length} unexplained fingerprint(s) in 24 hours`);
  const byMeans = new Map();
  for (const defect of defects) {
    const means = typeof defect?.means === "string" && defect.means !== "" ? defect.means : "a defect the cron registry names";
    byMeans.set(means, (byMeans.get(means) ?? 0) + 1);
  }
  for (const [means, count] of byMeans) reasons.push(`defect (${count} fingerprint(s) in 24 hours): ${means}`);
  return reasons.length === 0 ? null : reasons.join("; ");
}

/**
 * @param {{ layout, settings, store, status, projectId, deployed, fetch?: typeof fetch, systemctl?: typeof systemctlUser, cronRegistry?: object, run?: typeof run, portAnswers?: typeof adbAnswers }} context
 */
export function healthChecks(context) {
  const fetchImpl = context.fetch ?? fetch;
  const systemctl = context.systemctl ?? systemctlUser;
  const runImpl = context.run ?? run;
  const portAnswers = context.portAnswers ?? adbAnswers;
  const api = () => `http://127.0.0.1:${context.settings.apiPort}`;
  const devVars = () => {
    const path = join(context.deployed.worktree, "apps", "api", ".dev.vars.rig");
    if (!existsSync(path)) throw new Error("the deployed worktree has no .dev.vars.rig");
    return parseDevVars(readFileSync(path, "utf8"));
  };
  let guardHealth;
  const guard = () => (guardHealth ??= guardGet(context.store, GUARD_ROUTES.health, fetchImpl));
  /** Null when `rig serve <service>` serves the deployed SHA. */
  const servesDeployed = (service) => {
    const serving = readJsonFile(join(context.layout.state, `serving-${service}.json`));
    context.published.serving[service] = serving?.sha ?? null;
    if (serving === null) return `rig serve ${service} has not recorded what it serves`;
    if (serving.sha !== context.deployed.sha) {
      return `the ${service} serves ${short(serving.sha)}, but deployed.json names ${short(context.deployed.sha)}`;
    }
    return null;
  };

  return {
    async api() {
      const response = await fetchImpl(`${api()}/health`);
      const body = await response.json().catch(() => null);
      // In rig mode the API answers everything, /health included, with 503
      // until its database reports rig posture.
      if (response.status === 503 && body?.error?.code === "service_unavailable") {
        return `the API is not serving: ${body.error.message}`;
      }
      if (response.status !== 200 || body?.ok !== true) return `the API answered ${response.status}`;
      return servesDeployed("api");
    },

    async web() {
      const response = await fetchImpl(`http://127.0.0.1:${context.settings.webPort}/login`, { redirect: "manual" });
      if (response.status >= 500) return `the web app answered ${response.status}`;
      return servesDeployed("web");
    },

    async database() {
      const response = await fetchImpl(`${context.status.apiUrl}/rest/v1/rpc/rig_database_posture`, {
        method: "POST",
        headers: { apikey: context.status.secretKey, authorization: `Bearer ${context.status.secretKey}`, "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) return `rig_database_posture answered ${response.status}`;
      const posture = await response.json();
      const owned = (devVars().RIG_OWNED_E164 ?? "").split(",").filter(Boolean).length;
      if (posture.deploy_env !== "rig") return "the database does not say rig";
      if (posture.endpoints !== owned) return `the database lists ${posture.endpoints} endpoint(s), the API ${owned}`;
      return null;
    },

    async signIn() {
      const tenants = context.store.readJson("tenants.json");
      const owner = tenants["qa-w"]?.members?.owner;
      if (!owner) return "tenants.json has no QA-W owner";
      const session = await fetchImpl(`${context.status.apiUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: context.status.publishableKey, "content-type": "application/json" },
        body: JSON.stringify({ email: owner.email, password: owner.password }),
      });
      if (!session.ok) return `sign-in answered ${session.status}`;
      const { access_token: token } = await session.json();
      const alg = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).alg;
      if (alg !== "ES256") return `local auth signs ${alg}, and the API accepts ES256 only`;
      const me = await fetchImpl(`${api()}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
      return me.status === 200 ? null : `GET /v1/me answered ${me.status}`;
    },

    async guard() {
      const body = await guard();
      if (body?.ok !== true) return "the guard does not report ok";
      if (body.balance_above_floor === false) return "the Telnyx balance is below the floor";
      if (body.balance_above_floor !== true) return "the guard does not report the balance floor";
      context.published.room = body.room ?? null;
      return null;
    },

    async uplink() {
      const state = readJsonFile(join(context.layout.state, "uplink.json"));
      if (state === null) return "rigd has not published state/uplink.json";
      if (state.connected !== true) return "rigd reports the edge uplink down";
      return fresh(state.at, 120_000) ? null : "rigd's uplink report is stale";
    },

    /**
     * "The nonprod apps point at the edge" is one of the guard's own start-up
     * checks, run against the live resources with the key only it holds;
     * the rig-api caller may not read those resources itself.
     */
    async nonprodApps() {
      const safety = (await guard())?.telnyx?.safety;
      if (!safety || typeof safety.state !== "string") return "the guard's /health does not report its start-up checks";
      if (safety.state !== "ok") {
        return `the guard's start-up checks say ${safety.state}: ${(safety.reasons ?? []).join(", ") || "no reason given"}`;
      }
      return fresh(safety.checked_at, GUARD_SAFETY_MAX_AGE_MS) ? null : "the guard's start-up checks have not run for over six hours";
    },

    async stripeListener() {
      if (context.settings.systemd) {
        const active = systemctl(["is-active", "loonext-rig-stripe-listen.service"], { allowFailure: true });
        if (active.stdout.trim() !== "active") return "the stripe listen service is not active";
      }
      const printed = run("stripe", ["listen", "--print-secret"], {
        env: { STRIPE_API_KEY: stripeSandboxKey(context.store) },
        allowFailure: true,
      });
      if (printed.status !== 0) return "stripe listen --print-secret failed";
      return printed.stdout.trim() === devVars().STRIPE_WEBHOOK_SECRET
        ? null
        : "the listener's signing secret differs from the API's STRIPE_WEBHOOK_SECRET";
    },

    async crons() {
      const config = parseJsonc(readFileSync(join(context.deployed.worktree, "apps", "api", "wrangler.jsonc"), "utf8"));
      const { unclassified } = classifyCrons(config.triggers?.crons ?? [], context.cronRegistry ?? readCronRegistry());
      return unclassified.length === 0
        ? null
        : `${unclassified.length} cron(s) tools/rig/crons.json does not classify, so nothing says what firing them should do: ${unclassified.join(" | ")}`;
    },

    async deployHold() {
      const hold = readDeployHold(context.layout.state);
      if (hold === null) return null;
      const path = deployHoldPath(context.layout.state);
      if (hold.unreadable) return `${path} is there but unreadable, and runs are refused while it is; deploy again`;
      if (fresh(hold.at, DEPLOY_HOLD_MAX_AGE_MS)) return null;
      return (
        `${path} has held the services stopped since ${hold.at}: the deploy of ${short(hold.sha)} ` +
        "stopped them for a schema change and did not finish, and runs are refused until a deploy succeeds"
      );
    },

    async tz() {
      const rows = psql(context.projectId, tzProbeSql(TZ_PROBE_ZONES, tzProbeInstants())).split("\n");
      const mismatches = tzMismatches(rows);
      context.published.node_tz = process.versions.tz ?? null;
      if (mismatches.length === 0) return null;
      const first = mismatches[0];
      return `Node (tz ${process.versions.tz}) and Postgres disagree at ${mismatches.length} probe(s), first ${first.zone} ${first.at}: ${first.node} vs ${first.postgres} minutes`;
    },

    async sentry() {
      const state = readJsonFile(join(context.layout.state, "sentry-relay.json"));
      if (state === null) return "the relay has not published state/sentry-relay.json";
      if (!fresh(state.at, 30 * 60_000)) return "the relay's report is stale";
      return sentryFailure(state);
    },

    /** hostd on the Windows host answers through its tunnel, with the store's token. */
    async hostd() {
      const token = context.store.read("hostd-token").trim();
      let response;
      try {
        response = await fetchImpl(`http://127.0.0.1:${HOSTD_PORT}/v1/health`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        return `hostd did not answer through 127.0.0.1:${HOSTD_PORT} (${error instanceof Error ? error.name : "error"}); is the tunnel up?`;
      }
      if (response.status !== 200) return `hostd's /v1/health answered ${response.status}`;
      const body = await response.json().catch(() => null);
      return body !== null && typeof body === "object" ? null : "hostd's /v1/health answered with something that is not JSON";
    },

    /** The rig's adb server on the host, through the tunnel; without it every device check fails. */
    async adbTunnel() {
      return (await portAnswers("127.0.0.1", ADB_VM_PORT, 2_000)) ? null : `no adb server answers on 127.0.0.1:${ADB_VM_PORT}, the tunnel to the host's adb server`;
    },

    /** The VM's firewall table, which keeps the rig off private ranges and the host's other ports. */
    async nftables() {
      const listed = runImpl("sudo", ["-n", "nft", "list", "table", "inet", "loonext_rig"], { allowFailure: true });
      if (listed.status === 0) return null;
      const why = (listed.stderr ?? "").trim().split("\n").at(-1) || `exit ${listed.status}`;
      return `nft list table inet loonext_rig failed: ${why}`;
    },
  };
}

/**
 * Runs the checks and writes state/health.json. With `context.unavailable`
 * set (no deploy, the stack down, a broken rig.json), every check that needs
 * the deploy fails with that reason, the deploy-free ones still run when the
 * store opened, and the report is still written, so a down rig never reads as
 * its last green report.
 */
export async function runHealth(context, only) {
  context.published = { serving: {} };
  const checks = healthChecks(context);
  const results = [];
  for (const [name, check] of Object.entries(checks)) {
    if (only && !only.includes(name)) continue;
    let reason;
    if (context.unavailable && !(context.store && DEPLOY_FREE_CHECKS.has(name))) reason = context.unavailable;
    else {
      try {
        reason = await check();
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }
    results.push({ name, pass: reason === null, ...(reason === null ? {} : { reason }) });
  }
  const report = { at: new Date().toISOString(), sha: context.deployed?.sha ?? null, results, ...context.published };
  mkdirSync(context.layout.state, { recursive: true });
  writeFileSync(join(context.layout.state, "health.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
