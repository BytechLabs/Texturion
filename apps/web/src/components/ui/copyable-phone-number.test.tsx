/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CopyablePhoneNumber } from "./copyable-phone-number";

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
