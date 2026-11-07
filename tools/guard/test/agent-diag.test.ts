/**
 * D142: scripts/ops/agent-diag.mjs, the login production-measurements.ts reads
 * production with.
 *
 * Two promises are checked, because each is what makes it safe to hand to an
 * agent with no approval step: it logs in only as `agent_diag`, taking the
 * credential only from the environment or the file set-agent-diag-password.mjs
 * writes, and every session it opens checks itself before it reads.
 *
 * Nothing here connects to a database: every refusal happens before a
 * connection.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  agentDiagConnection,
  agentDiagUrl,
  psqlEnv,
  selfCheckSql,
  sessionSql,
} from "../../../scripts/ops/agent-diag.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(REPO, "scripts", "ops", "agent-diag.mjs");

let home: string | null = null;
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = null;
});

/** A home directory of the test's own, so a real ~/.loonext/agent-diag.env is never read. */
function emptyHome(): string {
  home = mkdtempSync(join(tmpdir(), "agent-diag-home-"));
  return home;
}

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const dir = home ?? emptyHome();
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, AGENT_DIAG_DATABASE_URL: undefined, HOME: dir, USERPROFILE: dir, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("agent-diag.mjs", () => {
  it("refuses to check itself without the agent_diag login in the environment", () => {
    const missing = run(["--self-check"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("AGENT_DIAG_DATABASE_URL");
  });

  it.each([
    "postgres://postgres:secret@db.example.invalid:5432/postgres",
    "postgres://postgres.abcdefgh:secret@pooler.example.invalid:5432/postgres",
    "postgres://service_role:secret@db.example.invalid:5432/postgres",
  ])("refuses a stronger login: %s", (url) => {
    const refused = run(["--self-check"], { AGENT_DIAG_DATABASE_URL: url });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("must log in as agent_diag");
    expect(refused.stderr).not.toContain("secret");
  });

  it.each(["agent_diagx", "agent_diag.ref.extra", "agent_diag.REF", "agent_diag_admin", "xagent_diag"])(
    "refuses a login that only looks like agent_diag: %s",
    (user) => {
      const refused = agentDiagConnection(`postgres://${user}:secret@pooler.example.invalid:5432/postgres`);
      expect(refused.error).toMatch(/must log in as agent_diag/);
    },
  );

  it("accepts agent_diag and the pooler's agent_diag.<project> spelling", () => {
    for (const user of ["agent_diag", "agent_diag.abcdefghijklmnopqrst"]) {
      const accepted = agentDiagConnection(`postgresql://${user}:secret@pooler.example.invalid:5432/postgres`);
      expect(accepted.error).toBeUndefined();
      expect(accepted.env?.PGUSER).toBe(user);
      expect(accepted.env?.PGSSLMODE).toBe("require");
    }
  });

  it("reads the login from ~/.loonext/agent-diag.env when the environment has none", () => {
    const dir = emptyHome();
    expect(agentDiagUrl({ env: {}, home: dir })).toBeUndefined();
    mkdirSync(join(dir, ".loonext"));
    writeFileSync(
      join(dir, ".loonext", "agent-diag.env"),
      "# Written by set-agent-diag-password.mjs\r\nOTHER=1\r\nAGENT_DIAG_DATABASE_URL=postgresql://agent_diag:from-file@h.invalid/postgres\r\n",
    );
    expect(agentDiagUrl({ env: {}, home: dir })).toBe("postgresql://agent_diag:from-file@h.invalid/postgres");
    expect(
      agentDiagUrl({ env: { AGENT_DIAG_DATABASE_URL: "postgresql://agent_diag:from-env@h.invalid/postgres" }, home: dir }),
    ).toBe("postgresql://agent_diag:from-env@h.invalid/postgres");
  });

  it("holds the file's login to agent_diag too, before connecting", () => {
    const dir = emptyHome();
    mkdirSync(join(dir, ".loonext"));
    writeFileSync(
      join(dir, ".loonext", "agent-diag.env"),
      "AGENT_DIAG_DATABASE_URL=postgres://postgres:secret@db.example.invalid:5432/postgres\n",
    );
    const refused = run(["--self-check"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("must log in as agent_diag");
    expect(refused.stderr).not.toContain("secret");
  });

  it("checks every session first, strictly for any login not on this machine", () => {
    const read = "select 1;";
    const remote = agentDiagConnection("postgresql://agent_diag.abcdefgh:p@pooler.example.invalid:5432/postgres");
    const local = agentDiagConnection("postgresql://agent_diag:p@127.0.0.1:54322/postgres?sslmode=disable");
    expect(sessionSql(read, remote)).toBe(`${selfCheckSql({ production: true })}${read}\n`);
    expect(sessionSql(read, local)).toBe(`${selfCheckSql({ production: false })}${read}\n`);
  });

  it("asks the session the hazards set-agent-diag-password refuses, and names the way out", () => {
    // Each was planted on a local stack and seen to stop the check; this
    // keeps every one of them asked.
    const strict = selfCheckSql({ production: true });
    for (const asked of [
      "current_user <> 'agent_diag'",
      "current_setting('transaction_read_only')",
      "'statement_timeout', 'idle_in_transaction_session_timeout',",
      "'transaction_timeout'",
      "has_database_privilege(pg_catalog.current_database(), 'TEMP')",
      "extname = 'pg_net'",
      "has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')",
    ]) {
      expect(strict).toContain(asked);
    }
    expect(strict).toMatch(
      /raise exception 'REFUSED: this agent_diag login is no longer safe: %\. Withdraw it with node scripts\/ops\/set-agent-diag-password\.mjs --target production --withdraw'/,
    );
    expect(selfCheckSql({ production: false })).toMatch(/raise warning 'agent_diag on this local stack/);
  });

  it("passes on no PG* variable from the shell, so nothing outside can change the login's settings", () => {
    const env = psqlEnv(
      { PGHOST: "h.invalid", PGUSER: "agent_diag", PGPASSWORD: "p" },
      { PATH: "/bin", PGOPTIONS: "-c statement_timeout=0", PGSERVICEFILE: "/tmp/x", PGPASSWORD: "stale" },
    );
    expect(env).toEqual({ PATH: "/bin", PGHOST: "h.invalid", PGUSER: "agent_diag", PGPASSWORD: "p" });
  });

  it("answers anything but --self-check with its usage", () => {
    const usage = run([]);
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain("--self-check");
  });
});
