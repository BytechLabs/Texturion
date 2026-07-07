/**
 * D31 launch-pass — Stage 1 smoke: proves the whole hermetic plumbing END TO
 * END against REAL Supabase.
 *
 *   seed auth.users + company + owner company_members + an active number
 *     (via the docker psql fixture path the SQL suites use)
 *   → mint an ES256 token (verified against the fake JWKS)
 *   → GET /v1/me → 200 with the membership (proves ES256 verify + real
 *     PostgREST + the /v1 middleware chain)
 *   → POST a signed Telnyx message.received to the seeded number
 *   → flush waitUntil → assert (via the service client) exactly one messages
 *     row threaded into one conversation (proves signed-webhook ingestion +
 *     the ledger + the real thread_inbound_message RPC).
 *
 * Everything is scoped to a unique run id so reruns are idempotent; afterAll
 * tears the run's rows down.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHarness, type Harness } from "./harness";

let h: Harness;

// Deterministic ids for this run (a fixed UUID space keyed by the run id would
// require UUID arithmetic; a per-run constant set is enough since afterAll
// cleans them and the DB started empty).
const OWNER_ID = "d31d31d3-0001-4001-8001-000000000001";
const COMPANY_ID = "d31d31d3-0002-4002-8002-000000000002";
const NUMBER_ID = "d31d31d3-0003-4003-8003-000000000003";
const NUMBER_E164 = "+16135550199";
const FROM_E164 = "+16135551234";

beforeAll(async () => {
  h = await startHarness();

  // Idempotent teardown of any prior run of THIS spec, then seed fresh.
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@smoke.test`, "Smoke Owner")}
    -- public.profiles is created by the on_auth_user_created trigger.

    insert into public.companies
      (id, name, owner_user_id, country, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${COMPANY_ID}', 'Smoke Plumbing', '${OWNER_ID}', 'CA', '613',
            'active', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'smoke_${h.runId}',
            'CA', '${NUMBER_E164}');
  `);
});

afterAll(async () => {
  if (h) {
    cleanup();
    await h.close();
  }
});

/** Delete this spec's fixtures (children first for the FK restrict). */
function cleanup(): void {
  h.sql(`
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.conversation_events where company_id = '${COMPANY_ID}';
    delete from public.opt_outs where company_id = '${COMPANY_ID}';
    delete from public.webhook_events where provider = 'telnyx'
      and event_id like 'smoke-${h.runId}%';
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    delete from public.egress_events where company_id = '${COMPANY_ID}';
    delete from public.inbound_notification_days where company_id = '${COMPANY_ID}';
    delete from public.companies where id = '${COMPANY_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

describe("D31 smoke: hermetic plumbing end to end", () => {
  it("GET /v1/me returns the seeded membership (ES256 + real PostgREST)", async () => {
    const token = await h.token(OWNER_ID);
    const res = await h.call("GET", "/v1/me", { token });

    expect(res.status).toBe(200);
    const body = res.json as {
      user_id: string;
      memberships: { company_id: string; role: string }[];
    };
    expect(body.user_id).toBe(OWNER_ID);
    expect(body.memberships).toContainEqual(
      expect.objectContaining({ company_id: COMPANY_ID, role: "owner" }),
    );
  });

  it("a signed message.received threads exactly one message + conversation", async () => {
    const eventId = `smoke-${h.runId}-inbound-1`;
    const telnyxMessageId = `smoke-${h.runId}-tmsg-1`;

    const event = {
      data: {
        event_type: "message.received",
        id: eventId,
        occurred_at: new Date().toISOString(),
        payload: {
          id: telnyxMessageId,
          type: "SMS",
          direction: "inbound",
          from: { phone_number: FROM_E164, carrier: "Bell", line_type: "Wireless" },
          to: [{ phone_number: NUMBER_E164, status: "webhook_delivered" }],
          text: "Hi, do you do gutters?",
          media: [],
          received_at: new Date().toISOString(),
          encoding: "GSM-7",
          parts: 1,
        },
      },
      meta: { attempt: 1 },
    };

    const res = await h.injectTelnyx(event);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ received: true });

    // The RPC + inbound pipeline ran in waitUntil (flushed). Assert via the
    // service client against real Postgres.
    const { data: messages, error: mErr } = await h.db
      .from("messages")
      .select("id,conversation_id,direction,body,telnyx_message_id")
      .eq("company_id", COMPANY_ID);
    expect(mErr).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toMatchObject({
      direction: "inbound",
      body: "Hi, do you do gutters?",
      telnyx_message_id: telnyxMessageId,
    });

    const { data: conversations, error: cErr } = await h.db
      .from("conversations")
      .select("id,company_id,phone_number_id")
      .eq("company_id", COMPANY_ID);
    expect(cErr).toBeNull();
    expect(conversations).toHaveLength(1);
    expect(conversations?.[0]?.id).toBe(messages?.[0]?.conversation_id);
    expect(conversations?.[0]?.phone_number_id).toBe(NUMBER_ID);

    // The webhook ledger recorded and processed the event.
    const { data: ledger } = await h.db
      .from("webhook_events")
      .select("event_id,processed_at")
      .eq("provider", "telnyx")
      .eq("event_id", eventId);
    expect(ledger).toHaveLength(1);
    expect(ledger?.[0]?.processed_at).not.toBeNull();
  });
});
