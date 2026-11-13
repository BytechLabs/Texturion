import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("/app-version.json", () => {
  it("names the version and the build id this deployment serves, uncached", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "0.31.0");
    vi.stubEnv("NEXT_PUBLIC_WEB_BUILD_ID", "web-build-b");
    const response = GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: "0.31.0", build: "web-build-b" });
  });

  it("says null for a build that was given no id", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "0.31.0");
    vi.stubEnv("NEXT_PUBLIC_WEB_BUILD_ID", "");
    expect(await GET().json()).toEqual({ version: "0.31.0", build: null });
  });
});
