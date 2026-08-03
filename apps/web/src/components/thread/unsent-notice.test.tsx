/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UnsentNotice } from "./composer";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

/**
 * #299 — the durable half of "a send during a blip never reads as ambiguous".
 *
 * A failed send restores the draft and raises a toast. The toast is gone in
 * seconds and the draft is not, so what somebody comes back to is text in a
 * composer that looks exactly like a reply they started and never finished.
 * Nothing distinguished that from a message they pressed send on and believe
 * went out, which is the more expensive way to be wrong.
 */
describe("#299 the unsent notice", () => {
  it("says it did not send, and that retrying is safe", () => {
    render(<UnsentNotice show />);
    // Both halves matter. The first removes the ambiguity; the second is the
    // reason not to hesitate over the button, and it is only true because the
    // Idempotency-Key is stored beside the draft.
    expect(screen.getByRole("status").textContent).toContain(
      "This didn’t send",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "won’t send twice",
    );
  });

  it("announces politely rather than interrupting", () => {
    // A screen-reader user mid-sentence should not be cut off by a condition
    // whose remedy is a button they already know about.
    render(<UnsentNotice show />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("renders nothing when there is nothing to report", () => {
    const { container } = render(<UnsentNotice show={false} />);
    expect(container.textContent).toBe("");
  });

  it("carries no em or en dash", () => {
    // Law 6 bans both in rendered copy. The first draft of this line used an em
    // dash before the reassurance.
    render(<UnsentNotice show />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toContain("—");
    expect(text).not.toContain("–");
  });
});
