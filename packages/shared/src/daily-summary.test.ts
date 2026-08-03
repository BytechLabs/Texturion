import { describe, expect, it } from "vitest";

import { summaryLine } from "./notification-delivery";

describe("summaryLine", () => {
  it("DS-1: leads with what is OWED, not with what happened", () => {
    // "12 texts came in" is a statistic; "3 people are still waiting on you"
    // is a to-do list, and only the second is worth opening the app for.
    expect(summaryLine({ waiting: 3, tasks: 2 })).toBe(
      "3 people are waiting on you · 2 tasks are due.",
    );
  });

  it("DS-2: gets the singular right on both halves", () => {
    // This is the most-read notification this product sends. "1 people are
    // waiting" in the one somebody reads every morning is the kind of thing
    // that makes the rest of it look careless.
    expect(summaryLine({ waiting: 1, tasks: 1 })).toBe(
      "1 person is waiting on you · 1 task is due.",
    );
  });

  it("DS-3: drops a half that would say zero", () => {
    expect(summaryLine({ waiting: 2, tasks: 0 })).toBe(
      "2 people are waiting on you.",
    );
    expect(summaryLine({ waiting: 0, tasks: 4 })).toBe("4 tasks are due.");
  });

  it("DS-4: a quiet day is a real answer, and the nicest one", () => {
    // Saying nothing would read as a broken summary; "0 waiting, 0 due" reads
    // like a spreadsheet.
    expect(summaryLine({ waiting: 0, tasks: 0 })).toBe(
      "Nothing is waiting. Nice day.",
    );
  });
});
