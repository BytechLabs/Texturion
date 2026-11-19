/**
 * #237 — switching a job's reminders off, and the queue going with them.
 *
 * The route exists because this is a different KIND of decision from the
 * metadata patch beside it: title, assignee and due date describe the job; this
 * one decides whether we text somebody about it. What is worth pinning is the
 * ordering — the queue must be cleared BEFORE the response, or an owner who
 * just switched reminders off sees the reminder they cancelled still sitting
 * there.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch } from '../test/support';
import type { TestAuth } from '../test/support';
import { tasksRoutes } from "./tasks";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const TASK_ID = "cccccccc-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(tasksRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Records the order the two writes happened in. */
function harness(outcome: "updated" | "not_found" | "no_conversation" = "updated") {
  const order: string[] = [];
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
  sb.on("POST", "/rest/v1/rpc/set_task_reminders_off", () => {
    order.push("set-flag");
    return {
      outcome,
      task: outcome === "updated" ? { id: TASK_ID, reminders_off: true, confirmed_at: null } : null,
    };
  });
  // The sync's own reads, which follow.
  sb.on("GET", "/rest/v1/tasks", () => {
    order.push("sync-read");
    return [];
  });
  sb.on("GET", "/rest/v1/appointment_reminder_rules", () => []);
  sb.on("POST", "/rest/v1/rpc/api_sync_task_reminders", () => {
    order.push("sync-write");
    return { outcome: "synced" };
  });
  return { sb, order };
}

describe("PUT /v1/tasks/:id/reminders", () => {
  it("clears the queue BEFORE answering, not after", async () => {
    const { sb, order } = harness();
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/reminders`,
      { method: "PUT", companyId: COMPANY_ID, body: { off: true } },
    );

    expect(response.status).toBe(200);
    // The whole reason this one call is awaited. An owner who switches
    // reminders off and still sees the queued text has been told a lie by the
    // screen they just used.
    expect(order[0]).toBe("set-flag");
    expect(order).toContain("sync-read");
  });

  it("404s a job that is not here", async () => {
    const { sb } = harness("not_found");
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/reminders`,
      { method: "PUT", companyId: COMPANY_ID, body: { off: true } },
    );
    expect(response.status).toBe(404);
  });

  it("refuses to enable reminders on a job with no customer conversation", async () => {
    const { sb, order } = harness("no_conversation");
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/reminders`,
      { method: "PUT", companyId: COMPANY_ID, body: { off: false } },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { message_key: "apiRefusals.remindersNeedCustomer" },
    });
    expect(order).toEqual(["set-flag"]);
  });

  it("422s a body that does not say which way", async () => {
    const { sb } = harness();
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/reminders`,
      { method: "PUT", companyId: COMPANY_ID, body: {} },
    );
    expect(response.status).toBe(422);
  });
});
