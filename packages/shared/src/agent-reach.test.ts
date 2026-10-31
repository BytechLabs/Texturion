import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * These pin how `scripts/ops/audit-agent-reach.mjs` tiers a credential, that
 * it never prints a value, and that it fails only when FA1 has been chosen
 * (docs/RIG.md's 2026-10-30 amendment made FA1 optional).
 *
 * Secret-shaped fixtures are assembled at run time from readable stems.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "ops", "audit-agent-reach.mjs");

type Finding = { source: string; name: string; commented: boolean; tier: string; reason: string };
type Sources = { environment: number; settings: number; envFiles: number; loonext: number; variables: number };
const reach = (await import(join(REPO, "scripts", "ops", "audit-agent-reach.mjs"))) as {
  classify: (
    name: string,
    value: string,
    options?: { commented?: boolean; context?: Record<string, string> },
  ) => { tier: string; reason: string };
  parseEnvText: (text: string) => { name: string; value: string; commented: boolean }[];
  auditEntries: (source: string, entries: { name: string; value: string; commented: boolean }[]) => Finding[];
  verdict: (
    result: { findings: Finding[]; sources: Sources },
    options: { report: boolean; fa1: { chosen: boolean; where: string | null } },
  ) => { exit: number; why: string };
  fa1Chosen: (options: { env: Record<string, string | undefined>; home: string }) => {
    chosen: boolean;
    where: string | null;
  };
};

const live = {
  stripe: ["sk", "live", "readablestemforthistest"].join("_"),
  stripeTest: ["sk", "test", "readablestemforthistest"].join("_"),
  telnyx: `KEY${"ABCDEF".repeat(5)}_readablestem`,
  supabase: ["sb", "secret", "readable-stem-for-this-test"].join("_"),
  platform: ["sbp", "readablestemforthistest"].join("_"),
  diagPassword: "stem-password-for-a-test",
};
const diagUrl = (host: string) =>
  `postgresql://agent_diag.projectrefstem:${live.diagPassword}@${host}:5432/postgres`;

const tierOf = (name: string, value: string, options = {}) => reach.classify(name, value, options).tier;

describe("a value that names itself decides its tier", () => {
  it.each([
    ["STRIPE_SECRET_KEY", live.stripe, "production-write"],
    ["STRIPE_SECRET_KEY", live.stripeTest, "nonprod"],
    ["TELNYX_API_KEY", live.telnyx, "production-write"],
    ["ANYTHING_TOKEN", live.platform, "production-write"],
    ["AGENT_DIAG_DATABASE_URL", diagUrl("aws-0-us-east-1.pooler.supabase.com"), "production-read"],
    ["DATABASE_URL", "postgresql://postgres.ref:" + live.diagPassword + "@aws-0-us-east-1.pooler.supabase.com/postgres", "production-write"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "nonprod"],
  ])("%s = %s is %s", (name, value, tier) => {
    expect(tierOf(name, value)).toBe(tier);
  });

  it("places a Supabase secret key by the URL beside it", () => {
    expect(tierOf("SUPABASE_SECRET_KEY", live.supabase, { context: { SUPABASE_URL: "http://127.0.0.1:54321" } })).toBe("nonprod");
    expect(tierOf("SUPABASE_SECRET_KEY", live.supabase, { context: { SUPABASE_URL: "https://projectrefstem.supabase.co" } })).toBe("production-write");
    expect(tierOf("SUPABASE_SECRET_KEY", live.supabase)).toBe("production-write");
  });

  it("holds a Telnyx key to production even under an innocent name", () => {
    expect(tierOf("SOME_SETTING_KEY", live.telnyx)).toBe("production-write");
  });
});

describe("otherwise the name decides", () => {
  it.each([
    ["CLOUDFLARE_API_TOKEN", "readablestemforthistest", "production-write"],
    ["SUPABASE_DB_PASSWORD", "readablestemforthistest", "production-write"],
    ["SUPABASE_ACCESS_TOKEN", "readablestemforthistest", "production-write"],
    ["TELNYX_API_KEY", "guard-caller-token-stem", "nonprod"],
    ["TELNYX_PUBLIC_KEY", "readablestemforthistest", "none"],
    ["SENTRY_DSN", "https://stem@o0.ingest.sentry.io/1", "none"],
    ["AHREFS_API_KEY", "readablestemforthistest", "nonprod"],
    ["SOMETHING_NEW_SECRET", "readablestemforthistest", "unclassified"],
  ])("%s is %s", (name, value, tier) => {
    expect(tierOf(name, value)).toBe(tier);
  });

  it.each(["", "...", "xxxxxxxx", "<your key>", "${SECRET}", "changeme"])("treats %j as no credential", (value) => {
    expect(tierOf("STRIPE_SECRET_KEY", value)).toBe("none");
  });

  it("takes a commented .dev.vars line to be production's when the name cannot tell", () => {
    expect(tierOf("VAPID_PRIVATE_KEY", "readablestemforthistest")).toBe("nonprod");
    expect(tierOf("VAPID_PRIVATE_KEY", "readablestemforthistest", { commented: true })).toBe("production-write");
    expect(tierOf("SOMETHING_NEW_SECRET", "readablestemforthistest", { commented: true })).toBe("production-write");
  });
});

