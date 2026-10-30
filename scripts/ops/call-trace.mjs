#!/usr/bin/env node
/**
 * D142: what production knows about one workspace's calls in a time window,
 * with no customer in it.
 *
 *   node scripts/ops/call-trace.mjs --company-hash 36e0f2739806ec8a --since 48h
 *   node scripts/ops/call-trace.mjs --company-id <uuid> --since 2026-10-29T04:00Z --until 2026-10-29T10:00Z
 *   node scripts/ops/call-trace.mjs ... --json            # the raw trace
 *   node scripts/ops/call-trace.mjs ... --print-sql       # the query; connects to nothing
 *   node scripts/ops/call-trace.mjs --replay trace.json   # format a saved trace
 *
 * For each call session and member: legs, push attempts, ring-beacon stages
 * with device state, and how far the ring got:
 *
 *   (a) no push was sent
 *   (b) the provider accepted it and the device never reported it
 *   (c) the device received it and showed no ring
 *   (d) it rang, and answering or audio is where it failed
 *
 * READS ONLY `ops_diag`, AS `agent_diag`. Those views carry hashes, codes,
 * timings and versions and nothing personal, and the login can read nothing
 * else (supabase/tests/agent_diag.test.sql). The connection string comes from
 * AGENT_DIAG_DATABASE_URL, never from a flag, and a URL for any other login is
 * refused: this script must not become the way someone reads production with
 * a stronger key.
 *
 * `--company-id` hashes the id here and sends only the hash. The hash is the
 * one in an issue: the first 16 hex characters of sha256 over the uuid's
 * lowercase text, the same as `ops_diag.ref()`.
 *
 * Needs `psql` on PATH. The password reaches it through the environment, not
 * the command line.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { fail, parseArgs } from "./lib.mjs";

const REF = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATIVE = /^(\d{1,4})([mhd])$/;
const MAX_WINDOW_MS = 35 * 24 * 60 * 60 * 1000; // what the views keep

/** The workspace hash, identical to `ops_diag.ref(uuid)`. */
export function companyRef(companyId) {
  return createHash("sha256")
    .update(companyId.toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** `48h`, `90m`, `3d`, or an ISO timestamp, as a Date. */
export function parseInstant(value, now) {
  const relative = RELATIVE.exec(value);
  if (relative) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2]];
    return new Date(now.getTime() - Number(relative[1]) * unit);
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The workspace and window a run asks about, or the reason it cannot. */
export function resolveRequest(args, now = new Date()) {
  let ref = null;
  if (typeof args["company-hash"] === "string") {
    ref = args["company-hash"].toLowerCase();
    if (!REF.test(ref)) return { error: "--company-hash must be 16 hex characters" };
  } else if (typeof args["company-id"] === "string") {
    if (!UUID.test(args["company-id"])) return { error: "--company-id must be a uuid" };
    ref = companyRef(args["company-id"]);
  } else {
    return { error: "pass --company-hash <16 hex> or --company-id <uuid>" };
  }

  const since = parseInstant(typeof args.since === "string" ? args.since : "48h", now);
  const until = typeof args.until === "string" ? parseInstant(args.until, now) : now;
  if (since === null || until === null) {
    return { error: "--since and --until take 48h, 90m, 3d or an ISO timestamp" };
  }
  if (since.getTime() >= until.getTime()) return { error: "--since must be before --until" };
  if (until.getTime() - since.getTime() > MAX_WINDOW_MS) {
    return { error: "the window is longer than the 35 days ops_diag keeps" };
  }
  return { ref, since: since.toISOString(), until: until.toISOString() };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * One statement, one JSON document. The values are inlined, so each is held
 * to the shape resolveRequest produces (a hex hash and two ISO instants) and
 * anything else throws before a statement exists.
 */
export function buildTraceSql({ ref, since, until }) {
  if (!REF.test(ref) || !ISO_INSTANT.test(since) || !ISO_INSTANT.test(until)) {
    throw new Error("buildTraceSql takes resolveRequest's output only");
  }
  const window = (column) =>
    `${column} >= '${since}'::timestamptz and ${column} < '${until}'::timestamptz`;
  const rows = (view, where, order) =>
    `(select coalesce(json_agg(v order by ${order}), '[]'::json) from ops_diag.${view} v ` +
    `where v.company_ref = '${ref}' and ${where})`;
  return [
    "select json_build_object(",
    `  'company_ref', '${ref}',`,
    `  'since', '${since}',`,
    `  'until', '${until}',`,
    `  'calls', ${rows("call_sessions", window("v.started_at"), "v.started_at")},`,
    `  'legs', ${rows("call_legs", window("v.created_at"), "v.created_at")},`,
    `  'pushes', ${rows("push_attempts", window("v.attempted_at"), "v.attempted_at")},`,
    `  'beacons', ${rows("ring_beacons", window("v.recorded_at"), "coalesce(v.occurred_at, v.recorded_at)")},`,
    `  'audience', ${rows("ring_audience_sizes", "true", "v.number_ref")}`,
    ");",
  ].join("\n");
}

const RECEIVED = new Set(["push_received", "os_reported"]);
const RANG = new Set(["ring_me_sent", "ringing_shown", "answered", "declined"]);

/**
 * How far one member's ring got, from the evidence alone. A member whose
 * device sent no beacons at all may be on an app that predates them, which is
 * why (b) and (c) then cannot be told apart and both are named.
 */
export function classifyRing({ pushes, beacons, answered }) {
  if (answered) return "answered";
  if (beacons.some((beacon) => RANG.has(beacon.stage))) return "(d) rang; answering or audio failed";
  if (beacons.some((beacon) => RECEIVED.has(beacon.stage))) return "(c) received; no ring shown";
  if (pushes.length === 0) return "(a) no push was sent";
  if (!pushes.some((push) => push.response_class === "accepted")) {
    return `(a) no push was accepted (${[...new Set(pushes.map((p) => p.response_class))].join(", ")})`;
  }
  return beacons.length === 0
    ? "(b) or (c): accepted, and the device sent no beacon (an app without beacons cannot say which)"
    : "(b) accepted; never reported received";
}

function short(ref) {
  return ref ? ref.slice(0, 8) : "-";
}

function offset(from, at) {
  if (!from || !at) return "";
  const seconds = (new Date(at).getTime() - new Date(from).getTime()) / 1000;
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}

function deviceState(beacon) {
  const parts = [
    beacon.platform,
    beacon.app_version && `app ${beacon.app_version}`,
    beacon.os,
    beacon.standby_bucket && `standby ${beacon.standby_bucket}`,
    beacon.power_save === true && "power save",
    beacon.device_idle === true && "idle",
    beacon.screen_locked === true && "locked",
  ].filter(Boolean);
  const permissions = Object.entries(beacon.permissions ?? {})
    .map(([name, state]) => `${name} ${state}`)
    .join(", ");
  return permissions ? `${parts.join(", ")} [${permissions}]` : parts.join(", ");
}

/** The trace as lines a person can read and an issue can quote. */
export function formatTrace(trace) {
  const lines = [
    `Workspace ${trace.company_ref}, ${trace.since} to ${trace.until}`,
    "",
  ];
  const bySession = (list) => {
    const map = new Map();
    for (const row of list) {
      if (!row.call_session_id) continue;
      if (!map.has(row.call_session_id)) map.set(row.call_session_id, []);
      map.get(row.call_session_id).push(row);
    }
    return map;
  };
  const legs = bySession(trace.legs);
  const pushes = bySession(trace.pushes);
  const beacons = bySession(trace.beacons);

  lines.push(`Calls: ${trace.calls.length}`);
  for (const call of trace.calls) {
    const id = call.call_session_id;
    lines.push(
      `  ${id}  ${call.direction ?? "?"}  ${call.outcome ?? call.state ?? "in flight"}  ` +
        `started ${call.started_at}` +
        (call.answered_at ? `  answered ${offset(call.started_at, call.answered_at)}` : "") +
        (call.ended_at ? `  ended ${offset(call.started_at, call.ended_at)}` : ""),
    );
    const callLegs = legs.get(id) ?? [];
    const callPushes = pushes.get(id) ?? [];
    const callBeacons = beacons.get(id) ?? [];
    const members = new Set([
      ...callLegs.map((leg) => leg.member_ref),
      ...callPushes.map((push) => push.member_ref),
      ...callBeacons.map((beacon) => beacon.member_ref),
    ]);
    if (members.size === 0) lines.push("    no legs, pushes or beacons recorded");
    for (const member of members) {
      const mine = (list) => list.filter((row) => row.member_ref === member);
      const memberLegs = mine(callLegs);
      const memberPushes = mine(callPushes);
      const memberBeacons = mine(callBeacons);
      const answered =
        call.answered_by_ref === member ||
        memberLegs.some((leg) => leg.state === "answered");
      lines.push(`    member ${short(member)}: ${classifyRing({ pushes: memberPushes, beacons: memberBeacons, answered })}`);
      for (const leg of memberLegs) {
        lines.push(`      leg ${leg.kind ?? "ring"} ${leg.state} ${offset(call.started_at, leg.created_at)}`);
      }
      for (const push of memberPushes) {
        lines.push(
          `      push ${push.purpose} ${push.channel}/${push.platform} ${push.priority} ` +
            `${push.response_class}${push.http_status ? ` ${push.http_status}` : ""} ` +
            `${push.latency_ms}ms ${offset(call.started_at, push.attempted_at)} (channel ${short(push.channel_ref)})`,
        );
      }
      for (const beacon of memberBeacons) {
        lines.push(
          `      beacon ${beacon.stage} ${offset(call.started_at, beacon.occurred_at ?? beacon.recorded_at)} ` +
            `${deviceState(beacon)} (session ${short(beacon.session_ref)})`,
        );
      }
    }
  }

  const loose = trace.pushes.filter((push) => !push.call_session_id);
  if (loose.length > 0) {
    const counts = new Map();
    for (const push of loose) {
      const key = `${push.purpose} ${push.platform} ${push.response_class}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    lines.push("", `Other pushes in the window: ${loose.length}`);
    for (const [key, count] of [...counts].sort()) lines.push(`  ${count}  ${key}`);
  }

  if (trace.audience.length > 0) {
    lines.push("", "Ring audience by number (legs one call can open):");
    for (const row of trace.audience) {
      lines.push(
        `  number ${short(row.number_ref)}: at most ${row.ring_legs_ceiling}, ` +
          `peak ${row.peak_legs_28d} in the last 28 days`,
      );
    }
  }
  return lines;
}

/**
 * Connection settings for psql, from AGENT_DIAG_DATABASE_URL. The pooler names
 * a login `agent_diag.<project>`, so either spelling is the right login and
 * anything else is refused.
 */
export function agentDiagConnection(raw) {
  if (!raw) {
    return { error: "AGENT_DIAG_DATABASE_URL is not set. It is the agent_diag login, never a flag." };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "AGENT_DIAG_DATABASE_URL is not a URL" };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { error: "AGENT_DIAG_DATABASE_URL must be a postgres:// URL" };
  }
  const user = decodeURIComponent(url.username);
  if (user !== "agent_diag" && !user.startsWith("agent_diag.")) {
    return { error: "AGENT_DIAG_DATABASE_URL must log in as agent_diag; refusing any other login" };
  }
  return {
    env: {
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: user,
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
      PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
      PGAPPNAME: "call-trace",
    },
  };
}

function runTrace(sql, connection) {
  const result = spawnSync(
    "psql",
    ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    {
      input: sql,
      encoding: "utf8",
      env: { ...process.env, ...connection.env },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) {
    fail(`could not run psql (${result.error.code ?? result.error.message}). Install the Postgres client.`);
  }
  if (result.status !== 0) {
    // psql's own error names the view or the permission, never row data.
    fail(`psql exited ${result.status}: ${(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail("psql returned something that is not the trace document");
  }
}

function main() {
  const args = parseArgs();
  let trace;
  if (typeof args.replay === "string") {
    trace = JSON.parse(readFileSync(args.replay, "utf8"));
  } else {
    const request = resolveRequest(args);
    if (request.error) fail(request.error);
    const sql = buildTraceSql(request);
    if (args["print-sql"]) {
      console.log(sql);
      return;
    }
    const connection = agentDiagConnection(process.env.AGENT_DIAG_DATABASE_URL);
    if (connection.error) fail(connection.error);
    trace = runTrace(sql, connection);
  }
  if (args.json) {
    console.log(JSON.stringify(trace, null, 2));
    return;
  }
  console.log(formatTrace(trace).join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
