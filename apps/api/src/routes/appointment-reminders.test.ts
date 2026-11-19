import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFor } from "@loonext/shared";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch } from '../test/support';
import type { TestAuth } from '../test/support';
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

it("suggests reminder text in the workspace's language", async () => {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(OWNER_ID, "owner"));
  sb.on("GET", "/rest/v1/appointment_reminder_rules", () => []);
  sb.on("GET", "/rest/v1/companies", () => [{ locale: "fr-CA" }]);
  stubFetch(jwksRoute(auth), sb.route);

  const res = await apiRequest(app, env, await auth.token(), "/v1/appointment-reminders", {
    companyId: COMPANY_ID,
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ suggested: copyFor("fr-CA").appointmentReminders });
});

async function save(rules: { offset_minutes: number; body: string }[]) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(OWNER_ID, "owner"));
  sb.on("POST", "/rest/v1/rpc/api_replace_reminder_rules", () => ({
    outcome: "saved",
    rules: rules.map((rule, index) => ({ id: `r${index}`, ...rule, enabled: true })),
    replanned_jobs: rules.length > 0 ? 3 : 0,
  }));
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
    await expect(res.json()).resolves.toMatchObject({ rules, replanned_jobs: 3 });
    const [replacement] = sb.find("POST", "/rest/v1/rpc/api_replace_reminder_rules");
    expect(replacement.body).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_rules: rules,
    });
  });

  it("turns reminders off with an empty set, inserting nothing", async () => {
    const { res, sb } = await save([]);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ rules: [], replanned_jobs: 0 });
    expect(sb.find("POST", "/rest/v1/rpc/api_replace_reminder_rules")[0].body).toMatchObject({ p_rules: [] });
  });
});
