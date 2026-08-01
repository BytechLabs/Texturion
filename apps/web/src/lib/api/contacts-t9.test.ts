/**
 * #459 — the dialer's contact fetch.
 *
 * The one thing worth pinning on this side of the wire: `t9=1` is sent when
 * the keypad asks and never otherwise. The contacts search box and the dialer
 * call the same function, and only one of them means "these digits might be a
 * name".
 *
 * Mocks the browser session module rather than the client, so the URL under
 * test is the one `fetchContactsPage` actually builds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");
vi.mock("@/lib/supabase/browser", () => ({
  getAccessToken: async () => "test-token",
}));

/**
 * Stubbed BEFORE the dynamic import: `createApiClient` captures `fetch` once,
 * when the module is first evaluated, so a stub installed later would never be
 * seen. This is also why the capture is a mutable holder rather than a fresh
 * spy per test.
 */
let seenUrl = "";
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL) => {
    seenUrl = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify({ data: [], next_cursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
);

const { fetchContactsPage } = await import("./contacts");

beforeEach(() => {
  seenUrl = "";
});

describe("fetchContactsPage", () => {
  it("does not send t9 by default", async () => {
    await fetchContactsPage("company-1", "416");
    expect(seenUrl).not.toContain("t9=");
  });

  it("sends t9=1 when the keypad asks", async () => {
    await fetchContactsPage("company-1", "262", undefined, true);
    expect(seenUrl).toContain("t9=1");
    expect(seenUrl).toContain("q=262");
  });

  it("omits t9 on an empty query, so it cannot ask for the whole book", async () => {
    await fetchContactsPage("company-1", "", undefined, true);
    expect(seenUrl).not.toContain("t9=");
  });
});
