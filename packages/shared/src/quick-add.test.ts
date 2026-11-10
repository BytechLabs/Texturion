import { describe, expect, it } from "vitest";

import { parseQuickAdd, zonedToInstant, type QuickAddContext } from "./quick-add";

// Wednesday 11 November 2026, 10:30 in Toronto (EST, UTC-5).
const NOW = new Date("2026-11-11T15:30:00Z");

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const U3 = "00000000-0000-4000-8000-000000000003";

const ctx = (over: Partial<QuickAddContext> = {}): QuickAddContext => ({
  now: NOW,
  timeZone: "America/Toronto",
  selfUserId: U1,
  members: [
    { userId: U1, name: "Rehman Ahmad" },
    { userId: U2, name: "Sam Rivera" },
    { userId: U3, name: "Samantha Cho" },
  ],
  labels: [
    { id: "l1", name: "warranty" },
    { id: "l2", name: "boiler" },
  ],
  ...over,
});

const due = (line: string, over: Partial<QuickAddContext> = {}) => parseQuickAdd(line, ctx(over)).dueAt;

describe("the example line", () => {
  it("reads title, person, time and priority", () => {
    const r = parseQuickAdd("Fix furnace @rehman tomorrow 9am #urgent", ctx());
    expect(r.title).toBe("Fix furnace");
    expect(r.assignee?.userId).toBe(U1);
    expect(r.dueAt).toBe("2026-11-12T14:00:00.000Z");
    expect(r.dueHasTime).toBe(true);
    expect(r.priority).toBe("urgent");
    expect(r.understood.map((u) => [u.kind, u.text])).toEqual([
      ["assignee", "@rehman"],
      ["priority", "#urgent"],
      ["due", "tomorrow 9am"],
    ]);
  });

  it("is just a title when nothing in it means anything", () => {
    const r = parseQuickAdd("Order the part", ctx());
    expect(r).toMatchObject({ title: "Order the part", assignee: null, dueAt: null, priority: null, labels: [] });
    expect(r.understood).toEqual([]);
  });

  it("leaves the title empty when everything was understood", () => {
    expect(parseQuickAdd("tomorrow 9am", ctx()).title).toBe("");
  });
});

describe("days", () => {
  it("today with no time is 17:00 once 9:00 has passed", () => {
    expect(due("Call back today")).toBe("2026-11-11T22:00:00.000Z");
  });
  it("today with no time is 9:00 while it is still ahead", () => {
    expect(due("Call back today", { now: new Date("2026-11-11T12:00:00Z") })).toBe("2026-11-11T14:00:00.000Z");
  });
  it("tomorrow and its short forms are 9:00", () => {
    for (const w of ["tomorrow", "tmrw", "tmr"]) expect(due(`x ${w}`)).toBe("2026-11-12T14:00:00.000Z");
  });
  it("tonight is 18:00 unless a time is given", () => {
    expect(due("x tonight")).toBe("2026-11-11T23:00:00.000Z");
    expect(due("x tonight 8pm")).toBe("2026-11-12T01:00:00.000Z");
  });
  it("a bare weekday is the next one after today", () => {
    expect(due("x friday")).toBe("2026-11-13T14:00:00.000Z");
    expect(due("x mon")).toBe("2026-11-16T14:00:00.000Z");
    expect(due("x wednesday")).toBe("2026-11-18T14:00:00.000Z");
    expect(due("x thurs")).toBe("2026-11-12T14:00:00.000Z");
  });
  it("this is the same as a bare weekday", () => {
    expect(due("x this friday")).toBe("2026-11-13T14:00:00.000Z");
    expect(due("x this wednesday")).toBe("2026-11-18T14:00:00.000Z");
  });
  it("next weekday is that day of next week, the week starting Monday", () => {
    expect(due("x next friday")).toBe("2026-11-20T14:00:00.000Z");
    expect(due("x next monday")).toBe("2026-11-16T14:00:00.000Z");
    expect(due("x next sunday")).toBe("2026-11-22T14:00:00.000Z");
  });
  it("next week is next Monday", () => {
    expect(due("x next week")).toBe("2026-11-16T14:00:00.000Z");
  });
  it("on a Monday, next week is seven days on", () => {
    expect(due("x next week", { now: new Date("2026-11-09T15:30:00Z") })).toBe("2026-11-16T14:00:00.000Z");
  });
  it("in N days and weeks", () => {
    expect(due("x in 2 days")).toBe("2026-11-13T14:00:00.000Z");
    expect(due("x in 1 week")).toBe("2026-11-18T14:00:00.000Z");
    expect(due("x in 2 weeks 3pm")).toBe("2026-11-25T20:00:00.000Z");
  });
  it("in N hours and minutes counts from now and has a time", () => {
    const r = parseQuickAdd("x in 3 hours", ctx());
    expect(r.dueAt).toBe("2026-11-11T18:30:00.000Z");
    expect(r.dueHasTime).toBe(true);
    expect(due("x in 45 min")).toBe("2026-11-11T16:15:00.000Z");
    expect(due("x in 1 hr")).toBe("2026-11-11T16:30:00.000Z");
  });
  it("refuses in 0 days and in many", () => {
    expect(due("x in 0 days")).toBeNull();
    expect(due("x in many days")).toBeNull();
  });
});

