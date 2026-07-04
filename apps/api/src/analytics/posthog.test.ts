/**
 * PostHog capture helper suite (SPEC §12 step 18, §10): key-unset no-op, the
 * exact capture wire shape (distinct_id = company_id, never PII), and the
 * never-throws guarantee. As everywhere, only global fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { capture, POSTHOG_CAPTURE_URL } from "./posthog";
import type { Env } from "../env";
import { stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";

const posthogMatch = (url: URL, request: Request) =>
  request.method === "POST" && url.href === POSTHOG_CAPTURE_URL;

function envWithKey(): Env {
  return { ...completeEnv(), POSTHOG_API_KEY: "phc_test_key" };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capture (analytics/posthog)", () => {
  it("is a silent no-op when POSTHOG_API_KEY is unset", async () => {
    const posthog = stubRoute(posthogMatch, () => ({ status: 1 }));
    stubFetch(posthog.route);

    await capture(completeEnv(), "checkout_completed", COMPANY_ID);
    expect(posthog.calls).toHaveLength(0);
  });

  it("POSTs the capture shape with the company id as distinct_id", async () => {
    const posthog = stubRoute(posthogMatch, () => ({ status: 1 }));
    stubFetch(posthog.route);

    await capture(envWithKey(), "registration_submitted", COMPANY_ID, {
      action: "brand_submitted",
    });

    expect(posthog.calls).toHaveLength(1);
    expect(posthog.calls[0].body).toEqual({
      api_key: "phc_test_key",
      event: "registration_submitted",
      distinct_id: COMPANY_ID,
      properties: { action: "brand_submitted" },
    });
    expect(posthog.calls[0].headers.get("content-type")).toBe(
      "application/json",
    );
  });

  it("defaults properties to an empty object", async () => {
    const posthog = stubRoute(posthogMatch, () => ({ status: 1 }));
    stubFetch(posthog.route);

    await capture(envWithKey(), "first_outbound_sent", COMPANY_ID);
    expect(posthog.calls[0].body).toMatchObject({
      event: "first_outbound_sent",
      properties: {},
    });
  });

  it("never throws: network failure and non-2xx both resolve", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // No route claims the request → stubFetch throws inside fetch itself.
    stubFetch();
    await expect(
      capture(envWithKey(), "checkout_completed", COMPANY_ID),
    ).resolves.toBeUndefined();

    const failing = stubRoute(
      posthogMatch,
      () => new Response("nope", { status: 500 }),
    );
    stubFetch(failing.route);
    await expect(
      capture(envWithKey(), "checkout_completed", COMPANY_ID),
    ).resolves.toBeUndefined();
    expect(failing.calls).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});
