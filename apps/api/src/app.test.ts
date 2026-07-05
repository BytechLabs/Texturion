import { describe, expect, it } from "vitest";

import { getEnv, type Bindings } from "./env";
import { app } from "./index";
import { completeEnv as sharedCompleteEnv } from "./test/support";

// Test-only route to drive the onError hook. Registered at module scope
// because Hono freezes its route matcher on the first request.
app.get("/__test__/boom", () => {
  throw new Error("secret internal detail");
});

/**
 * A complete set of bindings, as `wrangler dev` would supply from .dev.vars.
 * Sourced from the shared test helper so this suite stays in lockstep with
 * the env schema (which grows as tracks add bindings); spread into a fresh
 * mutable object because these tests delete/blank individual keys.
 */
function completeEnv(): Bindings {
  return { ...sharedCompleteEnv() };
}

describe("env validation", () => {
  it("accepts a complete set of bindings", () => {
    const bindings = completeEnv();
    const env = getEnv(bindings);
    expect(env.SUPABASE_URL).toBe(bindings.SUPABASE_URL);
    expect(env.APP_ORIGIN).toBe("https://app.loonext.app");
  });

  it("rejects a missing key and names it in the error", () => {
    const bindings = completeEnv();
    delete bindings.TELNYX_API_KEY;
    expect(() => getEnv(bindings)).toThrowError(/TELNYX_API_KEY/);
  });

  it("rejects an empty value and names the key in the error", () => {
    const bindings = completeEnv();
    bindings.STRIPE_WEBHOOK_SECRET = "";
    expect(() => getEnv(bindings)).toThrowError(/STRIPE_WEBHOOK_SECRET/);
  });

  it("validates once per bindings object (memoized per isolate)", () => {
    const bindings = completeEnv();
    expect(getEnv(bindings)).toBe(getEnv(bindings));
  });
});

describe("GET /health", () => {
  it("returns 200 { ok: true } with a fully configured environment", async () => {
    const res = await app.request("/health", {}, completeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("error envelope (SPEC §7)", () => {
  it("returns { error: { code, message } } with code not_found for unknown routes", async () => {
    const res = await app.request("/nope", {}, completeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No such route." },
    });
  });

  it("keeps the envelope shape for unhandled exceptions (500 internal_error, no internals leaked)", async () => {
    const res = await app.request("/__test__/boom", {}, completeEnv());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "internal_error", message: "Something went wrong." },
    });
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});
