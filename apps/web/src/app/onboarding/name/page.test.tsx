/**
 * @vitest-environment happy-dom
 *
 * #370 — the crew-size question, mounted.
 *
 * `crew-copy.test.ts` pins what the answer says back. This pins the part that
 * only exists once the form is rendered: that the question can be SKIPPED, that
 * skipping stores nothing, and that an answer survives into the draft the three
 * company-creation call sites read. "Never asked" and "solo" are different
 * answers all the way down, and the only place that distinction can be lost is
 * here.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CREW_SIZE_LABELS } from "@loonext/shared";

import { sayEnglish } from "@/i18n/provider";

/** #228 — the labels are catalogue KEYS now, so this says them. */
const say = sayEnglish;

import { readOnboardingDraft } from "../local-draft";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/analytics/events", () => ({
  trackOnboardingStepCompleted: vi.fn(),
}));

const guard = vi.hoisted(() => ({ draft: {} as Record<string, unknown> }));

vi.mock("../use-onboarding-state", () => ({
  useWizardStepGuard: () => ({
    ready: true,
    state: {
      status: "ready",
      retry: vi.fn(),
      companyId: null,
      company: null,
      registration: null,
      role: null,
      draft: guard.draft,
      snapshot: { company: null, registration: null, draft: guard.draft },
      refreshDraft: vi.fn(),
    },
  }),
}));

const { default: CompanyNamePage } = await import("./page");

beforeEach(() => {
  guard.draft = {};
  window.localStorage.clear();
  push.mockClear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function typeName(value = "Mike's Plumbing") {
  fireEvent.change(screen.getByLabelText("Company name"), {
    target: { value },
  });
}

describe("#370 crew size on the name step", () => {
  it("offers every bucket, in people rather than seats", () => {
    render(<CompanyNamePage />);
    for (const key of Object.values(CREW_SIZE_LABELS)) {
      const label = say(key);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("starts with nothing chosen and says the question is skippable", () => {
    // Deliberately NOT a Smart Default. Pre-selecting a bucket would write an
    // answer nobody gave, into a column whose whole value is telling "never
    // asked" apart from "solo".
    render(<CompanyNamePage />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
    expect(screen.getByText(/skip it/i)).toBeTruthy();
  });

  it("answers back the moment a bucket is picked", () => {
    render(<CompanyNamePage />);
    fireEvent.click(screen.getByText(say(CREW_SIZE_LABELS["4_10"])));
    expect(screen.getByText(/^Pro covers up to/)).toBeTruthy();
  });

  it("recommends no plan for a crew past ten", () => {
    render(<CompanyNamePage />);
    fireEvent.click(screen.getByText(say(CREW_SIZE_LABELS["11_plus"])));
    expect(screen.getByText(/Our biggest plan covers/)).toBeTruthy();
  });

  it("carries the answer into the draft the create call reads", async () => {
    render(<CompanyNamePage />);
    typeName();
    fireEvent.click(screen.getByText(say(CREW_SIZE_LABELS["2_3"])));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding/number"));
    expect(readOnboardingDraft().crewSize).toBe("2_3");
  });

  it("stores NOTHING when the question is skipped", async () => {
    render(<CompanyNamePage />);
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding/number"));
    const draft = readOnboardingDraft();
    expect(draft.name).toBe("Mike's Plumbing");
    expect("crewSize" in draft).toBe(false);
  });

  it("still refuses to continue without a company name", async () => {
    render(<CompanyNamePage />);
    fireEvent.click(screen.getByText(say(CREW_SIZE_LABELS.solo)));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() =>
      expect(screen.getByText("Enter your company name.")).toBeTruthy(),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
