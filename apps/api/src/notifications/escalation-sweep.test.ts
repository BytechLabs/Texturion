/**
 * #244 — the sweep that makes narrowing safe.
 *
 * Narrowing a 2am page to one person is only defensible because this runs ten
 * minutes later when they sleep through it. So the tests that matter are the
 * ones about the SECOND notification: who gets it, who does not, and whether it
 * says something new.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { escalationCopy, runEscalationSweep } from "./escalation-sweep";

const env = completeEnv();
const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ON_CALL = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const THIRD = "55555555-5555-4555-8555-555555555555";

interface Options {
  due?: Record<string, unknown>[];
  members?: { user_id: string; role: string }[];
  /**
   * Registered inside `world`, not by a later `sb.on`. The harness is
   * first-match-wins, so re-registering a path a helper already claimed is a
   * stub that silently never runs.
   */
  devices?: Record<string, unknown>[];
}

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "alert-1",
    company_id: COMPANY,
    conversation_id: CONVERSATION,
    kind: "missed_call",
    on_call_user_id: ON_CALL,
    ...overrides,
  };
}

function world(options: Options = {}) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_claim_due_alerts", () =>
    options.due ?? [alertRow()],
  );
  sb.on("GET", "/rest/v1/conversations", () => [{ phone_number_id: null }]);
  sb.on("GET", "/rest/v1/company_members", () =>
    options.members ?? [
      { user_id: ON_CALL, role: "member" },
      { user_id: OTHER, role: "owner" },
      { user_id: THIRD, role: "member" },
    ],
  );
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => options.devices ?? []);
  return sb;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runEscalationSweep", () => {
  it("ES-1: widens to the rest of the crew, not to the person already paged", async () => {
    // They have the first notification on their phone. A second one telling
    // them nobody has picked it up is the product arguing with itself.
    const sb = world();
    stubFetch(sb.route);

    const summary = await runEscalationSweep(env);

    expect(summary).toEqual({ claimed: 1, widened: 1 });
    const lookup = sb.calls.find(
      (call) => call.path === "/rest/v1/push_subscriptions",
    );
    const targeted = lookup?.url.searchParams.get("user_id") ?? "";
    expect(targeted).toContain(OTHER);
    expect(targeted).toContain(THIRD);
    expect(targeted).not.toContain(ON_CALL);
  });

  it("ES-2: says something NEW, not a second copy of the first alert", async () => {
    // A duplicate "Missed call from Dana" ten minutes later teaches the crew
    // that this product sends things twice. "Nobody has picked this up" is a
    // different fact, and it is the one that gets somebody out of bed.
    const copy = escalationCopy("missed_call", "en");

    expect(copy.title).toBe("A missed call is still waiting");
    expect(copy.body).toContain("Nobody has picked this up");
    expect(copy.title).not.toContain("from");
  });

  it("ES-2b: #228 — says it in the reader's language, whole sentence per kind", async () => {
    // The three titles are built from three different subjects, so translating
    // a shared fragment is how the gendered ones would break later. Pinning all
    // three proves the kind switch reaches the table rather than one branch of
    // it, and that an unknown kind still escalates with a sentence.
    expect(escalationCopy("missed_call", "fr-CA").title).toBe(
      "Un appel manqué attend toujours",
    );
    expect(escalationCopy("emergency", "fr-CA").title).toBe(
      "Une urgence attend toujours",
    );
    expect(escalationCopy("poor_rating", "fr-CA").title).toBe(
      "Une alerte attend toujours",
    );
    expect(escalationCopy("missed_call", "fr-CA").body).toBe(
      "Personne ne s'en est occupé. C'est maintenant ouvert à toute l'équipe.",
    );

    // The English catch-all is unchanged and still the one a new kind gets.
    expect(escalationCopy("poor_rating", "en").title).toBe(
      "An alert is still waiting",
    );
  });

  it("ES-3: the escalation does not replace the original on a phone that has it", async () => {
    // Two different facts. Sharing the original's `conversation:<id>` key would
    // make this an EDIT of a notification the reader may never have seen — the
    // escalation would silently overwrite the alert it is escalating.
    const account = await makeServiceAccount();
    const service = fcmService();
    const sb = world({
      members: [
        { user_id: ON_CALL, role: "member" },
        { user_id: OTHER, role: "owner" },
      ],
      devices: [
        {
          id: "60000000-aaaa-4000-8000-000000000001",
          user_id: OTHER,
          platform: "ios",
          token: "tok-owner",
        },
      ],
    });
    stubFetch(sb.route, ...service.routes);

    await runEscalationSweep(fcmEnv(account));

    expect(service.sends).toHaveLength(1);
    const headers = (
      service.sends[0].message as { apns: { headers: Record<string, string> } }
    ).apns.headers;
    expect(headers["apns-collapse-id"]).toBe("escalation:alert-1");
    expect(headers["apns-collapse-id"]).not.toBe(`conversation:${CONVERSATION}`);

    // And the payload carries the alert id, which is what lets the
    // notification offer Acknowledge rather than only a link.
    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.alert_id).toBe("alert-1");
    expect(data.kind).toBe("escalation");
  });

  it("ES-4: a crew of one on-call member has nobody to widen to", async () => {
    const sb = world({ members: [{ user_id: ON_CALL, role: "owner" }] });
    stubFetch(sb.route);

    const summary = await runEscalationSweep(env);

    expect(summary).toEqual({ claimed: 1, widened: 0 });
    expect(
      sb.calls.some((call) => call.path === "/rest/v1/push_subscriptions"),
    ).toBe(false);
  });

  it("ES-5: one broken alert does not starve the next workspace's emergency", async () => {
    // The claim already happened for every row in the batch, so a throw that
    // escaped would abandon alerts that were legitimately claimed — and the
    // next tick will not see them again.
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_claim_due_alerts", () => [
      alertRow({ id: "alert-broken", conversation_id: "missing" }),
      alertRow({ id: "alert-good" }),
    ]);
    sb.on("GET", "/rest/v1/conversations", (call) =>
      call.url.searchParams.get("id") === "eq.missing"
        ? new Response("boom", { status: 500 })
        : [{ phone_number_id: null }],
    );
    sb.on("GET", "/rest/v1/company_members", () => [
      { user_id: ON_CALL, role: "member" },
      { user_id: OTHER, role: "owner" },
    ]);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    sb.on("GET", "/rest/v1/device_push_tokens", () => []);
    stubFetch(sb.route);

    const summary = await runEscalationSweep(env);

    expect(summary.claimed).toBe(2);
    expect(summary.widened).toBe(1);
  });

  it("ES-6: a quiet minute claims nothing and touches nothing else", async () => {
    // This runs every minute forever. The common case must cost one indexed
    // lookup returning nothing.
    const sb = world({ due: [] });
    stubFetch(sb.route);

    const summary = await runEscalationSweep(env);

    expect(summary).toEqual({ claimed: 0, widened: 0 });
    expect(sb.calls).toHaveLength(1);
  });
});
