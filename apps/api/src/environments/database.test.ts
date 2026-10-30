/**
 * D142: the rig serves only once its database says the destination gate is on,
 * checked on its own and through the Worker's real `fetch` and `scheduled`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Bindings } from "../env";
import worker, { handler } from "../index";
import { testExecutionContext } from "../test/messaging-support";
import { supabaseStub, type SbResponder } from "../test/routes-harness";
import { rigEnv } from "../test/rig-env";
import { completeEnv, stubFetch } from "../test/support";
import { rigDatabaseRefusal } from "./database";

const POSTURE = "/rest/v1/rpc/rig_database_posture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A rig database answering `posture`, and every request that reached it. */
function database(bindings: Bindings, posture: SbResponder) {
  const sb = supabaseStub(getEnv(bindings));
  sb.on("POST", POSTURE, posture);
  stubFetch(sb.route);
  return sb;
}

describe("the rig's database posture", () => {
  it.each([
    ["local", completeEnv()],
    ["production", { ...completeEnv(), DEPLOY_ENV: "production" }],
  ])("is never asked in %s", async (_name, bindings) => {
    stubFetch(() => {
      throw new Error("nothing may be fetched");
    });
    expect(await rigDatabaseRefusal(getEnv(bindings))).toBeNull();
  });

  it("serves a bootstrapped rig, and asks again only after a minute", async () => {
    const bindings = rigEnv();
    const sb = database(bindings, () => ({ deploy_env: "rig", endpoints: 3 }));
    const env = getEnv(bindings);

    expect(await rigDatabaseRefusal(env, 1_000)).toBeNull();
    expect(await rigDatabaseRefusal(env, 59_000)).toBeNull();
    expect(sb.find("POST", POSTURE)).toHaveLength(1);
    expect(await rigDatabaseRefusal(env, 61_001)).toBeNull();
    expect(sb.find("POST", POSTURE)).toHaveLength(2);
  });

  it.each([
    ["a reset database, which lost its setting", { deploy_env: "", endpoints: 0 }],
    ["a database set to something else", { deploy_env: "production", endpoints: 2 }],
    ["a rig database with no usable endpoint", { deploy_env: "rig", endpoints: 0 }],
    ["an answer of the wrong shape", ["rig"]],
    ["no answer", null],
  ])("refuses %s, and remembers no refusal", async (_label, posture) => {
    const bindings = rigEnv();
    const sb = database(bindings, () => posture);
    const env = getEnv(bindings);

    expect(await rigDatabaseRefusal(env, 1_000)).toEqual(expect.any(String));
    expect(await rigDatabaseRefusal(env, 1_001)).toEqual(expect.any(String));
    expect(sb.find("POST", POSTURE)).toHaveLength(2);
  });

  it("refuses when the database cannot be asked", async () => {
    const bindings = rigEnv();
    database(bindings, () => Response.json({ message: "no such function" }, { status: 404 }));
    expect(await rigDatabaseRefusal(getEnv(bindings))).toMatch(/could not read/);
  });

  it("forgets a confirmation once the database stops confirming", async () => {
    const bindings = rigEnv();
    let posture: unknown = { deploy_env: "rig", endpoints: 2 };
    database(bindings, () => posture);
    const env = getEnv(bindings);

    expect(await rigDatabaseRefusal(env, 0)).toBeNull();
    posture = { deploy_env: "", endpoints: 0 };
    expect(await rigDatabaseRefusal(env, 60_001)).not.toBeNull();
    // The next request asks again, and serves once the database confirms.
    posture = { deploy_env: "rig", endpoints: 2 };
    expect(await rigDatabaseRefusal(env, 60_002)).toBeNull();
  });
});

describe("a rig whose database gate is off", () => {
  it("answers every request 503 and touches nothing else", async () => {
    const bindings = rigEnv();
    const sb = database(bindings, () => ({ deploy_env: "", endpoints: 0 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, flush } = testExecutionContext();

    const response = await handler.fetch(
      new Request("https://api.loonext.com/health"),
      bindings,
      ctx,
    );
    await flush();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "service_unavailable", message: expect.stringMatching(/destination gate is off/) },
    });
    expect(sb.calls.map((call) => call.path)).toEqual([POSTURE]);
  });

  it("runs no cron job", async () => {
    const bindings = rigEnv();
    const sb = database(bindings, () => ({ deploy_env: "", endpoints: 0 }));
    // The heartbeat records that the trigger fired, which it did.
    const HEARTBEAT = "/rest/v1/rpc/record_heartbeat";
    sb.on("POST", HEARTBEAT, () => ({ recovered: false }));

    // Through the exported Worker, as the runtime calls it. Sentry wraps the
    // handler in place and its wrapper needs the execution context, which the
    // handler's own signature leaves out.
    const scheduled = worker.scheduled as unknown as ExportedHandlerScheduledHandler<Bindings>;
    await expect(
      scheduled(
        { cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry: () => {} },
        bindings,
        testExecutionContext().ctx,
      ),
    ).rejects.toThrow(/rig cron not run/);
    expect(sb.calls.map((call) => call.path).filter((path) => path !== HEARTBEAT)).toEqual([
      POSTURE,
    ]);
  });
});

describe("a production Worker", () => {
  it("serves without asking", async () => {
    const bindings = { ...completeEnv(), DEPLOY_ENV: "production" };
    const sb = supabaseStub(getEnv(bindings));
    stubFetch(sb.route);
    const { ctx, flush } = testExecutionContext();

    const response = await handler.fetch(
      new Request("https://api.loonext.com/health"),
      bindings,
      ctx,
    );
    await flush();

    expect(response.status).toBe(200);
    expect(sb.find("POST", POSTURE)).toEqual([]);
  });
});
