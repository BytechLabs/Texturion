/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyAiSettings } from "@/lib/api/types";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

const settings: CompanyAiSettings = {
  enrich_task_address: true,
  enrich_task_due: true,
  suggest_replies: true,
  business_description: null,
  transcribe_voicemail: true,
  voicemail_intake: false,
  // #507: on by default, like every Lou toggle except the one that changes
  // what a stranger hears.
  call_wrapup: true,
};

const mutate = vi.fn();
const role = { current: "owner" as "owner" | "admin" | "member" };

vi.mock("@/lib/api/ai-settings", () => ({
  useAiSettings: () => ({
    isPending: false,
    isError: false,
    data: settings,
    refetch: vi.fn(),
  }),
  useUpdateAiSettings: () => ({ isPending: false, mutate }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AiSettingsPage from "./page";

beforeEach(() => {
  mutate.mockReset();
  settings.call_wrapup = true;
  role.current = "owner";
});

/**
 * #507 Phase 1 — the wrap-up toggle sits with the other Lou switches and is
 * wired to the same PATCH. The round-trip matters more than the render: a
 * switch that flips visually and sends the WRONG key silently turns off some
 * other feature, and nothing about the screen would look wrong.
 */
describe("/settings/ai — the call wrap-up toggle", () => {
  it("renders in the on position by default", () => {
    render(<AiSettingsPage />);
    expect(
      screen.getByLabelText("Let Lou write down your wrap-up"),
    ).toHaveProperty("dataset.state", "checked");
  });

  it("reflects a workspace that turned it off", () => {
    settings.call_wrapup = false;
    render(<AiSettingsPage />);
    expect(
      screen.getByLabelText("Let Lou write down your wrap-up"),
    ).toHaveProperty("dataset.state", "unchecked");
  });

  it("PATCHes call_wrapup false and leaves every other setting alone", () => {
    render(<AiSettingsPage />);
    fireEvent.click(screen.getByLabelText("Let Lou write down your wrap-up"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      ...settings,
      call_wrapup: false,
    });
  });

  it("PATCHes it back on from off", () => {
    settings.call_wrapup = false;
    render(<AiSettingsPage />);
    fireEvent.click(screen.getByLabelText("Let Lou write down your wrap-up"));

    expect(mutate.mock.calls[0][0]).toMatchObject({ call_wrapup: true });
  });

  it("is read-only for a member, like every other toggle on the page", () => {
    role.current = "member";
    render(<AiSettingsPage />);
    expect(
      screen.getByLabelText("Let Lou write down your wrap-up"),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText("Only owners and admins can change these.")).toBeTruthy();
  });
});

/**
 * D117 is the entire design of this feature, and the failure mode is a
 * SENTENCE, not a crash. Copy that implied Loonext listens to calls would be
 * false, would be believed, and would be caught by nothing else in this repo.
 */
describe("/settings/ai — what the wrap-up copy is allowed to claim", () => {
  it("says whose voice it is, and says the call has ended", () => {
    render(<AiSettingsPage />);
    expect(screen.getByText(/After a call ends/)).toBeTruthy();
    expect(
      screen.getByText(/after the call has ended/),
    ).toBeTruthy();
    expect(
      screen.getByText(/The call itself is never recorded/),
    ).toBeTruthy();
  });

  it("promises the words back verbatim, not a summary", () => {
    render(<AiSettingsPage />);
    expect(
      screen.getByText(/exactly as you said them/),
    ).toBeTruthy();
    // A paraphrase would destroy the only thing the note exists for — settling
    // what was quoted. Nothing here may offer one.
    const page = document.body.textContent ?? "";
    expect(page).not.toContain("summarise");
    expect(page).not.toContain("summarize");
    expect(page).not.toContain("summary");
  });

  it("never claims to record, transcribe or listen to a call", () => {
    render(<AiSettingsPage />);
    const page = (document.body.textContent ?? "").toLowerCase();
    for (const claim of [
      "record your calls",
      "records your calls",
      "record the call",
      "records the call",
      "transcribe your calls",
      "transcribes the call",
      "listen to your calls",
      "listens to the call",
      "record the customer",
    ]) {
      expect(page, claim).not.toContain(claim);
    }
  });

  it("keeps the wrap-up next to the voicemail card, where the contrast reads", () => {
    render(<AiSettingsPage />);
    const page = document.body.textContent ?? "";
    expect(page.indexOf("When someone leaves a voicemail")).toBeGreaterThan(-1);
    expect(page.indexOf("After a call ends")).toBeGreaterThan(
      page.indexOf("When someone leaves a voicemail"),
    );
  });
});
