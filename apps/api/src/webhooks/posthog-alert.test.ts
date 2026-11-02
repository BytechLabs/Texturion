/**
 * #652: PostHog's error-tracking alerts, delivered to the founder by email.
 *
 * The shared secret is the only authentication this endpoint has, and it
 * protects the founder's inbox, so most of this is about rejection. The body
 * fixtures follow PostHog's webhook destination: the template's default body is
 * `{ event, person }` (the `event` and `person` globals), and the error
 * tracking alert event carries `name`, `description`, `status`, `fingerprint`
 * and `exception_timestamp` in `properties`, with the issue id as
 * `distinct_id` (posthog.com/docs/data-pipelines/destinations/customizing-destinations,
 * and products/error_tracking/skills/authoring-error-tracking-alerts in the
 * PostHog repository).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { opsAlert } from "../observability/ops-alert";
import type { ThrottleCache } from "../observability/ops-email-throttle";
import { resetSentryCaptures } from "../test/sentry-mock";
import { completeEnv, stubFetch } from "../test/support";
import {
  OPS_SECRET_HEADER,
  parsePostHogAlert,
  posthogAlertWebhookRoute,
} from "./posthog-alert";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

/** Built from a readable stem, so no scanner reads it as a credential. */
const SECRET = ["posthog", "alert", "secret", "for", "tests"].join("-").padEnd(40, "x");
const OTHER_SECRET = ["a", "different", "secret", "for", "tests"].join("-").padEnd(40, "y");

const env = { ...completeEnv(), OPS_ALERT_WEBHOOK_SECRET: SECRET };

/** What the webhook template posts for an issue the first time it appears. */
function createdFixture(overrides: { fingerprint?: string; name?: string } = {}) {
  return {
    event: {
      uuid: "0198a8c4-77f2-7c2e-9d4b-3b1c1f6a2e10",
      event: "$error_tracking_issue_created",
      distinct_id: "0198a8c4-6e1d-7a55-8f0e-9a4c2b7d1f33",
      timestamp: "2026-11-02T09:14:07.512Z",
      url: "https://us.posthog.com/project/12345/events/0198a8c4-77f2-7c2e-9d4b-3b1c1f6a2e10/2026-11-02T09%3A14%3A07.512000%2B00%3A00",
      properties: {
        name: overrides.name ?? "Error",
        description: "Telnyx wiring: the voice connection points at the wrong webhook",
        status: "active",
        fingerprint: overrides.fingerprint ?? "ops:telnyx-wiring",
        exception_timestamp: "2026-11-02T09:14:07.000Z",
        $exception_issue_id: "0198a8c4-6e1d-7a55-8f0e-9a4c2b7d1f33",
        $exception_types: ["Error"],
        environment: "production",
      },
    },
    person: {
      id: "0198a8c4-0000-7000-8000-000000000000",
      name: "loonext-api",
      url: "https://us.posthog.com/project/12345/person/loonext-api",
      properties: {},
    },
  };
}

function reopenedFixture() {
  const fixture = createdFixture();
  return { ...fixture, event: { ...fixture.event, event: "$error_tracking_issue_reopened" } };
}

function spikingFixture() {
  const fixture = createdFixture();
  return {
    ...fixture,
    event: {
      ...fixture.event,
      event: "$error_tracking_issue_spiking",
      properties: {
        name: "Error",
        description: "Telnyx wiring",
        fingerprint: "ops:telnyx-wiring",
        exception_timestamp: "2026-11-02T09:14:07.000Z",
        current_bucket_value: "42",
        computed_baseline: "3",
      },
    },
  };
}

interface SentMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/** Captures what reaches Resend; `failures` makes that many sends blow up first. */
function world(options: { failures?: number } = {}) {
  const mail: SentMail[] = [];
  let failures = options.failures ?? 0;
  stubFetch((url, request) => {
    if (url.host !== "api.resend.com") return undefined;
    if (failures > 0) {
      failures -= 1;
      return new Response("upstream down", { status: 500 });
    }
    return (async () => {
      mail.push((await request.clone().json()) as SentMail);
      return Response.json({ id: "email-1" });
    })();
  });
  return mail;
}

