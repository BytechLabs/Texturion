/**
 * @vitest-environment happy-dom
 *
 * #291 / #711: narrowing the contacts list to a tag or one answer, behind the
 * same Filter button every list uses.
 *
 * CTF-2 is the one to read twice. Only a dropdown or a yes/no field has a
 * closed set of answers. Offering to filter by a serial number would be a text
 * box that returns nothing until it is typed perfectly, which is search, and
 * search already reads those fields.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fieldDefs, tagRows, onField, onTag } = vi.hoisted(() => ({
  fieldDefs: vi.fn(),
  tagRows: { current: [] as { id: string; name: string }[] },
  onField: vi.fn(),
  onTag: vi.fn(),
}));

vi.mock("@/lib/api/contact-fields", () => ({
  useContactFields: () => ({ isPending: false, data: fieldDefs() }),
}));
vi.mock("@/lib/api/tags", () => ({
  useTags: () => ({ data: { data: tagRows.current } }),
}));

import { ContactActiveFilters, ContactListFilter } from "./contact-filter";

afterEach(cleanup);

beforeEach(() => {
  onField.mockReset();
  onTag.mockReset();
  tagRows.current = [];
  fieldDefs.mockReturnValue({
    cap: 10,
    data: [
      { key: "system_type", label: "System type", kind: "select", options: ["Combi", "System"] },
      { key: "has_dog", label: "Dog on site", kind: "checkbox", options: null },
      { key: "serial", label: "Serial", kind: "text", options: null },
    ],
  });
});

function openFilter(props: { field?: { key: string; value: string }; tag?: string } = {}) {
  render(<ContactListFilter {...props} onField={onField} onTag={onTag} />);
  fireEvent.click(screen.getByRole("button", { name: /filter/i }));
}

describe("#291 the contacts filter", () => {
  it("CTF-1: renders nothing until the workspace has something to filter on", () => {
    fieldDefs.mockReturnValue({ cap: 10, data: [] });
    const { container } = render(<ContactListFilter onField={onField} onTag={onTag} />);
    expect(container.innerHTML).toBe("");
  });

  it("CTF-2: offers only the fields with a closed set of answers", () => {
    openFilter();
    expect(screen.getByText("System type")).toBeTruthy();
    expect(screen.getByText("Dog on site")).toBeTruthy();
    expect(screen.queryByText("Serial")).toBeNull();
  });

  it("CTF-3: tags are offered beside the fields", () => {
    tagRows.current = [{ id: "t1", name: "Warranty" }];
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Warranty" }));
    expect(onTag).toHaveBeenCalledWith("t1");
  });

  it("CTF-4: an answer is chosen in one step", () => {
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Combi" }));
    expect(onField).toHaveBeenCalledWith({ key: "system_type", value: "Combi" });
  });

  it("CTF-5: 'Not set' is a real choice, and it is first", () => {
    openFilter();
    const notSet = screen.getAllByRole("option", { name: "Not set" });
    expect(notSet).toHaveLength(2);
    fireEvent.click(notSet[0]);
    expect(onField).toHaveBeenCalledWith({ key: "system_type", value: "" });
  });

  it("CTF-6: a yes/no field offers yes and no, not its own options list", () => {
    openFilter();
    fireEvent.click(screen.getByRole("option", { name: "Yes" }));
    expect(onField).toHaveBeenCalledWith({ key: "has_dog", value: "yes" });
  });

  it("CTF-7: an applied filter shows as a chip that clears it", () => {
    // A list quietly filtered is a list that looks wrong: somebody scrolls
    // for a customer who is not missing, they are excluded.
    render(
      <ContactActiveFilters
        field={{ key: "system_type", value: "Combi" }}
        onField={onField}
        onTag={onTag}
      />,
    );
    expect(screen.getByText("System type: Combi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove System type: Combi filter" }));
    expect(onField).toHaveBeenCalledWith(undefined);
  });

  it("CTF-8: nothing applied, nothing shown", () => {
    const { container } = render(<ContactActiveFilters onField={onField} onTag={onTag} />);
    expect(container.innerHTML).toBe("");
  });
});
