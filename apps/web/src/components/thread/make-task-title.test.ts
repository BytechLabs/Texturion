import { describe, expect, it } from "vitest";

import { messageTaskTitle } from "./make-task-title";

describe("messageTaskTitle (T5.1 default title seed)", () => {
  it("collapses whitespace/newlines to a single line", () => {
    expect(messageTaskTitle("Fix the   leak\nunder the sink")).toBe(
      "Fix the leak under the sink",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(messageTaskTitle("   hello  ")).toBe("hello");
  });

  it("falls back to a sensible default for an empty/whitespace body", () => {
    expect(messageTaskTitle("")).toBe("Follow up");
    expect(messageTaskTitle("   \n  ")).toBe("Follow up");
  });

  it("truncates a long body to 120 chars with an ellipsis", () => {
    const long = "a".repeat(200);
    const out = messageTaskTitle(long);
    expect(out).toHaveLength(118); // 117 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, 117)).toBe("a".repeat(117));
  });

  it("keeps a body exactly at the 120-char boundary intact", () => {
    const exact = "b".repeat(120);
    expect(messageTaskTitle(exact)).toBe(exact);
  });
});
