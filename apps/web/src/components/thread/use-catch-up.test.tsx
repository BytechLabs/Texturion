/**
 * @vitest-environment happy-dom
 */
import { THREAD_SUMMARY_MIN_MESSAGES } from "@loonext/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/api/types";

import { CatchUpHint } from "./catch-up-hint";
import { useCatchUp } from "./use-catch-up";

afterEach(cleanup);

const ME = "u-me";

/** The loaded thread, newest first as the API pages it. */
let thread: Message[] = [];

vi.mock("@/lib/api/messages", () => ({
  useMessages: () => ({
    data: { pages: [{ data: thread, next_cursor: null }], pageParams: [undefined] },
  }),
}));

let sequence = 0;
/** A message a few seconds after the last one, so each is the newest. */
function message(over: Partial<Message> = {}): Message {
  sequence += 1;
  return {
    id: `m-${sequence}`,
    direction: "inbound",
    sent_by_user_id: null,
    // From the real clock: the offer rule reads `new Date()`.
    created_at: new Date(Date.now() - 60 * 60_000 + sequence * 1000).toISOString(),
    ...over,
  } as Message;
}

/** A thread the shared rule offers a catch-up on, by length alone. */
function longThread(): Message[] {
  return Array.from({ length: THREAD_SUMMARY_MIN_MESSAGES }, () => message()).reverse();
}

function arrives(next: Message) {
  thread = [next, ...thread];
}

/** What the thread view does with the hook: the hint, the token, the card's dismiss. */
function Thread({ conversationId = "c-1" }: { conversationId?: string }) {
  const catchUp = useCatchUp(conversationId, ME);
  return (
    <>
      <span data-testid="token">{catchUp.askToken}</span>
      <span data-testid="offered">{String(catchUp.offered)}</span>
      <button type="button" data-testid="close-recap" onClick={catchUp.recapClosed} />
      {catchUp.hintShown && (
        <CatchUpHint
          onRecap={catchUp.ask}
          onNotNow={catchUp.notNow}
          returnFocus={() => {}}
        />
      )}
    </>
  );
}

const hint = () => screen.queryByText("Catch up on this thread?");
const token = () => screen.getByTestId("token").textContent;

beforeEach(() => {
  window.sessionStorage.clear();
  sequence = 0;
  thread = longThread();
});

describe("useCatchUp — when the hint shows", () => {
  it("shows on a thread the shared rule offers", () => {
    render(<Thread />);
    expect(hint()).toBeTruthy();
    // Announced, not just drawn.
    expect(screen.getByRole("status").textContent).toContain("Catch up on this thread?");
  });

  it("does not show on a thread too short to be worth one", () => {
    thread = [message(), message()].reverse();
    render(<Thread />);
    expect(screen.getByTestId("offered").textContent).toBe("false");
    expect(hint()).toBeNull();
  });
});

describe("useCatchUp — Not now", () => {
  it("hides the hint, and keeps it hidden across a reload", () => {
    const view = render(<Thread />);
    fireEvent.click(screen.getByText("Not now"));
    expect(hint()).toBeNull();

    view.unmount();
    render(<Thread />);
    expect(hint()).toBeNull();
  });

  it("comes back when a newer message arrives", () => {
    const view = render(<Thread />);
    fireEvent.click(screen.getByText("Not now"));

    arrives(message());
    view.rerender(<Thread />);
    expect(hint()).toBeTruthy();
  });

  /** The person's own reply is not news they need a recap of. */
  it("stays away for a message the viewer sent themselves", () => {
    const view = render(<Thread />);
    fireEvent.click(screen.getByText("Not now"));

    arrives(message({ direction: "outbound", sent_by_user_id: ME }));
    view.rerender(<Thread />);
    expect(hint()).toBeNull();
  });

  it("is remembered per conversation", () => {
    const view = render(<Thread conversationId="c-1" />);
    fireEvent.click(screen.getByText("Not now"));
    view.rerender(<Thread conversationId="c-2" />);
    expect(hint()).toBeTruthy();
  });

  it("asks nothing", () => {
    render(<Thread />);
    fireEvent.click(screen.getByText("Not now"));
    expect(token()).toBe("0");
  });

  it("is what Escape does inside the hint", () => {
    render(<Thread />);
    fireEvent.keyDown(screen.getByText("Recap"), { key: "Escape" });
    expect(hint()).toBeNull();
    expect(token()).toBe("0");
  });
});

describe("useCatchUp — Recap", () => {
  it("asks, by moving the token the card watches", () => {
    render(<Thread />);
    expect(token()).toBe("0");
    fireEvent.click(screen.getByText("Recap"));
    expect(token()).toBe("1");
    // The card is up now, so the hint has done its job.
    expect(hint()).toBeNull();
  });

  it("does not offer again over a recap that is still open", () => {
    const view = render(<Thread />);
    fireEvent.click(screen.getByText("Recap"));
    // The card says the thread moved and offers its own re-ask.
    arrives(message());
    view.rerender(<Thread />);
    expect(hint()).toBeNull();

    // Once the card is dismissed, the newer message is worth offering.
    fireEvent.click(screen.getByTestId("close-recap"));
    expect(hint()).toBeTruthy();
  });

  it("does not offer again for the same messages once the card is dismissed", () => {
    render(<Thread />);
    fireEvent.click(screen.getByText("Recap"));
    fireEvent.click(screen.getByTestId("close-recap"));
    expect(hint()).toBeNull();
  });

  /** A token from one thread must never make the next thread's card spend. */
  it("starts every conversation from nothing asked", () => {
    const view = render(<Thread conversationId="c-1" />);
    fireEvent.click(screen.getByText("Recap"));
    expect(token()).toBe("1");
    view.rerender(<Thread conversationId="c-2" />);
    expect(token()).toBe("0");
  });
});
