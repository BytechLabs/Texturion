import { afterEach, describe, expect, it, vi } from "vitest";

const { settle } = vi.hoisted(() => ({
  settle: vi.fn(() => new Promise<void>(() => {})),
}));
vi.mock("./after-lcp-and-load", () => ({ whenPageSettles: settle }));

import { whenTelemetryMayLoad } from "./telemetry-gate";

afterEach(() => {
  vi.unstubAllGlobals();
  settle.mockClear();
});

async function resolvesAtOnce(gate: Promise<void>): Promise<boolean> {
  let done = false;
  void gate.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 0));
  return done;
}

describe("whenTelemetryMayLoad", () => {
  it("waits for the page to settle on a marketing page (#640)", async () => {
    for (const pathname of ["/", "/pricing", "/fr/tarifs", "/blog/some-post"]) {
      vi.stubGlobal("window", { location: { pathname } });
      expect(await resolvesAtOnce(whenTelemetryMayLoad()), pathname).toBe(false);
    }
    expect(settle).toHaveBeenCalledTimes(4);
  });

  it("does not wait on the app, where nothing is scored", async () => {
    for (const pathname of ["/inbox", "/for-you", "/settings/billing", "/login", "/onboarding"]) {
      vi.stubGlobal("window", { location: { pathname } });
      expect(await resolvesAtOnce(whenTelemetryMayLoad()), pathname).toBe(true);
    }
    expect(settle).not.toHaveBeenCalled();
  });
});
