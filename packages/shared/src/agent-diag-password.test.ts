import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * These pin what `scripts/ops/set-agent-diag-password.mjs` sends and refuses:
 * only a SCRAM-SHA-256 verifier ever reaches the database, the statement
 * takes nothing else, the admin login is read and never printed, and a dry
 * run touches nothing.
 *
 * Nothing here connects to a database. The rotation itself was run against a
 * local stack, and the precondition refusals were each proven there by
 * planting their hazard; the SQL is pinned below so that proof stays true.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "ops", "set-agent-diag-password.mjs");

type Target = {
  error?: string;
  label: string;
  production: boolean;
  admin: Record<string, string>;
  login: (password: string) => string;
};
const tool = (await import(join(REPO, "scripts", "ops", "set-agent-diag-password.mjs"))) as {
  scramKeys: (password: string, salt: Buffer, iterations?: number) => {
    clientKey: Buffer;
    storedKey: Buffer;
    serverKey: Buffer;
  };
  scramVerifier: (password: string, salt?: Buffer, iterations?: number) => string;
  newPassword: () => string;
  devVar: (text: string, key: string) => string | null;
  resolveTarget: (
    target: string,
    options?: { env?: Record<string, string | undefined>; root?: string; dbPort?: number },
  ) => Target;
  preconditionSql: (options: { production: boolean }) => string;
  rotationSql: (options: { production: boolean; verifier: string }) => string;
};