describe("dates", () => {
  it("an ISO date", () => {
    expect(due("x 2026-12-25")).toBe("2026-12-25T14:00:00.000Z");
  });
  it("refuses an impossible ISO date", () => {
    expect(due("x 2026-02-30")).toBeNull();
    expect(due("x 2026-13-01")).toBeNull();
  });
  it("month and day, either way round, with ordinals", () => {
    expect(due("x dec 25 noon")).toBe("2026-12-25T17:00:00.000Z");
    expect(due("x 25 dec 14:30")).toBe("2026-12-25T19:30:00.000Z");
    expect(due("x december 3rd")).toBe("2026-12-03T14:00:00.000Z");
    expect(due("x 3rd december")).toBe("2026-12-03T14:00:00.000Z");
  });
  it("a date that has passed this year is next year", () => {
    expect(due("x nov 5")).toBe("2027-11-05T13:00:00.000Z");
  });
  it("a date that is today is today", () => {
    expect(due("x nov 11")).toBe("2026-11-11T22:00:00.000Z");
  });
  it("Feb 29 waits for a leap year and Feb 30 never comes", () => {
    expect(due("x feb 29")).toBe("2028-02-29T14:00:00.000Z");
    expect(due("x feb 30")).toBeNull();
  });
  it("May is only a month when a day follows", () => {
    const r = parseQuickAdd("we may need parts", ctx());
    expect(r.title).toBe("we may need parts");
    expect(r.dueAt).toBeNull();
  });
});

describe("times", () => {
  it("a clock with no date is today, or tomorrow once passed", () => {
    expect(due("x 5pm")).toBe("2026-11-11T22:00:00.000Z");
    expect(due("x 9am")).toBe("2026-11-12T14:00:00.000Z");
    expect(due("x 10:30am")).toBe("2026-11-12T15:30:00.000Z");
  });
  it("12 hour and 24 hour", () => {
    expect(due("x tomorrow 12am")).toBe("2026-11-12T05:00:00.000Z");
    expect(due("x tomorrow 12pm")).toBe("2026-11-12T17:00:00.000Z");
    expect(due("x tomorrow 9:30pm")).toBe("2026-11-13T02:30:00.000Z");
    expect(due("x tomorrow 14:00")).toBe("2026-11-12T19:00:00.000Z");
    expect(due("x tomorrow 23:59")).toBe("2026-11-13T04:59:00.000Z");
  });
  it("noon", () => {
    expect(due("x tomorrow noon")).toBe("2026-11-12T17:00:00.000Z");
  });
  it("at plus an hour is read the way a trade day is", () => {
    expect(due("x tomorrow at 9")).toBe("2026-11-12T14:00:00.000Z");
    expect(due("x tomorrow at 2")).toBe("2026-11-12T19:00:00.000Z");
    expect(due("x tomorrow at 12")).toBe("2026-11-12T17:00:00.000Z");
    expect(due("x tomorrow at 15")).toBe("2026-11-12T20:00:00.000Z");
    expect(due("x tomorrow at 9:15")).toBe("2026-11-12T14:15:00.000Z");
  });
  it("a time before the date", () => {
    expect(due("x 9am tomorrow")).toBe("2026-11-12T14:00:00.000Z");
  });
  it("refuses an hour that is not one", () => {
    expect(due("x tomorrow 25:00")).toBe("2026-11-12T14:00:00.000Z");
    expect(due("x tomorrow 13pm")).toBe("2026-11-12T14:00:00.000Z");
    expect(due("x tomorrow at 0")).toBe("2026-11-12T14:00:00.000Z");
  });
  it("a bare number is not a time", () => {
    expect(parseQuickAdd("Room 9", ctx())).toMatchObject({ title: "Room 9", dueAt: null });
  });
});

