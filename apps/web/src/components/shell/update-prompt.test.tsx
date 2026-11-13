/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppReleasePolicy, UpdateRequirement } from "@loonext/shared";

import type { WebBuild } from "@/lib/api/app-release";

/**
 * #339 — the update surfaces, and mostly the one property that matters:
 * NOTHING appears unless the server said something.
 *
 * A false block is the worst outcome this feature can produce — every
 * customer's business phone at once, per the issue's devil's advocate — so the
 * assertions that earn their place are the ones proving silence (no policy, a
 * current build) and the ones proving the block always carries its reason and
 * its way out.
 */

let requirement: UpdateRequirement = "none";
let policy: AppReleasePolicy | null = {
  platform: "web",
  recommended_version: "1.1.0",
  minimum_version: null,
  message: null,
  update_url: null,
};

let deployed: WebBuild | null = null;
let liveCall = false;

vi.mock("@/lib/api/app-release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/app-release")>()),
  APP_VERSION: "1.0.0",
  THIS_BUILD: { version: "1.0.0", build: "build-a" },
  useUpdateRequirement: () => requirement,
  useAppRelease: () => ({ data: policy }),
  useDeployedVersion: () => ({ data: deployed }),
}));
vi.mock("@/lib/softphone/live-call", () => ({
  hasLiveBrowserCall: () => liveCall,
}));

const { UpdatePrompt, dismissKey } = await import("./update-prompt");

function markup(): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <UpdatePrompt />
    </QueryClientProvider>,
  );
}

describe("UpdatePrompt", () => {
  it("renders nothing when the build is current", () => {
    requirement = "none";
    expect(markup()).toBe("");
  });

  it("renders nothing when the policy could not be fetched", () => {
    // A network blip must never become an update wall.
    requirement = "none";
    policy = null;
    expect(markup()).toBe("");
    policy = {
      platform: "web",
      recommended_version: "1.1.0",
      minimum_version: null,
      message: null,
      update_url: null,
    };
  });

  it("offers a dismissible card below the recommended version", () => {
    requirement = "soft";
    const html = markup();

    expect(html).toContain("A newer version of Loonext is ready");
    expect(html).toContain("Reload now");
    // Ambient, never blocking: it must be possible to make it go away.
    expect(html).toContain("Dismiss update notice");
    // A status region, not an alert — it interrupts nothing.
    expect(html).toContain('role="status"');
  });

  it("carries the server's own reason rather than inventing one", () => {
    requirement = "soft";
    policy = { ...policy!, message: "Threads load faster now" };
    expect(markup()).toContain("Threads load faster now");
    policy = { ...policy, message: null };
  });

  it("falls back to a plain sentence when the server gave no reason", () => {
    requirement = "soft";
    expect(markup()).toContain("Reload to pick up the latest fixes.");
  });

  it("#710: offers a reload for a newer deploy even with no recommended version", () => {
    requirement = "soft";
    policy = { ...policy!, recommended_version: null };
    deployed = { version: "1.2.0", build: null };
    expect(markup()).toContain("Reload now");
    deployed = null;
    policy = { ...policy, recommended_version: "1.1.0" };
  });

  it("blocks below the floor, with the reason and no way past it", () => {
    requirement = "block";
    policy = { ...policy!, minimum_version: "2.0.0", message: "A security fix" };
    const html = markup();

    expect(html).toContain("Loonext needs an update");
    expect(html).toContain("A security fix");
    // A block somebody can click past is not a block.
    expect(html).not.toContain("Dismiss update notice");
    // Support's first question, answered on the screen the person is stuck on.
    expect(html).toContain("You are on 1.0.0");
    expect(html).toContain("2.0.0 or newer is required");
  });

  it("explains itself even when the server set a floor with no message", () => {
    requirement = "block";
    policy = { ...policy!, minimum_version: "2.0.0", message: null };
    // Being stopped with no explanation reads as a hijack, so there is always
    // a sentence — the server's when it has one, ours when it does not.
    expect(markup()).toContain("can no longer connect safely");
  });
});

describe("#710 a different build reloads the tab only while nobody is looking", () => {
  let client: QueryClient;
  let reload: ReturnType<typeof vi.fn<() => void>>;

  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function show() {
    render(
      <QueryClientProvider client={client}>
        <UpdatePrompt />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    reload = vi.fn<() => void>();
    vi.spyOn(window.location, "reload").mockImplementation(reload);
    client = new QueryClient();
    requirement = "soft";
    // The same version, built again from a changed web tree.
    deployed = { version: "1.0.0", build: "build-b" };
    liveCall = false;
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    deployed = null;
    document.body.innerHTML = "";
  });

  it("only shows the card while the tab is visible", () => {
    show();
    vi.advanceTimersByTime(10 * 60_000);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Reload now")).toBeTruthy();
  });

  it("reloads once the tab has been hidden for a minute", () => {
    show();
    setVisibility("hidden");
    vi.advanceTimersByTime(59_999);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a tab that came back within the minute", () => {
    show();
    setVisibility("hidden");
    vi.advanceTimersByTime(30_000);
    setVisibility("visible");
    vi.advanceTimersByTime(5 * 60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("waits out a live call, then reloads", () => {
    // Reloading the tab would hang up the call it is carrying.
    liveCall = true;
    show();
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    liveCall = false;
    vi.advanceTimersByTime(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload over an open dialog or a save in flight", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.append(dialog);
    show();
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();

    dialog.remove();
    const saving = vi.spyOn(client, "isMutating").mockReturnValue(1);
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();

    saving.mockReturnValue(0);
    vi.advanceTimersByTime(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads when the live build is this one", () => {
    deployed = { version: "1.0.0", build: "build-a" };
    requirement = "none";
    show();
    setVisibility("hidden");
    vi.advanceTimersByTime(10 * 60_000);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("dismissKey", () => {
  it("is per recommended version, so the next release is not pre-dismissed", () => {
    expect(dismissKey("1.1.0")).not.toBe(dismissKey("1.2.0"));
  });

  it("is stable for the same version", () => {
    expect(dismissKey("1.1.0")).toBe(dismissKey("1.1.0"));
  });

  it("has an answer when there is no recommended version at all", () => {
    expect(dismissKey(null)).toContain("unknown");
  });
});
