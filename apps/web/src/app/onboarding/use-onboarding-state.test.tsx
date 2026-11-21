/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
  writeOnboardingPortDraft,
} from "./local-draft";
import { OnboardingSessionGate } from "./session-gate";
import { useOnboardingState } from "./use-onboarding-state";

const { session, apiFetch } = vi.hoisted(() => ({
  session: { userId: "owner-a" },
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/auth/use-session-ready", () => ({
  useSession: () => ({ state: "ready", userId: session.userId }),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

function DraftPage() {
  const state = useOnboardingState();
  if (state.status !== "ready") return <p>Loading draft</p>;
  return (
    <>
      <p>{state.draft.name ?? "New draft"}</p>
      <label>
        Unsaved company name
        <input />
      </label>
    </>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  apiFetch.mockReset();
  session.userId = "owner-a";
});

describe("Onboarding draft ownership", () => {
  it("drops the legacy draft and resumes only the signed-in owner's saved details", () => {
    window.localStorage.setItem("loonext:onboarding-draft", JSON.stringify({
      name: "Unknown owner",
      savedAt: Date.now(),
    }));
    writeOnboardingDraft("owner-a", { name: "Plumbing Crew" });
    writeOnboardingPortDraft("owner-a", { entityName: "Plumbing Crew" });
    writeOnboardingPortDraft("owner-a", { serviceLocality: "Toronto" });
    writeOnboardingDraft("owner-b", { name: "Electric Crew" });

    expect(window.localStorage.getItem("loonext:onboarding-draft")).toBeNull();
    expect(readOnboardingDraft("owner-b")).toEqual({ name: "Electric Crew" });
    clearOnboardingDraft("owner-b");
    expect(readOnboardingDraft("owner-b")).toEqual({});
    expect(readOnboardingDraft("owner-a")).toEqual({
      name: "Plumbing Crew",
      mode: "port",
      port: { entityName: "Plumbing Crew", serviceLocality: "Toronto" },
    });
  });

  it("removes expired drafts when a different user opens onboarding", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    writeOnboardingDraft("owner-a", { name: "Old draft" });
    expect(readOnboardingDraft("owner-b", now + week + 1000)).toEqual({});
    expect(readOnboardingDraft("owner-a")).toEqual({});
  });

  it("loads a fresh profile and resets a mounted form when the session changes", async () => {
    const client = new QueryClient();
    writeOnboardingDraft("owner-a", { name: "Plumbing Crew" });
    apiFetch.mockResolvedValueOnce({ user_id: "owner-a", memberships: [] });
    apiFetch.mockResolvedValueOnce({ user_id: "owner-b", memberships: [] });
    const wizard = () => (
      <QueryClientProvider client={client}>
        <OnboardingSessionGate><DraftPage /></OnboardingSessionGate>
      </QueryClientProvider>
    );
    const { rerender } = render(wizard());
    await screen.findByText("Plumbing Crew");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unsaved changes" } });

    session.userId = "owner-b";
    rerender(wizard());
    expect(screen.queryByText("Plumbing Crew")).toBeNull();
    expect(screen.queryByDisplayValue("Unsaved changes")).toBeNull();
    await screen.findByText("New draft");
    expect(apiFetch.mock.calls).toEqual([["/v1/me"], ["/v1/me"]]);
    expect(screen.getByRole("textbox")).toHaveProperty("value", "");

    session.userId = "owner-a";
    rerender(wizard());
    await screen.findByText("Plumbing Crew");
    expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  });
});
