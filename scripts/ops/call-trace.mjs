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
 *   node scripts/ops/call-trace.mjs --self-check          # is the login still safe
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
 * AGENT_DIAG_DATABASE_URL, or failing that from the same name in
 * ~/.loonext/agent-diag.env (which set-agent-diag-password.mjs writes), never
 * from a flag, and a URL for any other login is refused: this script must not
 * become the way someone reads production with a stronger key.
 *
 * `--company-id` hashes the id here and sends only the hash. The hash is the
 * one in an issue: the first 16 hex characters of sha256 over the uuid's
 * lowercase text, the same as `ops_diag.ref()`.
 *
 * EVERY SESSION CHECKS ITSELF FIRST (selfCheckSql): read-only, each timeout
 * at 60 s or less, no TEMP, no pg_net, and no relation outside ops_diag. A
 * hazard that appeared after the password was set, such as pg_net enabled
 * from the dashboard, stops the trace on production and names the way to
 * withdraw the login. `--self-check` runs only that.
 *
 * Runs `psql`: the one on PATH, or without one the client inside a Supabase
 * database container. A local login runs in the container that publishes its
 * port, against that server's network address so its password is really
 * checked; any other login runs in `--psql-container <name>` or the default
 * one. The password reaches psql through the environment, never the command
 * line, and no PG* variable this shell already carries is passed on, so
 * nothing can change the login's settings from outside.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

/** Where set-agent-diag-password.mjs leaves the login, under a home directory. */
export function agentDiagEnvFile(home = homedir()) {
  return join(home, ".loonext", "agent-diag.env");
}

/**
 * AGENT_DIAG_DATABASE_URL from the environment, else from the env file. Only
 * that one name is read from the file, so nothing else in it reaches psql.
 */
