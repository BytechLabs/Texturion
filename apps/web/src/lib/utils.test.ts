import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-2", "text-sm")).toBe("px-2 text-sm");
  });

  it("drops falsy conditional values", () => {
    expect(cn("base", false, undefined, null, "kept")).toBe("base kept");
  });

  it("lets the later Tailwind utility win a conflict", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
});
