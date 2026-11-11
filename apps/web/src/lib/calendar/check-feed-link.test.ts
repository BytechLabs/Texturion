// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { checkFeedLink } from "./check-feed-link";

const respond = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

describe("#744 checkFeedLink", () => {
  it("says working for a calendar answer", async () => {
    const f = respond("BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    expect(await checkFeedLink("https://api.example/calendar/t/schedule.ics", f)).toEqual({
      state: "working",
    });
  });

  it("reports the status when the link is a page not found", async () => {
    expect(await checkFeedLink("https://x/y", respond("Not found", 404))).toEqual({
      state: "error",
      status: 404,
    });
  });

  it("does not trust a 200 that is not a calendar", async () => {
    expect(await checkFeedLink("https://x/y", respond("<html></html>"))).toEqual({
      state: "error",
      status: 200,
    });
  });

  it("reports unreachable when the request fails", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await checkFeedLink("https://x/y", f)).toEqual({ state: "unreachable" });
  });
});
