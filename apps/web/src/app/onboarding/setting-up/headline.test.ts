import { describe, expect, it } from "vitest";

import { setupHeadline } from "./headline";

describe("setupHeadline", () => {
  it("does not call the checklist live while a row is still finishing", () => {
    // The number is the first of three rows and lands in under a minute.
    // Carrier registration takes 3 to 7 business days after it, and its row
    // says so a few pixels below this sentence.
    expect(
      setupHeadline({
        numberReady: true,
        everyRowDone: false,
        aRowNeedsYou: false,
      }),
    ).toBe(
      "Text your new number to see it land. One step below is still finishing.",
    );
  });

  it("calls it live only once every row is done", () => {
    expect(
      setupHeadline({
        numberReady: true,
        everyRowDone: true,
        aRowNeedsYou: false,
      }),
    ).toBe("Everything below is live. Text your new number to see it land.");
  });

  it("puts a step that needs the reader ahead of any other claim", () => {
    // A live number plus an outstanding verification code is the case that
    // matters: the reader must not be told everything is handled while a row
    // below is waiting on them.
    expect(
      setupHeadline({
        numberReady: true,
        everyRowDone: false,
        aRowNeedsYou: true,
      }),
    ).toBe("One step below needs you. The rest updates itself.");
  });

  it("promises nothing about a number that has not arrived", () => {
    expect(
      setupHeadline({
        numberReady: false,
        everyRowDone: false,
        aRowNeedsYou: false,
      }),
    ).toBe("This screen updates itself. No refreshing needed.");
  });
});
