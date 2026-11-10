/**
 * #691 — a STOP outlives the thread it arrived in, and the contact it came from.
 *
 * Opt-out is carrier truth: only the customer lifts it. The gate that enforces
 * that (`runPreSendGates`) asks `opt_outs`, keyed on (company, phone), and
 * nothing else — not the conversation, not the contact. That keying is the whole
 * reason deleting either cannot re-open a number, and these tests pin both halves:
 *
 *   1. the delete routes never read or write `opt_outs`;
 *   2. with the conversation and the contact deleted, a send to the opted-out
 *      number is still refused, and the lookup that refused it names neither.
 *
 * The SQL half (the row survives the trash and the purge) is in
 * supabase/tests/deletion_and_trash.test.sql.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runPreSendGates } from "./send";
import { endpoint, makeHarness } from "../test/billing-support";
import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { contactsRoutes } from "../routes/contacts";
import { trashRoutes } from "../routes/trash";
import { getSendGates } from "../telnyx/registration";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONV_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const CONTACT_ID = "ffffffff-1111-4222-8333-444444444444";
const OPTED_OUT_NUMBER = "+14155550123";

let auth: TestAuth;
const app = buildTestApp(trashRoutes);
const contactsApp = buildTestApp(contactsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

beforeEach(() => {
  vi.mocked(getSendGates).mockReset();
  vi.mocked(getSendGates).mockResolvedValue({
    subscriptionActive: true,
    paused: false,
    aupEnforcement: "none",
    usApproved: true,
    caAllowed: true,
  });
});

describe("#691 opt-out survives deletion", () => {
  it("the delete routes never touch opt_outs", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "admin"));
    sb.on("POST", "/rest/v1/rpc/api_trash_conversations", () => ({
      trashed: [CONV_ID],
      calls: 0,
    }));
    sb.on("PATCH", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
    stubFetch(jwksRoute(auth), sb.route);

    const thread = await apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}`, {
      method: "DELETE",
      companyId: COMPANY_ID,
    });
    const contact = await apiRequest(
      contactsApp,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(thread.status).toBe(200);
    expect(contact.status).toBe(204);
    expect(sb.calls.filter((call) => call.path.includes("opt_outs"))).toHaveLength(0);
    // The contact is soft-deleted in place, not removed: the PATCH sets a stamp.
    expect(sb.find("DELETE", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("a send to the number is refused after both are deleted, by phone alone", async () => {
    const lookups: URL[] = [];
    const harness = makeHarness([
      endpoint("HEAD", /\/rest\/v1\/messages/, () =>
        new Response(null, { status: 206, headers: { "content-range": "0-0/0" } }),
      ),
      // Whatever happened to the conversation and the contact, the opt-out row
      // is still there: it is not a child of either.
      endpoint("GET", /\/rest\/v1\/opt_outs/, (request) => {
        lookups.push(new URL(request.url));
        return [{ id: "opt-1" }];
      }),
    ]);
    stubFetch(harness.route);

    await expect(
      runPreSendGates(env, COMPANY_ID, OPTED_OUT_NUMBER),
    ).rejects.toMatchObject({ code: "recipient_opted_out" });

    expect(lookups).toHaveLength(1);
    const params = lookups[0].searchParams;
    expect(params.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(params.get("phone_e164")).toBe(`eq.${OPTED_OUT_NUMBER}`);
    expect(params.get("revoked_at")).toBe("is.null");
    // Nothing in the question mentions a thread or a contact, so removing either
    // cannot change the answer.
    expect(lookups[0].search).not.toMatch(/conversation|contact_id|deleted_at/);
  });
});
