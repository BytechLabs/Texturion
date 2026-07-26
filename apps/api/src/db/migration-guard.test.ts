/**
 * The destructive-migration guard, and the false positive that turned main red.
 *
 * `scripts/check-migrations.mjs` is the one thing standing between a
 * `drop column` and production, because CI applies migrations to an EMPTY
 * database — a destructive statement passes every test and then runs against
 * real rows.
 *
 * On 2026-07-26 it started flagging #231's audit_log migration for "truncates
 * a table". The statement it matched was:
 *
 *     revoke update, delete, truncate on public.audit_log from public, anon;
 *
 * `truncate` is a PRIVILEGE NAME as well as a statement, and that line is the
 * exact opposite of destructive — it is what makes truncating impossible. Six
 * consecutive commits went red, nothing deployed, and because a red main looks
 * the same as a busy main from inside the repo, nobody noticed for a day.
 *
 * Two properties are pinned here, and the second matters as much as the first:
 * the guard must not fire on a GRANT or REVOKE, and it must still fire on a
 * real destructive statement that happens to sit next to one. A fix for a
 * false positive that opens a hole is worse than the false positive.
 *
 * The script is checked by RUNNING it over fixtures rather than by re-stating
 * its regexes here — a test that copies the implementation only proves the copy
 * is faithful.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const REPO = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const SCRIPT = join(REPO, "scripts", "check-migrations.mjs");

/**
 * The script refuses to run when its grandfathered allowlist names a migration
 * that is absent — deliberately, because a stale allowlist stops guarding. The
 * fixture directory therefore has to contain them, inert.
 */
const GRANDFATHERED = [
  "20260704110000_hard_overage_ceiling.sql",
  "20260705010000_drop_google_review_link.sql",
  "20260712000200_delete_forwarding.sql",
];

let workspace: string | null = null;

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = null;
});

/**
 * Run the real script against a throwaway migrations directory. It resolves
 * `supabase/migrations` relative to the process cwd, so the fixture dir is
 * built at that path inside a temp root.
 */
function guard(sql: string): { ok: boolean; output: string } {
  workspace = mkdtempSync(join(tmpdir(), "migration-guard-"));
  const dir = join(workspace, "supabase", "migrations");
  mkdirSync(dir, { recursive: true });
  // The script also fails when a GRANDFATHERED entry names a file that is not
  // there — a stale allowlist quietly stops guarding things, so it is right
  // that it does. The fixture dir has to satisfy that check to reach the one
  // under test, so each grandfathered name gets an inert placeholder.
  for (const name of GRANDFATHERED) {
    writeFileSync(join(dir, name), "-- placeholder for the guard's own test\n", "utf8");
  }
  writeFileSync(join(dir, "20260101000000_fixture.sql"), sql, "utf8");
  try {
    const output = execFileSync(process.execPath, [SCRIPT], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (cause) {
    const err = cause as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("the migration guard does not fire on privilege statements", () => {
  it("passes the exact statement that turned main red", () => {
    const result = guard(
      "create table public.audit_log (id uuid primary key);\n" +
        "revoke update, delete, truncate on public.audit_log from public, anon, authenticated, service_role;\n" +
        "grant select, insert on public.audit_log to service_role;\n",
    );
    expect(result.ok).toBe(true);
  });

  it("passes a revoke split across lines", () => {
    const result = guard(
      "revoke\n  update,\n  delete,\n  truncate\n  on public.t\n  from public;\n",
    );
    expect(result.ok).toBe(true);
  });
});

describe("the migration guard still catches what it is for", () => {
  // Each of these sits NEXT TO a privilege statement, which is the shape a
  // careless fix would swallow.
  const destructive: [string, string, string][] = [
    [
      "a real truncate after a revoke",
      "revoke truncate on public.t from public;\ntruncate table public.t;\n",
      "truncates a table",
    ],
    [
      "a dropped table after a grant",
      "grant select on public.t to service_role;\ndrop table public.old_t;\n",
      "drops a table",
    ],
    [
      "an unqualified delete after a revoke",
      "revoke delete on public.t from public;\ndelete from public.t;\n",
      "deletes rows with no WHERE",
    ],
    [
      "a dropped column",
      "grant select on public.t to r;\nalter table public.t drop column secret;\n",
      "drops a column",
    ],
    [
      "a dropped policy",
      "revoke all on public.t from anon;\ndrop policy p on public.t;\n",
      "drops a security/replication object",
    ],
  ];

  it.each(destructive)("flags %s", (_name, sql, why) => {
    const result = guard(sql);
    expect(result.ok).toBe(false);
    expect(result.output).toContain(why);
  });

  it("still accepts an explicit acknowledgement", () => {
    const result = guard(
      "-- destructive-ok: the column held a feature that no longer exists.\n" +
        "alter table public.t drop column gone;\n",
    );
    expect(result.ok).toBe(true);
  });
});

describe("the guard passes over the real migrations", () => {
  it("finds nothing unacknowledged in supabase/migrations", () => {
    // The regression test proper: main was red for six commits on exactly this
    // command, and every push since had been landing on a build nobody could
    // deploy.
    const output = execFileSync(process.execPath, [SCRIPT], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(output).toContain("no unacknowledged destructive statements");
  });
});
