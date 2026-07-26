/**
 * #343 — "your notifications are paused", said to the crew.
 *
 * At the workspace's daily ceiling, alerts stop reaching every member while an
 * email goes to the owner alone. A tech's phone simply goes quiet, and the
 * reasonable inference from that side is that the business had a slow
 * afternoon. It is the same failure shape as #342 (a spam thread absorbing
 * messages) and #306 (a count that stopped at the page size): the product
 * stops reporting and says nothing about it.
 *
 * What is pinned here is that the notice is ABSENT on an ordinary day — a
 * banner that renders when nothing is wrong is the thing everyone learns to
 * ignore — and that when only one channel is spent it says which, because
 * "email is paused, push still works" and "you are getting nothing" are very
 * different messages to a crew.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AlertPause } from "@/lib/api/types";

// The notice lives in its own file rather than inside the bell. Its panel sits
// behind a Radix popover trigger and renders nothing at all in a server pass,
// so a test routed through the bell would have asserted against an empty
// string and passed for the wrong reason — and the bell's module graph reaches
// the API client, which validates public env on import.
import { NotificationPauseNotice } from "./pause-notice";

function paused(overrides: Partial<AlertPause> = {}): AlertPause {
  return {
    email_paused: true,
    push_paused: false,
    // Far enough out that the relative rendering is stable whenever this runs.
    resets_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function render(pause?: AlertPause): string {
  return renderToStaticMarkup(<NotificationPauseNotice pause={pause} />);
}

describe("the notification pause notice (#343)", () => {
  it("says nothing on an ordinary day", () => {
    const html = render({ email_paused: false, push_paused: false, resets_at: "" });
    expect(html).not.toContain("paused");
  });

  it("says nothing when the server is older and sends no pause at all", () => {
    expect(render(undefined)).not.toContain("paused");
  });

  it("names the channel, and says the other one still works", () => {
    // The difference between "we are broken" and "you are still covered".
    const html = render(paused());
    expect(html).toContain("Email alerts are paused");
    expect(html).toContain("still getting push");
  });

  it("does not claim push still works when it does not", () => {
    const html = render(paused({ email_paused: true, push_paused: true }));
    expect(html).toContain("Notifications are paused");
    expect(html).not.toContain("still getting push");
  });

  it("says the messages are still there, because that is the actual worry", () => {
    expect(render(paused())).toContain("messages are all still here");
  });
});
