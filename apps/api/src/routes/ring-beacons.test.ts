/**
 * Ring beacons (D142): record a stage, never anything personal, never more
 * than the cap. The last block reads the web, Android and iOS sources to check
 * they spell and send the stages the way this server does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  AUTHORIZE_RPC,
  buildTestApp,
  countResponse,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import {
  RING_BEACON_DAILY_CAP,
  RING_BEACON_PERMISSIONS,
  RING_BEACON_STAGES,
  RING_BEACON_STANDBY_BUCKETS,
  RING_BEACON_WARN_AT,
  ringBeaconsRoutes,
  resetRingBeaconAlertsForTest,
  type RingBeaconStage,
} from "./ring-beacons";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const SESSION = "v3:4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

let auth: TestAuth;
const app = buildTestApp(ringBeaconsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

beforeEach(() => {
  resetSentryCaptures();
  resetRingBeaconAlertsForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubs(options: { recent?: number; role?: string | null } = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    AUTHORIZE_RPC,
    membershipResponder(MEMBER_ID, options.role === undefined ? "member" : options.role),
  );
  sb.on("HEAD", "/rest/v1/ring_beacons", () => countResponse(options.recent ?? 0));
  sb.on("POST", "/rest/v1/ring_beacons", () => new Response(null, { status: 201 }));
  stubFetch(jwksRoute(auth), sb.route);
  return sb;
}

async function post(
  body: unknown,
  headers: Record<string, string> = { "X-Client": "android", "X-App-Version": "0.18.2" },
): Promise<Response> {
  return apiRequest(app, env, await auth.token(), "/v1/ring-beacons", {
    method: "POST",
    companyId: COMPANY_ID,
    headers,
    body,
  });
}

function inserted(sb: SupabaseStub): Record<string, unknown>[] {
  return sb
    .find("POST", "/rest/v1/ring_beacons")
    .map((call) => call.body as Record<string, unknown>);
}

describe("POST /v1/ring-beacons", () => {
  it("records one stage with the device state, the caller's identity and the build from the headers", async () => {
    const sb = stubs();
    const occurredAt = new Date(Date.now() - 2_000).toISOString();

    const res = await post({
      call_session_id: SESSION,
      stage: "ringing_shown",
      occurred_at: occurredAt,
      os: "Android-34",
      permissions: {
        notifications: "granted",
        microphone: "denied",
        full_screen_intent: "granted",
        battery_unrestricted: "prompt",
      },
      standby_bucket: "rare",
      power_save: true,
      device_idle: false,
      screen_locked: true,
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ recorded: true });
    const rows = inserted(sb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      company_id: COMPANY_ID,
      user_id: auth.subject,
      auth_session_id: auth.sessionId,
      call_session_id: SESSION,
      platform: "android",
      stage: "ringing_shown",
      occurred_at: occurredAt,
      app_version: "0.18.2",
      os: "android-34",
      permissions: {
        notifications: "granted",
        microphone: "denied",
        full_screen_intent: "granted",
        battery_unrestricted: "prompt",
      },
      standby_bucket: "rare",
      power_save: true,
      device_idle: false,
      screen_locked: true,
    });

    // The cap counts this member in this workspace over the last day.
    const count = sb.find("HEAD", "/rest/v1/ring_beacons")[0];
    expect(count.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(count.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(count.url.searchParams.get("created_at")).toMatch(/^gte\./);
  });

  it("counts a full day back, so a shorter window cannot quietly lift the cap", async () => {
    const sb = stubs();
    const before = Date.now();
    await post({ call_session_id: SESSION, stage: "answered" });
    const after = Date.now();

    const since = sb
      .find("HEAD", "/rest/v1/ring_beacons")[0]!
      .url.searchParams.get("created_at")!
      .replace(/^gte\./, "");
    const day = 24 * 60 * 60 * 1000;
    expect(Date.parse(since)).toBeGreaterThanOrEqual(before - day);
    expect(Date.parse(since)).toBeLessThanOrEqual(after - day);
  });

  it("keeps a stage whose device state it cannot read, and drops only the unreadable parts", async () => {
    const sb = stubs();

    const res = await post({
      call_session_id: SESSION,
      stage: "push_received",
      occurred_at: "yesterday-ish",
      // Every character is one the table allows; the shape is not.
      os: "android-34-beta",
      permissions: {
        notifications: "granted",
        microphone: "maybe",
        contacts: "granted",
      },
      standby_bucket: "ultra_rare",
      power_save: "yes",
      device_idle: 1,
    });

    expect(res.status).toBe(202);
    const [row] = inserted(sb);
    // Exact, not a subset: an unknown permission name is the leak this filters.
    expect(row!.permissions).toEqual({ notifications: "granted" });
    expect(row).toMatchObject({
      stage: "push_received",
      occurred_at: null,
      os: null,
      permissions: { notifications: "granted" },
      standby_bucket: null,
      power_save: null,
      device_idle: null,
      screen_locked: null,
    });
  });

  it("throws away a device clock that is a day out, and keeps the stage", async () => {
    const sb = stubs();
    await post({
      call_session_id: SESSION,
      stage: "answered",
      occurred_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await post({
      call_session_id: SESSION,
      stage: "declined",
      occurred_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(inserted(sb).map((row) => row.occurred_at)).toEqual([null, null]);
  });

  it.each([
    ["no session", { stage: "answered" }],
    ["a session that looks like a phone number", { call_session_id: "+1 613 555 0123", stage: "answered" }],
    ["a session that is a phone number without its plus", { call_session_id: "16135550123", stage: "answered" }],
    ["a stage this server does not know", { call_session_id: SESSION, stage: "rang_twice" }],
  ])("refuses %s with 422 and writes nothing", async (_label, body) => {
    const sb = stubs();
    const res = await post(body);
    expect(res.status).toBe(422);
    expect(inserted(sb)).toHaveLength(0);
  });

  it("refuses a beacon that does not say which app sent it", async () => {
    const sb = stubs();
    const res = await post({ call_session_id: SESSION, stage: "answered" }, {});
    expect(res.status).toBe(422);
    expect(inserted(sb)).toHaveLength(0);
  });

  it("refuses a caller who is not a member of the workspace", async () => {
    const sb = stubs({ role: null });
    const res = await post({ call_session_id: SESSION, stage: "answered" });
    expect(res.status).toBe(403);
    expect(sb.find("HEAD", "/rest/v1/ring_beacons")).toHaveLength(0);
    expect(inserted(sb)).toHaveLength(0);
  });

  it("refuses a member who is never rung, because they cannot take calls", async () => {
    const sb = stubs({ role: "read_only" });
    const res = await post({ call_session_id: SESSION, stage: "answered" });
    expect(res.status).toBe(403);
    expect(sb.find("HEAD", "/rest/v1/ring_beacons")).toHaveLength(0);
    expect(inserted(sb)).toHaveLength(0);
  });

  it("warns the operator at 80% of the cap and still records", async () => {
    const sb = stubs({ recent: RING_BEACON_WARN_AT });
    const res = await post({ call_session_id: SESSION, stage: "answered" });
    expect(await res.json()).toEqual({ recorded: true });
    expect(inserted(sb)).toHaveLength(1);
    expect(opsCaptures("ring-beacons-member-cap-warning")).toHaveLength(1);
    expect(opsCaptures("ring-beacons-member-cap")).toHaveLength(0);
  });

  it("warns once between the warning line and the cap, even when beacons race past the line", async () => {
    const sb = stubs({ recent: RING_BEACON_WARN_AT + 1 });
    const res = await post({ call_session_id: SESSION, stage: "answered" });
    expect(await res.json()).toEqual({ recorded: true });
    expect(inserted(sb)).toHaveLength(1);
    expect(opsCaptures("ring-beacons-member-cap-warning")).toHaveLength(1);

    vi.unstubAllGlobals();
    stubs({ recent: RING_BEACON_WARN_AT + 2 });
    await post({ call_session_id: SESSION, stage: "answered" });
    expect(opsCaptures("ring-beacons-member-cap-warning")).toHaveLength(1);
  });

  it("drops beacons at the cap and says so once, however many arrive", async () => {
    // A dropped beacon leaves the count at the cap, so every later beacon
    // sees exactly the cap again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      vi.unstubAllGlobals();
      const atCap = stubs({ recent: RING_BEACON_DAILY_CAP });
      const res = await post({ call_session_id: SESSION, stage: "answered" });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ recorded: false });
      expect(inserted(atCap)).toHaveLength(0);
    }
    expect(opsCaptures("ring-beacons-member-cap")).toHaveLength(1);
  });

  it("says nothing to the operator below the warning line", async () => {
    stubs({ recent: RING_BEACON_WARN_AT - 1 });
    await post({ call_session_id: SESSION, stage: "answered" });
    expect(opsCaptures()).toHaveLength(0);
  });
});

/**
 * The stage words are written four times: in the route and in each client. A
 * word on one side only is a beacon nobody can send or one the server refuses,
 * visible only as a missing row on the day it matters.
 */