describe("whose clock", () => {
  it("is the member's zone", () => {
    expect(due("x tomorrow 9am", { timeZone: "America/Los_Angeles" })).toBe("2026-11-12T17:00:00.000Z");
    expect(due("x tomorrow 9am", { timeZone: "UTC" })).toBe("2026-11-12T09:00:00.000Z");
  });
  it("uses the member's today, not the server's", () => {
    // 03:30 UTC on the 12th is still the evening of the 11th in Toronto, so
    // "today" is the 11th and its 17:00 has passed: 17:00 on the 11th.
    expect(due("x today", { now: new Date("2026-11-12T03:30:00Z") })).toBe("2026-11-11T22:00:00.000Z");
  });
  it("is right across the spring change", () => {
    // 15 March 2027 is the day after Toronto went to daylight time (UTC-4).
    expect(due("x march 15 9am")).toBe("2027-03-15T13:00:00.000Z");
    expect(due("x march 13 9am")).toBe("2027-03-13T14:00:00.000Z");
  });
  it("is right across the autumn change", () => {
    expect(zonedToInstant({ y: 2026, m: 11, d: 2 }, { h: 9, mi: 0 }, "America/Toronto")).toBe(Date.UTC(2026, 10, 2, 14));
    expect(zonedToInstant({ y: 2026, m: 10, d: 30 }, { h: 9, mi: 0 }, "America/Toronto")).toBe(Date.UTC(2026, 9, 30, 13));
  });
  it("handles a zone with no daylight saving", () => {
    expect(due("x tomorrow 9am", { timeZone: "America/Regina" })).toBe("2026-11-12T15:00:00.000Z");
  });
});

describe("people", () => {
  it("@me is the one typing", () => {
    expect(parseQuickAdd("x @me", ctx({ selfUserId: U2 })).assignee?.userId).toBe(U2);
  });
  it("matches a first name, whole or in part", () => {
    expect(parseQuickAdd("x @rehman", ctx()).assignee?.userId).toBe(U1);
    expect(parseQuickAdd("x @reh", ctx()).assignee?.userId).toBe(U1);
    expect(parseQuickAdd("x @ahmad", ctx()).assignee?.userId).toBe(U1);
  });
  it("an exact first name beats a longer one", () => {
    expect(parseQuickAdd("x @sam", ctx()).assignee?.userId).toBe(U2);
    expect(parseQuickAdd("x @samx", ctx()).assignee).toBeNull();
    expect(parseQuickAdd("x @samantha", ctx()).assignee?.userId).toBe(U3);
  });
  it("an ambiguous or unknown name stays in the title and is reported", () => {
    const amb = parseQuickAdd("ask @sa", ctx());
    expect(amb.assignee).toBeNull();
    expect(amb.title).toBe("ask @sa");
    expect(amb.ignored).toEqual(["@sa"]);
    expect(parseQuickAdd("ask @nobody", ctx()).ignored).toEqual(["@nobody"]);
  });
  it("ignores case and trailing punctuation", () => {
    expect(parseQuickAdd("x @REHMAN, please", ctx()).assignee?.userId).toBe(U1);
  });
  it("only the first person is taken", () => {
    const r = parseQuickAdd("x @rehman @sam", ctx());
    expect(r.assignee?.userId).toBe(U1);
    expect(r.title).toBe("x @sam");
  });
  it("a lone @ is not a mention", () => {
    expect(parseQuickAdd("meet @ the shop", ctx()).title).toBe("meet @ the shop");
  });
  it("@me with nobody to be", () => {
    expect(parseQuickAdd("x @me", ctx({ members: [] })).ignored).toEqual(["@me"]);
  });
});

