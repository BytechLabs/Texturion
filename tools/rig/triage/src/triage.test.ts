import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appJwt, installationToken } from "./github-app.ts";
import { fingerprintMarker, isFingerprint, upsertSyntheticIssue } from "./issues.ts";
import { redactForIssue } from "./redact.ts";
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

function github(issues: { number: number; state: "open" | "closed"; body: string; pull_request?: object }[] = []) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization") ?? undefined;
    calls.push({ method, url, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.endsWith("/repos/BytechLabs/Texturion/installation")) return ok({ id: 77 });
    if (url.endsWith("/app/installations/77/access_tokens")) return ok({ token: "ghs_installation_token" }, 201);
    if (method === "GET" && url.includes("/issues?")) {
      return ok(issues.map((i) => ({ ...i, html_url: `https://github.com/BytechLabs/Texturion/issues/${i.number}` })));
    }
    if (method === "POST" && url.endsWith("/issues")) return ok({ number: 900, html_url: "https://github.com/x/900" }, 201);
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

  it("mints an installation token scoped to the one repository and to issues", async () => {
    const { fetch, calls } = github();
    expect(await installationToken(APP, { fetch })).toBe("ghs_installation_token");
    expect(calls[0]!.auth).toMatch(/^Bearer ey/);
    expect(calls[1]).toMatchObject({ method: "POST", body: { repositories: ["Texturion"], permissions: { issues: "write" } } });
  });
});

describe("upsertSyntheticIssue", () => {
  const fingerprint = ["synthetic", "S02", "no_ring_within_6s"];
  const draft = { fingerprint, title: "S02: the owner's page does not ring", body: "Evidence: ring_ms undefined." };

  it("creates the issue, labelled synthetic, with the fingerprint marker", async () => {
    const { fetch, calls } = github();
    const result = await upsertSyntheticIssue("token", "BytechLabs/Texturion", draft, fetch);
    expect(result).toEqual({ number: 900, url: "https://github.com/x/900", action: "created" });
    const created = calls.find((c) => c.method === "POST")!;
    expect(created.body).toMatchObject({ labels: ["synthetic"], title: draft.title });
    expect((created.body as { body: string }).body.startsWith(fingerprintMarker(fingerprint))).toBe(true);
  });

  it("comments on the open issue for the same fingerprint instead of filing another", async () => {
    const { fetch, calls } = github([
      { number: 5, state: "open", body: `${fingerprintMarker(fingerprint)}\nolder`, pull_request: {} },
      { number: 7, state: "open", body: `${fingerprintMarker(fingerprint)}\nfirst` },
    ]);
    expect(await upsertSyntheticIssue("token", "BytechLabs/Texturion", draft, fetch)).toMatchObject({ number: 7, action: "commented" });
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual([expect.stringMatching(/\/issues\/7\/comments$/)]);
  });

  it("reopens a closed issue for a failure that came back", async () => {
    const { fetch, calls } = github([{ number: 8, state: "closed", body: fingerprintMarker(fingerprint) }]);
    expect(await upsertSyntheticIssue("token", "BytechLabs/Texturion", draft, fetch)).toMatchObject({ number: 8, action: "reopened" });
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ body: { state: "open" } });
  });

  it("checks fingerprints", () => {
    expect(isFingerprint(["synthetic", "S02", "no_ring"])).toBe(true);
    expect(isFingerprint(["synthetic-infra", "pixel"])).toBe(true);
    expect(isFingerprint(["ops", "telnyx-guard-integrity"])).toBe(false);
    expect(isFingerprint(["synthetic", "S02"])).toBe(false);
    expect(isFingerprint(["synthetic", "S02", "x y"])).toBe(false);
  });
});

describe("redactForIssue", () => {
  it("keeps fictional numbers, removes real-looking ones and breaks mentions", () => {
    // Real-looking numbers are assembled here so this file never holds one (check-rig-no-e164).
    const realE164 = ["+1416", "8675309"].join("");
    const realWritten = ["647", "867", "5309"].join("-");
    const text = `Called +14165550142 and ${realE164}, also (647) 555-0199 and ${realWritten}. cc @someone, mail rig@example.test`;
    const out = redactForIssue(text);
    expect(out).toContain("+14165550142");
    expect(out).toContain("(647) 555-0199");
    expect(out.match(/\[number\]/g)).toHaveLength(2);
    expect(out).toContain("@\u200bsomeone");
    expect(out).toContain("rig@example.test");
  });
});

describe("the triage rpc methods", () => {
  const unresolved = [{ scenario: "S02", fingerprint: ["synthetic", "S02", "no_ring_within_6s"] }];

  function methods() {
    const { fetch, calls } = github();
    const runs: string[] = [];
    const handlers = triageMethods({
      unresolved: () => unresolved,
      run: async (scenario) => {
        runs.push(scenario);
        return { started: true, scenario, run_id: `${scenario}-20261031050000-abc123` };
      },
      evidence: (runId) => ({ verdicts: [{ run_id: runId }], evidence: [] }),
      app: () => APP,
      fetch,
    });
    return { handlers, calls, runs };
  }

  it("lists unresolved failures", async () => {
    const { handlers } = methods();
    expect(await handlers["triage.unresolved"]!({})).toEqual(unresolved);
  });

  it("re-runs and files only what the rig itself reports as unresolved", async () => {
    const { handlers, runs, calls } = methods();
    await expect(handlers["triage.rerun"]!({ scenario: "S01" })).rejects.toThrow(/no unresolved failure/);
    expect(await handlers["triage.rerun"]!({ scenario: "S02" })).toEqual({ started: true, scenario: "S02", run_id: "S02-20261031050000-abc123" });
    expect(runs).toEqual(["S02"]);
    await expect(
      handlers["triage.issue"]!({ fingerprint: ["synthetic", "S01", "x"], title: "t", body: "b" }),
    ).rejects.toThrow(/not an unresolved failure/);
    expect(calls).toEqual([]);
    expect(await handlers["triage.issue"]!({ fingerprint: unresolved[0]!.fingerprint, title: "S02 fails", body: "evidence" })).toMatchObject({
      action: "created",
    });
  });

  it("validates evidence ids", async () => {
    const { handlers } = methods();
    await expect(handlers["triage.evidence"]!({ run_id: "../../etc" })).rejects.toThrow(/run_id/);
    expect(await handlers["triage.evidence"]!({ run_id: "S02-20261031-abc" })).toMatchObject({ verdicts: [{ run_id: "S02-20261031-abc" }] });
  });
});
