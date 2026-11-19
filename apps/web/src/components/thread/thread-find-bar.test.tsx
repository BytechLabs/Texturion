/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ThreadFindBar } from "./thread-find-bar";

vi.mock("@/lib/api/messages", () => ({
  useFindThreadMessages: () => ({
    data: { data: [{ id: "newest" }, { id: "older" }], truncated: false },
    isFetching: false,
    isError: false,
  }),
}));

afterEach(cleanup);

it("opens on the matched message and steps in either direction", () => {
  const jump = vi.fn();
  const close = vi.fn();
  render(
    <ThreadFindBar
      conversationId="thread"
      initialQuery="furn"
      initialMessage="older"
      onJump={jump}
      onClose={close}
    />,
  );

  const input = screen.getByRole("searchbox");
  expect(input).toHaveProperty("value", "furn");
  expect(screen.getByRole("status").textContent).toBe("2 of 2");
  fireEvent.click(screen.getByRole("button", { name: "Next match" }));
  expect(jump).toHaveBeenLastCalledWith("newest");
  expect(screen.getByRole("status").textContent).toBe("1 of 2");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(jump).toHaveBeenLastCalledWith("older");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
