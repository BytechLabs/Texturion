/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CopyablePhoneNumber } from "./copyable-phone-number";
import { SimpleSelect } from "./simple-select";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("copies the complete number without activating the surrounding row", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const open = vi.fn();
  render(<div onClick={open}><CopyablePhoneNumber number="+14165550177" /></div>);
  fireEvent.click(screen.getByRole("button", { name: /copy number.*555-0177/i }));
  await waitFor(() => expect(write).toHaveBeenCalledWith("+14165550177"));
  expect(open).not.toHaveBeenCalled();
});

it("copies a selected phone without choosing a different item", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const onValueChange = vi.fn();
  render(<SimpleSelect
    options={[{ value: "line", label: "(416) 555-0177", copyValue: "+14165550177" }]}
    value="line"
    onValueChange={onValueChange}
  />);

  fireEvent.contextMenu(screen.getByRole("combobox"));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "c", ctrlKey: true });
  await waitFor(() => expect(write.mock.calls).toEqual([["+14165550177"], ["+14165550177"]]));
  expect(onValueChange).not.toHaveBeenCalled();
});
