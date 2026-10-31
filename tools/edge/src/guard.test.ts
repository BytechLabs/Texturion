import { CALLER_CLASSES, HEADER } from "@loonext/rig-protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "./auth";
import type { Env } from "./env";
import { ORIGIN, TOKENS, call, edgeEnv, fakeGuard, resetEdge, type FakeGuard } from "./test/support";

let guard: FakeGuard;
let env: Env;

beforeEach(async () => {
  await resetEdge();
  guard = fakeGuard();
  env = await edgeEnv(guard);
});

function toGuard(path: string, token: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("token to caller class", () => {
  it.each(CALLER_CLASSES)("forwards a %s token as that class", async (cls) => {
    const response = await call(toGuard("/g/health", TOKENS[cls]), env);
    expect(response.status).toBe(200);
    expect(guard.calls.at(-1)?.headers[HEADER.callerClass]).toBe(cls);
  });

  it("refuses no token, an unknown token and the control tokens, without reaching the guard", async () => {
    for (const token of [null, "edge-test-token-unknown-0123456789abcdef", TOKENS.rig, TOKENS.triage]) {
      const response = await call(toGuard("/g/health", token), env);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
    }
    expect(guard.calls).toEqual([]);
  });

  it("refuses a token whose digest is configured for two classes", async () => {
    const twice = await edgeEnv(guard, { TOKEN_SHA256_DIAG: await sha256Hex(TOKENS.admin) });
    expect((await call(toGuard("/g/health", TOKENS.admin), twice)).status).toBe(401);
    expect((await call(toGuard("/g/health", TOKENS.diag), twice)).status).toBe(401);
  });

  it("turns a class off when its digest is unset or malformed", async () => {
    const off = await edgeEnv(guard, { TOKEN_SHA256_ROBOT: undefined, TOKEN_SHA256_DIAG: "not-a-digest" });
    expect((await call(toGuard("/g/health", TOKENS.robot), off)).status).toBe(401);
    expect((await call(toGuard("/g/health", TOKENS.diag), off)).status).toBe(401);
  });
});

describe("forwarding", () => {
  it("removes /g, keeps the query and body, and drops the bearer token and cookies", async () => {
    const request = toGuard("/g/telnyx/v2/calls?filter=1", TOKENS["rig-api"], {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "a=b" },
      body: JSON.stringify({ to: "x" }),
    });
    expect((await call(request, env)).status).toBe(200);
    const forwarded = guard.calls.at(-1);
    expect(forwarded).toMatchObject({ method: "POST", path: "/telnyx/v2/calls?filter=1", body: '{"to":"x"}' });
    expect(forwarded?.headers.authorization).toBeUndefined();
    expect(forwarded?.headers.cookie).toBeUndefined();
    expect(forwarded?.headers["content-type"]).toBe("application/json");
  });

  it("strips every inbound x-rig-* header but the caller's lease and scenario, and sets the class", async () => {
    const request = toGuard("/g/telnyx/v2/calls", TOKENS.robot, {
      method: "POST",
      headers: {
        [HEADER.callerClass]: "admin",
        [HEADER.refusedBy]: "guard",
        "x-rig-anything": "1",
        "X-Rig-Caller": "admin",
        [HEADER.lease]: "lease-1",
        [HEADER.scenario]: "S02",
      },
      body: "{}",
    });
    await call(request, env);
    const headers = guard.calls.at(-1)?.headers ?? {};
    expect(headers[HEADER.callerClass]).toBe("robot");
    expect(headers[HEADER.refusedBy]).toBeUndefined();
    expect(headers["x-rig-anything"]).toBeUndefined();
    expect(headers[HEADER.lease]).toBe("lease-1");
    expect(headers[HEADER.scenario]).toBe("S02");
  });

  it("maps /g alone to the guard's root", async () => {
    await call(toGuard("/g", TOKENS.diag), env);
    expect(guard.calls.at(-1)?.path).toBe("/");
    expect((await call(toGuard("/gx/health", TOKENS.diag), env)).status).toBe(404);
  });

  it("refuses the edge-only routes to every caller", async () => {
    for (const path of ["/g/legs", "/g/reject", "/g/detach", "/g/halt", "/g/legs/extra", "/g//legs", "/g/LEGS", "/g/%6Cegs", "/g/%E0"]) {
      const response = await call(toGuard(path, TOKENS.admin, { method: "POST", body: "{}" }), env);
      expect(response.status).toBe(403);
      expect(response.headers.get(HEADER.refusedBy)).toBe("edge");
      expect(await response.json()).toEqual({ error: "guard_refused", rule: "route.edge_only" });
    }
    expect(guard.calls).toEqual([]);
  });

  it("returns the guard's answer without cookies or a renderable type", async () => {
    guard.respond = () =>
      new Response("<html>hi</html>", {
        status: 418,
        headers: { "content-type": "text/html", "set-cookie": "s=1", [HEADER.refusedBy]: "guard" },
      });
    const response = await call(toGuard("/g/telnyx/v2/x", TOKENS.diag), env);
    expect(response.status).toBe(418);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get(HEADER.refusedBy)).toBe("guard");
  });
});
