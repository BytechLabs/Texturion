/**
 * @vitest-environment happy-dom
 *
 * #278 — after-hours calling, on the settings screen.
 *
 * AH-C2 is the one that decides whether this card is honest. With no business
 * hours set there is no "after hours", so every option here is inert — and an
 * owner who picks "take a message" and watches nothing ever happen has been
 * failed silently, which is the worst way to fail somebody. The warning is the
 * feature.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMutate, greetingRows } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  greetingRows: { current: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/api/companies", () => ({
  useUpdateCompany: () => ({ isPending: false, mutate: updateMutate }),
}));
vi.mock("@/lib/api/voicemail-greetings", () => ({
  useVoicemailGreetings: (enabled: boolean) => ({
    data: { data: enabled ? greetingRows.current : [] },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AfterHoursCallsCard } from "./after-hours-calls-card";

afterEach(cleanup);
beforeEach(() => {
  updateMutate.mockReset();
  greetingRows.current = [];
});

const WEEKDAYS = {
  mon: { open: "08:00", close: "17:00" },
  tue: { open: "08:00", close: "17:00" },
};

function company(over: Record<string, unknown> = {}) {
  return {
    name: "Reed Roofing",
    after_hours_calls: "ring_everyone",
    after_hours_greeting_id: null,
    business_hours: WEEKDAYS,
    ...over,
  } as never;
}

describe("#278 after-hours calling", () => {
  it("AH-C1: the default is the product as it was, and it is the one selected", () => {
    // #278's own devil's-advocate section: a badly-built phone tree makes a
    // small business sound like a call centre. Ring-all stays the recommended
    // shape, so it is first and it is where every workspace starts.
    render(<AfterHoursCallsCard company={company()} canEdit />);
    const chosen = screen.getByRole("radio", { checked: true });
    expect(chosen.textContent).toMatch(/ring everyone/i);
  });

  it("AH-C2: with no hours set, the card says nothing here can happen", () => {
    // THE ONE THAT MATTERS. Without hours there is no after-hours, so the
    // whole card is inert — and the failure is invisible unless it is said.
    render(
      <AfterHoursCallsCard company={company({ business_hours: {} })} canEdit />,
    );
    const notice = screen.getByRole("status");
    expect(notice.textContent).toMatch(/haven't set business hours/i);
    // And it names where to fix it, rather than leaving them to hunt.
    expect(notice.textContent).toMatch(/hours/i);
  });

  it("AH-C2b: with hours set, the warning is gone", () => {
    // The pair matters more than either half: a notice that always shows is
    // furniture, and furniture is not read.
    render(<AfterHoursCallsCard company={company()} canEdit />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("AH-C3: each option says what a caller and a crew actually get", () => {
    // "On-call only" is a label. "Everyone else's phone stays quiet" is the
    // decision somebody is making.
    render(<AfterHoursCallsCard company={company()} canEdit />);
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    expect(options[1].textContent).toMatch(/on call/i);
    // The widen-on-uncertainty rule is stated where it is chosen, because a
    // crew that believes nobody rings when no shift is set would set one they
    // do not need.
    expect(options[1].textContent).toMatch(/everyone rings|no shift/i);
    expect(options[2].textContent).toMatch(/straight to your greeting/i);
  });

  it("AH-C4: choosing sends exactly the one field", () => {
    render(<AfterHoursCallsCard company={company()} canEdit />);
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(updateMutate).toHaveBeenCalledWith(
      { after_hours_calls: "voicemail" },
      expect.anything(),
    );
  });

  it("AH-C5: the greeting picker appears only once it could matter", () => {
    // A recording for a situation that never routes anywhere is a control with
    // no effect, and a settings screen full of those is how people stop
    // reading them.
    greetingRows.current = [{ id: "g1", name: "After hours" }];
    const { unmount } = render(
      <AfterHoursCallsCard company={company()} canEdit />,
    );
    expect(screen.queryByLabelText("After-hours voice")).toBeNull();
    unmount();

    render(
      <AfterHoursCallsCard
        company={company({ after_hours_calls: "voicemail" })}
        canEdit
      />,
    );
    expect(screen.getByLabelText("After-hours voice")).toBeTruthy();
  });

  it("AH-C6: a member who cannot edit sees the state, not the controls", () => {
    render(<AfterHoursCallsCard company={company()} canEdit={false} />);
    for (const option of screen.getAllByRole("radio")) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/only owners and admins/i)).toBeTruthy();
  });
});
