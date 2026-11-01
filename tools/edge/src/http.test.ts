import { runInDurableObject } from "cloudflare:test";
import { EDGE_PATHS } from "@loonext/rig-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import { servesHost } from "./http";
import { ALERT_REPEAT_MS, sealedBundle } from "./ctl";
import { ORIGIN, TOKENS, call, edgeEnv, fakeGuard, resetEdge, uplinkStub } from "./test/support";
import { SENTRY_DAILY_MAX } from "./uplink";

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
      ["GET", EDGE_PATHS.ctlAlert],
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

describe("/ctl/alert", () => {
  const PROD_DSN = "https://prodkey@o1.ingest.sentry.io/202";
  const alert = { key: "telnyx-guard-integrity", message: "The Telnyx guard's live deployment is not one guard.yml made from main", detail: "d" };
  const post = (e: Env, body: unknown, token = TOKENS.rig) =>
    call(
      new Request(`${ORIGIN}${EDGE_PATHS.ctlAlert}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      e,
    );
  let sent: { url: string; event: Record<string, unknown> }[];
  let sentryAnswers: number;

  beforeEach(() => {
    sent = [];
    sentryAnswers = 200;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      sent.push({ url: request.url, event: JSON.parse((await request.text()).split("\n")[2]!) as Record<string, unknown> });
      return new Response("{}", { status: sentryAnswers });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a listed key to production as ['ops', key], once in six hours", async () => {
    const withDsn = { ...env, SENTRY_PROD_DSN: PROD_DSN };
    const response = await post(withDsn, alert);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://o1.ingest.sentry.io/api/202/envelope/");
    expect(sent[0]!.event).toMatchObject({
      fingerprint: ["ops", "telnyx-guard-integrity"],
      level: "error",
      environment: "production",
      message: { formatted: alert.message },
      tags: { ops_key: "telnyx-guard-integrity", raised_by: "rigd" },
      extra: { detail: "d" },
    });

    expect(await (await post(withDsn, alert)).json()).toEqual({ sent: false, reason: "repeat" });
    expect(sent).toHaveLength(1);
    await runInDurableObject(uplinkStub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'alert:rig:telnyx-guard-integrity'", String(Date.now() - ALERT_REPEAT_MS - 1));
    });
    expect(await (await post(withDsn, alert)).json()).toEqual({ sent: true });
    expect(sent).toHaveLength(2);
  });

  it("spends the edge's daily production budget, and sends nothing once it is spent", async () => {
    const withDsn = { ...env, SENTRY_PROD_DSN: PROD_DSN };
    const rig = uplinkStub();
    expect((await post(withDsn, alert)).status).toBe(200);
    for (let i = 1; i < SENTRY_DAILY_MAX.production; i++) expect(await rig.takeSentryBudget(Date.now(), "production")).toBe(true);
    expect(await rig.takeSentryBudget(Date.now(), "production")).toBe(false);

    await runInDurableObject(uplinkStub(), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM meta WHERE key LIKE 'alert:%'");
    });
    const response = await post(withDsn, alert);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "budget_spent" });
    expect(sent).toHaveLength(1);
  });

  it("answers other than 200 whenever production did not get it", async () => {
    expect((await post(env, alert)).status).toBe(503);
    const withDsn = { ...env, SENTRY_PROD_DSN: PROD_DSN };
    sentryAnswers = 429;
    expect((await post(withDsn, alert)).status).toBe(502);
    // A refused send is not tried again inside the hour.
    sentryAnswers = 200;
    expect(await (await post(withDsn, alert)).json()).toEqual({ error: "retry_later" });
    expect(sent).toHaveLength(1);
  });

  it("takes the rig's token and the protocol's keys only", async () => {
    const withDsn = { ...env, SENTRY_PROD_DSN: PROD_DSN };
    for (const token of [TOKENS.triage, TOKENS.admin, TOKENS["rig-api"], "nope"]) expect((await post(withDsn, alert, token)).status).toBe(401);
    expect((await post(withDsn, { ...alert, key: "synthetic-dark" })).status).toBe(400);
    expect((await post(withDsn, { ...alert, message: "" })).status).toBe(400);
    expect((await post(withDsn, { ...alert, detail: "x".repeat(2_001) })).status).toBe(400);
    expect(sent).toEqual([]);
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
