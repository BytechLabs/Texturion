/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

import { inAppPath, NotificationRouter } from "./notification-router";

const ORIGIN = window.location.origin;

let worker: EventTarget;

/** What sw.js sends: the message, with a port it waits on for the answer. */
function postFromWorker(data: unknown) {
  const reply = vi.fn();
  const event = Object.assign(new Event("message"), {
    data,
    ports: [{ postMessage: reply }],
  });
  worker.dispatchEvent(event);
  return reply;
}

beforeEach(() => {
  worker = new EventTarget();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: worker,
  });
});

afterEach(() => {
  cleanup();
  push.mockClear();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("NotificationRouter", () => {
  it("routes a notification tap inside the tab and tells the worker it did", () => {
    render(<NotificationRouter />);
    const reply = postFromWorker({ type: "loonext:navigate", path: "/calls?call=sess-A" });
    expect(push).toHaveBeenCalledWith("/calls?call=sess-A");
    expect(reply).toHaveBeenCalledWith({ ok: true });
  });

  it("refuses a path that leaves this origin, so the worker falls back", () => {
    render(<NotificationRouter />);
    for (const path of ["//evil.example.com/x", "https://evil.example.com/", "/\\evil.example.com"]) {
      const reply = postFromWorker({ type: "loonext:navigate", path });
      expect(reply, path).toHaveBeenCalledWith({ ok: false });
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores the worker's other messages", () => {
    render(<NotificationRouter />);
    const reply = postFromWorker({ type: "loonext:push-subscription-changed" });
    expect(push).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<NotificationRouter />);
    unmount();
    const reply = postFromWorker({ type: "loonext:navigate", path: "/inbox" });
    expect(push).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("where it is mounted", () => {
  it("is in the signed-in layout, the only place with an in-app router to answer", () => {
    const layout = readFileSync(
      join(__dirname, "../../app/(app)/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("<NotificationRouter />");
  });
});

describe("inAppPath", () => {
  it("keeps the query and the hash of a same-origin path", () => {
    expect(inAppPath("/inbox/t-1?tab=notes#n-2", ORIGIN)).toBe("/inbox/t-1?tab=notes#n-2");
  });

  it("rejects anything that is not a string path", () => {
    expect(inAppPath(undefined, ORIGIN)).toBeNull();
    expect(inAppPath("inbox", ORIGIN)).toBeNull();
  });
});
