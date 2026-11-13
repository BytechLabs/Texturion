/** @vitest-environment happy-dom */
import type { AppReleasePolicy } from "@loonext/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { isSuperseded, requirementFor, useDeployedVersion, type WebBuild } from "./app-release";

const NO_DEMANDS: AppReleasePolicy = {
  platform: "web",
  recommended_version: null,
  minimum_version: null,
  message: null,
  update_url: null,
};

const tab = (version: string | null, build: string | null = null): WebBuild => ({
  version,
  build,
});

describe("requirementFor (#710)", () => {
  it("offers a reload when the server is serving a newer web build", () => {
    expect(requirementFor(tab("0.25.0"), NO_DEMANDS, tab("0.26.0"))).toBe("soft");
    expect(requirementFor(tab("0.25.0"), null, tab("0.25.1"))).toBe("soft");
  });

  it("says nothing when this tab is the live build, or either version is unknown", () => {
    expect(requirementFor(tab("0.26.0"), NO_DEMANDS, tab("0.26.0"))).toBe("none");
    expect(requirementFor(tab("0.26.0"), NO_DEMANDS, null)).toBe("none");
    expect(requirementFor(tab(null), NO_DEMANDS, tab("0.26.0"))).toBe("none");
  });

  it("never turns a newer deploy into a block, and keeps the policy's block", () => {
    expect(
      requirementFor(tab("0.25.0"), { ...NO_DEMANDS, minimum_version: "0.26.0" }, tab("0.25.0")),
    ).toBe("block");
    expect(requirementFor(tab("0.25.0"), NO_DEMANDS, tab("9.0.0"))).toBe("soft");
  });

  it("offers a reload for a different build at the same version", () => {
    // A redeploy that changed the web bundle without a web release.
    expect(
      requirementFor(tab("0.30.2", "build-a"), NO_DEMANDS, tab("0.30.2", "build-b")),
    ).toBe("soft");
  });
});

describe("isSuperseded", () => {
  it("compares build ids when both sides have one", () => {
    expect(isSuperseded(tab("0.30.2", "build-a"), tab("0.30.2", "build-b"))).toBe(true);
    // The same bundle redeployed: nothing to reload, whatever the versions say.
    expect(isSuperseded(tab("0.30.2", "build-a"), tab("0.30.3", "build-a"))).toBe(false);
  });

  it("falls back to the version when either side has no build id", () => {
    expect(isSuperseded(tab("0.30.2", "build-a"), tab("0.30.3"))).toBe(true);
    expect(isSuperseded(tab("0.30.2"), tab("0.30.2", "build-b"))).toBe(false);
    expect(isSuperseded(tab("0.30.2", "build-a"), null)).toBe(false);
  });
});

describe("useDeployedVersion", () => {
  function renderDeployed(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
    );
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    return { client, ...renderHook(() => useDeployedVersion(), { wrapper }) };
  }

  it("reads the version and the build id", async () => {
    const { result } = renderDeployed({ version: "0.30.2", build: "build-b" });
    await waitFor(() => expect(result.current.data).toEqual(tab("0.30.2", "build-b")));
  });

  it("treats an empty build id as none", async () => {
    const { result } = renderDeployed({ version: "0.30.2", build: "" });
    await waitFor(() => expect(result.current.data).toEqual(tab("0.30.2")));
  });

  it("keeps polling while the tab is hidden", async () => {
    const { client, result } = renderDeployed({ version: "0.30.2", build: "build-b" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: ["app-version", "web"] });
    expect(query?.options).toMatchObject({
      refetchInterval: 10 * 60 * 1000,
      refetchIntervalInBackground: true,
    });
  });
});
