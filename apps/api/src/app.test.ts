import { describe, expect, it } from "vitest";

import { getEnv, type Bindings } from "./env";
import { app, handler } from "./index";
import { completeEnv as sharedCompleteEnv } from "./test/support";

// Test-only route to drive the onError hook. Registered at module scope
// because Hono freezes its route matcher on the first request.
app.get("/__test__/boom", () => {
  throw new Error("secret internal detail");
});

// A deliberately non-Error thrown value: Hono's onError only routes `Error`
// instances, so this unwinds past it and out of `app.fetch` — the exact shape
// that becomes a header-less Cloudflare 1101 the browser mislabels as a "CORS
// error". Drives the outermost fetch guard (handler.fetch).
const nonErrorThrow: unknown = { detail: "not-an-Error-instance" };
app.get("/__test__/nonerror", () => {
  throw nonErrorThrow;
});

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

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
    expect(env.APP_ORIGIN).toBe("https://app.loonext.com");
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

describe("outermost fetch guard (escaped-onError safety net)", () => {
  it("turns a non-Error escaping onError into a CORS-readable 500 envelope with the ray as request_id", async () => {
    const env = completeEnv();
    const appOrigin = getEnv(env).APP_ORIGIN;
    const res = await handler.fetch(
      new Request("https://api.loonext.com/__test__/nonerror", {
        headers: { origin: appOrigin, "cf-ray": "ray-guard-test" },
      }),
      env,
      executionCtx,
    );
    expect(res.status).toBe(500);
    // The whole point: without this, the response ships no ACAO and the browser
    // reports a spurious "CORS error" that masks the real failure.
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(appOrigin);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "internal_error",
        message: "Something went wrong.",
        request_id: "ray-guard-test",
      },
    });
    expect(JSON.stringify(body)).not.toContain("not-an-Error-instance");
  });

  it("omits Access-Control-Allow-Origin for a disallowed origin", async () => {
    const env = completeEnv();
    const res = await handler.fetch(
      new Request("https://api.loonext.com/__test__/nonerror", {
        headers: { origin: "https://evil.example.com" },
      }),
      env,
      executionCtx,
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("passes normal responses through untouched", async () => {
    const env = completeEnv();
    const res = await handler.fetch(
      new Request("https://api.loonext.com/health"),
      env,
      executionCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
