import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appJwt, installationToken } from "./github-app.ts";
import { triageMethods } from "./rpc-methods.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const APP = { appId: "123456", privateKey, repo: "BytechLabs/Texturion" };

interface Call {
  method: string;
  url: string;
  auth?: string;
  body?: unknown;
}

function github() {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization") ?? undefined;
    calls.push({ method, url, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.endsWith("/repos/BytechLabs/Texturion/installation")) return ok({ id: 77 });
    if (url.endsWith("/app/installations/77/access_tokens")) return ok({ token: "ghs_installation_token" }, 201);
    return ok({});
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("the GitHub App", () => {
  it("signs a short-lived RS256 JWT that the App's public key verifies", () => {
    const now = Date.UTC(2026, 9, 31, 12);
    const jwt = appJwt("123456", privateKey, now);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString()) as { iat: number; exp: number; iss: string };
    expect(claims.iss).toBe("123456");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("mints an installation token scoped to the one repository and the permissions asked for", async () => {
    const { fetch, calls } = github();
    expect(await installationToken(APP, { fetch, permissions: { actions: "read" } })).toBe("ghs_installation_token");
    expect(calls[0]!.auth).toMatch(/^Bearer ey/);
    expect(calls[1]).toMatchObject({ method: "POST", body: { repositories: ["Texturion"], permissions: { actions: "read" } } });
  });
});

describe("the triage rpc methods", () => {
  const unresolved = [{ scenario: "S02", fingerprint: ["synthetic", "S02", "no_ring_within_6s"] }];

  function methods() {
    const runs: string[] = [];
    const handlers = triageMethods({
      unresolved: () => unresolved,
      run: async (scenario) => {
        runs.push(scenario);
        return { started: true, scenario, run_id: `${scenario}-20261031050000-abc123` };
      },
      evidence: (runId) => ({ verdicts: [{ run_id: runId }], evidence: [] }),
    });
    return { handlers, runs };
  }

  it("lists unresolved failures", async () => {
    const { handlers } = methods();
    expect(await handlers["triage.unresolved"]!({})).toEqual(unresolved);
  });

  it("re-runs only what the rig itself reports as unresolved", async () => {
    const { handlers, runs } = methods();
    await expect(handlers["triage.rerun"]!({ scenario: "S01" })).rejects.toThrow(/no unresolved failure/);
    expect(await handlers["triage.rerun"]!({ scenario: "S02" })).toEqual({ started: true, scenario: "S02", run_id: "S02-20261031050000-abc123" });
    expect(runs).toEqual(["S02"]);
  });

  it("validates evidence ids", async () => {
    const { handlers } = methods();
    await expect(handlers["triage.evidence"]!({ run_id: "../../etc" })).rejects.toThrow(/run_id/);
    expect(await handlers["triage.evidence"]!({ run_id: "S02-20261031-abc" })).toMatchObject({ verdicts: [{ run_id: "S02-20261031-abc" }] });
  });
});