/** An in-memory stand-in for `caches.default`, with the same keying by URL. */
function fakeCache(): ThrottleCache & { size(): number } {
  const stored = new Map<string, Response>();
  return {
    async match(request) {
      return stored.get(request.url)?.clone();
    },
    async put(request, response) {
      stored.set(request.url, response);
    },
    async delete(request) {
      return stored.delete(request.url);
    },
    size: () => stored.size,
  };
}

function post(body: unknown, headers: Record<string, string> = { [OPS_SECRET_HEADER]: SECRET }, testEnv: Env = env) {
  return posthogAlertWebhookRoute.request(
    "/",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    testEnv,
  );
}

beforeEach(() => {
  resetSentryCaptures();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authentication", () => {
  it("refuses everything while no secret is configured", async () => {
    const mail = world();
    const res = await post(createdFixture(), { [OPS_SECRET_HEADER]: SECRET }, {
      ...env,
      OPS_ALERT_WEBHOOK_SECRET: undefined,
    });

    expect(res.status).toBe(503);
    expect(mail).toHaveLength(0);
  });

  it("refuses a request with no secret header", async () => {
    const mail = world();
    const res = await post(createdFixture(), {});

    expect(res.status).toBe(401);
    expect(mail).toHaveLength(0);
  });

  it("refuses a request with the wrong secret", async () => {
    const mail = world();
    const res = await post(createdFixture(), { [OPS_SECRET_HEADER]: OTHER_SECRET });

    expect(res.status).toBe(401);
    expect(mail).toHaveLength(0);
  });

  it("refuses a secret that is a prefix of the real one", async () => {
    const mail = world();
    const res = await post(createdFixture(), { [OPS_SECRET_HEADER]: SECRET.slice(0, 20) });

    expect(res.status).toBe(401);
    expect(mail).toHaveLength(0);
  });

  it("checks the secret before reading the body", async () => {
    const mail = world();
    const res = await post("{ not json", { [OPS_SECRET_HEADER]: OTHER_SECRET });

    expect(res.status).toBe(401);
    expect(mail).toHaveLength(0);
  });
});

describe("the payload", () => {
  it("mails a new issue to the ops address, with its key and a PostHog link", async () => {
    const mail = world();
    const res = await post(createdFixture());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, delivery: "sent" });
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toEqual([env.OPS_ALERT_EMAIL]);
    expect(mail[0].subject).toBe("[ops] Error");
    expect(mail[0].text).toContain("New issue: Error");
    expect(mail[0].text).toContain("the voice connection points at the wrong webhook");
    expect(mail[0].text).toContain("Key: ops:telnyx-wiring");
    expect(mail[0].text).toContain("https://us.posthog.com/project/12345/events/");
    expect(mail[0].html).toContain("Open in PostHog");
    // Not customer mail.
    expect(mail[0].text).not.toMatch(/service message about your/i);
  });

  it("says when an issue was reopened", async () => {
    const mail = world();
    const res = await post(reopenedFixture());

    expect(res.status).toBe(200);
    expect(mail[0].text).toContain("Issue reopened: Error");
  });

  it("acknowledges an event it has no use for, and mails nothing", async () => {
    const mail = world();
    const res = await post(spikingFixture());

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ received: true, delivery: "ignored" });
    expect(mail).toHaveLength(0);
  });

  it("rejects a body that is not an alert", async () => {
    const mail = world();

    expect((await post({ hello: "world" })).status).toBe(422);
    expect((await post([1, 2, 3])).status).toBe(422);
    expect((await post("{ not json")).status).toBe(400);
    expect(mail).toHaveLength(0);
  });

  it("drops a link that does not point into PostHog", async () => {
    const mail = world();
    const fixture = createdFixture();
    fixture.event.url = "https://evil.example.com/phish";
    await post(fixture);

    expect(mail[0].text).not.toContain("evil.example.com");
    expect(mail[0].html).not.toContain("evil.example.com");
  });

  it("escapes markup in the issue text and keeps the subject on one line", async () => {
    const mail = world();
    const fixture = createdFixture({ name: "Boom\r\nBcc: someone@example.com" });
    fixture.event.properties.description = "<script>alert(1)</script>";
    await post(fixture);

    expect(mail[0].subject).toBe("[ops] Boom Bcc: someone@example.com");
    expect(mail[0].html).not.toContain("<script>");
    expect(mail[0].html).toContain("&lt;script&gt;");
  });

  it("answers 503 when there is nobody to mail", async () => {
    const mail = world();
    const bare = { ...env, OPS_ALERT_EMAIL: undefined };
    const res = await post(createdFixture(), { [OPS_SECRET_HEADER]: SECRET }, bare);

    expect(res.status).toBe(503);
    expect(mail).toHaveLength(0);
  });
});

