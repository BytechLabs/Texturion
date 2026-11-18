import { describe, expect, it } from "vitest";

import { scrubText } from "./posthog";

describe(scrubText, () => {
  it("redacts addresses and phones while keeping surrounding punctuation", () => {
    expect(scrubText("Ask (owner+ops@example.com), office@example.org. Call +14165550100.")).toBe(
      "Ask ([email redacted]), [email redacted]. Call [phone redacted].",
    );
  });
});
