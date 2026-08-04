/**
 * @vitest-environment happy-dom
 *
 * #228 - the workspace language, on the settings screen.
 *
 * LC-3 is the one that decides whether this card is honest. "Language" on a
 * settings screen reads as "the language of this software", and what it
 * actually changes is four text messages. An owner who finds that out from a
 * customer was misled by a control that could have said so.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMutate } = vi.hoisted(() => ({ updateMutate: vi.fn() }));

vi.mock("@/lib/api/companies", () => ({
  useUpdateCompany: () => ({ isPending: false, mutate: updateMutate }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LanguageCard } from "./language-card";

afterEach(cleanup);
beforeEach(() => updateMutate.mockReset());

function company(over: Record<string, unknown> = {}) {
  return { name: "Reed Roofing", locale: "en", ...over } as never;
}

describe("#228 workspace language", () => {
  it("LC-1: both languages are on screen, and the current one is selected", () => {
    // Smart Defaults: the control opens on the answer in force. A two-item
    // list also has nothing to gain from hiding half of itself.
    render(<LanguageCard company={company({ locale: "fr-CA" })} canEdit />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { checked: true }).textContent).toBe(
      "Francais (Canada)",
    );
  });

  it("LC-2: choosing sends exactly the one field", () => {
    render(<LanguageCard company={company()} canEdit />);
    fireEvent.click(screen.getByRole("radio", { name: "Francais (Canada)" }));
    expect(updateMutate).toHaveBeenCalledWith(
      { locale: "fr-CA" },
      expect.anything(),
    );
  });

  it("LC-3: it says what it does not do, in the words that mislead", () => {
    // THE ONE THAT MATTERS. Both halves have to be there: the app itself does
    // not change language, and neither does a sentence the owner wrote.
    const { container } = render(<LanguageCard company={company()} canEdit />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/does not translate this app/i);
    expect(text).toMatch(/message you wrote yourself/i);
  });

  it("LC-3b: it names the four texts it does change", () => {
    // A promise this vague is unfalsifiable unless it lists them, and these
    // four are exactly the send paths that resolve a language.
    const { container } = render(<LanguageCard company={company()} canEdit />);
    const text = container.textContent ?? "";
    for (const named of [
      /away reply/i,
      /missed-call text-back/i,
      /emergency acknowledgment/i,
      /rating ask/i,
    ]) {
      expect(text).toMatch(named);
    }
  });

  it("LC-4: there is no way to clear it", () => {
    // A workspace with no language is not a state any send path can resolve,
    // so the card must not offer one. Only the two languages are pressable.
    render(<LanguageCard company={company()} canEdit />);
    const labels = screen
      .getAllByRole("radio")
      .map((radio) => radio.textContent);
    expect(labels).toEqual(["English", "Francais (Canada)"]);
  });

  it("LC-5: a member sees the language, not the controls", () => {
    render(<LanguageCard company={company({ locale: "fr-CA" })} canEdit={false} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Francais (Canada)")).toBeTruthy();
    expect(screen.getByText(/only owners and admins/i)).toBeTruthy();
  });

  it("LC-6: a failed save says so and leaves the old answer showing", () => {
    // The optimistic chip has to come back. A settings screen that shows the
    // language you picked while the server kept the old one is a screen
    // reporting a state that does not exist.
    updateMutate.mockImplementation(
      (_patch: unknown, handlers?: { onError?: (cause: unknown) => void }) => {
        handlers?.onError?.(new Error("offline"));
      },
    );
    render(<LanguageCard company={company()} canEdit />);
    fireEvent.click(screen.getByRole("radio", { name: "Francais (Canada)" }));
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't save/i);
    expect(screen.getByRole("radio", { checked: true }).textContent).toBe(
      "English",
    );
  });
});