describe("the verifier", () => {
  // RFC 7677's published exchange: user "user", password "pencil". The two
  // expected values are split so a secret scanner does not read them as keys.
  const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
  const clientProof = ["dHzbZapWIk4jUhN+", "Ute9ytag9zjfMHgs", "qmmiz7AndVQ="].join("");
  const serverSignature = ["6rriTRBi23WpRR/w", "tup+mMhUZUn/dB5n", "LTJRsjl95G4="].join("");
  const clientFirstBare = "n=user,r=rOprNGfwEbeRWgbNEkqO";
  const serverFirst = "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
  const clientFinalBare = "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalBare}`;

  it("derives the keys RFC 7677's exchange proves", () => {
    const { clientKey, storedKey, serverKey } = tool.scramKeys("pencil", salt, 4096);
    expect(createHash("sha256").update(clientKey).digest().equals(storedKey)).toBe(true);
    const signature = createHmac("sha256", storedKey).update(authMessage).digest();
    const proof = Buffer.from(clientKey.map((byte, i) => byte ^ signature[i]));
    expect(proof.toString("base64")).toBe(clientProof);
    expect(createHmac("sha256", serverKey).update(authMessage).digest("base64")).toBe(serverSignature);
  });

  it("is written in PostgreSQL's stored format", () => {
    const verifier = tool.scramVerifier("pencil", salt, 4096);
    const { storedKey, serverKey } = tool.scramKeys("pencil", salt, 4096);
    expect(verifier).toBe(
      `SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$${storedKey.toString("base64")}:${serverKey.toString("base64")}`,
    );
    expect(verifier).not.toContain("pencil");
  });

  it("salts every verifier freshly", () => {
    expect(tool.scramVerifier("pencil")).not.toBe(tool.scramVerifier("pencil"));
  });

  it("makes 256-bit passwords in characters SASLprep leaves alone", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => tool.newPassword()));
    expect(passwords.size).toBe(20);
    for (const password of passwords) expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("the statement", () => {
  const verifier = tool.scramVerifier("pencil");

  it("sets the verifier after the refusals, in one transaction", () => {
    const sql = tool.rotationSql({ production: true, verifier });
    expect(sql.startsWith("begin;\n")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql.indexOf("REFUSED")).toBeLessThan(sql.indexOf("alter role agent_diag password"));
    expect(sql).toContain(`alter role agent_diag password '${verifier}';`);
  });

  it.each([
    ["a plaintext password", "pencil"],
    ["a quote", `${verifier}'; alter role postgres password 'x`],
    ["an md5 hash", "md5" + "0".repeat(32)],
  ])("takes nothing but a verifier: refuses %s", (_label, value) => {
    expect(() => tool.rotationSql({ production: true, verifier: value })).toThrowError(/verifier/);
  });

  it("refuses production where agent_diag reaches pg_net, and only warns locally", () => {
    expect(tool.preconditionSql({ production: true })).toMatch(/raise exception 'REFUSED: agent_diag can reach pg_net/);
    expect(tool.preconditionSql({ production: false })).toMatch(/raise warning 'agent_diag can reach pg_net/);
  });

  it("refuses an agent_diag that is not hardened", () => {
    const sql = tool.preconditionSql({ production: true });
    for (const refusal of [
      "there is no agent_diag role",
      "agent_diag cannot log in",
      "can still create temporary objects",
      "has no % setting",
    ]) {
      expect(sql).toContain(refusal);
    }
    for (const setting of ["statement_timeout", "idle_in_transaction_session_timeout", "transaction_timeout", "default_transaction_read_only"]) {
      expect(sql).toContain(`'${setting}'`);
    }
  });
});

describe("where the admin login comes from", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  const ref = "projectrefstemabcdef";
  const dbPassword = "stem-db-password-for-a-test";

  it("reads a commented .dev.vars line", () => {
    expect(tool.devVar(`LOCAL_DEV=1\n#SUPABASE_DB_PASSWORD="${dbPassword}"\n`, "SUPABASE_DB_PASSWORD")).toBe(dbPassword);
    expect(tool.devVar("LOCAL_DEV=1\n", "SUPABASE_DB_PASSWORD")).toBeNull();
  });

  it("builds production's logins from the environment", () => {
    const target = tool.resolveTarget("production", {
      env: { SUPABASE_PROJECT_REF: ref, SUPABASE_DB_PASSWORD: dbPassword },
    });
    expect(target.error).toBeUndefined();
    expect(target.production).toBe(true);
    expect(target.admin.PGUSER).toBe(`postgres.${ref}`);
    expect(target.admin.PGSSLMODE).toBe("require");
    const login = new URL(target.login("generated"));
    expect(decodeURIComponent(login.username)).toBe(`agent_diag.${ref}`);
    expect(login.password).toBe("generated");
    expect(login.port).toBe("5432");
    expect(target.label).not.toContain(ref);
    expect(target.label).not.toContain(dbPassword);
  });

  it("refuses without the credentials, or with a ref that is not one", () => {
    root = mkdtempSync(join(tmpdir(), "agent-diag-password-"));
    expect(tool.resolveTarget("production", { env: {}, root }).error).toMatch(/SUPABASE_PROJECT_REF/);
    expect(
      tool.resolveTarget("production", { env: { SUPABASE_PROJECT_REF: "x'; drop", SUPABASE_DB_PASSWORD: dbPassword }, root }).error,
    ).toMatch(/project ref/);
    expect(tool.resolveTarget("staging", { env: {} }).error).toMatch(/production or local/);
  });

  it("finds them in a checkout's .dev.vars", () => {
    root = mkdtempSync(join(tmpdir(), "agent-diag-password-"));
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(
      join(root, "apps", "api", ".dev.vars"),
      `SUPABASE_URL=http://127.0.0.1:54321\n#SUPABASE_PROJECT_REF=${ref}\n#SUPABASE_DB_PASSWORD=${dbPassword}\n`,
    );
    const target = tool.resolveTarget("production", { env: {}, root });
    expect(target.admin.PGPASSWORD).toBe(dbPassword);
    expect(target.label).toContain("apps/api/.dev.vars");
  });

  it("points the local target at the stack's own port", () => {
    root = mkdtempSync(join(tmpdir(), "agent-diag-password-"));
    mkdirSync(join(root, "supabase"));
    writeFileSync(join(root, "supabase", "config.toml"), '[api]\nport = 1\n\n[db]\nport = 57322\n\n[studio]\nport = 2\n');
    const target = tool.resolveTarget("local", { root });
    expect(target.production).toBe(false);
    expect(target.admin.PGPORT).toBe("57322");
    expect(new URL(target.login("generated")).host).toBe("127.0.0.1:57322");
  });
});

describe("run for real", () => {
  let scratch: string | null = null;
  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  it("a dry run connects to nothing, writes nothing and prints no credential", { timeout: 60_000 }, () => {
    scratch = mkdtempSync(join(tmpdir(), "agent-diag-password-"));
    const out = join(scratch, "agent-diag.env");
    const env = {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      HOME: scratch,
      USERPROFILE: scratch,
      SUPABASE_PROJECT_REF: "projectrefstemabcdef",
      SUPABASE_DB_PASSWORD: "stem-db-password-for-a-test",
    };
    const result = spawnSync(process.execPath, [SCRIPT, "--target", "production", "--dry-run", "--out", out], {
      env,
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(output).toContain("dry run: connects to nothing, writes nothing");
    expect(output).toContain("agent_diag.<project ref>");
    expect(output).not.toContain("projectrefstemabcdef");
    expect(output).not.toContain("stem-db-password-for-a-test");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses to run without a target", { timeout: 60_000 }, () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--dry-run"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--target must be production or local");
  });
});
