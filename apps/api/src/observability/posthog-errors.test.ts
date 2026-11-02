import type { ErrorEvent } from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";

import { completeEnv } from "../test/support";
import {
  ERROR_DISTINCT_ID,
  mirrorToPostHog,
  posthogFingerprint,
  toPostHogException,
} from "./posthog-errors";
import { scrubEvent, sentryOptions } from "./sentry";

const PHONE = "+14165551234";
const KEY = "phc_test_key_for_unit_tests";

const env = { ...completeEnv(), POSTHOG_API_KEY: KEY };

function opsEvent(): ErrorEvent {
  return {
    type: undefined,
    message: `Telnyx wiring is broken for ${PHONE}`,
    level: "warning",
    fingerprint: ["ops", "telnyx-wiring"],
    tags: { ops_key: "telnyx-wiring" },
    extra: { detail: "no webhook in 6h", action: "check the number profile" },
    environment: "production",
    release: "abc123",
  };
}

function thrownEvent(): ErrorEvent {
  return {
    type: undefined,
    level: "error",
    exception: {
      values: [
        {
          type: "TypeError",
          value: "x is not a function",
          mechanism: { type: "auto.http.cloudflare", handled: false },
          stacktrace: {
            frames: [
              { filename: "index.js", function: "outer", lineno: 1, colno: 2 },
              { filename: "send.js", function: "inner", lineno: 10, colno: 4, in_app: true },
            ],
          },
        },
      ],
    },
    request: { method: "POST", url: "https://api.loonext.com/v1/messages" },
  };
}

describe("posthogFingerprint (D139: the same key in both trackers)", () => {
  it("joins our own fingerprint with a colon", () => {
    expect(posthogFingerprint(["ops", "telnyx-wiring"])).toBe("ops:telnyx-wiring");
  });

  it("leaves default grouping to PostHog", () => {
    expect(posthogFingerprint(undefined)).toBeUndefined();
    expect(posthogFingerprint([])).toBeUndefined();
    expect(posthogFingerprint(["{{ default }}"])).toBeUndefined();
  });
});

describe("toPostHogException", () => {
  it("turns an ops alert into an OpsAlert exception grouped by its key", () => {
    const sent = toPostHogException(opsEvent(), env);
    expect(sent?.event).toBe("$exception");
    expect(sent?.distinct_id).toBe(ERROR_DISTINCT_ID);
    expect(sent?.properties.$exception_fingerprint).toBe("ops:telnyx-wiring");
    expect(sent?.properties.$exception_level).toBe("warning");
    expect(sent?.properties.ops_key).toBe("telnyx-wiring");
    expect(sent?.properties.$process_person_profile).toBe(false);
    expect(sent?.properties.environment).toBe("production");
    expect(sent?.properties.$exception_list).toEqual([
      {
        type: "OpsAlert",
        value: `Telnyx wiring is broken for ${PHONE}`,
        mechanism: { handled: true, synthetic: true },
      },
    ]);
  });

  it("keeps a thrown error's stack and leaves grouping to PostHog", () => {
    const sent = toPostHogException(thrownEvent(), env);
    expect(sent?.properties.$exception_fingerprint).toBeUndefined();
    const [first] = sent?.properties.$exception_list as {
      type: string;
      mechanism: { handled: boolean };
      stacktrace: { frames: { function: string; in_app?: boolean }[] };
    }[];
    expect(first.type).toBe("TypeError");
    expect(first.mechanism.handled).toBe(false);
    expect(first.stacktrace.frames.map((frame) => frame.function)).toEqual([
      "outer",
      "inner",
    ]);
    expect(sent?.properties.request_url).toBe("https://api.loonext.com/v1/messages");
  });

  it("identifies by the event's user id when there is one", () => {
    const event = thrownEvent();
    event.user = { id: "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01" };
    expect(toPostHogException(event, env)?.distinct_id).toBe(
      "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01",
    );
  });

  it("says nothing for an event with no message and no exception", () => {
    expect(toPostHogException({ type: undefined }, env)).toBeNull();
  });
});

describe("mirrorToPostHog", () => {
  it("posts the scrubbed event to the capture endpoint with the project key", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    await mirrorToPostHog(env, scrubEvent(opsEvent()), fetchSpy as unknown as typeof fetch);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.api_key).toBe(KEY);
    expect(body.event).toBe("$exception");
    // Scrubbed BEFORE it left: the phone number is not in the request.
    expect(String(init.body)).not.toContain(PHONE);
    expect(String(init.body)).toContain("[phone redacted]");
  });

  it("does nothing when analytics is off", async () => {
    const fetchSpy = vi.fn();
    await mirrorToPostHog(completeEnv(), opsEvent(), fetchSpy as unknown as typeof fetch);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never rejects when PostHog is down or refuses", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      mirrorToPostHog(env, opsEvent(), (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    await expect(
      mirrorToPostHog(
        env,
        opsEvent(),
        (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});

describe("sentryOptions().beforeSend", () => {
  it("returns the scrubbed event whether or not the PostHog copy worked", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("posthog unreachable"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const options = sentryOptions(env);

    const sent = await options.beforeSend?.(opsEvent(), {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sent?.message).toBe("Telnyx wiring is broken for [phone redacted]");
    expect(sent?.fingerprint).toEqual(["ops", "telnyx-wiring"]);
    fetchSpy.mockRestore();
    errors.mockRestore();
  });
});
