/**
 * Saving the reminder rules replaces them: the old set is deleted, the new one
 * inserted, and the saved set returned.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
import { appointmentReminderRoutes } from "./appointment-reminders";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const OWNER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(appointmentReminderRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => vi.unstubAllGlobals());

async function save(rules: { offset_minutes: number; body: string }[]) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(OWNER_ID, "owner"));
  sb.on("DELETE", "/rest/v1/appointment_reminder_rules", () => []);
  sb.on("POST", "/rest/v1/appointment_reminder_rules", () => []);
  sb.on("GET", "/rest/v1/appointment_reminder_rules", () =>
    rules.map((rule, index) => ({ id: `r${index}`, ...rule, enabled: true })),
  );
  stubFetch(jwksRoute(auth), sb.route);
  const res = await apiRequest(app, env, await auth.token(), "/v1/appointment-reminders", {
    method: "PUT",
    companyId: COMPANY_ID,
    body: { rules },
  });
  return { res, sb };
}

describe("PUT /v1/appointment-reminders", () => {
  it("replaces the rules and returns the saved set", async () => {
    const rules = [
      { offset_minutes: 1440, body: "See you tomorrow." },
      { offset_minutes: 120, body: "On our way in two hours." },
    ];
    const { res, sb } = await save(rules);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { rules: unknown[] }).rules).toHaveLength(2);
    expect(sb.find("DELETE", "/rest/v1/appointment_reminder_rules")).toHaveLength(1);
    const inserted = sb.find("POST", "/rest/v1/appointment_reminder_rules")[0].body as {
      offset_minutes: number;
    }[];
    expect(inserted.map((row) => row.offset_minutes)).toEqual([1440, 120]);
  });

  it("turns reminders off with an empty set, inserting nothing", async () => {
    const { res, sb } = await save([]);

    expect(res.status).toBe(200);
    expect(sb.find("DELETE", "/rest/v1/appointment_reminder_rules")).toHaveLength(1);
    expect(sb.find("POST", "/rest/v1/appointment_reminder_rules")).toHaveLength(0);
  });
});
