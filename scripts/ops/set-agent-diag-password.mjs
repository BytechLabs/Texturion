#!/usr/bin/env node
/**
 * D142 FA13: give agent_diag a new random password and leave the login where
 * call-trace.mjs looks for it. An agent runs this; nobody sees the password.
 *
 *   node scripts/ops/set-agent-diag-password.mjs --target production --dry-run
 *   node scripts/ops/set-agent-diag-password.mjs --target production --check
 *   node scripts/ops/set-agent-diag-password.mjs --target production
 *   node scripts/ops/set-agent-diag-password.mjs --target local [--db-port 54322] [--out <file>]
 *
 * WHAT IT DOES. Generates 256 random bits, computes their SCRAM-SHA-256
 * verifier here, and sends only the verifier: the database stores exactly
 * that, so the password itself never leaves this process, not even into a
 * server log. Then writes AGENT_DIAG_DATABASE_URL (the pooler login
 * `agent_diag.<project ref>`) to ~/.loonext/agent-diag.env, readable by this
 * user only. Running it again rotates the password. The new file is written
 * aside first and moved into place only once the database has taken the
 * verifier, so a refused or failed change leaves the previous login and its
 * file as they were.
 *
 * WHERE THE ADMIN LOGIN COMES FROM. Production: SUPABASE_PROJECT_REF and
 * SUPABASE_DB_PASSWORD from the environment, or from apps/api/.dev.vars
 * (this checkout's, then the main worktree's), the same source
 * prod-dump-scale.mjs reads; the session pooler host is SUPABASE_POOLER_HOST
 * or the one prod-dump-scale uses. Local: the stack's published postgres
 * login on 127.0.0.1. Nothing it reads is printed.
 *
 * WHAT IT REFUSES. A database where agent_diag is not yet hardened: it must
 * exist, log in, hold no TEMP, and carry the role's timeouts (migration
 * 20261031100000). And a production database where agent_diag can reach
 * pg_net, which a migration cannot close on Supabase; on the local stack,
 * which installs pg_net, that is a warning.
 *
 * --dry-run connects to nothing and writes nothing. --check runs the same
 * refusals read-only and changes nothing.
 *
 * NOT IN CI. ops.yml has no password action: the password is born where it
 * is used, and a runner would add a copy of it, a ciphertext in a public
 * repository's artifacts and a key pair to manage, while protecting nothing
 * an agent holding this machine's keys could not already reach.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { agentDiagEnvFile, DEFAULT_PSQL_CONTAINER, runPsql } from "./call-trace.mjs";
import { fail, parseArgs } from "./lib.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com";
const PROJECT_REF = /^[a-z0-9]{8,40}$/;
const ITERATIONS = 4096;

/** The client, stored and server keys RFC 5802 derives from a password; RFC 7677 has the SHA-256 vector. */
export function scramKeys(password, salt, iterations = ITERATIONS) {
  const salted = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  return {
    clientKey,
    storedKey: createHash("sha256").update(clientKey).digest(),
    serverKey: createHmac("sha256", salted).update("Server Key").digest(),
  };
}

/** The verifier PostgreSQL stores for a SCRAM-SHA-256 password, in its own format. */
export function scramVerifier(password, salt = randomBytes(16), iterations = ITERATIONS) {
  const { storedKey, serverKey } = scramKeys(password, salt, iterations);
  return (
    `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}` +
    `$${storedKey.toString("base64")}:${serverKey.toString("base64")}`
  );
}

/** 256 random bits in URL-safe characters, which SASLprep leaves unchanged. */
export function newPassword() {
  return randomBytes(32).toString("base64url");
}

/** `KEY=value` from a .dev.vars text, commented lines included, or null. */
export function devVar(text, key) {
  const match = new RegExp(`^#?\\s*${key}=(.*)$`, "m").exec(text);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") || null : null;
}

function devVarsCandidates(root) {
  const candidates = [join(root, "apps", "api", ".dev.vars")];
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const main = /^worktree (.+)$/m.exec(out);
    if (main) candidates.push(join(main[1].trim(), "apps", "api", ".dev.vars"));
  } catch {
    // Not a git checkout: this one's own file is the only candidate.
  }
  return [...new Set(candidates)];
}

