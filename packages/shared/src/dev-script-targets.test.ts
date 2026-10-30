import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The dev scripts that write fixtures or rewrite a billing catalog, refusing a
 * production target before they send anything. An operator's shell can export
 * the production Supabase pair and the live Stripe key, and each of these
 * scripts falls back to that environment.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { isLocalUrl, localSupabaseUrl, LOCAL_SUPABASE_URL } = (await import(
  join(REPO, "scripts", "local-supabase.mjs")
)) as {
  isLocalUrl: (url: string) => boolean;
  localSupabaseUrl: (env: Record<string, string | undefined>) => string;
  LOCAL_SUPABASE_URL: string;
};

const REMOTE_PROJECT = "remote-project-ref";
const REMOTE_URL = `https://${REMOTE_PROJECT}.supabase.co`;

/** Shaped like a live key, but not a credential and not one a scanner matches. */
const FAKE_LIVE_KEY = "sk_live_not-a-real-key-only-a-test";

function envWithoutCredentials(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "STRIPE_SECRET_KEY"]) {
    delete env[name];
  }
  return { ...env, ...extra };
}

function run(script: string, env: Record<string, string>, args: string[] = []) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", join(REPO, script), ...args],
    { cwd: REPO, env: envWithoutCredentials(env), encoding: "utf8", timeout: 20_000 },
  );
}

describe("isLocalUrl", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://[::1]:54321",
    "http://host.docker.internal:54321",
    "http://api.loonext.localhost:54321",
  ])("accepts %s", (url) => {
    expect(isLocalUrl(url)).toBe(true);
  });

  it.each([
    REMOTE_URL,
    "https://127.0.0.1.example.com",
    "https://localhost.example.com",
    "not a url",
    "",
  ])("refuses %j", (url) => {
    expect(isLocalUrl(url)).toBe(false);
  });
});

describe("localSupabaseUrl", () => {
  it("defaults to the local stack when nothing is exported", () => {
    expect(localSupabaseUrl({})).toBe(LOCAL_SUPABASE_URL);
  });

  it("refuses a remote SUPABASE_URL without naming the host", () => {
    expect(() => localSupabaseUrl({ SUPABASE_URL: REMOTE_URL })).toThrow(
      /points at a remote host/,
    );
    try {
      localSupabaseUrl({ SUPABASE_URL: REMOTE_URL });
    } catch (error) {
      expect(String(error)).not.toContain(REMOTE_PROJECT);
    }
  });
});

describe.each(["scripts/dev-seed.ts", "scripts/dev-activate-number.ts"])(
  "%s",
  (script) => {
    it("refuses a production SUPABASE_URL before any request", () => {
      const result = run(script, {
        SUPABASE_URL: REMOTE_URL,
        SUPABASE_SECRET_KEY: "not-a-real-secret",
      });
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain("points at a remote host");
      expect(result.stderr).not.toContain(REMOTE_PROJECT);
    });
  },
);

describe("apps/api/scripts/stripe-setup.ts", () => {
  it("refuses a live key unless --live is passed, before contacting Stripe", () => {
    const result = run("apps/api/scripts/stripe-setup.ts", {
      STRIPE_SECRET_KEY: FAKE_LIVE_KEY,
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("is a LIVE key");
  });
});
