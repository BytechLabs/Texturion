/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { InboxFocusProvider, queueThreadHeading, useInboxFocus } from "@/lib/inbox/navigation-focus";

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
  expect(document.activeElement).toBe(input);
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

function OpenedSearchThread({ openedManually }: { openedManually: boolean }) {
  const focus = useInboxFocus();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    queueThreadHeading(focus, "thread", "conversation:thread");
    const request = focus?.current;
    if (request) request.headingPending = false;
    heading.current?.focus();
  }, [focus]);

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>Conversation</h1>
      <ThreadFindBar
        conversationId="thread"
        initialQuery="furn"
        initialMessage="older"
        openedManually={openedManually}
        onJump={() => undefined}
        onClose={() => undefined}
      />
    </>
  );
}

it("keeps keyboard focus on a search result's thread heading until Find is opened explicitly", () => {
  const { rerender } = render(
    <InboxFocusProvider><OpenedSearchThread openedManually={false} /></InboxFocusProvider>,
  );
  expect(document.activeElement).toBe(screen.getByRole("heading"));
  expect(screen.getByRole("searchbox")).toHaveProperty("value", "furn");

  rerender(<InboxFocusProvider><OpenedSearchThread openedManually /></InboxFocusProvider>);
  expect(document.activeElement).toBe(screen.getByRole("searchbox"));
});
