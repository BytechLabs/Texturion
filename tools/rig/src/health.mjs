/**
 * `rig health`: the parts of R00 that need no phone, emulator or hub.
 * Each check passes or fails with a reason; a check that
 * cannot measure fails too, because "unknown" is not a pass. The result is
 * also written to state/health.json, with the guard's room, for rigd to
 * publish.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { run } from "./exec.mjs";
import { parseDevVars } from "./dev-vars.mjs";
import { EDGE_PATHS, GUARD_ROUTES } from "../../rig-protocol/src/index.ts";
import { edgeOrigin, guardGet } from "./guard.mjs";
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

/** The webhook paths each nonprod resource must name on the edge. */
export function expectedWebhooks(edge, partition, standing) {
  const robotProfile = standing.get("ROBOT-1")?.messaging_profile_id ?? null;
  return [
    {
      what: "nonprod-voice",
      path: `/v2/call_control_applications/${partition.connection_ids.voice}`,
      fields: { webhook_event_url: `${edge}${EDGE_PATHS.telnyxVoice}`, webhook_event_failover_url: `${edge}${EDGE_PATHS.telnyxVoiceFailover}` },
    },
    {
      what: "nonprod-robot",
      path: `/v2/call_control_applications/${partition.connection_ids.robot}`,
      fields: { webhook_event_url: `${edge}${EDGE_PATHS.telnyxRobot}` },
    },
    {
      what: "nonprod-webrtc",
      path: `/v2/credential_connections/${partition.connection_ids.webrtc}`,
      fields: { webhook_event_url: `${edge}${EDGE_PATHS.telnyxWebrtc}` },
    },
    ...partition.messaging_profile_ids.map((id) => ({
      what: `messaging profile ${id === robotProfile ? "nonprod-robot" : "of a tenant"}`,
      path: `/v2/messaging_profiles/${id}`,
      fields: { webhook_url: `${edge}${id === robotProfile ? EDGE_PATHS.telnyxRobot : EDGE_PATHS.telnyxMessaging}` },
    })),
  ];
}

function readJsonFile(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function fresh(at, maxAgeMs, now = Date.now()) {
  const time = Date.parse(at ?? "");
  return Number.isFinite(time) && now - time <= maxAgeMs;
}

/**
 * @param {{ layout, settings, store, status, projectId, deployed, partition, standing, fetch?: typeof fetch }} context
 */
export function healthChecks(context) {
  const fetchImpl = context.fetch ?? fetch;
  const api = `http://127.0.0.1:${context.settings.apiPort}`;
  const devVars = () => {
    const path = join(context.deployed.worktree, "apps", "api", ".dev.vars.rig");
    if (!existsSync(path)) throw new Error("the deployed worktree has no .dev.vars.rig");
    return parseDevVars(readFileSync(path, "utf8"));
  };

  return {
    async api() {
      const response = await fetchImpl(`${api}/health`);
      const body = await response.json().catch(() => null);
      if (response.status !== 200 || body?.ok !== true) return `the API answered ${response.status}`;
      // A healthy API with an unready database still answers /health; /v1 is
      // where the posture refusal shows.
      const probe = await fetchImpl(`${api}/v1/me`);
      if (probe.status === 503) return "the API refuses /v1: its database is not in rig posture";
      return null;
    },

    async web() {
      const response = await fetchImpl(`http://127.0.0.1:${context.settings.webPort}/login`, { redirect: "manual" });
      return response.status < 500 ? null : `the web app answered ${response.status}`;
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
      const me = await fetchImpl(`${api}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
      return me.status === 200 ? null : `GET /v1/me answered ${me.status}`;
    },

    async guard() {
      const body = await guardGet(context.store, GUARD_ROUTES.health, fetchImpl);
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

    async nonprodApps() {
      const edge = edgeOrigin(context.store);
      const wrong = [];
      for (const expected of expectedWebhooks(edge, context.partition, context.standing)) {
        const body = await guardGet(context.store, `${GUARD_ROUTES.telnyx}${expected.path}`, fetchImpl);
        for (const [field, url] of Object.entries(expected.fields)) {
          if (body?.data?.[field] !== url) wrong.push(`${expected.what} ${field}`);
        }
      }
      return wrong.length === 0 ? null : `not pointed at the edge: ${wrong.join(", ")}`;
    },

    async stripeListener() {
      if (context.settings.systemd) {
        const active = run("systemctl", ["--user", "is-active", "loonext-rig-stripe-listen.service"], { allowFailure: true });
        if (active.stdout.trim() !== "active") return "the stripe listen service is not active";
      }
      const printed = run("stripe", ["listen", "--print-secret"], {
        env: { STRIPE_API_KEY: context.store.read("stripe-secret-key") },
        allowFailure: true,
      });
      if (printed.status !== 0) return "stripe listen --print-secret failed";
      return printed.stdout.trim() === devVars().STRIPE_WEBHOOK_SECRET
        ? null
        : "the listener's signing secret differs from the API's STRIPE_WEBHOOK_SECRET";
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
      const unexplained = state.unexplained_24h ?? [];
      return unexplained.length === 0 ? null : `${unexplained.length} unexplained fingerprint(s) in 24 hours`;
    },
  };
}

export async function runHealth(context, only) {
  context.published = {};
  const checks = healthChecks(context);
  const results = [];
  for (const [name, check] of Object.entries(checks)) {
    if (only && !only.includes(name)) continue;
    let reason;
    try {
      reason = await check();
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    results.push({ name, pass: reason === null, ...(reason === null ? {} : { reason }) });
  }
  const report = { at: new Date().toISOString(), sha: context.deployed.sha, results, ...context.published };
  mkdirSync(context.layout.state, { recursive: true });
  writeFileSync(join(context.layout.state, "health.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
