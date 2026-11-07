import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { completeEnv } from "../test/support";
import { captureEvent, captureException, opsNotice, scrubbedError } from "./capture";

const PHONE = "+16135551234";
const EMAIL = "a@b.co";
const COMPANY = "550e8400-e29b-41d4-a716-446655440000";

interface Sent {
  url: string;
  body: string;
  event: { event: string; distinct_id: string; properties: Record<string, unknown> };
}

let sent: Sent[];
let fetchMock: ReturnType<typeof vi.fn>;

function env(overrides: Partial<Env> = {}): Env {
  return {
    ...completeEnv(),
    POSTHOG_API_KEY: "phc_capture_test_key",
    DEPLOY_ENV: "production",
    GIT_SHA: "abc1234",
    ...overrides,
  };
}

/** Collects what `waitUntil` was handed, so a test can await it. */
function invocation() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    pending,
  };
}

beforeEach(() => {
  sent = [];
  fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body) as { batch: Sent["event"][] };
    for (const event of payload.batch) sent.push({ url, body: init.body, event });
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("captureException", () => {
  it("sends a thrown error with its phone number and email address scrubbed", async () => {
    const { waitUntil, pending } = invocation();
    await captureException(
      env(),
      new Error(`${PHONE} ${EMAIL}`),
      { source: "api", route: "/v1/conversations" },
      waitUntil,
    );

    expect(pending).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const [{ body, event, url }] = sent;
    expect(url).toBe("https://us.i.posthog.com/batch/");
    expect(event.event).toBe("$exception");
    const [entry] = event.properties.$exception_list as { type: string; value: string }[];
    expect(entry.type).toBe("Error");
    expect(entry.value).toBe("[phone redacted] [email redacted]");
    // Anywhere in the payload, the stack included.
    expect(body).not.toContain("6135551234");
    expect(body).not.toContain(EMAIL);
  });

  it("files it under the deployment, the release and where it was caught", async () => {
    await captureException(
      env(),
      new Error("boom"),
      { source: "cron", cron: "0 * * * *", job: "job:reconcile", company_id: COMPANY },
      () => {},
    );

    const [{ event }] = sent;
    expect(event.distinct_id).toBe("loonext-api");
    expect(event.properties).toMatchObject({
      environment: "production",
      release: "abc1234",
      $process_person_profile: false,
      $exception_level: "error",
      source: "cron",
      cron: "0 * * * *",
      job: "job:reconcile",
      company_id: COMPANY,
    });
    expect(event.properties.$exception_fingerprint).toBeUndefined();
  });

  it("names the rig and a laptop apart from production", async () => {
    await captureException(env({ DEPLOY_ENV: "rig" }), new Error("a"), { source: "api" }, () => {});
    await captureException(env({ DEPLOY_ENV: undefined }), new Error("b"), { source: "api" }, () => {});

    expect(sent.map(({ event }) => event.properties.environment)).toEqual(["rig", "local"]);
  });

  it("scrubs the cause chain and the extra data too", async () => {
    const error = new Error("outer", { cause: new Error(`inner ${PHONE}`) });
    await captureException(
      env(),
      error,
      {
        source: "api",
        level: "warning",
        extra: { contact_name: "Jane Doe", url: `https://x.example/a?to=${PHONE}` },
      },
      () => {},
    );

    const [{ body, event }] = sent;
    expect(body).not.toContain("6135551234");
    expect(body).not.toContain("Jane Doe");
    expect(event.properties.$exception_level).toBe("warning");
    expect(event.properties.extra).toEqual({
      contact_name: "[name redacted]",
      url: "https://x.example/a",
    });
  });

  it("sends nothing without a project key, or from a laptop", async () => {
    await captureException(env({ POSTHOG_API_KEY: undefined }), new Error("x"), { source: "api" }, () => {});
    await captureException(env({ LOCAL_DEV: "1" }), new Error("x"), { source: "api" }, () => {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves when PostHog is down, so the failure it reports is not replaced", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      captureException(env(), new Error("x"), { source: "api" }, () => {}),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("scrubbedError", () => {
  it("rebuilds an error from scrubbed text only", () => {
    const original = new TypeError(`no route to ${PHONE}`);
    const copy = scrubbedError(original) as Error;

    expect(copy).not.toBe(original);
    expect(copy.name).toBe("TypeError");
    expect(copy.message).toBe("no route to [phone redacted]");
    expect(copy.stack).not.toContain("6135551234");
  });

  it("scrubs a thrown string or object", () => {
    expect(scrubbedError(`call ${PHONE}`)).toBe("call [phone redacted]");
    expect(scrubbedError({ to: PHONE, owner_name: "Jane" })).toEqual({
      to: "[phone redacted]",
      owner_name: "[name redacted]",
    });
  });
});

describe("opsNotice", () => {
  it("is one issue per key, with the detail scrubbed", async () => {
    const { waitUntil, pending } = invocation();
    await opsNotice(
      env(),
      {
        key: "port-out",
        summary: "A number is being ported away",
        detail: `number ${PHONE}, owner ${EMAIL}, company ${COMPANY}`,
        action: "Check the port-out request in Telnyx",
      },
      waitUntil,
    );

    expect(pending).toHaveLength(1);
    const [{ body, event }] = sent;
    expect(event.event).toBe("$exception");
    expect(event.distinct_id).toBe("loonext-api");
    expect(event.properties).toMatchObject({
      $exception_fingerprint: "ops:port-out",
      $exception_level: "warning",
      ops_key: "port-out",
      detail: `number [phone redacted], owner [email redacted], company ${COMPANY}`,
      action: "Check the port-out request in Telnyx",
      environment: "production",
    });
    const [entry] = event.properties.$exception_list as { type: string; value: string }[];
    expect(entry).toMatchObject({ type: "OpsNotice", value: "A number is being ported away" });
    expect(body).not.toContain("6135551234");
  });

  it("still sends a badly named key, and says so", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await opsNotice(env(), { key: "Port Out 2026", summary: "x" }, () => {});

    expect(sent).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Port Out 2026"));
    log.mockRestore();
  });
});

describe("captureEvent", () => {
  it("sends the event under the given identity, with the deployment", async () => {
    await captureEvent(env(), "email_bounced", "loonext-api", { kind: "bounce" }, () => {});

    const [{ event }] = sent;
    expect(event).toMatchObject({
      event: "email_bounced",
      distinct_id: "loonext-api",
      properties: {
        kind: "bounce",
        environment: "production",
        $process_person_profile: false,
      },
    });
  });

  it("drops a property that reads as a person and reports the key, not the value", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { waitUntil, pending } = invocation();
    await captureEvent(env(), "message_outcome", COMPANY, {
      status: "failed",
      to: PHONE,
    }, waitUntil);
    await Promise.all(pending);

    const outcome = sent.find(({ event }) => event.event === "message_outcome");
    expect(outcome?.event.properties.status).toBe("failed");
    expect(outcome?.event.properties).not.toHaveProperty("to");
    const report = sent.find(({ event }) => event.event === "$exception");
    expect(report?.body).toContain("'to'");
    expect(report?.body).not.toContain("6135551234");
    log.mockRestore();
  });

  it("keeps a uuid and a UTC instant whole, though each holds a phone-shaped run", async () => {
    const { waitUntil, pending } = invocation();
    const properties = {
      user_id: "a1000000-0000-4000-8000-00000000000a",
      attempted_at: "2026-10-31T14:00:00.000Z",
    };
    await captureEvent(env({ DEPLOY_ENV: "rig" }), "push_attempt", COMPANY, properties, waitUntil);
    await Promise.all(pending);

    expect(sent).toHaveLength(1);
    expect(sent[0].event.properties).toMatchObject(properties);
  });

  it("leaves the member out of a production event and keeps it on the rig", async () => {
    const { waitUntil, pending } = invocation();
    const properties = { stage: "ringing_shown", user_id: "a1000000-0000-4000-8000-00000000000a" };
    await captureEvent(env({ DEPLOY_ENV: "production" }), "ring_beacon", COMPANY, properties, waitUntil);
    await captureEvent(env({ DEPLOY_ENV: "rig" }), "ring_beacon", COMPANY, properties, waitUntil);
    await Promise.all(pending);

    expect(sent.map(({ event }) => event.properties)).toMatchObject([
      { environment: "production", stage: "ringing_shown" },
      { environment: "rig", user_id: properties.user_id },
    ]);
    expect(sent[0].event.properties).not.toHaveProperty("user_id");
  });

  it("still drops a phone number written beside a uuid", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { waitUntil, pending } = invocation();
    await captureEvent(env(), "push_attempt", COMPANY, {
      call_session_id: `a1000000-0000-4000-8000-00000000000a ${PHONE}`,
    }, waitUntil);
    await Promise.all(pending);

    const event = sent.find(({ event }) => event.event === "push_attempt");
    expect(event?.event.properties).not.toHaveProperty("call_session_id");
    log.mockRestore();
  });
});