describe("priority and labels", () => {
  it("the four priority words", () => {
    for (const p of ["urgent", "high", "low", "normal"] as const) {
      expect(parseQuickAdd(`x #${p}`, ctx()).priority).toBe(p);
    }
  });
  it("the first priority wins and the second stays in the title", () => {
    const r = parseQuickAdd("x #low #urgent", ctx());
    expect(r.priority).toBe("low");
    expect(r.title).toBe("x #urgent");
  });
  it("a priority word is not a label, even when the workspace has one of that name", () => {
    const r = parseQuickAdd("x #urgent", ctx({ labels: [{ id: "l9", name: "urgent" }] }));
    expect(r.priority).toBe("urgent");
    expect(r.labels).toEqual([]);
  });
  it("labels match whole words, ignoring case, once each", () => {
    const r = parseQuickAdd("x #Boiler #warranty #boiler", ctx());
    expect(r.labels.map((l) => l.id)).toEqual(["l2", "l1"]);
    expect(r.title).toBe("x");
  });
  it("an unknown label stays in the title and is reported", () => {
    const r = parseQuickAdd("x #unknown", ctx());
    expect(r.labels).toEqual([]);
    expect(r.title).toBe("x #unknown");
    expect(r.ignored).toEqual(["#unknown"]);
  });
  it("a lone # is nothing", () => {
    expect(parseQuickAdd("item # 4", ctx()).title).toBe("item # 4");
  });
});

describe("references", () => {
  it("are never labels and stay in the title", () => {
    const r = parseQuickAdd("Follow up #T-142 #contact-1a2b3c4d #conv-abcdef01 tomorrow", ctx());
    expect(r.title).toBe("Follow up #T-142 #contact-1a2b3c4d #conv-abcdef01");
    expect(r.ignored).toEqual([]);
    expect(r.labels).toEqual([]);
  });
  it("even when a workspace has a label called t-142", () => {
    const r = parseQuickAdd("x #t-142", ctx({ labels: [{ id: "l9", name: "t-142" }] }));
    expect(r.labels).toEqual([]);
    expect(r.title).toBe("x #t-142");
  });
});

describe("the line itself", () => {
  it("copes with extra space and punctuation", () => {
    const r = parseQuickAdd("  Fix   it ,  tomorrow.  ", ctx());
    expect(r.title).toBe("Fix it ,");
    expect(r.dueAt).toBe("2026-11-12T14:00:00.000Z");
  });
  it("an empty line is empty", () => {
    expect(parseQuickAdd("", ctx())).toMatchObject({ title: "", dueAt: null, assignee: null });
    expect(parseQuickAdd("   ", ctx()).title).toBe("");
  });
  it("takes only the first date and the first time", () => {
    const r = parseQuickAdd("x tomorrow friday 9am 5pm", ctx());
    expect(r.dueAt).toBe("2026-11-12T14:00:00.000Z");
    expect(r.title).toBe("x friday 5pm");
  });
  it("keeps the words in the order they were typed", () => {
    expect(parseQuickAdd("Replace the filter at the shop tomorrow", ctx()).title).toBe("Replace the filter at the shop");
  });
  it("does not read a date out of the middle of a word", () => {
    expect(parseQuickAdd("Monday's meeting and sunroom fix", ctx()).dueAt).toBeNull();
  });
  it("a title that is one understood word is empty", () => {
    expect(parseQuickAdd("#urgent", ctx()).title).toBe("");
  });
});
