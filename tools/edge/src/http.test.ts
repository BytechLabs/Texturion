import { EDGE_PATHS } from "@loonext/rig-protocol";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "./env";
import { servesHost } from "./http";
import { sealedBundle } from "./ctl";
import { ORIGIN, TOKENS, call, edgeEnv, fakeGuard, resetEdge } from "./test/support";

let env: Env;

beforeEach(async () => {
  await resetEdge();
  env = await edgeEnv(fakeGuard());
});

function expectHardened(response: Response): void {
  expect(response.headers.get("content-security-policy")).toMatch(/^sandbox;/);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("the public surface", () => {
  it("is an empty 404 everywhere off the list, with the hardening headers", async () => {
    for (const path of ["/", "/index.html", "/t", "/t/x", "/ctl", "/ctl/other", "/health", "/favicon.ico", "/gx"]) {
      for (const method of ["GET", "POST"]) {
        const response = await call(new Request(`${ORIGIN}${path}`, { method }), env);
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(await response.text()).toBe("");
        expectHardened(response);
      }
    }
  });

  it("is an empty 404 for a listed path on the wrong method", async () => {
    for (const [method, path] of [
      ["GET", EDGE_PATHS.telnyxVoice],
      ["GET", `${EDGE_PATHS.telnyxNotificationsPrefix}x`],
      ["POST", `${EDGE_PATHS.mediaPrefix}object/sign/mms-media/a`],
      ["GET", `${EDGE_PATHS.robotWebhookPrefix}x`],
      ["POST", EDGE_PATHS.ctlUplink],
      ["GET", EDGE_PATHS.ctlRpc],
      ["POST", EDGE_PATHS.ctlSecrets],
    ]) {
      expect((await call(new Request(`${ORIGIN}${path}`, { method }), env)).status, `${method} ${path}`).toBe(404);
    }
  });

  it("hardens answers from every handler, including refusals", async () => {
    expectHardened(await call(new Request(`${ORIGIN}${EDGE_PATHS.telnyxVoice}`, { method: "POST", body: "{}" }), env));
    expectHardened(await call(new Request(`${ORIGIN}/g/health`), env));
    expectHardened(await call(new Request(`${ORIGIN}/g/health`, { headers: { authorization: `Bearer ${TOKENS.diag}` } }), env));
  });

  it("refuses to serve on any loonext.com host", async () => {
    for (const host of ["loonext.com", "app.loonext.com", "edge.loonext.com", "LOONEXT.COM."]) {
      const response = await call(new Request(`https://${host}/t/v`, { method: "POST", body: "{}" }), env);
      expect(response.status, host).toBe(421);
      expectHardened(response);
    }
    expect(servesHost("loonext-rig-edge.example.workers.dev")).toBe(true);
    expect(servesHost("localhost")).toBe(true);
    expect(servesHost("edge.example.com")).toBe(false);
  });
});

describe("/ctl/secrets", () => {
  const bundle = JSON.stringify({ v: 1, alg: "X25519-HKDF-SHA256-A256GCM", kid: "k", epk: "e", iv: "i", sealed_at: "t", ct: "c".repeat(9000) });
  const parts = (text: string, size = 4000) => {
    const out: Record<string, string> = {};
    for (let i = 0, n = 1; i < text.length; i += size, n++) out[`RIG_SECRET_BUNDLE_${n}`] = text.slice(i, i + size);
    return out;
  };
  const get = (token: string, e: Env) =>
    call(new Request(`${ORIGIN}/ctl/secrets`, { headers: { authorization: `Bearer ${token}` } }), e);

  it("serves the reassembled ciphertext to the rig token only", async () => {
    const withBundle = { ...env, ...parts(bundle), RIG_SECRET_BUNDLE_PARTS: "3" };
    const response = await get(TOKENS.rig, withBundle);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(bundle);
    expect(response.headers.get("cache-control")).toBe("no-store");
    for (const token of [TOKENS.triage, TOKENS.admin, "nope"]) {
      expect((await get(token, withBundle)).status).toBe(401);
    }
  });

  it("reads only as many parts as the count names, so a stale tail never joins", () => {
    const stale = { ...env, ...parts(bundle), RIG_SECRET_BUNDLE_4: "stale", RIG_SECRET_BUNDLE_PARTS: "3" };
    expect(sealedBundle(stale)).toBe(bundle);
    expect(sealedBundle({ ...env, ...parts(bundle), RIG_SECRET_BUNDLE_PARTS: "2" })).toBeNull();
    expect(sealedBundle({ ...env, ...parts(bundle), RIG_SECRET_BUNDLE_PARTS: "9" })).toBeNull();
  });

  it("answers 503 while no bundle is stored", async () => {
    const response = await get(TOKENS.rig, env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "bundle_absent" });
  });
});