describe("the clients send this server's vocabulary", () => {
  const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
  const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), "utf8");

  /** Quoted snake_case words between a start marker and the next `end`. */
  function wordsIn(source: string, start: string, end: string): string[] {
    const from = source.indexOf(start);
    expect(from, `marker "${start}" not found`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    const block = source.slice(from, to);
    return [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
  }

  const clients = {
    web: () =>
      wordsIn(
        read("apps", "web", "src", "lib", "softphone", "beacons.ts"),
        "export const RING_BEACON_STAGES",
        "] as const",
      ),
    android: () =>
      wordsIn(
        read(
          "apps", "android", "app", "src", "main", "kotlin", "com", "loonext",
          "android", "telephony", "RingBeacons.kt",
        ),
        "enum class RingBeaconStage",
        "}",
      ),
    ios: () =>
      wordsIn(
        read("apps", "ios", "Loonext", "Features", "Calls", "Telephony", "RingBeacons.swift"),
        "enum RingBeaconStage",
        "}",
      ),
  };

  for (const [client, words] of Object.entries(clients)) {
    it(`${client} spells exactly the stages this server accepts`, () => {
      const found = words();
      // An empty read is a moved marker, not agreement.
      expect(found.length).toBeGreaterThan(0);
      expect([...new Set(found)].sort()).toEqual([...RING_BEACON_STAGES].sort());
    });
  }

  /**
   * A browser never handles a push or reports a call to an OS; both phones
   * send all six. Catches a stage with no call site left, where the
   * vocabulary still agrees and the evidence simply stops. Each client's own
   * tests cover which session a site reports under.
   */
  const SENT_BY: Record<string, readonly RingBeaconStage[]> = {
    web: ["ringing_shown", "answered", "declined"],
    android: RING_BEACON_STAGES,
    ios: RING_BEACON_STAGES,
  };

  /** Swift case or Kotlin constant name -> wire word, from a client's enum. */
  function wireNames(source: string, pattern: RegExp): Map<string, string> {
    return new Map([...source.matchAll(pattern)].map((match) => [match[1]!, match[2]!]));
  }

  const emitted = {
    web: () => {
      const provider = read("apps", "web", "src", "lib", "softphone", "provider.tsx");
      return [...provider.matchAll(/emitRingBeacon\([^,]+,\s*"([a-z_]+)"/g)].map((m) => m[1]!);
    },
    android: () => {
      const root = ["apps", "android", "app", "src", "main", "kotlin", "com", "loonext", "android"];
      const names = wireNames(
        read(...root, "telephony", "RingBeacons.kt"),
        /^\s*([A-Z_]+)\("([a-z_]+)"\),?$/gm,
      );
      const callers = [
        read(...root, "telephony", "SoftphoneManager.kt"),
        read(...root, "push", "LoonextMessagingService.kt"),
      ].join("\n");
      return [...callers.matchAll(/RingBeaconStage\.([A-Z_]+)/g)].map((m) => names.get(m[1]!) ?? m[1]!);
    },
    ios: () => {
      const dir = ["apps", "ios", "Loonext", "Features", "Calls", "Telephony"];
      const names = wireNames(
        read(...dir, "RingBeacons.swift"),
        /case (\w+) = "([a-z_]+)"/g,
      );
      const manager = read(...dir, "CallsManager.swift");
      return [...manager.matchAll(/\bbeacon(?:IfRinging)?\(\s*\.(\w+)/g)].map(
        (m) => names.get(m[1]!) ?? m[1]!,
      );
    },
  };

  for (const [client, sites] of Object.entries(emitted)) {
    it(`${client} still sends every stage it is meant to, and only those`, () => {
      const found = [...new Set(sites())].sort();
      expect([...found]).toEqual([...SENT_BY[client]!].sort());
    });
  }

  it("android reports only permissions and buckets this server keeps", () => {
    const source = read(
      "apps", "android", "app", "src", "main", "kotlin", "com", "loonext",
      "android", "telephony", "RingBeacons.kt",
    );
    const permissions = wordsIn(source, "object RingBeaconPermission", "}");
    expect(permissions.length).toBeGreaterThan(0);
    for (const key of permissions) {
      expect(RING_BEACON_PERMISSIONS as readonly string[]).toContain(key);
    }
    const buckets = wordsIn(source, "fun standbyBucketName", "else ->");
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      expect(RING_BEACON_STANDBY_BUCKETS as readonly string[]).toContain(bucket);
    }
  });
});
