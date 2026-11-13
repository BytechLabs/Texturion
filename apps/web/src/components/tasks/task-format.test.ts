import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import { taskActionAllowed, taskCallerName } from "./task-format";
const t = makeTranslate("en");

describe("D64 a task that came from a call", () => {
  it("names who rang: CNAM name, else the number, else unknown; null for a message task", () => {
    const call = {
      id: "k1",
      call_session_id: "s1",
      caller_e164: "+14165550133",
      caller_name: null,
      outcome: "answered" as const,
      forward_seconds: 60,
      started_at: "2026-08-08T18:00:00.000Z",
      ended_at: null,
      contact_id: null,
      has_voicemail: false,
    };
    expect(taskCallerName({ call: { ...call, caller_name: "Pat" } }, t)).toBe("Pat");
    expect(taskCallerName({ call }, t)).toBe("(416) 555-0133");
    expect(taskCallerName({ call: { ...call, caller_e164: null } }, t)).toBe(
      "Unknown caller",
    );
    expect(taskCallerName({ call: null }, t)).toBeNull();
  });
});

describe("#722 taskActionAllowed", () => {
  it("follows the server's list, and allows everything when the row has none", () => {
    expect(taskActionAllowed({ allowed_actions: ["complete"] }, "complete")).toBe(true);
    expect(taskActionAllowed({ allowed_actions: ["complete"] }, "trash")).toBe(false);
    expect(taskActionAllowed({ allowed_actions: [] }, "reopen")).toBe(false);
    expect(taskActionAllowed({}, "trash")).toBe(true);
  });
});
