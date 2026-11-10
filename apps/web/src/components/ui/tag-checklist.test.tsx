/**
 * @vitest-environment happy-dom
 *
 * #713: one control for a tag across a selection.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TagChecklist } from "./tag-checklist";

afterEach(cleanup);

const TAGS = [
  { id: "warranty", name: "Warranty" },
  { id: "vip", name: "VIP" },
];

function open(itemTagIds: string[][] | null, onToggle = vi.fn()) {
  render(
    <TagChecklist
      label="Tags"
      tags={TAGS}
      itemTagIds={itemTagIds}
      selectionKey="a,b"
      emptyLabel="No tags yet."
      onToggle={onToggle}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Tags" }), { key: "Enter" });
  return onToggle;
}

function item(name: string) {
  return screen.getByRole("menuitemcheckbox", { name });
}

describe("TagChecklist", () => {
  it("shows every, some and none of the selection", () => {
    open([["warranty"], ["warranty", "vip"]]);
    expect(item("Warranty").getAttribute("aria-checked")).toBe("true");
    expect(item("VIP").getAttribute("aria-checked")).toBe("mixed");
  });

  it("removes a tag every item has and adds one only some have", () => {
    const onToggle = open([["warranty"], ["warranty", "vip"]]);
    fireEvent.click(item("Warranty"));
    expect(onToggle).toHaveBeenLastCalledWith(TAGS[0], "remove");
    fireEvent.click(item("VIP"));
    expect(onToggle).toHaveBeenLastCalledWith(TAGS[1], "add");
  });

  it("lets a filter selection take back a tag it just added", () => {
    const onToggle = open(null);
    expect(item("VIP").getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(item("VIP"));
    expect(onToggle).toHaveBeenLastCalledWith(TAGS[1], "add");
    fireEvent.click(item("VIP"));
    expect(onToggle).toHaveBeenLastCalledWith(TAGS[1], "remove");
  });

  it("says so when there are no tags", () => {
    render(
      <TagChecklist
        label="Tags"
        tags={[]}
        itemTagIds={[[]]}
        selectionKey="a"
        emptyLabel="No tags yet."
        onToggle={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Tags" }), { key: "Enter" });
    expect(screen.getByText("No tags yet.")).toBeTruthy();
  });
});
