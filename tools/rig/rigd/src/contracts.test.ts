/**
 * rigd against its neighbours' contracts: the `rig` CLI's layout, store and
 * standing roles (tools/rig/src), the edge's /ctl paths (tools/edge/src/ctl.ts),
 * the seed's tenants (scripts/rig/seed.mjs) and the bundle rig-secrets.yml seals.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_PATHS, STANDING_ROLES } from "@loonext/rig-protocol";
import { numberBook, SecretFiles, storeNameOf } from "@loonext/rig-robot";
import { STANDING_ROLES as CLI_STANDING_ROLES } from "../../src/guard.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { AppProbe, splitMember, stableUuid } from "./app-probe.ts";
import { edgeOriginOf, loadConfig, readDeployedSha, readRoom } from "./config.ts";
import { cronExplainer, parseMatch } from "./cron-events.ts";
import { runStarter } from "./daemon.ts";
import { WindowSource } from "./guard-window.ts";
import { RpcRouter } from "./rpc.ts";
import { BUNDLE_KEY_SECRET, deliverSecrets } from "./secrets.ts";
import { PostHogErrors, reportApiExceptions, seenException, type SeenEvent } from "./posthog-errors.ts";
import { fakeFetch, json } from "./test-support.ts";
import type { RpcFrame } from "./uplink.ts";

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
    writeFileSync(join(home, "rig.json"), JSON.stringify({ apiPort: 8787 }));
    const config = loadConfig({ RIG_HOME: home });
    expect(config.edgeOrigin).toBe("https://rig-edge.example.workers.dev");
    expect(config.localApiBase).toBe("http://127.0.0.1:8787");
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

describe("rig-secrets.yml's bundle", () => {
  const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
  /** Delivered before anything reads it. Each must still have no reader, so the entry goes when one lands. */
  const AHEAD_OF_READER: Record<string, string> = {};
  const SOURCES = ["tools/rig/src", "tools/rig/templates", "tools/rig/rigd/src", "tools/rig/robot/src", "tools/rig/lanes/src", "tools/rig/triage/src", "scripts/rig"];

  function bundleFiles(): string[] {
    const workflow = readFileSync(join(REPO, ".github", "workflows", "rig-secrets.yml"), "utf8");
    return [...workflow.matchAll(/^\s+BUNDLE__([A-Z0-9_]+):/gm)].map((match) => storeNameOf(match[1]!));
  }

  /**
   * What the rig's code and templates say, comments left out, so a file only
   * mentioned in prose is unread. A block comment opens only where one can
   * (scripts/check-deploy-env-branches.mjs), so `tools/rig/*` in a string
   * does not.
   */
  function rigCode(): string {
    const files = SOURCES.flatMap((root) =>
      (readdirSync(join(REPO, root), { recursive: true }) as string[])
        .map((name) => join(REPO, root, name))
        .filter((path) => statSync(path).isFile() && !/\.test\.(ts|mjs)$|test-support\.ts$/.test(path)),
    );
    return files
      .map((path) => {
        const text = readFileSync(path, "utf8");
        if (!/\.(ts|mjs)$/.test(path)) return text.replace(/^\s*#.*$/gm, "");
        return text
          .replace(/(^|[(,={]|\breturn\b)([ \t]*)\/\*[\s\S]*?\*\//gm, "$1$2")
          .replace(/(^|\s)\/\/[^\n]*/g, "$1");
      })
      .join("\n");
  }

  it("lands every secret in a store file something on the rig reads", () => {
    const files = bundleFiles();
    const code = rigCode();
    expect(files.length).toBeGreaterThan(10);
    const unread = files.filter((file) => !new RegExp(`["'\`:]${file.replace(/[.]/g, "\\.")}["'\`}]`).test(code));
    expect(unread.sort()).toEqual(Object.keys(AHEAD_OF_READER).sort());
  });
});

describe("the rpc router at /ctl/rpc", () => {
  it("holds each method to the caller class the edge stamped on the frame", async () => {
    const router = new RpcRouter()
      .register("triage.unresolved", () => [], ["triage", "rig"])
      .register("scenario.run", () => "ran");
    expect(await router.dispatch({ t: "rpc", id: "1", method: "triage.unresolved", params: {}, caller: "triage" })).toEqual([]);
    await expect(router.dispatch({ t: "rpc", id: "2", method: "scenario.run", params: {}, caller: "triage" })).rejects.toThrow(
      /not open to triage/,
    );
    expect(await router.dispatch({ t: "rpc", id: "3", method: "scenario.run", params: {}, caller: "rig" })).toBe("ran");
    await expect(router.dispatch({ t: "rpc", id: "4", method: "nope", params: {}, caller: "rig" })).rejects.toThrow(/unknown method/);
  });

  it("refuses a frame that names no caller, or one that is not a control class", async () => {
    const router = new RpcRouter().register("triage.unresolved", () => [], ["triage", "rig"]);
    const bare = { t: "rpc", id: "5", method: "triage.unresolved", params: {} } as unknown as RpcFrame;
    await expect(router.dispatch(bare)).rejects.toThrow(/unknown caller class/);
    const forged = { ...bare, caller: "admin" } as unknown as RpcFrame;
    await expect(router.dispatch(forged)).rejects.toThrow(/unknown caller class/);
  });
});

describe("the standing roles", () => {
  it("are the protocol's in the rig CLI too, in the same order", () => {
    expect([...CLI_STANDING_ROLES]).toEqual([...STANDING_ROLES]);
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
    expect(JSON.parse(send.body!)).toEqual({ phone_e164: "+14165550101", phone_number_id: "7de34ea1-d188-4bcf-ad8e-be2efe86bdfe", body: "hello", quiet_hours_confirmed: true });
  });

  const USER = "11111111-2222-4333-8444-555555555555";
  const memberJwt = `h.${Buffer.from(JSON.stringify({ sub: USER })).toString("base64url")}.s`;
  function probeWith(routes: Parameters<typeof fakeFetch>[0], secret?: string) {
    const { fetch, requests } = fakeFetch({
      "POST http://127.0.0.1:54321/auth/v1/token": () => json({ access_token: memberJwt, expires_in: 3600 }),
      ...routes,
    });
    const probe = new AppProbe({
      tenants: { "qa-w": { company_id: "00000000-0000-4000-8000-000000000001", members: { owner: { email: "o@example.test", password: "pw" } } } },
      numbers: numberBook({ "ROBOT-1": "+14165550101" }),
      apiBase: "http://127.0.0.1:8787",
      supabaseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: "service",
      anonKey: "publishable",
      edgeOrigin: "https://rig-edge.example.workers.dev",
      guardToken: "t",
      robotWebhookSecret: () => secret,
      posthog: new PostHogErrors({ personalKey: "phx_rig_test_key", projectId: "7", fetch }),
      fetch,
    });
    return { probe, requests };
  }

  it("reads push_attempt events from PostHog since a time, and a member's push targets by user", async () => {
    const since = Date.UTC(2026, 9, 31);
    const { probe, requests } = probeWith({
      "POST https://us.posthog.com/api/environments/7/query/": () =>
        json({ results: [[since + 1_000, "alert", "web", "accepted", null, "normal", null, USER]] }),
      "GET http://127.0.0.1:54321/rest/v1/push_subscriptions": () => json([{ id: "a" }]),
      "GET http://127.0.0.1:54321/rest/v1/device_push_tokens": () => json([{ id: "b" }, { id: "c" }]),
    });
    expect(await probe.pushAttempts({ tenant: "QA-W", since, purpose: "alert" })).toEqual([
      {
        purpose: "alert",
        platform: "web",
        response_class: "accepted",
        attempted_at: new Date(since + 1_000).toISOString(),
        priority: "normal",
        call_session_id: null,
        user_id: USER,
      },
    ]);
    const asked = JSON.parse(requests[0]!.body!) as { query: { query: string; values: Record<string, unknown> } };
    expect(asked.query.values).toEqual({
      event: "push_attempt",
      environment: "rig",
      company: "00000000-0000-4000-8000-000000000001",
      since,
      purpose: "alert",
    });
    expect(asked.query.query.startsWith(
      "select toUnixTimestamp64Milli(timestamp), properties.purpose, properties.platform, properties.response_class, " +
        "properties.attempted_at, properties.priority, properties.call_session_id, properties.user_id from events ",
    )).toBe(true);
    expect(await probe.pushTargets({ member: "qa-w-owner" })).toBe(3);
    expect(requests.filter((r) => r.url.includes("push_subscriptions") || r.url.includes("device_push_tokens")).map((r) => new URL(r.url).searchParams.get("user_id"))).toEqual([`eq.${USER}`, `eq.${USER}`]);
  });

  it("counts a call's token as used only by the call row a consumed token creates", async () => {
    const { probe, requests } = probeWith({
      "GET http://127.0.0.1:54321/rest/v1/calls": () => json([{ call_session_id: "s" }]),
      "GET http://127.0.0.1:54321/rest/v1/outbound_call_authorizations": () => json([]),
    });
    expect(await probe.outboundTokenUse({ tenant: "QA-W", toRole: "ROBOT-1", since: Date.UTC(2026, 9, 31) })).toEqual({ calls: 1, left: 0 });
    const calls = new URL(requests.find((r) => r.url.includes("/calls?"))!.url).searchParams;
    expect([calls.get("direction"), calls.get("caller_e164")]).toEqual(["eq.outbound", "eq.+14165550101"]);
  });

  it("points the workspace's webhooks at the robot's sink, once, and needs the sink's secret to", async () => {
    let endpoints: { id: string; url: string; events: string[]; active: boolean }[] = [];
    const { probe, requests } = probeWith(
      {
        "GET http://127.0.0.1:8787/v1/webhooks": () => json({ endpoints, cap: 10 }),
        "POST http://127.0.0.1:8787/v1/webhooks": (request) => {
          const body = JSON.parse(request.body!) as { url: string; events: string[] };
          endpoints = [{ id: "wh-1", url: body.url, events: body.events, active: true }];
          return json({ endpoint: endpoints[0], secret_once: "whsec_x" }, 201);
        },
        "PATCH http://127.0.0.1:8787/v1/webhooks/wh-1": (request) => {
          const body = JSON.parse(request.body!) as { events: string[] };
          endpoints = [{ ...endpoints[0]!, events: body.events, active: true }];
          return json({ endpoint: endpoints[0] });
        },
      },
      "sink-secret-for-tests",
    );
    await probe.ensureRobotWebhook({ member: "qa-w-owner", events: ["message.sent"] });
    await probe.ensureRobotWebhook({ member: "qa-w-owner", events: ["message.sent"] });
    await probe.ensureRobotWebhook({ member: "qa-w-owner", events: ["voicemail.received"] });
    expect(endpoints).toEqual([
      { id: "wh-1", url: "https://rig-edge.example.workers.dev/w/sink-secret-for-tests/qa-w", events: ["message.sent", "voicemail.received"], active: true },
    ]);
    expect(requests.filter((r) => r.method !== "GET").map((r) => r.method)).toEqual(["POST", "POST", "PATCH"]);
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/v1/webhooks"))!.headers["x-company-id"]).toBe("00000000-0000-4000-8000-000000000001");

    const blind = probeWith({});
    await expect(blind.probe.ensureRobotWebhook({ member: "qa-w-owner", events: ["message.sent"] })).rejects.toThrow(/robot-webhook-secret/);
  });
});

/** Entries of tools/rig/crons.json as the registries branch holds them (2026-10-31), trimmed to what R00 reads. */
const CRONS = {
  schema: "loonext.rig-crons.v1",
  refusal_match: { code: "rig_endpoint_refused", exception_type: "TelnyxApiError", message_contains: "[codes rig_endpoint_refused]" },
  crons: [
    {
      config: "apps/api/wrangler.jsonc",
      cron: "*/15 * * * *",
      class: "run-expect-refusal",
      refusals: [
        {
          job: "job:reconcile-text-enablement",
          code: "rig_endpoint_refused",
          outcome: "captured",
          telnyx_paths: ["/v2/messaging_hosted_number_orders", "/v2/documents"],
          follow_on_events: [{ match: 'level error, message starts "text-enablement exhausted "' }],
        },
      ],
      defects: [
        {
          match: 'message starts "reconcile: a Telnyx number is unknown to phone_numbers"',
          means: "A number in the rig's group has no phone_numbers row.",
        },
        { match: 'TelnyxApiError "Telnyx 403 on DELETE /v2/phone_numbers/" with no [codes ...]', means: "A standing number was nearly reclaimed." },
      ],
      expected_events: [{ match: 'fingerprint ["ops", "billing-dispute"]' }],
    },
    {
      config: "apps/api/wrangler.jsonc",
      cron: "0 13 * * *",
      class: "run-expect-refusal",
      refusals: [
        {
          job: "job:poll-registrations",
          code: "rig_endpoint_refused",
          outcome: "job-fails",
          telnyx_paths: ["/v2/10dlc/brand", "/v2/10dlc/campaign"],
        },
      ],
    },
    {
      config: "apps/api/wrangler.jsonc",
      cron: "15 */6 * * *",
      class: "run",
      expected_events: [{ match: "level warning, tag ops_key=port-out" }],
    },
  ],
};

const refused = (method: string, path: string) => ({ type: "TelnyxApiError", value: `Telnyx 403 on ${method} ${path} [codes rig_endpoint_refused] refused in rig mode` });
const at = Date.UTC(2026, 9, 31, 5);

describe("the cron registry's reading of the API's events", () => {
  const { explain, unread } = cronExplainer(JSON.stringify(CRONS));
  const event = (over: Partial<SeenEvent>): SeenEvent => ({ at, ...over });

  it("reads every match form the registry uses", () => {
    expect(unread).toEqual([]);
    expect(parseMatch("fingerprint [\"ops\", \"billing-dispute\"]")!(event({ fingerprint: ["ops", "billing-dispute"] }))).toBe(true);
    expect(parseMatch("something the reader never learned")).toBeUndefined();
    expect(cronExplainer(JSON.stringify({ ...CRONS, crons: [{ cron: "x", expected_events: [{ match: "a new form" }] }] })).unread).toEqual(["a new form"]);
  });

  it("expects the listed events, captured refusals and their follow-ons", () => {
    expect(explain(event({ fingerprint: ["ops", "billing-dispute"] }))).toEqual({ kind: "expected" });
    expect(explain(event({ level: "warning", tags: { ops_key: "port-out" }, message: "A number port-out is pending" }))).toEqual({ kind: "expected" });
    expect(explain(event({ exceptions: [refused("POST", "/v2/documents")] }))).toEqual({ kind: "expected" });
    expect(explain(event({ level: "error", message: "text-enablement exhausted 5 attempts for order 1" }))).toEqual({ kind: "expected" });
  });

  it("expects a job's failure only when it is a refusal listed for the cron that ran it", () => {
    const failed = (cron: string, ...exceptions: { type: string; value: string }[]) =>
      event({ tags: { source: "cron", cron, job: "job:poll-registrations" }, exceptions });
    expect(explain(failed("0 13 * * *", refused("GET", "/v2/10dlc/brand/x")))).toEqual({ kind: "expected" });
    expect(explain(failed("0 13 * * *", refused("GET", "/v2/10dlc/brand/x"), { type: "TypeError", value: "x is undefined" }))).toBeUndefined();
    expect(explain(failed("*/15 * * * *", refused("GET", "/v2/10dlc/brand/x")))).toBeUndefined();
    expect(explain(failed("0 13 * * *", { type: "AggregateError", value: "registration poll finished with 1 failure(s)" }))).toBeUndefined();
  });

  it("names a defect by its cause, and explains nothing else", () => {
    expect(explain(event({ level: "warning", message: "reconcile: a Telnyx number is unknown to phone_numbers" }))).toEqual({
      kind: "defect",
      means: "A number in the rig's group has no phone_numbers row.",
    });
    expect(explain(event({ exceptions: [{ type: "TelnyxApiError", value: "Telnyx 403 on DELETE /v2/phone_numbers/abc forbidden" }] }))).toMatchObject({ kind: "defect" });
    expect(explain(event({ exceptions: [{ type: "TelnyxApiError", value: "Telnyx 403 on DELETE /v2/phone_numbers/abc [codes rig_endpoint_refused]" }] }))).toBeUndefined();
    expect(explain(event({ message: "rig cron not run: the database is not in rig mode" }))).toBeUndefined();
    expect(explain(event({ exceptions: [{ type: "TypeError", value: "x is undefined" }] }))).toBeUndefined();
    // The refusal's words in another kind of error are that error, not the refusal.
    expect(explain(event({ exceptions: [{ ...refused("POST", "/v2/documents"), type: "TypeError" }] }))).toBeUndefined();
  });

  it("refuses a file that is not the cron registry", () => {
    expect(() => cronExplainer(JSON.stringify([{ cron: "x" }]))).toThrow(/loonext\.rig-crons\.v1/);
    expect(cronExplainer(undefined).explain(event({ fingerprint: ["ops", "x"] }))).toBeUndefined();
  });
});

describe("the report of the API's exceptions for rig health", () => {
  const NOW = Date.UTC(2026, 9, 1, 5);
  const row = (at: number, list: { type: string; value: string }[], extras: { level?: string; fingerprint?: string; cron?: string; job?: string; ops_key?: string } = {}) =>
    [at / 1000, extras.level ?? "error", extras.fingerprint ?? null, list, "api", null, extras.cron ?? null, extras.job ?? null, extras.ops_key ?? null];
  const source = (rows: unknown[][]) => ({ apiExceptions: async () => rows.map((r) => seenException(r)) });

  it("lists the API's exceptions from the last day that the cron registry does not explain, and its defects apart", async () => {
    const { explain } = cronExplainer(JSON.stringify(CRONS));
    const report = await reportApiExceptions(
      source([
        row(NOW, [{ type: "OpsNotice", value: "A number port-out is pending" }], { level: "warning", fingerprint: "ops:billing-dispute", ops_key: "billing-dispute" }),
        row(NOW, [{ type: "Error", value: "reconcile: a Telnyx number is unknown to phone_numbers" }], { level: "warning" }),
        row(NOW, [{ type: "TypeError", value: "x is undefined" }]),
      ]),
      explain,
      NOW,
    );
    expect(report.error).toBeUndefined();
    expect(report.unexplained_24h).toEqual(["TypeError: x is undefined"]);
    expect(report.defects_24h).toEqual([
      { key: "Error: reconcile: a Telnyx number is unknown to phone_numbers", means: "A number in the rig's group has no phone_numbers row." },
    ]);
  });

  it("says the read failed instead of reporting a quiet API", async () => {
    const report = await reportApiExceptions(
      { apiExceptions: async () => { throw new Error("PostHog answered 401 for the exception query"); } },
      () => undefined,
      NOW,
    );
    expect(report).toMatchObject({ error: "PostHog answered 401 for the exception query", unexplained_24h: [], defects_24h: [] });
  });

  it("reads PostHog's list with the thrown error first as the registry's, outermost last, and keeps the tags it matches on", () => {
    const seen = seenException(
      row(NOW, [{ type: "AggregateError", value: "cron: 1 of 5 job(s) failed" }, { type: "TelnyxApiError", value: "Telnyx 403 on DELETE /v2/phone_numbers/x" }], {
        cron: "0 13 * * *",
        job: "job:reconcile-numbers",
      }),
    );
    expect(seen.exceptions?.map((e) => e.type)).toEqual(["TelnyxApiError", "AggregateError"]);
    expect(seen.message).toBe("cron: 1 of 5 job(s) failed");
    expect(seen.tags).toEqual({ source: "api", cron: "0 13 * * *", job: "job:reconcile-numbers" });
    expect(seen.at).toBe(NOW);
  });

  it("parses a list PostHog returns as JSON text", () => {
    const seen = seenException([NOW / 1000, "error", null, JSON.stringify([{ type: "Error", value: "boom" }]), null, null, null, null, null]);
    expect(seen.exceptions).toEqual([{ type: "Error", value: "boom" }]);
  });
});

describe("re-runs that triage starts", () => {
  it("get a unit of their own under systemd, and a run id to read their evidence by", () => {
    const launched: { command: string; args: string[] }[] = [];
    const launch = ((command: string, args: string[]) => {
      launched.push({ command, args });
      return { unref() {} };
    }) as unknown as typeof import("node:child_process").spawn;
    const home = rigHomeDir();
    const config = loadConfig({ RIG_HOME: home });
    const started = runStarter({ home: config.home, systemd: true }, launch)("S02");
    expect(started).toMatchObject({ started: true, scenario: "S02", run_id: expect.stringMatching(/^S02-\d{14}-[0-9a-f]{6}$/) });
    expect(launched[0]!.command).toBe("systemd-run");
    expect(launched[0]!.args).toEqual(
      expect.arrayContaining(["--user", `--unit=loonext-rig-rerun-${started.run_id}`, "--collect", `--setenv=RIG_HOME=${config.home.home}`]),
    );
    expect(launched[0]!.args.slice(-4)).toEqual(["run", "S02", "--run-id", started.run_id]);
    expect(() => runStarter({ home: config.home, systemd: true }, launch)("../x")).toThrow(/not a scenario/);
  });
});

describe("the dial window", () => {
  it("is the guard's measured one, the last one it gave when it does not answer, else the registry's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rigd-window-"));
    dirs.push(dir);
    let answer: Response | undefined = json({ paid_dials: { window_start_hour_utc: 13 } });
    const { fetch, requests } = fakeFetch({ GET: () => answer ?? json({ error: "guard_error" }, 502) });
    const source = () =>
      new WindowSource({
        edgeOrigin: "https://rig-edge.example.workers.dev",
        token: "robot",
        stateFile: join(dir, "guard-window.json"),
        registry: { startHour: 4, hours: 6 },
        fetch,
      });
    expect(source().known()).toEqual({ startHour: 4, hours: 6 });
    expect(await source().current()).toEqual({ startHour: 13, hours: 6 });
    expect(requests[0]).toMatchObject({ url: "https://rig-edge.example.workers.dev/g/health", headers: { authorization: "Bearer robot" } });
    answer = undefined;
    expect(await source().current()).toEqual({ startHour: 13, hours: 6 });
    const pinned = new WindowSource({
      edgeOrigin: "https://rig-edge.example.workers.dev",
      token: "robot",
      stateFile: join(dir, "guard-window.json"),
      registry: { startHour: 4, hours: 6 },
      override: { startHour: 5, hours: 3 },
      fetch,
    });
    expect(await pinned.current()).toEqual({ startHour: 5, hours: 3 });
  });
});
