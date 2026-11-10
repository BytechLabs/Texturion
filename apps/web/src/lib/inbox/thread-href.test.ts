import { describe, expect, it } from "vitest";

import { threadHref } from "./thread-href";

describe("#718 threadHref, the one way to open a thread at something", () => {
  it("is the plain thread with no target", () => {
    expect(threadHref("c1")).toBe("/inbox/c1");
    expect(threadHref("c1", { messageId: null, taskId: null })).toBe("/inbox/c1");
  });

  it("anchors to a message, a call, and opens a task beside either", () => {
    expect(threadHref("c1", { messageId: "m1" })).toBe("/inbox/c1?message=m1");
    expect(threadHref("c1", { callSessionId: "s1" })).toBe("/inbox/c1?call=s1");
    expect(threadHref("c1", { messageId: "m1", taskId: "t1" })).toBe(
      "/inbox/c1?message=m1&task=t1",
    );
    expect(threadHref("c1", { taskId: "t1" })).toBe("/inbox/c1?task=t1");
  });

  it("a message wins when both a message and a call are given", () => {
    expect(threadHref("c1", { messageId: "m1", callSessionId: "s1" })).toBe(
      "/inbox/c1?message=m1",
    );
  });
});
