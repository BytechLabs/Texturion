/**
 * @vitest-environment happy-dom
 *
 * #278 — how the phones ring, on the settings screen.
 *
 * RC-3 is the one that decides whether these two controls are honest
 * together. Either alone is harmless; a short window AND "one at a time" is a
 * rota that silently excludes half the crew, and an owner who set both without
 * being told has configured something they would never have chosen. The
 * sentence is the whole reason both controls share a card.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMutate } = vi.hoisted(() => ({ updateMutate: vi.fn() }));

vi.mock("@/lib/api/companies", () => ({
  useUpdateCompany: () => ({ isPending: false, mutate: updateMutate }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { phonesReached, RingCard, ringsIn } from "./ring-card";

afterEach(cleanup);
beforeEach(() => updateMutate.mockReset());

function company(over: Record<string, unknown> = {}) {
  return { ring_strategy: "all", ring_seconds: 45, ...over } as never;
}

describe("#278 how the phones ring", () => {
  it("RC-1: the default is the product as it was, and it is the one selected", () => {
    render(<RingCard company={company()} canEdit />);
    expect(screen.getByRole("radio", { checked: true }).textContent).toMatch(
      /all at once/i,
    );
  });

  it("RC-2: seconds are shown as rings, because nobody thinks in seconds", () => {
    // Everybody has an intuition for "about five rings" and nobody has one for
    // "thirty seconds of ringing". The stored value is still seconds.
    render(<RingCard company={company({ ring_seconds: 30 })} canEdit />);
    expect(screen.getByLabelText("How long they ring").textContent).toMatch(
      /about 5 rings/i,
    );
  });

  it("RC-3: a short window with 'one at a time' says who never rings", () => {
    // THE ONE THAT MATTERS. Fifteen seconds and a cascade means the third and
    // fourth crew members are never dialled at all, and nothing else on this
    // screen would ever tell them.
    render(
      <RingCard
        company={company({ ring_strategy: "in_turn", ring_seconds: 15 })}
        canEdit
      />,
    );
    const note = screen.getByText(/phones get a turn/i);
    expect(note.textContent).toMatch(/2 phones get a turn/i);
    expect(note.textContent).toMatch(/never rings/i);
  });

  it("RC-3b: 'all at once' says something different, because nobody is excluded", () => {
    // The pair. A note that said the same thing in both modes would be
    // furniture, and the point of RC-3 is that it is not.
    render(<RingCard company={company()} canEdit />);
    expect(screen.queryByText(/phones get a turn/i)).toBeNull();
    // It explains the ceiling instead, which is the question "all at once"
    // actually raises: why can't I ring for a minute?
    expect(screen.getByText(/45 seconds isn't offered/i)).toBeTruthy();
  });

  it("RC-4: the arithmetic behind both readings", () => {
    // Pure, and asserted directly because the copy above is only as honest as
    // these two functions.
    expect(ringsIn(45)).toBe(8);
    expect(ringsIn(30)).toBe(5);
    expect(ringsIn(15)).toBe(3);
    // One phone rings immediately; each further 12 seconds adds one.
    expect(phonesReached(10)).toBe(1);
    expect(phonesReached(15)).toBe(2);
    expect(phonesReached(45)).toBe(4);
  });

  it("RC-5: an odd stored window is shown, never silently rounded", () => {
    // A picker that quietly snaps somebody's 25 seconds to 30 is a picker
    // lying about what their line does.
    render(<RingCard company={company({ ring_seconds: 25 })} canEdit />);
    expect(screen.getByLabelText("How long they ring").textContent).toMatch(/25 seconds/);
  });

  it("RC-6: choosing sends exactly the one field", () => {
    render(<RingCard company={company()} canEdit />);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(updateMutate).toHaveBeenCalledWith(
      { ring_strategy: "in_turn" },
      expect.anything(),
    );
  });

  it("RC-7: a member who cannot edit sees the state, not the controls", () => {
    render(<RingCard company={company()} canEdit={false} />);
    for (const option of screen.getAllByRole("radio")) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/only owners and admins/i)).toBeTruthy();
  });
});
