import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.jobtext.app";

// env.ts validates at module load, so each test stubs process.env first and
// then imports a fresh copy of the module.
async function importEnv() {
  return import("./env");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public env validation (SPEC §3, §10)", () => {
  it("exposes exactly the allowed NEXT_PUBLIC_* values when all are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    const { publicEnv } = await importEnv();
    expect(publicEnv).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: VALID_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: VALID_KEY,
      NEXT_PUBLIC_API_URL: VALID_API,
    });
  });

  it("fails loudly and names the key when the Supabase URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    await expect(importEnv()).rejects.toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("fails loudly when the publishable key is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    await expect(importEnv()).rejects.toThrowError(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("rejects a Supabase URL that is not a URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);

    await expect(importEnv()).rejects.toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("fails loudly when the API origin is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);

    await expect(importEnv()).rejects.toThrowError(/NEXT_PUBLIC_API_URL/);
  });
});