export function agentDiagUrl({ env = process.env, home = homedir() } = {}) {
  if (env.AGENT_DIAG_DATABASE_URL) return env.AGENT_DIAG_DATABASE_URL;
  const file = agentDiagEnvFile(home);
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?AGENT_DIAG_DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
    if (match) return match[1].replace(/^(["'])(.*)\1$/, "$2") || undefined;
  }
  return undefined;
}

const AGENT_DIAG_LOGIN = /^agent_diag(?:\.[a-z0-9]{1,40})?$/;

/**
 * Connection settings for psql, from AGENT_DIAG_DATABASE_URL. The pooler names
 * a login `agent_diag.<project>`, so either spelling is the right login and
 * anything else is refused.
 */
export function agentDiagConnection(raw) {
  if (!raw) {
    return {
      error:
        "AGENT_DIAG_DATABASE_URL is not set, and ~/.loonext/agent-diag.env does not carry it. " +
        "It is the agent_diag login, never a flag; set-agent-diag-password.mjs writes the file.",
    };
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
  if (!AGENT_DIAG_LOGIN.test(user)) {
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

export const DEFAULT_PSQL_CONTAINER = "supabase_db_Loonext";

/** This process's environment without any PG* variable, plus the connection's own. */
export function psqlEnv(connectionEnv, base = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (!/^PG[A-Z]/.test(name)) env[name] = value;
  }
  return { ...env, ...connectionEnv };
}

export const LOOPBACK = /^(?:127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/;

function docker(args) {
  return spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * The container publishing a loopback port, with its server's network address
 * and port. Not its loopback: the Supabase image trusts every loopback login,
 * so a wrong password would pass unnoticed.
 */
export function containerBehind(port, named) {
  const listed = docker(["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"]);
  if (listed.error || listed.status !== 0) return { error: `docker could not list the container on port ${port}` };
  const names = listed.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (named && !names.includes(named)) return { error: `${named} does not publish port ${port}` };
  if (!named && names.length !== 1) {
    return {
      error:
        names.length === 0
          ? `no running container publishes port ${port}`
          : `${names.length} containers publish port ${port}; name one with --psql-container`,
    };
  }
  const name = named ?? names[0];
  const ports = docker(["port", name]);
  const inner = (ports.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => /^(\d+)\/tcp -> .*:(\d+)$/.exec(line.trim()))
    .find((match) => match && match[2] === String(port));
  const address = docker(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", name]);
  const ip = (address.stdout ?? "").trim().split(/\s+/).find(Boolean);
  if (!inner || !ip) return { error: `could not find ${name}'s server address for port ${port}` };
  return { name, host: ip, port: inner[1] };
}

/**
 * Run psql with the statement on stdin and the connection in the environment.
 * Without a psql on PATH, a database container's client runs it, and
 * `docker exec -e NAME` copies each value from this process's environment, so
 * none of them is ever an argument. A loopback login is run in the container
 * that publishes its port, against that server; any other login uses the
 * named container, or the default one, only as a client.
 */
export function runPsql(sql, connectionEnv, { args = [], container } = {}) {
  const psqlArgs = ["-X", "-v", "ON_ERROR_STOP=1", ...args, "-f", "-"];
  const options = (connection) => ({
    input: sql,
    encoding: "utf8",
    env: psqlEnv(connection),
    maxBuffer: 64 * 1024 * 1024,
  });
  const local = spawnSync("psql", psqlArgs, options(connectionEnv));
  if (!local.error || local.error.code !== "ENOENT") return { ...local, via: "psql" };

  let name = container ?? DEFAULT_PSQL_CONTAINER;
  let inside = connectionEnv;
  if (LOOPBACK.test(connectionEnv.PGHOST ?? "")) {
    const behind = containerBehind(connectionEnv.PGPORT ?? "5432", container);
    if (behind.error) return { error: new Error(behind.error), status: null, stdout: "", stderr: "", via: "docker" };
    name = behind.name;
    inside = { ...connectionEnv, PGHOST: behind.host, PGPORT: behind.port };
  }
  const names = Object.keys(inside).flatMap((variable) => ["-e", variable]);
  const result = spawnSync("docker", ["exec", "-i", ...names, name, "psql", ...psqlArgs], options(inside));
  return { ...result, via: `psql in ${name}` };
}

/**
 * Run as agent_diag before every trace: set-agent-diag-password's hazards,
 * asked of this very session, so its effective settings count wherever they
 * were set. Refuses on production, naming the way to withdraw the login;
 * warns on the local stack, which installs pg_net.
 */
export function selfCheckSql({ production }) {
  return `do $$
declare
  v_name     text;
  v_value    text;
  v_parts    text[];
  v_ms       numeric;
  v_reach    text;
  v_problems text[] := '{}';
begin
  if current_user <> 'agent_diag' then
    raise exception 'REFUSED: this session is %, not agent_diag', current_user;
  end if;
  if pg_catalog.current_setting('transaction_read_only') <> 'on' then
    v_problems := v_problems || 'its transactions are not read-only'::text;
  end if;
  foreach v_name in array array['statement_timeout', 'idle_in_transaction_session_timeout',
                                'transaction_timeout'] loop
    v_value := pg_catalog.current_setting(v_name, true);
    v_parts := pg_catalog.regexp_match(coalesce(v_value, ''), '^([0-9]+)(ms|s|min|h|d)?$');
    v_ms := v_parts[1]::numeric * case coalesce(v_parts[2], 'ms')
      when 'ms' then 1 when 's' then 1000 when 'min' then 60000 when 'h' then 3600000 when 'd' then 86400000 end;
    if v_parts is null or v_ms <= 0 or v_ms > 60000 then
      v_problems := v_problems || pg_catalog.format('%s is %s', v_name, coalesce(v_value, 'unset'));
    end if;
  end loop;
  if pg_catalog.has_database_privilege(pg_catalog.current_database(), 'TEMP') then
    v_problems := v_problems || 'it can create temporary objects'::text;
  end if;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net')
     and pg_catalog.has_schema_privilege('net', 'USAGE')
     and (exists (select 1 from pg_catalog.pg_proc p
                   where p.pronamespace = 'net'::regnamespace
                     and pg_catalog.has_function_privilege(p.oid, 'EXECUTE'))
          or exists (select 1 from pg_catalog.pg_class c
                      where c.relnamespace = 'net'::regnamespace and c.relkind = 'r'
                        and pg_catalog.has_table_privilege(c.oid, 'INSERT'))) then
    v_problems := v_problems || 'it can reach pg_net, which sends HTTP from the database'::text;
  end if;
  select pg_catalog.string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname)
    into v_reach
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'ops_diag')
     and n.nspname !~ '^pg_(toast|temp_)'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (n.nspname || '.' || c.relname) not in ('extensions.pg_stat_statements', 'extensions.pg_stat_statements_info')
     and not exists (select 1 from pg_catalog.pg_depend d
                       join pg_catalog.pg_extension e on e.oid = d.refobjid
                      where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid
                        and d.deptype = 'e' and e.extname = 'pg_net')
     and pg_catalog.has_schema_privilege(n.oid, 'USAGE')
     and pg_catalog.has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  if v_reach is not null then
    v_problems := v_problems || ('it can reach ' || v_reach);
  end if;
  if pg_catalog.cardinality(v_problems) > 0 then
    ${
      production
        ? "raise exception 'REFUSED: this agent_diag login is no longer safe: %. Withdraw it with node scripts/ops/set-agent-diag-password.mjs --target production --withdraw', pg_catalog.array_to_string(v_problems, '; ');"
        : "raise warning 'agent_diag on this local stack: %; refused for production, allowed here', pg_catalog.array_to_string(v_problems, '; ');"
    }
  end if;
end $$;
`;
}

/**
 * What one agent_diag session runs: the self-check, then the statement, so
 * the check vouches for the very session that reads. Any login that is not
 * on this machine is held to production's refusal.
 */
export function sessionSql(sql, connection) {
  return `${selfCheckSql({ production: !LOOPBACK.test(connection.env.PGHOST ?? "") })}${sql}\n`;
}

/** Runs sessionSql, prints the check's warnings, and returns psql's output and whether it warned. */
function runAsAgentDiag(sql, connection, container) {
  const result = runPsql(sessionSql(sql, connection), connection.env, {
    args: ["-q", "-A", "-t"],
    container,
  });
  if (result.error) {
    fail(
      `could not run psql (${result.error.code ?? result.error.message}). Install the Postgres ` +
        "client, or start the local Supabase stack so its container's client can be used.",
    );
  }
  let warned = false;
  for (const line of (result.stderr ?? "").split(/\r?\n/)) {
    if (!/WARNING:/.test(line)) continue;
    warned = true;
    console.error(`  ! ${line.replace(/^.*?WARNING:\s*/, "")}`);
  }
  if (result.status !== 0) {
    // psql's own error names the view, the permission or the hazard, never row data.
    fail(
      `${result.via} exited ${result.status}: ` +
        `${(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}`,
    );
  }
  return { stdout: result.stdout ?? "", warned };
}

function main() {
  const args = parseArgs();
  const container = typeof args["psql-container"] === "string" ? args["psql-container"] : undefined;
  let trace;
  if (args["self-check"] === true) {
    const connection = agentDiagConnection(agentDiagUrl());
    if (connection.error) fail(connection.error);
    const { warned } = runAsAgentDiag("select 1;", connection, container);
    console.log(
      warned
        ? "call-trace: this local agent_diag login has the hazards above; production would refuse it."
        : "call-trace: this agent_diag login is read-only, bounded, and reaches only ops_diag.",
    );
    return;
  }
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
    const connection = agentDiagConnection(agentDiagUrl());
    if (connection.error) fail(connection.error);
    const { stdout } = runAsAgentDiag(sql, connection, container);
    try {
      trace = JSON.parse(stdout.trim().split(/\r?\n/).pop());
    } catch {
      fail("psql returned something that is not the trace document");
    }
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
