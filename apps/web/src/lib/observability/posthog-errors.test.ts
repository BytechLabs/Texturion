import type { ErrorEvent } from "@sentry/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureSpy, initPostHog } = vi.hoisted(() => {
  const captureSpy = vi.fn();
  return {
    captureSpy,
    initPostHog: vi.fn(async (): Promise<{ capture: typeof captureSpy } | null> => ({
      capture: captureSpy,
    })),
  };
});
vi.mock("@/lib/analytics/posthog", () => ({ initPostHog }));

import {
  mirrorToPostHog,
  posthogFingerprint,
  toPostHogProperties,
} from "./posthog-errors";
import { scrubEvent } from "./scrub";

const PHONE = "+14165551234";

function thrown(): ErrorEvent {
  return {
    type: undefined,
    environment: "production",
    exception: {
      values: [
        {
          type: "TypeError",
          value: `cannot read ${PHONE}`,
          mechanism: { type: "auto.browser.global_handlers.onerror", handled: false },
          stacktrace: { frames: [{ filename: "app.js", function: "go", lineno: 3, colno: 9 }] },
        },
      ],
    },
  };
}

beforeEach(() => {
  captureSpy.mockClear();
  initPostHog.mockClear();
});

describe("posthogFingerprint", () => {
  it("uses our own parts, and leaves the default to PostHog", () => {
    expect(posthogFingerprint(["ops", "x"])).toBe("ops:x");
    expect(posthogFingerprint(["{{ default }}"])).toBeUndefined();
    expect(posthogFingerprint(undefined)).toBeUndefined();
  });
});

describe("toPostHogProperties", () => {
  it("builds an $exception_list with the stack and the mechanism", () => {
    const properties = toPostHogProperties(thrown());
    expect(properties?.$exception_level).toBe("error");
    expect(properties?.$exception_fingerprint).toBeUndefined();
    const [first] = properties?.$exception_list as {
      type: string;
      mechanism: { handled: boolean };
      stacktrace: { frames: { function: string }[] };
    }[];
    expect(first.type).toBe("TypeError");
    expect(first.mechanism.handled).toBe(false);
    expect(first.stacktrace.frames[0].function).toBe("go");
  });

  it("says nothing for an empty event", () => {
    expect(toPostHogProperties({ type: undefined })).toBeNull();
  });
});

describe("mirrorToPostHog", () => {
  it("captures the SCRUBBED event as $exception", async () => {
    await mirrorToPostHog(scrubEvent(thrown()));
    expect(captureSpy).toHaveBeenCalledTimes(1);
    const [name, properties] = captureSpy.mock.calls[0] as [string, object];
    expect(name).toBe("$exception");
    expect(JSON.stringify(properties)).not.toContain(PHONE);
    expect(JSON.stringify(properties)).toContain("[phone redacted]");
  });

  it("does nothing when analytics is off", async () => {
    initPostHog.mockResolvedValueOnce(null);
    await expect(mirrorToPostHog(thrown())).resolves.toBeUndefined();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("never rejects when the client throws", async () => {
    captureSpy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(mirrorToPostHog(thrown())).resolves.toBeUndefined();
  });
});
