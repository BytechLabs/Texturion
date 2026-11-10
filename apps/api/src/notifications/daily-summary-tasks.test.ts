/**
 * #689 D: the daily summary counts the member's overdue and due-today tasks.
 *
 * It used to report every open task assigned to them as "due", which told
 * someone with a backlog of undated to-dos that the day was on fire. The count
 * is now what the app calls overdue plus what falls due by the end of THEIR day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { runDailySummary, tasksNeedingToday } from "./daily-summary";
import { deliverPush } from "./deliver";

vi.mock("./deliver", () => ({ deliverPush: vi.fn(async () => undefined) }));

const env = completeEnv();
const COMPANY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "33333333-3333-4333-8333-333333333333";
/** 07:45 in Toronto on 2026-08-05. */
const MORNING = new Date("2026-08-05T11:45:00Z");

beforeEach(() => {
  vi.mocked(deliverPush).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tasksNeedingToday", () => {
  const TORONTO = "America/Toronto";

  it("counts overdue, and what is due before their local midnight", () => {
    expect(
      tasksNeedingToday(
        [
          { overdue: true, due_at: "2026-08-04T15:00:00Z" },
          // 23:30 Toronto tonight is 03:30Z tomorrow: still today for them.
          { overdue: false, due_at: "2026-08-06T03:30:00Z" },
          { overdue: false, due_at: "2026-08-05T20:00:00Z" },
        ],
        TORONTO,
        "2026-08-05",
      ),
    ).toBe(3);
  });

  it("leaves out tomorrow and the undated", () => {
    expect(
      tasksNeedingToday(
        [
          // 00:30 Toronto tomorrow.
          { overdue: false, due_at: "2026-08-06T04:30:00Z" },
          { overdue: false, due_at: null },
          { overdue: false },
        ],
        TORONTO,
        "2026-08-05",
      ),
    ).toBe(0);
  });
});

describe("the summary line", () => {
  function run(myTasks: unknown[]) {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/notification_prefs", () => [
      {
        user_id: MEMBER,
        company_id: COMPANY,
        summary_at: "07:30",
        summary_sent_on: null,
        quiet_timezone: "America/Toronto",
        companies: { timezone: "America/Toronto" },
      },
    ]);
    sb.on("PATCH", "/rest/v1/notification_prefs", () => [{ user_id: MEMBER }]);
    sb.on("GET", "/rest/v1/company_members", () => [{ role: "owner" }]);
    sb.on("POST", "/rest/v1/rpc/api_for_you", () => ({
      totals: { waiting_on_you: 0, my_tasks: myTasks.length },
      my_tasks: myTasks,
    }));
    stubFetch(sb.route);
    return runDailySummary(env, MORNING);
  }

  it("says how many tasks need them today, not how many they own", async () => {
    await run([
      { overdue: true, due_at: "2026-08-04T15:00:00Z" },
      { overdue: false, due_at: "2026-08-05T20:00:00Z" },
      { overdue: false, due_at: null },
      { overdue: false, due_at: "2026-08-09T20:00:00Z" },
    ]);
    const delivery = vi.mocked(deliverPush).mock.calls[0][2];
    expect(delivery.web("en").body).toBe("2 tasks are due.");
  });

  it("does not call a backlog of undated work due", async () => {
    await run([{ overdue: false, due_at: null }]);
    const delivery = vi.mocked(deliverPush).mock.calls[0][2];
    expect(delivery.web("en").body).toBe("Nothing is waiting. Nice day.");
  });
});