/** The local stack's database port, from supabase/config.toml's [db] block. */
export function localDbPort(root = REPO_ROOT) {
  try {
    const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
    const block = /^\[db\]\s*$([\s\S]*?)(?=^\[)/m.exec(config);
    const port = block && /^port\s*=\s*(\d+)/m.exec(block[1]);
    if (port) return Number(port[1]);
  } catch {
    // Fall through to the CLI's default.
  }
  return 54322;
}

/**
 * The admin connection and the agent_diag login it will hand out, for one
 * target. Values stay inside the returned object; nothing here prints them.
 */
export function resolveTarget(target, { env = process.env, root = REPO_ROOT, dbPort } = {}) {
  if (target === "local") {
    const port = dbPort ?? localDbPort(root);
    return {
      label: `the local stack on 127.0.0.1:${port}`,
      production: false,
      admin: {
        PGHOST: "127.0.0.1",
        PGPORT: String(port),
        PGUSER: "postgres",
        PGPASSWORD: "postgres",
        PGDATABASE: "postgres",
        PGSSLMODE: "disable",
        PGAPPNAME: "set-agent-diag-password",
      },
      login: (password) =>
        `postgresql://agent_diag:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres?sslmode=disable`,
    };
  }
  if (target !== "production") return { error: "--target must be production or local" };

  let ref = env.SUPABASE_PROJECT_REF?.trim() || null;
  let password = env.SUPABASE_DB_PASSWORD?.trim() || null;
  let source = ref && password ? "the environment" : null;
  if (!source) {
    for (const path of devVarsCandidates(root)) {
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      ref = ref || devVar(text, "SUPABASE_PROJECT_REF");
      password = password || devVar(text, "SUPABASE_DB_PASSWORD");
      if (ref && password) {
        source = "apps/api/.dev.vars";
        break;
      }
    }
  }
  if (!ref || !password) {
    return {
      error:
        "SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD were not found in the environment or in " +
        "apps/api/.dev.vars. They are the CLI-only production credentials; never pass them as flags.",
    };
  }
  if (!PROJECT_REF.test(ref)) return { error: "SUPABASE_PROJECT_REF is not shaped like a project ref" };
  const host = env.SUPABASE_POOLER_HOST?.trim() || DEFAULT_POOLER_HOST;
  return {
    label: `production through ${host} (admin login read from ${source})`,
    production: true,
    admin: {
      PGHOST: host,
      PGPORT: "5432",
      PGUSER: `postgres.${ref}`,
      PGPASSWORD: password,
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
      PGAPPNAME: "set-agent-diag-password",
    },
    login: (secret) =>
      `postgresql://agent_diag.${ref}:${encodeURIComponent(secret)}@${host}:5432/postgres?sslmode=require`,
    secrets: [password, ref],
  };
}

/**
 * The refusals, as one DO block. Each failure raises with the reason, so the
 * last ERROR line psql prints is the whole explanation.
 */
export function preconditionSql({ production }) {
  return `do $$
declare
  v_db     text := pg_catalog.current_database();
  v_config text[];
  v_name   text;
  v_net    boolean := false;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'agent_diag') then
    raise exception 'REFUSED: there is no agent_diag role here; apply the migrations first';
  end if;
  if not (select rolcanlogin from pg_catalog.pg_roles where rolname = 'agent_diag') then
    raise exception 'REFUSED: agent_diag cannot log in here, so a password would do nothing';
  end if;
  if pg_catalog.has_database_privilege('agent_diag', v_db, 'TEMP') then
    raise exception 'REFUSED: agent_diag can still create temporary objects; migration 20261031100000 is not live here';
  end if;
  select s.setconfig into v_config from pg_catalog.pg_db_role_setting s
   where s.setrole = 'agent_diag'::regrole and s.setdatabase = 0;
  foreach v_name in array array['statement_timeout', 'idle_in_transaction_session_timeout',
                                'transaction_timeout', 'default_transaction_read_only'] loop
    if not exists (select 1 from unnest(coalesce(v_config, '{}')) c where split_part(c, '=', 1) = v_name) then
      raise exception 'REFUSED: agent_diag has no % setting; migration 20261031100000 is not live here', v_name;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    select pg_catalog.has_schema_privilege('agent_diag', 'net', 'USAGE')
       and (exists (select 1 from pg_catalog.pg_proc p
                     where p.pronamespace = 'net'::regnamespace
                       and pg_catalog.has_function_privilege('agent_diag', p.oid, 'EXECUTE'))
            or exists (select 1 from pg_catalog.pg_class c
                        where c.relnamespace = 'net'::regnamespace and c.relkind = 'r'
                          and pg_catalog.has_table_privilege('agent_diag', c.oid, 'INSERT')))
      into v_net;
  end if;
  if v_net then
    ${
      production
        ? "raise exception 'REFUSED: agent_diag can reach pg_net here, which would let it send HTTP requests from the database; this database must not give it a login';"
        : "raise warning 'agent_diag can reach pg_net on this local stack; refused for production, allowed here';"
    }
  end if;
  raise notice 'preconditions hold';
end $$;
`;
}

/** The whole statement: refusals, then the verifier, in one transaction. */
export function rotationSql({ production, verifier }) {
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
    throw new Error("rotationSql takes a SCRAM-SHA-256 verifier and nothing else");
  }
  return `begin;\n${preconditionSql({ production })}alter role agent_diag password '${verifier}';\ncommit;\n`;
}

