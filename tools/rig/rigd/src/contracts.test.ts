/**
 * rigd against its neighbours' contracts: the `rig` CLI's layout and store
 * (tools/rig/src), the edge's /ctl paths (tools/edge/src/ctl.ts) and the
 * seed's tenants (scripts/rig/seed.mjs).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDGE_PATHS } from "@loonext/rig-protocol";
import { numberBook, SecretFiles } from "@loonext/rig-robot";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { AppProbe, splitMember, stableUuid } from "./app-probe.ts";
import { edgeOriginOf, loadConfig, readDeployedSha, readRoom } from "./config.ts";
import { explainedFingerprints } from "./daemon.ts";
import { RpcRouter } from "./rpc.ts";
import { BUNDLE_KEY_SECRET, deliverSecrets } from "./secrets.ts";
import { parseDsn, SentryRelay } from "./sentry-relay.ts";
import { fakeFetch, json } from "./test-support.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function rigHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigd-home-"));
  dirs.push(dir);
  mkdirSync(join(dir, "secrets"), { recursive: true });
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "secrets", "edge-origin"), "https://rig-edge.example.workers.dev\n");
  return dir;
}

describe("config from $RIG_HOME", () => {
  it("reads the edge origin from the store and the API's loopback port from rig.json", () => {
    const home = rigHomeDir();
    writeFileSync(join(home, "rig.json"), JSON.stringify({ apiPort: 8787, sentryRelayOrigin: "http://127.0.0.1:8790" }));
    const config = loadConfig({ RIG_HOME: home });
    expect(config.edgeOrigin).toBe("https://rig-edge.example.workers.dev");
    expect(config.localApiBase).toBe("http://127.0.0.1:8787");
    expect(config.relayPort).toBe(8790);
    expect(() => edgeOriginOf("https://rig-edge.example.workers.dev/path")).toThrow(/bare https origin/);
    expect(edgeOriginOf("http://127.0.0.1:8899")).toBe("http://127.0.0.1:8899");
  });

  it("takes the room from rig health's report and the SHA from rig deploy's", () => {
    const home = rigHomeDir();
    const config = loadConfig({ RIG_HOME: home });
    expect(readRoom(config)).toBe(0);
    writeFileSync(join(home, "state", "health.json"), JSON.stringify({ at: "x", sha: "abc1234", results: [], room: 3 }));
    expect(readRoom(config)).toBe(3);
    expect(() => readDeployedSha(config)).toThrow(/run rig deploy/);
    writeFileSync(join(home, "state", "deployed.json"), JSON.stringify({ sha: "0123456789abcdef0123456789abcdef01234567", ref: "main" }));
    expect(readDeployedSha(config)).toBe("0123456789abcdef0123456789abcdef01234567");
  });
});

describe("secret delivery", () => {
  it("fetches the sealed bundle with the rig control token and writes one file per secret", async () => {
    const home = rigHomeDir();
    const store = new SecretFiles(join(home, "secrets"));
    store.write("control-token-rig", "rig-control-token");
    store.write(BUNDLE_KEY_SECRET, JSON.stringify({ kty: "OKP", crv: "X25519", x: "x", d: "d" }));
    const { fetch, requests } = fakeFetch({
      [`GET https://rig-edge.example.workers.dev${EDGE_PATHS.ctlSecrets}`]: () => json({ v: 1, ct: "sealed" }),
    });
    const opened: unknown[] = [];
    const result = await deliverSecrets({
      edgeOrigin: "https://rig-edge.example.workers.dev",
      store,
      fetch,
      open: async (jwk, bundle) => {
        opened.push({ jwk, bundle });
        return {
          sealed_at: "2026-10-31T00:00:00.000Z",
          absent: ["RIG_APP_KEY"],
          secrets: { GUARD_TOKEN_ROBOT: "robot-token", STANDING_NUMBERS_JSON: "[]", BUNDLE_PRIVATE_KEY_JSON: "{}" },
        };
      },
    });
    expect(requests[0]!.headers.authorization).toBe("Bearer rig-control-token");
    expect(opened).toEqual([{ jwk: { kty: "OKP", crv: "X25519", x: "x", d: "d" }, bundle: { v: 1, ct: "sealed" } }]);
    expect(result).toEqual({ written: ["guard-token-robot", "standing-numbers.json"], absent: ["RIG_APP_KEY"], sealed_at: "2026-10-31T00:00:00.000Z" });
    expect(store.read("guard-token-robot")).toBe("robot-token");
    // The key that opens the bundle never comes out of it.
    expect(store.readJson<{ d: string }>(BUNDLE_KEY_SECRET).d).toBe("d");
  });

  it("refuses when the edge has no bundle", async () => {
    const home = rigHomeDir();
    const store = new SecretFiles(join(home, "secrets"));
    store.write("control-token-rig", "t");
    const { fetch } = fakeFetch({ GET: () => json({ error: "bundle_absent" }, 503) });
    await expect(deliverSecrets({ edgeOrigin: "https://e.example.workers.dev", store, fetch, open: async () => ({ secrets: {} }) })).rejects.toThrow(/503/);
  });
});

describe("the rpc router at /ctl/rpc", () => {
  it("treats a frame with no caller as triage's, the only class the edge admits there", async () => {
    const router = new RpcRouter()
      .register("triage.unresolved", () => [], ["triage", "rig"])
      .register("scenario.run", () => "ran");
    expect(await router.dispatch({ t: "rpc", id: "1", method: "triage.unresolved", params: {} })).toEqual([]);
    await expect(router.dispatch({ t: "rpc", id: "2", method: "scenario.run", params: {} })).rejects.toThrow(/not open to triage/);
    await expect(router.dispatch({ t: "rpc", id: "3", method: "nope", params: {} })).rejects.toThrow(/unknown method/);
  });
});

describe("the app probe and the seed's tenants", () => {
  it("derives a number's row id as the seed does", () => {
    // Computed with scripts/rig/seed.mjs stableUuid on 2026-10-31.
    expect(stableUuid("00000000-0000-4000-8000-000000000001", "DEV-W1")).toBe("7de34ea1-d188-4bcf-ad8e-be2efe86bdfe");
  });

  it("splits scenario member keys into the seed's tenant and member", () => {
    expect(splitMember("qa-w-owner")).toEqual({ tenant: "qa-w", member: "owner" });
    expect(splitMember("qa-c-signout-member")).toEqual({ tenant: "qa-c", member: "signout-member" });
    expect(() => splitMember("owner")).toThrow(/member key/);
  });

  it("texts as a member: signs in, then composes from the tenant's number to the role's", async () => {
    const companyId = "00000000-0000-4000-8000-000000000001";
    const { fetch, requests } = fakeFetch({
      "POST http://127.0.0.1:54321/auth/v1/token": () => json({ access_token: "member-jwt", expires_in: 3600 }),
      "POST http://127.0.0.1:8787/v1/conversations": () => json({ conversation: {}, message: { id: "m-1" } }, 201),
    });
    const probe = new AppProbe({
      tenants: { "qa-w": { company_id: companyId, members: { owner: { email: "delivered+rig-qa-w-owner@resend.dev", password: "pw" } } } },
      numbers: numberBook({ "ROBOT-1": "+14165550101" }),
      apiBase: "http://127.0.0.1:8787",
      supabaseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: "service",
      anonKey: "publishable",
      edgeOrigin: "https://rig-edge.example.workers.dev",
      guardToken: "t",
      fetch,
    });
    expect(await probe.sendText({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1", body: "hello" })).toEqual({ ok: true, messageId: "m-1" });
    const send = requests[1]!;
    expect(send.headers.authorization).toBe("Bearer member-jwt");
    expect(send.headers["x-company-id"]).toBe(companyId);
    expect(JSON.parse(send.body!)).toEqual({ phone_e164: "+14165550101", phone_number_id: "7de34ea1-d188-4bcf-ad8e-be2efe86bdfe", body: "hello" });
  });
});

describe("the relay's report for rig health", () => {
  it("lists the API's fingerprints from the last day that the cron registry does not expect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rigd-relay-"));
    dirs.push(dir);
    const { fetch } = fakeFetch({ POST: () => new Response("{}") });
    const clock = new ManualClock(Date.UTC(2026, 9, 1, 5));
    const dsn = parseDsn("https://key@o1.ingest.sentry.example/102");
    const relay = new SentryRelay({ statePath: join(dir, "counters.json"), alertDsn: dsn, fetch, clock });
    const envelope = (fingerprint: string[]) =>
      new TextEncoder().encode(`{}\n{"type":"event"}\n${JSON.stringify({ fingerprint })}\n`);
    await relay.forwardEnvelope(dsn, envelope(["rig_endpoint_refused", "10dlc"]));
    await relay.forwardEnvelope(dsn, envelope(["TypeError", "calls"]));
    const explained = explainedFingerprints(
      JSON.stringify([{ cron: "0 * * * *", class: "run-expect-refusal", fingerprint: ["rig_endpoint_refused", "10dlc"] }]),
    );
    const report = relay.report(explained);
    expect(report.unexplained_24h).toEqual([JSON.stringify(["TypeError", "calls"])]);
    expect(report.day_count).toBe(2);
    clock.advance(24 * 60 * 60 * 1000);
    expect(relay.report(explained).unexplained_24h).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "counters.json"), "utf8")).apiSeen).toBeDefined();
  });

  it("reads expected fingerprints from any of the registry's shapes", () => {
    expect([...explainedFingerprints(undefined)]).toEqual([]);
    expect([...explainedFingerprints(JSON.stringify({ crons: [{ cron: "x", fingerprints: [["a", "b"]] }] }))]).toEqual(['["a","b"]']);
    expect([...explainedFingerprints(JSON.stringify({ "0 * * * *": { class: "run" } }))]).toEqual([]);
  });
});
