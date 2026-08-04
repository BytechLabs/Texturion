/**
 * @vitest-environment happy-dom
 *
 * #228 - the language one customer hears from us in.
 *
 * CL-2 and CL-3 are the pair that decide whether this control is correct at
 * all. A contact's null locale means "follow the workspace", NOT English, so
 * there has to be a state that sends the null back, and it has to say which
 * language following the workspace currently means.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMutate, companyData } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  companyData: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: companyData.current }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useUpdateContact: () => ({ isPending: false, mutate: updateMutate }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ContactLanguage } from "./contact-language";

afterEach(cleanup);
beforeEach(() => {
  updateMutate.mockReset();
  companyData.current = { locale: "en" };
});

function contact(over: Record<string, unknown> = {}) {
  return { id: "ct1", locale: null, ...over } as never;
}

describe("#228 a customer's language", () => {
  it("CL-1: three states, not two", () => {
    // "Follow the workspace" is a choice somebody makes, so it is a chip.
    // Two chips would be a control that cannot express the default it starts
    // in, which is most contacts.
    render(<ContactLanguage contact={contact()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("CL-2: the inherit chip names the language it inherits", () => {
    // Without the name it is a promise to go and look somewhere else, and the
    // whole point is that somebody can see what it means from here.
    companyData.current = { locale: "fr-CA" };
    render(<ContactLanguage contact={contact()} />);
    expect(
      screen.getByRole("radio", { name: "Same as workspace (Francais (Canada))" }),
    ).toBeTruthy();
  });

  it("CL-2b: a contact with no language of their own is on the inherit chip", () => {
    render(<ContactLanguage contact={contact()} />);
    expect(screen.getByRole("radio", { checked: true }).textContent).toMatch(
      /same as workspace/i,
    );
  });

  it("CL-3: there is a way back to following the workspace, and it sends null", () => {
    // THE ONE THAT MATTERS. Sending "en" here would freeze this customer in
    // English and silently stop tracking a later switch to French.
    render(<ContactLanguage contact={contact({ locale: "fr-CA" })} />);
    fireEvent.click(screen.getByRole("radio", { name: /same as workspace/i }));
    expect(updateMutate).toHaveBeenCalledWith(
      { locale: null },
      expect.anything(),
    );
  });

  it("CL-4: choosing a language sends that language", () => {
    render(<ContactLanguage contact={contact()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Francais (Canada)" }));
    expect(updateMutate).toHaveBeenCalledWith(
      { locale: "fr-CA" },
      expect.anything(),
    );
  });

  it("CL-4b: an override reads as an override, not as the workspace answer", () => {
    companyData.current = { locale: "en" };
    render(<ContactLanguage contact={contact({ locale: "en" })} />);
    // Both say English. They are different states, and the one in force has to
    // be the one selected, or nobody can tell whether this customer is pinned.
    expect(screen.getByRole("radio", { checked: true }).textContent).toBe(
      "English",
    );
  });

  it("CL-5: an unknown workspace language is never guessed at", () => {
    // A server that predates the field, or a company still loading. Naming
    // English here would be the exact guess this feature exists to stop.
    companyData.current = undefined;
    render(<ContactLanguage contact={contact()} />);
    expect(screen.getByRole("radio", { name: "Same as workspace" })).toBeTruthy();
  });

  it("CL-5b: arrows move the choice, and take focus with them", () => {
    // The WAI-ARIA radiogroup contract, asserted because the focus half rides
    // on a ref reaching the button: if it ever stopped landing, the keyboard
    // would keep selecting and quietly stop moving.
    render(<ContactLanguage contact={contact()} />);
    const radios = screen.getAllByRole("radio");
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(updateMutate).toHaveBeenCalledWith(
      { locale: "en" },
      expect.anything(),
    );
    expect(document.activeElement).toBe(radios[1]);
  });

  it("CL-6: it says the typing is not translated", () => {
    // Somebody sets a customer to French and then waits for their own words to
    // arrive in French. Said at the point of the decision, not only in
    // Settings.
    const { container } = render(<ContactLanguage contact={contact()} />);
    expect(container.textContent).toMatch(/automatic texts only/i);
  });
});
