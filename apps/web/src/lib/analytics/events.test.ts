import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// events.ts routes every helper through initPostHog — mock the module so the
// tests control whether analytics is on (a capture spy) or off (null).
const { captureSpy, initPostHogMock } = vi.hoisted(() => {
  const captureSpy = vi.fn();
  return {
    captureSpy,
    // Return type spans both analytics states: a client with `capture`, or
    // null when NEXT_PUBLIC_POSTHOG_KEY is unset (the "off" test overrides it).
    initPostHogMock: vi.fn(
      (): Promise<{ capture: typeof captureSpy } | null> =>
        Promise.resolve({ capture: captureSpy }),
    ),
  };
});
vi.mock("./posthog", () => ({ initPostHog: initPostHogMock }));

/** Minimal in-memory Storage double (node test env has no DOM). */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

async function importEvents() {
  return import("./events");
}

/** capture() is fire-and-forget — flush the microtask queue before asserting. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  captureSpy.mockClear();
  initPostHogMock.mockClear();
  initPostHogMock.mockImplementation(() =>
    Promise.resolve({ capture: captureSpy }),
  );
  vi.stubGlobal("window", {
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("funnel event helpers (D8: enums only, silent no-op when analytics is off)", () => {
  it("signup_started fires bare, and with plan/module enums when intent exists", async () => {
    const { trackSignupStarted } = await importEvents();
    trackSignupStarted();
    trackSignupStarted({ plan: "pro", modules: ["mms", "voice"] });
    await flush();
    expect(captureSpy).toHaveBeenNthCalledWith(1, "signup_started", undefined);
    expect(captureSpy).toHaveBeenNthCalledWith(2, "signup_started", {
      plan: "pro",
      modules: ["mms", "voice"],
    });
  });

  it("signup_completed fires exactly once per browser (localStorage guard)", async () => {
    const { trackSignupCompleted } = await importEvents();
    trackSignupCompleted();
    trackSignupCompleted();
    trackSignupCompleted();
    await flush();
    expect(captureSpy).toHaveBeenCalledExactlyOnceWith("signup_completed");
  });

  it("onboarding_step_completed carries the step enum", async () => {
    const { trackOnboardingStepCompleted } = await importEvents();
    trackOnboardingStepCompleted("business");
    await flush();
    expect(captureSpy).toHaveBeenCalledExactlyOnceWith(
      "onboarding_step_completed",
      { step: "business" },
    );
  });

  it("plan_selected and checkout_started carry plan + modules", async () => {
    const { trackCheckoutStarted, trackPlanSelected } = await importEvents();
    trackPlanSelected("starter", ["extra_storage"]);
    trackCheckoutStarted("starter", ["extra_storage"]);
    await flush();
    expect(captureSpy).toHaveBeenNthCalledWith(1, "plan_selected", {
      plan: "starter",
      modules: ["extra_storage"],
    });
    expect(captureSpy).toHaveBeenNthCalledWith(2, "checkout_started", {
      plan: "starter",
      modules: ["extra_storage"],
    });
  });

  it("checkout_completed fires exactly once per tab (sessionStorage guard)", async () => {
    const { trackCheckoutCompleted } = await importEvents();
    trackCheckoutCompleted();
    trackCheckoutCompleted();
    await flush();
    expect(captureSpy).toHaveBeenCalledExactlyOnceWith("checkout_completed");
  });

  it("every helper is a silent no-op when analytics is off (initPostHog → null)", async () => {
    initPostHogMock.mockImplementation(() => Promise.resolve(null));
    const events = await importEvents();
    expect(() => {
      events.trackSignupStarted({ plan: "pro", modules: [] });
      events.trackSignupCompleted();
      events.trackOnboardingStepCompleted("plan");
      events.trackPlanSelected("pro", ["mms"]);
      events.trackCheckoutStarted("pro", ["mms"]);
      events.trackCheckoutCompleted();
    }).not.toThrow();
    await flush();
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("guards fail open without a window (SSR) — capture still fires", async () => {
    vi.unstubAllGlobals();
    const { trackCheckoutCompleted, trackSignupCompleted } =
      await importEvents();
    trackSignupCompleted();
    trackCheckoutCompleted();
    await flush();
    expect(captureSpy).toHaveBeenCalledWith("signup_completed");
    expect(captureSpy).toHaveBeenCalledWith("checkout_completed");
  });
});
