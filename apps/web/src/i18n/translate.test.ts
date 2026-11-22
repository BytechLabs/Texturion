import { expect, it } from "vitest";

import { makeTranslate } from "./translate";

it("preserves placeholder text inside inserted titles", () => {
  const titles = { first: "{second}", second: "{first}" };

  expect(makeTranslate("en")("tasks.deleteSummaryAnd", titles)).toBe(
    "{second} and {first}",
  );
  expect(makeTranslate("fr-CA")("tasks.deleteSummaryAnd", titles)).toBe(
    "{second} et {first}",
  );
});
