#!/usr/bin/env node
/**
 * D142: the agent_diag login, and the check every session it opens runs first.
 *
 *   node scripts/ops/agent-diag.mjs --self-check     # is the login still safe
 *
 * agent_diag reads `ops_diag` and nothing else (supabase/tests/agent_diag.test.sql):
 * views of calls, legs and counts that carry hashes, codes and timings and
 * nothing personal. The guard's daily measurements read production through it
 * (tools/guard/scripts/production-measurements.ts), and a person can read the
 * same views with psql once --self-check passes.
 *
 * The connection string comes from AGENT_DIAG_DATABASE_URL, or failing that
 * from the same name in ~/.loonext/agent-diag.env (which
 * set-agent-diag-password.mjs writes), never from a flag, and a URL for any
 * other login is refused: this must not become the way someone reads
 * production with a stronger key.
 *
 * EVERY SESSION CHECKS ITSELF FIRST (selfCheckSql): read-only, each timeout
 * at 60 s or less, no TEMP, no pg_net, and no relation outside ops_diag. A
 * hazard that appeared after the password was set, such as pg_net enabled
 * from the dashboard, stops the session on production and names the way to
 * withdraw the login.
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
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fail, parseArgs } from "./lib.mjs";

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
      PGAPPNAME: "agent-diag",
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
 * Run as agent_diag at the start of every session: set-agent-diag-password's
 * hazards, asked of this very session, so its effective settings count
 * wherever they were set. Refuses on production, naming the way to withdraw
 * the login; warns on the local stack, which installs pg_net.
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
  -- Nested: 'net'::regnamespace is resolved when its statement is planned, and
  -- fails on a database without pg_net however the conditions are ordered.
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    if pg_catalog.has_schema_privilege('net', 'USAGE')
       and (exists (select 1 from pg_catalog.pg_proc p
                     where p.pronamespace = 'net'::regnamespace
                       and pg_catalog.has_function_privilege(p.oid, 'EXECUTE'))
            or exists (select 1 from pg_catalog.pg_class c
                        where c.relnamespace = 'net'::regnamespace and c.relkind = 'r'
                          and pg_catalog.has_table_privilege(c.oid, 'INSERT'))) then
      v_problems := v_problems || 'it can reach pg_net, which sends HTTP from the database'::text;
    end if;
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
  if (args["self-check"] !== true) {
    fail("usage: node scripts/ops/agent-diag.mjs --self-check [--psql-container <name>]");
  }
  const container = typeof args["psql-container"] === "string" ? args["psql-container"] : undefined;
  const connection = agentDiagConnection(agentDiagUrl());
  if (connection.error) fail(connection.error);
  const { warned } = runAsAgentDiag("select 1;", connection, container);
  console.log(
    warned
      ? "agent-diag: this local agent_diag login has the hazards above; production would refuse it."
      : "agent-diag: this agent_diag login is read-only, bounded, and reaches only ops_diag.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
