/**
 * #696: a block works end to end. Block a number through the real Worker,
 * deliver a signed inbound text from it, and check the thread lands closed and
 * marked spam; then text that number and check the send still reaches the
 * carrier, because a block is the workspace's inbox choice, not an opt-out
 * (routes/blocked-senders.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHarness, type Harness } from "./harness";

let h: Harness;

const OWNER_ID = "d31c0696-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0696-0002-4002-8002-000000000002";
const NUMBER_ID = "d31c0696-0003-4003-8003-000000000003";
const NUMBER_E164 = "+16045550196";
const BLOCKED_E164 = "+16045551696";

beforeAll(async () => {
  h = await startHarness();
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@block.test`, "Block Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${COMPANY_ID}', 'Coastal Roofing', '${OWNER_ID}', 'CA', false, '604',
            'active', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'block_${h.runId}', 'CA',
            '${NUMBER_E164}');
  `);
});

afterAll(async () => {
  if (h) {
    cleanup();
    await h.close();
  }
});

function cleanup(): void {
  h.sql(`
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.conversation_events where company_id = '${COMPANY_ID}';
    delete from public.blocked_senders where company_id = '${COMPANY_ID}';
    delete from public.webhook_events where provider = 'telnyx'
      and event_id like 'block-${h.runId}%';
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    delete from public.egress_events where company_id = '${COMPANY_ID}';
    delete from public.inbound_notification_days where company_id = '${COMPANY_ID}';
    delete from public.companies where id = '${COMPANY_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

describe("#696 a blocked number is refused at the door, and can still be texted", () => {
  it("lands an inbound text closed as spam, and still sends to the number", async () => {
    const token = await h.token(OWNER_ID);

    const blocked = await h.call("POST", "/v1/blocked-senders", {
      token,
      companyId: COMPANY_ID,
      body: { phone_e164: BLOCKED_E164 },
    });
    expect(blocked.status).toBe(201);

    const inbound = await h.injectTelnyx({
      data: {
        event_type: "message.received",
        id: `block-${h.runId}-inbound-1`,
        occurred_at: new Date().toISOString(),
        payload: {
          id: `block-${h.runId}-tmsg-1`,
          type: "SMS",
          direction: "inbound",
          from: { phone_number: BLOCKED_E164, carrier: "Bell", line_type: "Wireless" },
          to: [{ phone_number: NUMBER_E164, status: "webhook_delivered" }],
          text: "Buy followers cheap",
          media: [],
          received_at: new Date().toISOString(),
          encoding: "GSM-7",
          parts: 1,
        },
      },
      meta: { attempt: 1 },
    });
    expect(inbound.status).toBe(200);

    const { data: threads } = await h.db
      .from("conversations")
      .select("id,status,is_spam")
      .eq("company_id", COMPANY_ID);
    expect(threads).toHaveLength(1);
    expect(threads?.[0]).toMatchObject({ status: "closed", is_spam: true });

    const before = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;
    const sent = await h.call("POST", "/v1/messages/send", {
      token,
      companyId: COMPANY_ID,
      idempotencyKey: `${h.runId}-block-send-1`,
      body: { conversation_id: threads?.[0]?.id, body: "Please stop texting this line." },
    });
    expect(sent.status).toBe(201);
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before + 1);
  });
});
