import {
  THREAD_SUMMARY_IDLE_MIN_MESSAGES,
  THREAD_SUMMARY_IDLE_MS,
  THREAD_SUMMARY_MIN_MESSAGES,
  THREAD_SUMMARY_SECTIONS,
  THREAD_SUMMARY_SECTION_IDS,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { ApiError } from "./error";
import {
  canRetryThreadSummary,
  groupThreadSummary,
  offerThreadSummary,
  threadSummaryFailureMessage,
  threadSummaryRequestFailure,
  type ThreadSummaryLine,
  type ThreadSummaryReason,
} from "./thread-summary";
import type { MessageDirection } from "./types";

/**
 * #247 — the client half of the catch-up, guarded.
 *
 * Every threshold below is READ from the shared module rather than typed in.
 * A test that pins 12 and 7 would pass forever after somebody changed the rule,
 * and would then be a ceiling on the fix rather than a check on the drift.
 */

const NOW = new Date("2026-08-05T12:00:00.000Z");

function thread(
  count: number,
  { idleMs = 0, direction = "inbound" as MessageDirection } = {},
): { direction: MessageDirection; created_at: string }[] {
  const newest = NOW.getTime() - idleMs;
  return Array.from({ length: count }, (_, index) => ({
    direction,
    // Spread backwards a minute apart so the newest is exactly `idleMs` old.
    created_at: new Date(newest - index * 60_000).toISOString(),
  }));
}

describe("offerThreadSummary — is this thread worth a catch-up", () => {
  it("offers at the shared message threshold and not one below it", () => {
    expect(offerThreadSummary(thread(THREAD_SUMMARY_MIN_MESSAGES), NOW)).toBe(true);
    expect(
      offerThreadSummary(thread(THREAD_SUMMARY_MIN_MESSAGES - 1), NOW),
    ).toBe(false);
  });

  it("offers a shorter thread once it has been idle long enough", () => {
    const short = THREAD_SUMMARY_IDLE_MIN_MESSAGES;
    expect(offerThreadSummary(thread(short, { idleMs: 0 }), NOW)).toBe(false);
    expect(
      offerThreadSummary(thread(short, { idleMs: THREAD_SUMMARY_IDLE_MS }), NOW),
    ).toBe(true);
    // Idle for a year is still not worth it with too little in it.
    expect(
      offerThreadSummary(
        thread(short - 1, { idleMs: THREAD_SUMMARY_IDLE_MS * 52 }),
        NOW,
      ),
    ).toBe(false);
  });

  /**
   * The load-bearing one. Notes are excluded from the prompt server-side, so a
   * thread that only LOOKS long because a crew annotated it heavily must not be
   * offered a catch-up — the model would be handed four customer messages and
   * asked what the conversation was about.
   */
  it("does not count internal notes toward the threshold", () => {
    const notes = thread(THREAD_SUMMARY_MIN_MESSAGES * 2, { direction: "note" });
    expect(offerThreadSummary(notes, NOW)).toBe(false);

    const mixed = [...notes, ...thread(THREAD_SUMMARY_MIN_MESSAGES)];
    expect(offerThreadSummary(mixed, NOW)).toBe(true);
  });

  it("says no to an empty thread and to unreadable timestamps", () => {
    expect(offerThreadSummary([], NOW)).toBe(false);
    expect(
      offerThreadSummary(
        Array.from({ length: THREAD_SUMMARY_MIN_MESSAGES }, () => ({
          direction: "inbound" as MessageDirection,
          created_at: "not a date",
        })),
        NOW,
      ),
    ).toBe(false);
  });

  /**
   * A clock skewed behind a just-arrived message produces a negative idle time.
   *
   * This asserts the OUTCOME, not the clamp that produces it — and the
   * distinction is worth writing down, because the clamp in `offerThreadSummary`
   * cannot be proven by breaking it: the shared rule only compares idleMs upward
   * against a positive threshold, so deleting the clamp leaves this test green.
   * The clamp is a contract, this is a behaviour, and neither pretends to be the
   * other.
   */
  it("treats a message from the future as brand new, never as ancient", () => {
    expect(
      offerThreadSummary(
        thread(THREAD_SUMMARY_IDLE_MIN_MESSAGES, { idleMs: -60_000 }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("groupThreadSummary — the three sections", () => {
  const line = (
    section: ThreadSummaryLine["section"],
    text: string,
    id: string,
  ): ThreadSummaryLine => ({
    section,
    text,
    message_id: id,
    at: NOW.toISOString(),
  });

  it("renders the shared sections in the shared order, whatever order they arrived in", () => {
    const reversed = [...THREAD_SUMMARY_SECTION_IDS]
      .reverse()
      .map((id, index) => line(id, `line ${index}`, `m${index}`));

    expect(groupThreadSummary(reversed).map((group) => group.id)).toEqual([
      ...THREAD_SUMMARY_SECTION_IDS,
    ]);
  });

  it("takes its headings from the shared labels, never its own", () => {
    const lines = THREAD_SUMMARY_SECTION_IDS.map((id, index) =>
      line(id, `line ${index}`, `m${index}`),
    );
    expect(groupThreadSummary(lines).map((group) => group.label)).toEqual(
      THREAD_SUMMARY_SECTIONS.map((section) => section.label),
    );
  });

  /**
   * An empty heading is a CLAIM, not a blank. "What they asked" with nothing
   * under it reads as "they asked nothing", which Lou never said and which is
   * usually false — the honest failure of this feature is saying less.
   */
  it("drops a section with nothing in it rather than heading an empty list", () => {
    const last = THREAD_SUMMARY_SECTION_IDS[THREAD_SUMMARY_SECTION_IDS.length - 1];
    const groups = groupThreadSummary([line(last, "still owed", "m1")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe(last);
  });

  it("keeps the server's order inside a section, which is oldest cited word first", () => {
    const [first] = THREAD_SUMMARY_SECTION_IDS;
    const groups = groupThreadSummary([
      line(first, "earlier", "m1"),
      line(first, "later", "m2"),
    ]);
    expect(groups[0]?.lines.map((l) => l.message_id)).toEqual(["m1", "m2"]);
  });

  it("returns nothing at all for no lines", () => {
    expect(groupThreadSummary([])).toEqual([]);
  });
});

/** Every reason the route can return, so a new one cannot be added untested. */
const REASONS: ThreadSummaryReason[] = [
  "disabled",
  "spam",
  "too_short",
  "rate_limited",
  "over_cap",
  "model_error",
  "unusable_output",
  "unavailable",
];

describe("threadSummaryFailureMessage — one sentence per reason", () => {
  it("gives every reason its own sentence, not one shrug shared between them", () => {
    const fallback = threadSummaryFailureMessage(undefined);
    for (const reason of REASONS) {
      expect(threadSummaryFailureMessage(reason), reason).not.toBe(fallback);
    }
    // model_error and unavailable are deliberately the same sentence — both
    // mean "Lou could not be reached", and splitting them would make the
    // reader guess at a distinction that changes nothing they can do.
    // Called through a lambda rather than passed to `.map` directly: the
    // function's second parameter is now the reader's lookup (#228), and a bare
    // reference would hand it the array index.
    const distinct = new Set(
      REASONS.map((reason) => threadSummaryFailureMessage(reason)),
    );
    expect(distinct.size).toBe(REASONS.length - 1);
  });

  it("still says something for a reason from a newer server than this build", () => {
    const message = threadSummaryFailureMessage(
      "something_new" as ThreadSummaryReason,
    );
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("canRetryThreadSummary — is a second press worth anything", () => {
  /**
   * A retry control under "catch-ups are turned off for this workspace" is a
   * button that cannot succeed however often it is pressed. These four are the
   * ones no second press can change from the thread.
   */
  it("offers no retry where nothing about a second press would differ", () => {
    for (const reason of ["disabled", "spam", "too_short", "over_cap"] as const) {
      expect(canRetryThreadSummary(reason), reason).toBe(false);
    }
  });

  it("offers a retry for everything transient, including an unknown reason", () => {
    for (const reason of [
      "rate_limited",
      "model_error",
      "unavailable",
      "unusable_output",
    ] as const) {
      expect(canRetryThreadSummary(reason), reason).toBe(true);
    }
    expect(canRetryThreadSummary(undefined)).toBe(true);
    expect(canRetryThreadSummary("from_a_newer_server" as ThreadSummaryReason)).toBe(
      true,
    );
  });

  it("covers every reason the route can return", () => {
    for (const reason of REASONS) {
      expect(typeof canRetryThreadSummary(reason), reason).toBe("boolean");
    }
  });
});

/**
 * H4 — the request itself failed, which is not the same event as a refusal.
 *
 * A refusal is an answer and silence degrades it honestly. A rejected request is
 * no answer at all, and the card that says nothing about one is indistinguishable
 * from a dead button.
 *
 * The server's own sentences are passed IN below rather than asserted as our
 * copy: every case here is about which sentence wins and whether a second press
 * is worth anything, so nothing pins a phrase this product might reword.
 */
describe("threadSummaryRequestFailure — when the ask never landed", () => {
  type ErrorCode = ConstructorParameters<typeof ApiError>[0];
  const failed = (code: ErrorCode, message: string, status: number) =>
    threadSummaryRequestFailure(new ApiError(code, message, status));

  /**
   * THE ONE H4 ASKS FOR. `forbidden` is about this person's standing in the
   * workspace — the `conversations.note` capability gate (a read-only member) or
   * a membership that ended — and no thread and no second press will change it.
   * `not_found` is about THIS conversation and nothing else. Collapsing them into
   * one sentence tells a read-only accountant that a thread has gone missing.
   */
  it("tells a refusal about the workspace apart from one about this thread", () => {
    const role = failed("forbidden", "Insufficient role for this action.", 403);
    const thread = failed("not_found", "No such conversation.", 404);

    expect(role.message).not.toBe(thread.message);
    expect(role.message.length).toBeGreaterThan(0);
    expect(thread.message.length).toBeGreaterThan(0);
    // Neither falls through to the server's own wording, which is written for
    // an API consumer and says nothing about what is still readable.
    expect(role.message).not.toBe("Insufficient role for this action.");
    expect(thread.message).not.toBe("No such conversation.");
    // And neither offers a press that cannot succeed.
    expect(role.retry).toBe(false);
    expect(thread.retry).toBe(false);
  });

  /**
   * The kill switch is the case where this route knows better than
   * `ApiError.retryable`, which is false for every code but two. #283 is an
   * operator's deliberate, temporary act during an incident — the one refusal
   * above that a second press really can get past.
   */
  it("retries an operator's pause where it will not retry a role", () => {
    const paused = failed("service_unavailable", "Temporarily unavailable.", 503);
    expect(paused.retry).toBe(true);
    expect(new ApiError("service_unavailable", "x", 503).retryable).toBe(false);
  });

  /** One fact, one wording: an edge 429 and the gate's own refusal are the same news. */
  it("says what the gate's own rate limit says, rather than a second wording", () => {
    expect(failed("rate_limited", "Too many requests.", 429).message).toBe(
      threadSummaryFailureMessage("rate_limited"),
    );
  });

  /**
   * The common failure on a phone in a basement: `fetch` rejects, nothing
   * reached the server, nothing was spent. The thrown value is not an ApiError
   * and its message is the browser's — developer text that must never surface.
   */
  it("never shows the browser's own words for a request that did not get out", () => {
    const offline = threadSummaryRequestFailure(new TypeError("Failed to fetch"));
    expect(offline.message).not.toContain("Failed to fetch");
    expect(offline.message.length).toBeGreaterThan(0);
    expect(offline.retry).toBe(true);
  });

  /**
   * A code this route does not raise keeps the server's OWN customer-facing
   * sentence (SPEC §7 writes one per code) instead of copy guessed here for a
   * state nobody has seen.
   */
  it("keeps the server's sentence for a code this route does not raise", () => {
    const message = "Your plan is paused. Resume it to start texting again.";
    const paused = failed("workspace_paused", message, 402);
    expect(paused.message).toBe(message);
    expect(paused.retry).toBe(false);
  });

  /**
   * An envelope with an empty message is a server bug, and passing it through
   * would put the card straight back into the silence this function exists to
   * end.
   */
  it("still says something when the envelope carried no sentence at all", () => {
    expect(failed("conflict", "", 409).message.length).toBeGreaterThan(0);
    expect(failed("conflict", "   ", 409).message.trim().length).toBeGreaterThan(0);
  });

  it("answers anything at all that gets thrown at it", () => {
    for (const thrown of [null, undefined, "a string", { code: "forbidden" }]) {
      const failure = threadSummaryRequestFailure(thrown);
      expect(failure.message.length, String(thrown)).toBeGreaterThan(0);
      expect(typeof failure.retry, String(thrown)).toBe("boolean");
    }
  });
});
