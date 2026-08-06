/**
 * @vitest-environment happy-dom
 */
import { THREAD_SUMMARY_ATTRIBUTION, THREAD_SUMMARY_SECTIONS } from "@loonext/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";
import {
  threadSummaryRequestFailure,
  type ThreadSummaryResult,
} from "@/lib/api/thread-summary";

import { ThreadSummaryCard } from "./thread-summary-card";

afterEach(cleanup);

const reportAiOutcome = vi.fn();
vi.mock("@/lib/api/conversations", () => ({
  reportAiOutcome: (...args: unknown[]) => reportAiOutcome(...args),
}));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));

/** The mutation hook, driven by hand so a press really precedes a result. */
const hook: {
  data: ThreadSummaryResult | undefined;
  isPending: boolean;
  /** A rejected request: `apiFetch` throws, so no result exists at all. */
  isError: boolean;
  error: unknown;
  mutate: () => void;
} = {
  data: undefined,
  isPending: false,
  isError: false,
  error: null,
  mutate: () => {},
};

vi.mock("@/lib/api/thread-summary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/thread-summary")>()),
  useThreadSummary: () => hook,
}));

const NEWEST = "m-newest";
/** No opt-out and no hint: the ordinary thread, so a test says so once. */
const CLEAR = { opt_out: null, opt_out_hint_at: null } as const;

function result(over: Partial<ThreadSummaryResult> = {}): ThreadSummaryResult {
  return { lines: [], ...CLEAR, ...over };
}

const [ASKED, WE_SAID, OPEN] = THREAD_SUMMARY_SECTIONS;

function line(
  section: (typeof THREAD_SUMMARY_SECTIONS)[number],
  text: string,
  message_id: string,
) {
  return {
    section: section.id,
    text,
    message_id,
    at: "2026-08-05T11:00:00.000Z",
  };
}

const onJump = vi.fn();

/** One line Lou wrote, so a test can watch it leave with the answer. */
const A_LINE = "Asked about Tuesday";
/** A thread with a standing on it, and a catch-up that has to sit under it. */
const optedOut = (source: string) =>
  result({
    lines: [line(ASKED, A_LINE, "msg-a")],
    opt_out: { source: source as never, at: "2026-08-01T00:00:00.000Z" },
  });

beforeEach(() => {
  hook.data = undefined;
  hook.isPending = false;
  hook.isError = false;
  hook.error = null;
  hook.mutate = () => {};
  reportAiOutcome.mockReset();
  onJump.mockReset();
});

/**
 * Press the control, let the answer land, re-render — the real sequence.
 *
 * Seeding `hook.data` before the first render would be a shortcut that skips
 * the press, and the press is what records which message the catch-up was asked
 * against. A test that skipped it would be testing a state the product cannot
 * reach.
 */
function press(newestMessageId: string) {
  const card = (id: string) => (
    <ThreadSummaryCard
      conversationId="c-1"
      offered
      newestMessageId={id}
      onJump={onJump}
    />
  );
  let newest = newestMessageId;
  const view = render(card(newest));
  fireEvent.click(screen.getByText("Catch me up"));
  /** Re-render with the hook's state as it now stands, nothing else moved. */
  const settle = () => view.rerender(card(newest));
  settle();
  return {
    ...view,
    settle,
    /** Re-render as if a new message had arrived under the catch-up. */
    newMessageArrives: (id: string) => {
      newest = id;
      settle();
    },
  };
}

function ask(answer: ThreadSummaryResult, newestMessageId = NEWEST) {
  // A fresh mount every time: the hook is component-local state in production
  // (useMutation), so a test that asks twice must start from nothing asked,
  // exactly as remounting the card does.
  hook.data = undefined;
  hook.isError = false;
  hook.mutate = () => {
    hook.data = answer;
  };
  return press(newestMessageId);
}

/**
 * Press it and have the REQUEST fail — no result, only a thrown error.
 *
 * The same sequence as {@link ask} on purpose. `useMutation` leaves `data`
 * undefined and sets `isError`, which is precisely the state the card used to
 * treat as "nothing has been asked yet" and answer with its resting row.
 */
