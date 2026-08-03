/**
 * @vitest-environment happy-dom
 *
 * #291 — narrowing the contacts list to one answer.
 *
 * CTF-2 is the one to read twice. Only a dropdown or a yes/no field has a
 * closed set of answers. Offering to filter by a serial number would be a text
 * box that returns nothing until it is typed perfectly — which is search, and
 * search already reads those fields.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fieldDefs, onChange } = vi.hoisted(() => ({
  fieldDefs: vi.fn(),
  onChange: vi.fn(),
}));

vi.mock("@/lib/api/contact-fields", () => ({
  useContactFields: () => ({ isPending: false, data: fieldDefs() }),
}));

import { ContactFilter } from "./contact-filter";

afterEach(cleanup);

beforeEach(() => {
  onChange.mockReset();
  fieldDefs.mockReturnValue({
    cap: 10,
    data: [
      {
        key: "system_type",
        label: "System type",
        kind: "select",
        options: ["Combi", "System"],
      },
      { key: "has_dog", label: "Dog on site", kind: "checkbox", options: null },
      { key: "serial", label: "Serial", kind: "text", options: null },
    ],
  });
});

describe("#291 the contacts filter", () => {
  it("CTF-1: renders nothing until the workspace has something to filter on", () => {
    // A control that offers no choices is furniture on a list most workspaces
    // never filter.
    fieldDefs.mockReturnValue({ cap: 10, data: [] });
    const { container } = render(<ContactFilter onChange={onChange} />);
    expect(container.innerHTML).toBe("");
  });

  it("CTF-2: offers only the fields with a closed set of answers", () => {
    // THE ONE THAT MATTERS. A serial number has no list to pick from, so a
    // filter on it would be a text box returning nothing until typed exactly —
    // which is what search is for.
    render(<ContactFilter onChange={onChange} />);
    const select = screen.getByLabelText("Narrow by") as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toContain("System type");
    expect(labels).toContain("Dog on site");
    expect(labels).not.toContain("Serial");
  });

  it("CTF-3: renders nothing when every defined field is free text", () => {
    // The empty case of CTF-2, which the definition list alone does not cover:
    // three fields exist, none is filterable, so the control has no choices.
    fieldDefs.mockReturnValue({
      cap: 10,
      data: [{ key: "serial", label: "Serial", kind: "text", options: null }],
    });
    const { container } = render(<ContactFilter onChange={onChange} />);
    expect(container.innerHTML).toBe("");
  });

  it("CTF-4: picking a field asks for an answer rather than filtering blind", () => {
    // "System type is anything" is not a question anybody meant to ask. The
    // pair goes out with an empty value, which IS a filter — "not set" — and
    // the server refuses a field with no value at all.
    render(<ContactFilter onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Narrow by"), {
      target: { value: "system_type" },
    });
    expect(onChange).toHaveBeenCalledWith({ key: "system_type", value: "" });
  });

  it("CTF-5: 'Not set' is a real choice, and it is first", () => {
    // The most useful filter of the lot: exactly the customers somebody still
    // has to ask. Dropped, there would be no way to list them.
    render(
      <ContactFilter
        value={{ key: "system_type", value: "Combi" }}
        onChange={onChange}
      />,
    );
    const values = screen.getByLabelText("System type") as HTMLSelectElement;
    expect([...values.options].map((option) => option.value)).toEqual([
      "",
      "Combi",
      "System",
    ]);
  });

  it("CTF-6: a yes/no field offers yes and no, not its own options list", () => {
    render(
      <ContactFilter
        value={{ key: "has_dog", value: "yes" }}
        onChange={onChange}
      />,
    );
    const values = screen.getByLabelText("Dog on site") as HTMLSelectElement;
    expect([...values.options].map((option) => option.value)).toEqual([
      "",
      "yes",
      "no",
    ]);
  });

  it("CTF-7: the filter can be cleared, and says so", () => {
    // A list quietly filtered is a list that looks wrong — somebody scrolls
    // for a customer who is not missing, they are excluded.
    render(
      <ContactFilter
        value={{ key: "system_type", value: "Combi" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Show everyone again"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("CTF-8: choosing Everyone clears it too", () => {
    render(
      <ContactFilter
        value={{ key: "system_type", value: "Combi" }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Narrow by"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
