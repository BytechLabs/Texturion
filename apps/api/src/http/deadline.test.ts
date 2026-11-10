import { afterEach, describe, expect, it, vi } from "vitest";

import { deadline, fetchWithDeadline } from "./deadline";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchWithDeadline", () => {
  it("leaves no timer pending once the response is read", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":true}'));
    const response = await fetchWithDeadline("https://example.test/", undefined, 20_000);
    expect(await response.json()).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer pending when the request fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(fetchWithDeadline("https://example.test/", undefined, 20_000)).rejects.toThrow("down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a request that never answers, as a TimeoutError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const error = await fetchWithDeadline("https://example.test/", undefined, 5).catch((cause) => cause);
    expect((error as Error).name).toBe("TimeoutError");
  });

  it("passes a body-less status through without a body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const response = await fetchWithDeadline("https://example.test/", undefined, 1_000);
    expect(response.status).toBe(204);
  });

  it("still honours the caller's own signal", async () => {
    let seen: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      seen = init?.signal ?? undefined;
      return new Response("[]");
    });
    const caller = new AbortController();
    await fetchWithDeadline("https://example.test/", { signal: caller.signal }, 1_000);
    caller.abort();
    expect(seen?.aborted).toBe(true);
  });
});

describe("deadline", () => {
  it("does not abort after clear", async () => {
    const limit = deadline(5);
    limit.clear();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(limit.signal.aborted).toBe(false);
  });
});