function askAndFail(error: unknown, newestMessageId = NEWEST) {
  hook.data = undefined;
  hook.isError = false;
  hook.error = null;
  hook.mutate = () => {
    hook.isError = true;
    hook.error = error;
  };
  return press(newestMessageId);
}

const cardSection = () => screen.getByLabelText("Catch-up");
const bodyText = () => document.body.textContent ?? "";
/**
 * The opt-out strip, found by its announced role rather than by its wording.
 *
 * Identity matters more than presence here: asserting "the card's first child
 * has text in it" would pass with the strip deleted, because the header that
 * takes its place has text too. Comparing the ROLE-matched node against
 * `firstElementChild` is what makes "above everything Lou wrote" a real check.
 */
const standingNode = () =>
  screen.queryByRole("status") ?? screen.queryByRole("alert");
/** The mark's own word for what it is doing, from the shipped `AiOrbState`. */
const orbState = () =>
  document.querySelector(".ai-orb")?.getAttribute("data-state");

/**
 * Ask, get an answer, then press the card's own re-ask control and stop with
 * the second request IN FLIGHT.
 *
 * The second ask goes through the button rather than through a flag set by
 * hand, because the press is the event under test. `useMutation` builds a
 * fresh mutation on every `mutate`, so the previous answer is gone from the
 * frame the button was clicked in and does not return until a new one lands —
 * a gap as long as a round trip, spent looking at the card you just refreshed.
 */
function reAsk(first: ThreadSummaryResult) {
  const view = ask(first);
  /** The strip as it stood before the press, to compare the node itself. */
  const before = standingNode();
  const said = before?.textContent ?? null;
  // The thread moves, which is what puts the re-ask control on the card.
  view.newMessageArrives("m-newer");
  hook.mutate = () => {
    hook.data = undefined;
    hook.isPending = true;
  };
  fireEvent.click(screen.getByText("Catch me up again"));
  view.settle();
  return {
    ...view,
    before,
    said,
    /** The second request answers. */
    lands(second: ThreadSummaryResult) {
      hook.isPending = false;
      hook.data = second;
      view.settle();
    },
    /** The second request is rejected — a throw, and no answer at all. */
    fails(error: unknown) {
      hook.isPending = false;
      hook.isError = true;
      hook.error = error;
      view.settle();
    },
  };
}

