/**
 * @vitest-environment happy-dom
 *
 * #309 — "Your own voice".
 *
 * VC-3 is the one that decides whether this card is safe to ship. Deleting a
 * greeting changes what every caller to a line using it hears, and this screen
 * cannot show which lines those are — so the confirm is the only warning there
 * is. A delete that fires without it is a silent change to the first thing a
 * customer hears from the business.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordMutate, deleteMutate, rows, toastSuccess, toastError } = vi.hoisted(
  () => ({
    recordMutate: vi.fn(),
    deleteMutate: vi.fn(),
    rows: { current: [] as Record<string, unknown>[] },
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  }),
);

vi.mock("@/lib/api/voicemail-greetings", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/voicemail-greetings")
  >("@/lib/api/voicemail-greetings");
  return {
    ...actual,
    useVoicemailGreetings: () => ({ data: { data: rows.current } }),
    useRecordGreeting: () => ({ isPending: false, mutateAsync: recordMutate }),
    useDeleteGreeting: () => ({ isPending: false, mutateAsync: deleteMutate }),
  };
});
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { VoiceGreetingCard } from "./voice-greeting-card";

afterEach(cleanup);

beforeEach(() => {
  recordMutate.mockReset().mockResolvedValue({});
  deleteMutate.mockReset().mockResolvedValue(undefined);
  toastSuccess.mockReset();
  toastError.mockReset();
  rows.current = [];
});

const GREETING = {
  id: "g1",
  name: "After hours",
  duration_ms: 8200,
  mime_type: "audio/mp4",
  byte_size: 1,
  created_at: "",
};

describe("#309 your own voice", () => {
  it("VC-1: says what a caller hears today, before anything is recorded", () => {
    // A screen full of controls that never states the current position cannot
    // tell an owner whether they have already done this.
    render(<VoiceGreetingCard canEdit />);
    expect(screen.getByText(/callers hear the written greeting/i)).toBeTruthy();
  });

  it("VC-2: there is no way to save a take nobody has heard", () => {
    // The Save button does not exist until there IS a take, and when it does
    // the player is on screen with it. Recording your own voice is the one
    // thing people redo; saving the first take unheard assumes it was good.
    render(<VoiceGreetingCard canEdit />);
    expect(screen.queryByRole("button", { name: /save greeting/i })).toBeNull();
    expect(screen.getByRole("button", { name: /record/i })).toBeTruthy();
  });

  it("VC-3: deleting asks first, and says what it costs", async () => {
    // THE ONE THAT MATTERS. This card cannot show which lines use a greeting,
    // so the confirm is the only warning before the first thing a customer
    // hears changes.
    rows.current = [GREETING];
    render(<VoiceGreetingCard canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Delete After hours" }));

    await waitFor(() =>
      expect(screen.getByText(/back to the written words/i)).toBeTruthy(),
    );
    // Nothing has happened yet — the click opened a question, not a delete.
    expect(deleteMutate).not.toHaveBeenCalled();

    // And backing out leaves the greeting alone.
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("VC-4: confirming actually deletes", async () => {
    rows.current = [GREETING];
    render(<VoiceGreetingCard canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Delete After hours" }));
    await waitFor(() => screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith("g1"));
  });

  it("VC-5: a member who cannot edit gets no controls, only the list", () => {
    rows.current = [GREETING];
    render(<VoiceGreetingCard canEdit={false} />);
    expect(screen.getByText("After hours")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /record/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("VC-6: a denied microphone says where the fix is, not that it failed", async () => {
    // The cause is almost always a denied prompt, and the fix is in the
    // browser rather than in this app — so the message points there.
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error("denied")) },
    });
    render(<VoiceGreetingCard canEdit />);

    fireEvent.click(screen.getByRole("button", { name: /record/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/microphone/i),
    );
    expect(screen.getByRole("alert").textContent).toMatch(/address bar/i);
  });
});
