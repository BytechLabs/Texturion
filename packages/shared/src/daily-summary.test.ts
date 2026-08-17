import { describe, expect, it } from "vitest";

import { SUMMARY_TITLE, summaryLine } from "./notification-delivery";

describe("summaryLine", () => {
  it("DS-1: leads with what is OWED, not with what happened", () => {
    // "12 texts came in" is a statistic; "3 people are still waiting on you"
    // is a to-do list, and only the second is worth opening the app for.
    expect(summaryLine({ waiting: 3, tasks: 2 }, "en")).toBe(
      "3 people are waiting on you · 2 tasks are due.",
    );
  });

  it("DS-2: gets the singular right on both halves", () => {
    // This is the most-read notification this product sends. "1 people are
    // waiting" in the one somebody reads every morning is the kind of thing
    // that makes the rest of it look careless.
    expect(summaryLine({ waiting: 1, tasks: 1 }, "en")).toBe(
      "1 person is waiting on you · 1 task is due.",
    );
  });

  it("DS-3: drops a half that would say zero", () => {
    expect(summaryLine({ waiting: 2, tasks: 0 }, "en")).toBe(
      "2 people are waiting on you.",
    );
    expect(summaryLine({ waiting: 0, tasks: 4 }, "en")).toBe("4 tasks are due.");
  });

  it("DS-4: a quiet day is a real answer, and the nicest one", () => {
    // Saying nothing would read as a broken summary; "0 waiting, 0 due" reads
    // like a spreadsheet.
    expect(summaryLine({ waiting: 0, tasks: 0 }, "en")).toBe(
      "Nothing is waiting. Nice day.",
    );
  });

  it("DS-5: says the same thing in French, singular and plural", () => {
    // #228. The same four shapes, because the failure this catches is a copy
    // table that has a French row nothing ever reads — and the daily summary
    // is the notification somebody is most likely to read and nothing else.
    expect(summaryLine({ waiting: 3, tasks: 2 }, "fr-CA")).toBe(
      "3 personnes attendent après vous · 2 tâches arrivent à échéance.",
    );
    expect(summaryLine({ waiting: 1, tasks: 1 }, "fr-CA")).toBe(
      "1 personne attend après vous · 1 tâche arrive à échéance.",
    );
  });

  it("DS-6: the quiet day keeps its own punctuation in French too", () => {
    // This branch bypasses the join-and-period assembly, so it is the one
    // place a clause carries its own periods. Getting that wrong in one
    // language only is exactly what a single-language test would miss.
    expect(summaryLine({ waiting: 0, tasks: 0 }, "fr-CA")).toBe(
      "Rien n'attend après vous. Bonne journée.",
    );
  });
});

describe("SUMMARY_TITLE", () => {
  it("DS-7: the title a member recognises, in either language", () => {
    // It never varies within a language on purpose — that is what makes the
    // daily notification identifiable at a glance.
    expect(SUMMARY_TITLE.en).toBe("Where things stand");
    expect(SUMMARY_TITLE["fr-CA"]).toBe("Où en sont les choses");
  });
});
