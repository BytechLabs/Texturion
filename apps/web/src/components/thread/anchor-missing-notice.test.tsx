/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnchorMissingNotice } from "./anchor-missing-notice";

afterEach(cleanup);

describe("#718 a link to a message that is gone", () => {
  it("says so, and can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<AnchorMissingNotice onDismiss={onDismiss} />);
    expect(screen.getByRole("status").textContent).toContain(
      "That message is no longer here.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
