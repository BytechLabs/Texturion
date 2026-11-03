import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PHONE = "+16135551234";
const EMAIL = "a@b.co";

interface SentEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}

let sent: { body: string; event: SentEvent }[];

async function importCapture(key: string | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key ?? "");
  vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "production");
  return import("./server-errors");
}

const CONTEXT = {
  routerKind: "App Router",
  routePath: "/photos/[token]",
  routeType: "render",
};

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as { batch: SentEvent[] };
      for (const event of payload.batch) sent.push({ body: init.body, event });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("captureServerError (onRequestError → posthog-node)", () => {
  it("sends a thrown error with its phone number and email address scrubbed", async () => {
    const { captureServerError } = await importCapture("phc_web_test_key");
    await captureServerError(new Error(`${PHONE} ${EMAIL}`), "GET", CONTEXT);

    expect(sent).toHaveLength(1);
    const [{ body, event }] = sent;
    expect(event.event).toBe("$exception");
    expect(event.distinct_id).toBe("loonext-web");
    const [entry] = event.properties.$exception_list as { value: string }[];
    expect(entry.value).toBe("[phone redacted] [email redacted]");
    expect(body).not.toContain("6135551234");
    expect(body).not.toContain(EMAIL);
  });

  it("keeps the route pattern and the deployment, never the requested path", async () => {
    const { captureServerError } = await importCapture("phc_web_test_key");
    const error = Object.assign(new Error("boom"), { digest: "d1g3st" });
    await captureServerError(error, "POST", CONTEXT);

    const [{ event }] = sent;
    expect(event.properties).toMatchObject({
      environment: "production",
      source: "web-server",
      route: "/photos/[token]",
      route_type: "render",
      method: "POST",
      digest: "d1g3st",
      $process_person_profile: false,
    });
  });

  it("sends nothing without a project key", async () => {
    const { captureServerError } = await importCapture(undefined);
    await captureServerError(new Error("x"), "GET", CONTEXT);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves when PostHog is down", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { captureServerError } = await importCapture("phc_web_test_key");
    await expect(captureServerError(new Error("x"), "GET", CONTEXT)).resolves.toBeUndefined();
  });
});
