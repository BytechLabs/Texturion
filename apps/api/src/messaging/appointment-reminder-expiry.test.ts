/**
 * How long a held reminder stays worth sending is the workspace's setting, with
 * two hours after the appointment as the default.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { syncTaskReminders } from "./appointment-reminders";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const TASK = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-10T15:00:00Z");
const DUE = "2026-11-12T18:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());

async function expiryHoursAfterDue(settings: Record<string, unknown>) {
  const env = completeEnv();
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/tasks", () => ({
    due_at: DUE,
    conversation_id: "22222222-2222-4222-8222-222222222222",
    reminders_off: false,
    conversations: {
      contact_phone_e164: "+16135550142",
      contacts: { timezone: "America/Toronto" },
    },
  }));
  sb.on("GET", "/rest/v1/companies", () => [{ id: COMPANY, ...settings }]);
  sb.on("POST", "/rest/v1/rpc/api_sync_task_reminders", () => ({ outcome: "synced" }));
  sb.on("GET", /\/rest\/v1\//, () => []);
  sb.on("POST", /\/rest\/v1\/rpc\//, () => []);
  stubFetch(sb.route);

  await syncTaskReminders(getDb(env), {
    companyId: COMPANY,
    taskId: TASK,
    userId: OWNER,
    now: NOW,
  });

  const call = sb.find("POST", "/rest/v1/rpc/api_sync_task_reminders")[0].body as {
    p_expires_at: string;
  };
  return (Date.parse(call.p_expires_at) - Date.parse(DUE)) / 3_600_000;
}

describe("appointment reminder expiry", () => {
  it("expires two hours after the appointment by default", async () => {
    expect(await expiryHoursAfterDue({})).toBe(2);
  });

  it("uses the workspace's own number of hours", async () => {
    expect(await expiryHoursAfterDue({ reminder_expiry_hours: 6 })).toBe(6);
  });
});