describe("reading an env file", () => {
  it("reads commented, exported, quoted and CRLF lines", () => {
    const text = `# STRIPE_SECRET_KEY=${live.stripe}\r\nexport A_TOKEN="quoted value"\r\nB_KEY=plain # trailing note\r\nnot a line\r\n`;
    expect(reach.parseEnvText(text)).toEqual([
      { name: "STRIPE_SECRET_KEY", value: live.stripe, commented: true },
      { name: "A_TOKEN", value: "quoted value", commented: false },
      { name: "B_KEY", value: "plain", commented: false },
    ]);
  });

  it("lists credentials only, with the commented block placed by its own URL", () => {
    const entries = reach.parseEnvText(
      [
        "SUPABASE_URL=http://127.0.0.1:54321",
        `SUPABASE_SECRET_KEY=${live.supabase}`,
        "#SUPABASE_URL=https://projectrefstem.supabase.co",
        `#SUPABASE_SECRET_KEY=${live.supabase}`,
        "STRIPE_PRO_PRICE_ID=price_stem",
      ].join("\n"),
    );
    const found = reach.auditEntries("apps/api/.dev.vars", entries);
    expect(found.map((f) => [f.name, f.commented, f.tier])).toEqual([
      ["SUPABASE_SECRET_KEY", false, "nonprod"],
      ["SUPABASE_SECRET_KEY", true, "production-write"],
    ]);
  });
});

describe("the gate", () => {
  const result = (tiers: string[], variables = 10) => ({
    findings: tiers.map((tier) => ({ source: "environment", name: "X", commented: false, tier, reason: "" })),
    sources: { environment: 1, settings: 0, envFiles: 0, loonext: 0, variables },
  });
  const noFa1 = { chosen: false, where: null };
  const fa1 = { chosen: true, where: "LOONEXT_FA1=1" };

  it("reports and passes while FA1 is not chosen, and says why", () => {
    const decision = reach.verdict(result(["production-write"]), { report: false, fa1: noFa1 });
    expect(decision.exit).toBe(0);
    expect(decision.why).toMatch(/FA1 is not chosen.*amendment/);
  });

  it("fails a production-write credential once FA1 is chosen", () => {
    expect(reach.verdict(result(["production-write"]), { report: false, fa1 }).exit).toBe(1);
    expect(reach.verdict(result(["production-read", "nonprod"]), { report: false, fa1 }).exit).toBe(0);
  });

  it("passes in report mode whatever it finds", () => {
    expect(reach.verdict(result(["production-write"]), { report: true, fa1 }).exit).toBe(0);
  });

  it("fails when it read nothing, since a blind audit passes", () => {
    expect(reach.verdict(result([], 0), { report: false, fa1: noFa1 }).exit).toBe(1);
  });

  it("reads FA1 from the environment or from ~/.loonext/hardening.json, and nowhere else", () => {
    const home = mkdtempSync(join(tmpdir(), "agent-reach-home-"));
    try {
      expect(reach.fa1Chosen({ env: {}, home }).chosen).toBe(false);
      expect(reach.fa1Chosen({ env: { LOONEXT_FA1: "true" }, home }).chosen).toBe(false);
      expect(reach.fa1Chosen({ env: { LOONEXT_FA1: "1" }, home }).chosen).toBe(true);
      mkdirSync(join(home, ".loonext"));
      writeFileSync(join(home, ".loonext", "hardening.json"), JSON.stringify({ fa1: true }));
      expect(reach.fa1Chosen({ env: {}, home })).toEqual({ chosen: true, where: "~/.loonext/hardening.json" });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("run for real", () => {
  let scratch: string | null = null;
  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  function machine() {
    scratch = mkdtempSync(join(tmpdir(), "agent-reach-"));
    const home = join(scratch, "home");
    const root = join(scratch, "clone");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".loonext"), { recursive: true });
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ env: { CLOUDFLARE_API_TOKEN: "readablestemforthistest" } }));
    writeFileSync(join(home, ".loonext", "agent-diag.env"), `AGENT_DIAG_DATABASE_URL=${diagUrl("aws-0-us-east-1.pooler.supabase.com")}\n`);
    spawnSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), ".dev.vars\n");
    writeFileSync(join(root, "apps", "api", ".dev.vars"), `LOCAL_DEV=1\n# TELNYX_API_KEY=${live.telnyx}\n`);
    return { home, root };
  }

  const run = (home: string, root: string, extra: Record<string, string>, ...args: string[]) => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      HOME: home,
      USERPROFILE: home,
      STRIPE_SECRET_KEY: live.stripe,
      ...extra,
    };
    const result = spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { env, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  const VALUES = [live.stripe, live.telnyx, live.diagPassword, "readablestemforthistest"];

  it("names every source's credentials and tiers, and prints no value", { timeout: 60_000 }, () => {
    const { home, root } = machine();
    const { status, output } = run(home, root, {}, "--report");
    expect(status).toBe(0);
    expect(output).toContain("environment: STRIPE_SECRET_KEY  - a live Stripe key");
    expect(output).toContain("~/.claude/settings.json env: CLOUDFLARE_API_TOKEN");
    expect(output).toMatch(/apps\/api\/\.dev\.vars \(commented\): TELNYX_API_KEY {2}- a Telnyx key/);
    expect(output).toContain("~/.loonext/agent-diag.env: AGENT_DIAG_DATABASE_URL  - the agent_diag login");
    expect(output).toMatch(/production-write \(3\)/);
    expect(output).toMatch(/production-read \(1\)/);
    expect(output).toContain("Not checked:");
    for (const value of VALUES) expect(output).not.toContain(value);
  });

  it("passes without FA1 and fails with it", { timeout: 60_000 }, () => {
    const { home, root } = machine();
    const without = run(home, root, {});
    expect(without.status).toBe(0);
    expect(without.output).toMatch(/PASS: FA1 is not chosen/);
    const chosen = run(home, root, { LOONEXT_FA1: "1" });
    expect(chosen.status).toBe(1);
    expect(chosen.output).toMatch(/FAIL: FA1 is chosen \(LOONEXT_FA1=1\) and 3 production-write/);
    for (const value of VALUES) expect(chosen.output).not.toContain(value);
  });
});
