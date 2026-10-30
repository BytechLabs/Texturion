/**
 * D142: scripts/ops/call-trace.mjs, run for real.
 *
 * Three promises are checked, because each is what makes it safe to hand to
 * an agent with no approval step: it reads only `ops_diag`, it logs in only as
 * `agent_diag` and takes the credential only from the environment, and its
 * workspace hash is the one `ops_diag.ref()` computes (pinned to the same
 * vector as supabase/tests/agent_diag.test.sql AD-6).
 *
 * Nothing here connects to a database: `--print-sql` and `--replay` are the
 * two modes that never do, and the refusals all happen before a connection.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error — a plain .mjs with no types, which is what CI executes.
import { buildTraceSql, resolveRequest } from "../../../../scripts/ops/call-trace.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "ops", "call-trace.mjs");

/** The vector AD-6 pins on the SQL side. */
const COMPANY_ID = "d1a90000-0000-4000-8000-000000000001";
const COMPANY_REF = "36e0f2739806ec8a";

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, AGENT_DIAG_DATABASE_URL: undefined, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

let scratch: string | null = null;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe("call-trace.mjs", () => {
  it("hashes a workspace id exactly as ops_diag.ref() does, and sends only the hash", () => {
    const { status, stdout } = run(["--company-id", COMPANY_ID.toUpperCase(), "--print-sql"]);
    expect(status).toBe(0);
    expect(stdout).toContain(`'${COMPANY_REF}'`);
    expect(stdout.toLowerCase()).not.toContain(COMPANY_ID);
  });

  it("reads ops_diag and nothing else", () => {
    const { status, stdout } = run(["--company-hash", COMPANY_REF, "--since", "48h", "--print-sql"]);
    expect(status).toBe(0);
    const relations = [...stdout.matchAll(/\bfrom\s+([a-z_]+)\.([a-z_]+)/g)].map(
      (match) => `${match[1]}.${match[2]}`,
    );
    expect(relations.length, "the query was found and read").toBeGreaterThanOrEqual(5);
    expect(new Set(relations.map((relation) => relation.split(".")[0]))).toEqual(
      new Set(["ops_diag"]),
    );
  });

  it("builds no statement from values resolveRequest would not produce", () => {
    const request = resolveRequest({ "company-hash": COMPANY_REF, since: "48h" });
    if ("error" in request) throw new Error(request.error);
    expect(buildTraceSql(request)).toContain(`'${COMPANY_REF}'`);
    for (const forged of [
      { ...request, ref: "x' or true --" },
      { ...request, since: "2026-10-01'; select 1; --" },
      { ...request, until: "now()" },
    ]) {
      expect(() => buildTraceSql(forged)).toThrowError(/resolveRequest/);
    }
  });

  it("refuses to run without the agent_diag login in the environment", () => {
    const missing = run(["--company-hash", COMPANY_REF]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("AGENT_DIAG_DATABASE_URL");
  });

  it.each([
    "postgres://postgres:secret@db.example.invalid:5432/postgres",
    "postgres://postgres.abcdefgh:secret@pooler.example.invalid:5432/postgres",
    "postgres://service_role:secret@db.example.invalid:5432/postgres",
  ])("refuses a stronger login: %s", (url) => {
    const refused = run(["--company-hash", COMPANY_REF], { AGENT_DIAG_DATABASE_URL: url });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("must log in as agent_diag");
    expect(refused.stderr).not.toContain("secret");
  });

  it.each([
    [["--company-hash", "36e0f27398"], "16 hex"],
    [["--company-hash", "'; drop table x;--"], "16 hex"],
    [["--company-id", "not-a-uuid"], "uuid"],
    [["--company-hash", COMPANY_REF, "--since", "90d"], "35 days"],
    [["--company-hash", COMPANY_REF, "--since", "1h", "--until", "2h"], "before"],
    [[], "--company-hash"],
  ])("refuses %j", (args, reason) => {
    const refused = run([...args, "--print-sql"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(reason);
  });

  it("names the stage each member's ring reached", () => {
    scratch = mkdtempSync(join(tmpdir(), "call-trace-"));
    const trace = join(scratch, "trace.json");
    const started = "2026-10-29T05:00:00.000Z";
    const at = (seconds: number) => new Date(Date.parse(started) + seconds * 1000).toISOString();
    writeFileSync(
      trace,
      JSON.stringify({
        company_ref: COMPANY_REF,
        since: "2026-10-28T05:00:00.000Z",
        until: "2026-10-30T05:00:00.000Z",
        calls: [
          { call_session_id: "v3:s1", direction: "inbound", outcome: "missed", started_at: started, ended_at: at(45), answered_by_ref: null },
        ],
        legs: [{ call_session_id: "v3:s1", member_ref: "aaaa111122223333", kind: "ring", state: "failed", created_at: at(1) }],
        pushes: [
          { call_session_id: "v3:s1", member_ref: "aaaa111122223333", channel_ref: "c1c1c1c1c1c1c1c1", purpose: "ring", channel: "fcm", platform: "android", priority: "high", response_class: "accepted", http_status: 200, latency_ms: 140, attempted_at: at(1) },
          { call_session_id: "v3:s1", member_ref: "bbbb111122223333", channel_ref: "c2c2c2c2c2c2c2c2", purpose: "ring", channel: "fcm", platform: "android", priority: "high", response_class: "accepted", http_status: 200, latency_ms: 150, attempted_at: at(1) },
          { call_session_id: "v3:s1", member_ref: "dddd111122223333", channel_ref: "c3c3c3c3c3c3c3c3", purpose: "ring", channel: "webpush", platform: "web", priority: "high", response_class: "gone", http_status: 410, latency_ms: 90, attempted_at: at(1) },
          { call_session_id: null, member_ref: "aaaa111122223333", channel_ref: "c1c1c1c1c1c1c1c1", purpose: "alert", channel: "fcm", platform: "android", priority: "normal", response_class: "accepted", http_status: 200, latency_ms: 120, attempted_at: at(60) },
        ],
        beacons: [
          { call_session_id: "v3:s1", member_ref: "aaaa111122223333", session_ref: "e1e1e1e1e1e1e1e1", platform: "android", stage: "push_received", occurred_at: at(2), recorded_at: at(2), app_version: "1.42.0", os: "android-15", permissions: { notifications: "granted", full_screen_intent: "denied" }, standby_bucket: "rare", power_save: true },
          { call_session_id: "v3:s1", member_ref: "cccc111122223333", session_ref: "e2e2e2e2e2e2e2e2", platform: "web", stage: "ringing_shown", occurred_at: at(3), recorded_at: at(3), app_version: null, os: "macos", permissions: {}, standby_bucket: null },
        ],
        audience: [{ number_ref: "f1f1f1f1f1f1f1f1", ring_legs_ceiling: 3, peak_legs_28d: 2 }],
      }),
    );

    const { status, stdout } = run(["--replay", trace]);
    expect(status).toBe(0);
    expect(stdout).toContain("member aaaa1111: (c) received; no ring shown");
    expect(stdout).toContain("member bbbb1111: (b) or (c)");
    expect(stdout).toContain("member cccc1111: (d) rang");
    expect(stdout).toContain("member dddd1111: (a) no push was accepted (gone)");
    expect(stdout).toContain("standby rare");
    expect(stdout).toContain("full_screen_intent denied");
    expect(stdout).toContain("Other pushes in the window: 1");
    expect(stdout).toContain("at most 3, peak 2");
  });
});