function scrub(text, secrets) {
  let out = text ?? "";
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}

function lastError(stderr) {
  const lines = stderr.trim().split(/\r?\n/);
  const error = [...lines].reverse().find((line) => /ERROR:/.test(line));
  return (error ?? lines.slice(-2).join(" | ")).replace(/^.*?ERROR:\s*/, "");
}

/** Owner-only where the OS has a notion of it: mode 0600, and on Windows an ACL for this user alone. */
function restrict(path) {
  chmodSync(path, 0o600);
  if (process.platform !== "win32") return true;
  const user = process.env.USERNAME;
  if (!user) return false;
  const who = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
  const result = spawnSync("icacls", [path, "/inheritance:r", "/grant:r", `${who}:F`], { encoding: "utf8" });
  return result.status === 0;
}

function main() {
  const args = parseArgs();
  const dryRun = args["dry-run"] === true;
  const check = args.check === true;
  const container = typeof args["psql-container"] === "string" ? args["psql-container"] : DEFAULT_PSQL_CONTAINER;
  const dbPort = typeof args["db-port"] === "string" ? Number(args["db-port"]) : undefined;
  if (dbPort !== undefined && !(Number.isInteger(dbPort) && dbPort > 0 && dbPort < 65536)) {
    fail("--db-port takes a port number");
  }

  const target = resolveTarget(typeof args.target === "string" ? args.target : "", { dbPort });
  if (target.error) fail(target.error);

  const home = homedir();
  const out = resolve(
    typeof args.out === "string"
      ? args.out
      : target.production
        ? agentDiagEnvFile(home)
        : join(home, ".loonext", "agent-diag.local.env"),
  );

  console.log("");
  console.log(`  target : ${target.label}`);
  console.log(`  login  : agent_diag${target.production ? ".<project ref>" : ""}, written to ${out}`);
  console.log(`  mode   : ${dryRun ? "dry run: connects to nothing, writes nothing" : check ? "check: read-only, changes nothing" : "ROTATE: sets a new password"}`);
  console.log("");

  if (dryRun) {
    console.log("  Would: refuse unless agent_diag exists, logs in, holds no TEMP and carries its timeouts;");
    console.log(`  refuse ${target.production ? "" : "(warn, on the local stack) "}if agent_diag can reach pg_net;`);
    console.log("  send only a SCRAM-SHA-256 verifier of 256 random bits; write the login, readable by you only.\n");
    return;
  }

  // The local stack's admin password is published, so only production's are hidden.
  const secrets = target.secrets ?? [];
  if (check) {
    const result = runPsql(`begin read only;\n${preconditionSql(target)}rollback;\n`, target.admin, { container });
    if (result.error) fail(`could not run psql (${result.error.code ?? result.error.message})`);
    for (const line of scrub(result.stderr, secrets).split(/\r?\n/)) {
      if (/WARNING:/.test(line)) console.log(`  ! ${line.replace(/^.*?WARNING:\s*/, "")}`);
    }
    if (result.status !== 0) fail(scrub(lastError(result.stderr ?? ""), secrets));
    console.log("  Preconditions hold. Nothing was changed.\n");
    return;
  }

  const password = newPassword();
  const verifier = scramVerifier(password);
  const pending = `${out}.pending-${process.pid}`;
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  writeFileSync(
    pending,
    "# Written by scripts/ops/set-agent-diag-password.mjs. Rotate by running it again.\n" +
      `AGENT_DIAG_DATABASE_URL=${target.login(password)}\n`,
    { mode: 0o600 },
  );
  const restricted = restrict(pending);

  const result = runPsql(rotationSql({ production: target.production, verifier }), target.admin, { container });
  const hidden = [...secrets, password, verifier];
  if (result.error || result.status !== 0) {
    rmSync(pending, { force: true });
    if (result.error) fail(`could not run psql (${result.error.code ?? result.error.message})`);
    fail(`${scrub(lastError(result.stderr ?? ""), hidden)}\n  The password was not changed and nothing was written.`);
  }
  for (const line of scrub(result.stderr, hidden).split(/\r?\n/)) {
    if (/WARNING:/.test(line)) console.log(`  ! ${line.replace(/^.*?WARNING:\s*/, "")}`);
  }
  renameSync(pending, out);

  console.log(`  agent_diag has a new password on ${target.production ? "production" : "the local stack"}.`);
  console.log(`  The login is in ${out}${restricted ? ", readable by you only" : "; its permissions could NOT be narrowed, so restrict it by hand"}.`);
  console.log("  call-trace.mjs reads it from there when AGENT_DIAG_DATABASE_URL is unset.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