describe("parsePostHogAlert", () => {
  it("groups by the issue's own fingerprint", () => {
    expect(parsePostHogAlert(createdFixture())).toMatchObject({
      fingerprint: "ops:telnyx-wiring",
      title: "Error",
      status: "active",
      event: "$error_tracking_issue_created",
    });
  });

  it("falls back to $exception_fingerprint, then to the issue id", () => {
    const fixture = createdFixture();
    const props = fixture.event.properties as Record<string, unknown>;
    delete props.fingerprint;
    props.$exception_fingerprint = "ops:from-the-exception";
    expect(parsePostHogAlert(fixture)).toMatchObject({ fingerprint: "ops:from-the-exception" });

    delete props.$exception_fingerprint;
    expect(parsePostHogAlert(fixture)).toMatchObject({ fingerprint: fixture.event.distinct_id });
  });

  it("titles an issue with no name rather than failing", () => {
    const fixture = createdFixture();
    delete (fixture.event.properties as Record<string, unknown>).name;
    expect(parsePostHogAlert(fixture)).toMatchObject({ title: "Error issue" });
  });
});

describe("one email per fingerprint per hour", () => {
  let cache: ReturnType<typeof fakeCache>;

  beforeEach(() => {
    cache = fakeCache();
    vi.stubGlobal("caches", { default: cache });
  });

  it("sends one mail for a storm of the same fingerprint", async () => {
    const mail = world();
    const answers: unknown[] = [];
    for (let i = 0; i < 50; i += 1) {
      answers.push(await (await post(createdFixture())).json());
    }

    expect(mail).toHaveLength(1);
    expect(answers[0]).toEqual({ received: true, delivery: "sent" });
    expect(answers[1]).toEqual({ received: true, delivery: "throttled" });
  });

  it("keeps two fingerprints apart", async () => {
    const mail = world();
    await post(createdFixture({ fingerprint: "ops:one" }));
    await post(createdFixture({ fingerprint: "ops:two" }));
    await post(createdFixture({ fingerprint: "ops:one" }));

    expect(mail.map((m) => m.text.match(/Key: (\S+)/)?.[1])).toEqual(["ops:one", "ops:two"]);
  });

  it("gives the slot back when the send fails, so PostHog's retry delivers", async () => {
    const mail = world({ failures: 1 });
    const failed = await post(createdFixture());
    expect(failed.status).toBe(502);
    expect(cache.size()).toBe(0);

    const retried = await post(createdFixture());
    expect(retried.status).toBe(200);
    expect(mail).toHaveLength(1);
  });

  it("shares the hour with opsAlert, so a direct mail and PostHog's do not both go", async () => {
    const mail = world();
    await opsAlert(env, { key: "telnyx-wiring", summary: "Telnyx wiring is off" });
    expect(mail).toHaveLength(1);

    const res = await post(createdFixture({ fingerprint: "ops:telnyx-wiring" }));
    expect(await res.json()).toEqual({ received: true, delivery: "throttled" });
    expect(mail).toHaveLength(1);
  });

  it("sends anyway when the cache is unusable", async () => {
    const mail = world();
    vi.stubGlobal("caches", {
      default: {
        match: async () => {
          throw new Error("cache down");
        },
        put: async () => undefined,
        delete: async () => false,
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await post(createdFixture());

    expect(res.status).toBe(200);
    expect(mail).toHaveLength(1);
  });
});
