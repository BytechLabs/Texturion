/**
 * #309 — recording a greeting in the business's own voice.
 *
 * VG-R4 is the one that decides whether this route is safe to ship. The bytes
 * go up BEFORE the row, so an insert that fails must take the object back out.
 * Without that, every rejected upload — a duplicate name, most commonly — would
 * leave audio in a bucket with nothing referencing it and nothing that would
 * ever notice.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, errorResponse } from "../http/errors";
import type { AppEnv } from "../context";
import type { Bindings } from "../env";
import type { Env } from "../env";
import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { voicemailGreetingsRoutes } from "./voicemail-greetings";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER_ID = "10000000-aaaa-4000-8000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Every write to the greetings bucket, so a test can count them. */
function storageRoutes(env: Env) {
  const origin = new URL(env.SUPABASE_URL).origin;
  const uploads: string[] = [];
  const removed: string[] = [];
  const route: FetchRoute = (url, request) => {
    if (
      url.origin !== origin ||
      !url.pathname.includes("/storage/v1/object")
    ) {
      return undefined;
    }
    if (request.method === "POST") {
      uploads.push(url.pathname);
      return Response.json({ Key: url.pathname });
    }
    if (request.method === "DELETE") {
      removed.push(url.pathname);
      return Response.json([]);
    }
    return undefined;
  };
  return { route, uploads, removed };
}

function buildHarness(extra: { greetingInsertFails?: string } = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("company_members");
  rest.table("voicemail_greetings");
  rest.table("audit_log");
  rest.insert("companies", { id: COMPANY_ID, name: "Acme Plumbing" });
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });

  const storage = storageRoutes(env);

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", "owner");
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1", voicemailGreetingsRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  // The insert failure a test asks for, ahead of the FakeRest route so it wins.
  const failRoute: FetchRoute = (url, request) => {
    if (
      !extra.greetingInsertFails ||
      request.method !== "POST" ||
      !url.pathname.endsWith("/rest/v1/voicemail_greetings")
    ) {
      return undefined;
    }
    return Response.json(
      { code: extra.greetingInsertFails, message: "duplicate key value" },
      { status: 409 },
    );
  };

  stubFetch(failRoute, storage.route, rest.route());
  return {
    env,
    rest,
    storage,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

function upload(fields: {
  name?: string;
  durationMs?: string;
  type?: string;
  bytes?: Uint8Array;
}) {
  const form = new FormData();
  if (fields.name !== undefined) form.set("name", fields.name);
  if (fields.durationMs !== undefined) form.set("duration_ms", fields.durationMs);
  form.set(
    "file",
    new Blob([fields.bytes ?? new Uint8Array([1, 2, 3, 4])], {
      type: fields.type ?? "audio/mp4",
    }),
    "greeting.m4a",
  );
  return { method: "POST", body: form } as RequestInit;
}

describe("#309 recording a greeting", () => {
  it("VG-R1: a recording lands, and the row says what it is", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "After hours", durationMs: "8200" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("After hours");
    expect(body.duration_ms).toBe(8200);
    expect(harness.storage.uploads).toHaveLength(1);
  });

  it("VG-R2: a greeting nobody would sit through is refused, in words", async () => {
    // The column has this ceiling too, but a constraint-violation string is not
    // something to show a person who just recorded a three-minute message.
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "Epic", durationMs: "180000" }),
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("two minutes");
    // And nothing was written — the ceiling is checked before the upload.
    expect(harness.storage.uploads).toHaveLength(0);
  });

  it("VG-R3: a file that is not audio never reaches the bucket", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "Sneaky", durationMs: "5000", type: "application/pdf" }),
    );
    expect(res.status).toBe(422);
    expect(harness.storage.uploads).toHaveLength(0);
  });

  it("VG-R4: a rejected row takes its bytes back out of the bucket", async () => {
    // THE ONE THAT MATTERS. The object is written first, so a failed insert
    // must undo it — otherwise every duplicate-name attempt strands audio that
    // nothing references and nothing will ever notice.
    const harness = buildHarness({ greetingInsertFails: "23505" });
    const res = await harness.request(
      "/v1/voicemail-greetings",
      upload({ name: "After hours", durationMs: "8200" }),
    );
    expect(res.status).toBe(422);
    // Named the conflict rather than reporting an internal error.
    expect(await res.text()).toContain("already have a greeting");
    expect(harness.storage.uploads).toHaveLength(1);
    expect(harness.storage.removed).toHaveLength(1);
  });

  it("VG-R5: deleting a greeting that is not yours is a 404, not a 204", async () => {
    const harness = buildHarness();
    const res = await harness.request(
      "/v1/voicemail-greetings/eeeeeeee-0000-4000-8000-0000000000e9",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
    // And no bytes were removed on the way to saying so.
    expect(harness.storage.removed).toHaveLength(0);
  });
});