describe("the catch-up card — what it costs", () => {
  /**
   * The single most expensive mistake available here. This is the largest input
   * the product sends to a model, and a card that read the thread on mount
   * would spend a metered call every time anybody opened a long thread — most
   * of which are not somebody coming back cold.
   */
  it("asks for nothing until somebody presses the control", () => {
    const mutate = vi.fn();
    hook.mutate = mutate;
    render(
      <ThreadSummaryCard
        conversationId="c-1"
        offered
        newestMessageId={NEWEST}
        onJump={onJump}
      />,
    );
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Catch me up"));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  /**
   * Not a disabled control, and not an explanation. A thread too short to be
   * worth a catch-up should show no trace of the feature — advertising
   * something with nothing behind it is the "clever at the user's expense"
   * failure the shared offer rule exists to prevent.
   */
  it("renders nothing at all on a thread the shared rule says is not worth it", () => {
    const { container } = render(
      <ThreadSummaryCard
        conversationId="c-1"
        offered={false}
        newestMessageId={NEWEST}
        onJump={onJump}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the catch-up card — never invent a fact", () => {
  /**
   * The whole guarantee, and it is structural rather than promised: there is no
   * branch that draws a line as text. Every line is a control that opens the
   * message grounding it, so an uncited claim has nowhere to appear.
   */
  it("makes every line open the message it cites", () => {
    ask(
      result({
        lines: [
          line(ASKED, "Asked what a new tank costs", "msg-a"),
          line(OPEN, "Nobody has answered the quote", "msg-b"),
        ],
      }),
    );

    fireEvent.click(screen.getByText("Nobody has answered the quote"));
    expect(onJump).toHaveBeenCalledWith("msg-b");

    fireEvent.click(screen.getByText("Asked what a new tank costs"));
    expect(onJump).toHaveBeenLastCalledWith("msg-a");
  });

  it("says whose reading this is, in the shared words, before the lines", () => {
    ask(result({ lines: [line(ASKED, "Asked about Tuesday", "msg-a")] }));
    const text = bodyText();
    expect(text).toContain(THREAD_SUMMARY_ATTRIBUTION);
    expect(text.indexOf(THREAD_SUMMARY_ATTRIBUTION)).toBeLessThan(
      text.indexOf("Asked about Tuesday"),
    );
  });

  /**
   * A heading with nothing under it is a claim about the conversation — "they
   * asked nothing" — that Lou never made.
   */
  it("shows only the sections that came back with lines", () => {
    ask(result({ lines: [line(WE_SAID, "Quoted 2,400", "msg-a")] }));
    expect(screen.getByText(WE_SAID.label)).toBeTruthy();
    expect(screen.queryByText(ASKED.label)).toBeNull();
    expect(screen.queryByText(OPEN.label)).toBeNull();
  });

  /**
   * Citation defends against invention and does nothing against staleness: a
   * correctly cited "we'll get someone out Tuesday" can be superseded two
   * messages later, and the receipt makes a crew trust it MORE. This notice is
   * the client's half of that mitigation.
   */
  it("says so when the thread has moved under the catch-up", () => {
    const view = ask(result({ lines: [line(WE_SAID, "Someone Tuesday", "msg-a")] }));
    const settled = bodyText();

    view.newMessageArrives("m-newer");
    expect(bodyText().length).toBeGreaterThan(settled.length);
    expect(screen.getByRole("status")).toBeTruthy();
    // And it offers to ask again — the server answers an unchanged thread from
    // its cache, so re-asking a moved thread is the only press that costs.
    expect(screen.getByText("Catch me up again")).toBeTruthy();
  });

  it("does not cry staleness on a thread that has not moved", () => {
    ask(result({ lines: [line(WE_SAID, "Someone Tuesday", "msg-a")] }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Catch me up again")).toBeNull();
  });

  it("says the reading was partial when the thread runs past the window", () => {
    ask(result({ lines: [line(ASKED, "Asked about Tuesday", "msg-a")], truncated: true }));
    const partial = bodyText();
    cleanup();
    ask(result({ lines: [line(ASKED, "Asked about Tuesday", "msg-a")] }));
    expect(partial.length).toBeGreaterThan(bodyText().length);
  });
});

describe("the catch-up card — never bury an opt-out", () => {
  /**
   * The slot is drawn before `lines` is read, so a summary line can never stand
   * where the standing should. Carrier truth outranks a tidy paragraph.
   */
  it("puts the standing above everything Lou wrote", () => {
    ask(optedOut("stop_keyword"));
    const strip = standingNode();
    expect(strip).toBeTruthy();
    // The card's very first child, so no line can be read before it.
    expect(strip).toBe(cardSection().firstElementChild);

    const text = bodyText();
    expect(text.indexOf(strip?.textContent ?? "")).toBeLessThan(
      text.indexOf("Asked about Tuesday"),
    );
  });

  /**
   * It rides on every response shape, including the eight refusals. A refusal
   * is exactly when nobody is looking at a card, and exactly when the standing
   * still has to be on screen.
   */
  it("shows the standing even when there is no catch-up to show", () => {
    ask(
      result({
        reason: "over_cap",
        opt_out: { source: "stop_keyword" as never, at: "2026-08-01T00:00:00.000Z" },
      }),
    );
    expect(standingNode()).toBe(cardSection().firstElementChild);
  });

  /** #331: only one of the two kinds is anybody here's to undo. */
  it("tells a carrier STOP apart from one somebody recorded by hand", () => {
    ask(optedOut("stop_keyword"));
    const carrier = standingNode()?.textContent;
    cleanup();

    ask(optedOut("manual"));
    const byHand = standingNode()?.textContent;

    expect(carrier).toBeTruthy();
    expect(byHand).toBeTruthy();
    expect(carrier).not.toBe(byHand);
  });

  /** #396: a plain-English request, announced rather than merely displayed. */
  it("announces an opt-out somebody typed in words", () => {
    ask(
      result({
        lines: [line(ASKED, "Asked about Tuesday", "msg-a")],
        opt_out_hint_at: "2026-08-04T00:00:00.000Z",
      }),
    );
    expect(screen.getByRole("alert").textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("says nothing about opting out on a thread where nobody did", () => {
    ask(result({ lines: [line(ASKED, "Asked about Tuesday", "msg-a")] }));
    // No standing to state, so no strip at all — and the card's first child is
    // therefore its own header rather than an empty announced region.
    expect(standingNode()).toBeNull();
    expect(cardSection().firstElementChild?.textContent).toContain("Catch-up");
  });
});

/**
 * The standing has to survive the press.
 *
 * `useMutation` clears `data` the moment it is asked again, so a strip rendered
 * from the live response alone left the screen for the width of the next
 * request: a thread the carrier is blocking stopped saying so at exactly the
 * moment somebody pressed the button, and said it again once the answer landed.
 * The window is short and it is the one somebody is looking at.
 */
describe("the catch-up card — the standing survives a re-ask", () => {
  const offline = new TypeError("Failed to fetch");

  it("keeps the standing on screen while the re-ask is in flight", () => {
    const again = reAsk(optedOut("stop_keyword"));
    expect(again.said).toBeTruthy();
    // Genuinely mid-request: Lou's own line went with the answer that carried
    // it, and the mark says so. That is the same clearing that used to take
    // the standing with it.
    expect(screen.queryByText(A_LINE)).toBeNull();
    expect(orbState()).toBe("thinking");

    const held = standingNode();
    expect(held?.textContent).toBe(again.said);
    expect(held).toBe(cardSection().firstElementChild);
    // The same NODE, not a second one saying the same thing: an announced
    // region that unmounts and remounts is one that speaks again, and this is
    // news the reader was given before they pressed anything.
    expect(held).toBe(again.before);
  });

  /**
   * A rejected re-ask is the worse half of the same bug. The request produced
   * no answer, so there is nothing fresher to state — and the old behaviour
   * read that as "state nothing", which is not what the server ever said.
   */
  it("keeps the standing when the re-ask is rejected outright", () => {
    const again = reAsk(optedOut("stop_keyword"));
    again.fails(offline);

    // Two announced regions now, and their order is the point: the standing is
    // still first and unchanged, and the news is the sentence under it.
    const announced = screen.getAllByRole("status");
    expect(announced[0]).toBe(again.before);
    expect(announced[0]?.textContent).toBe(again.said);
    expect(bodyText()).toContain(threadSummaryRequestFailure(offline).message);
  });

  /**
   * The other direction, and what the naive hold gets wrong. Remember the first
   * standing, prefer the remembered one, and a lifted opt-out stays on screen
   * for as long as the card lives — a strip stating the opposite of the truth
   * is worse than no strip, because a crew that believes a customer is
   * unreachable stops trying to reach them. This is the guard that fails when
   * the hold is either kept stale or read ahead of the answer.
   */
  it("drops the standing the moment an answer says it is gone", () => {
    const again = reAsk(optedOut("stop_keyword"));
    expect(standingNode()).toBeTruthy();

    again.lands(result({ lines: [line(ASKED, A_LINE, "msg-a")] }));
    expect(standingNode()).toBeNull();
    // And the header takes the slot back, rather than an empty announced region
    // sitting where the strip was.
    expect(cardSection().firstElementChild?.textContent).toContain("Catch-up");
  });

  /** Still a standing it was TOLD: a first ask has been told nothing yet. */
  it("states nothing while a first ask is in flight", () => {
    hook.mutate = () => {
      hook.isPending = true;
    };
    press(NEWEST);

    expect(orbState()).toBe("thinking");
    expect(standingNode()).toBeNull();
  });
});

describe("the catch-up card — a refusal is silence, not an error", () => {
  it("answers a refusal with one sentence and no lines", () => {
    ask(result({ reason: "disabled" }));
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(bodyText().length).toBeGreaterThan(0);
  });

  /**
   * A retry under "turned off for this workspace" is a button that cannot
   * succeed however often it is pressed.
   */
  it("offers no retry where a second press cannot change anything", () => {
    ask(result({ reason: "disabled" }));
    expect(screen.queryByText("Try again")).toBeNull();
    cleanup();

    ask(result({ reason: "model_error" }));
    expect(screen.getByText("Try again")).toBeTruthy();
  });
});

/**
 * H4 — the other half of that sentence. Silence is the right degradation for a
 * refusal, which is an answer; it is the wrong one for a request that was
 * rejected, which is no answer at all and used to leave the card sitting on its
 * resting row, indistinguishable from a button that does nothing.
 */
describe("the catch-up card — a failed request is not a refusal", () => {
  const offline = new TypeError("Failed to fetch");
  const role = new ApiError("forbidden", "Insufficient role for this action.", 403);
  const gone = new ApiError("not_found", "No such conversation.", 404);

  it("says something when the request never landed, rather than resting", () => {
    askAndFail(offline);
    // The resting row is what this used to fall back to. Its control going
    // missing is the whole difference between a card and a dead button.
    expect(screen.queryByText("Catch me up")).toBeNull();
    expect(bodyText()).toContain(threadSummaryRequestFailure(offline).message);
  });

  /**
   * THE ONE H4 NAMES. A read-only member is refused by the capability gate, and
   * a thread that cannot be opened is refused by this conversation — different
   * news, different remedy, and neither is "couldn't reach Lou just now".
   */
  it("tells a refusal about the workspace apart from one about this thread", () => {
    askAndFail(role);
    const workspace = bodyText();
    expect(workspace).toContain(threadSummaryRequestFailure(role).message);
    cleanup();

    askAndFail(gone);
    const thread = bodyText();
    expect(thread).toContain(threadSummaryRequestFailure(gone).message);
    expect(thread).not.toBe(workspace);
  });

  it("offers a second press only where a second press could work", () => {
    askAndFail(offline);
    expect(screen.getByText("Try again")).toBeTruthy();
    cleanup();

    askAndFail(role);
    expect(screen.queryByText("Try again")).toBeNull();
  });

  /**
   * The mark is honest too: `done` is the ring's bloom, which claims Lou
   * answered. On a rejected request nothing answered, so it rests.
   */
  it("does not wear the answered mark for a request nothing answered", () => {
    askAndFail(offline);
    const failed = document.querySelector(".ai-orb")?.getAttribute("data-state");
    cleanup();

    ask(result({ reason: "model_error" }));
    const refused = document.querySelector(".ai-orb")?.getAttribute("data-state");

    expect(failed).not.toBe(refused);
  });
});

describe("the catch-up card — what gets reported", () => {
  /**
   * #431: `used` means somebody opened a cited message, which is the one
   * deliberate act a client can see. Once per catch-up, however many lines are
   * opened — otherwise a card that is read carefully outscores one that is
   * read once and acted on.
   */
  it("reports one use however many cited messages are opened", () => {
    ask(
      result({
        lines: [
          line(ASKED, "Asked what a new tank costs", "msg-a"),
          line(OPEN, "Nobody has answered the quote", "msg-b"),
        ],
      }),
    );
    fireEvent.click(screen.getByText("Asked what a new tank costs"));
    fireEvent.click(screen.getByText("Nobody has answered the quote"));

    expect(reportAiOutcome).toHaveBeenCalledTimes(1);
    expect(reportAiOutcome).toHaveBeenCalledWith("company-1", "thread_summary", "used");
  });

  it("reports nothing for a catch-up nobody opened a message from", () => {
    ask(result({ lines: [line(ASKED, "Asked about Tuesday", "msg-a")] }));
    expect(reportAiOutcome).not.toHaveBeenCalled();
  });
});
