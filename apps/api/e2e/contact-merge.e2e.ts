/**
 * #695: a wrong merge can be undone, end to end. Merge one contact into
 * another through the real Worker and Postgres, check the merged-away record
 * leaves the list, then unmerge and check both records are back with every
 * thread and message still there. Unmerge restores the record and its number
 * but leaves the threads on the survivor (routes/contacts.ts, #246), so
 * "intact" means nothing was lost, not that the threads moved back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteCompaniesSql } from "./company-cleanup";
import { startHarness, type Harness } from "./harness";

let h: Harness;

const OWNER_ID = "d31c0695-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0695-0002-4002-8002-000000000002";
const NUMBER_ID = "d31c0695-0003-4003-8003-000000000003";
const KEPT_ID = "d31c0695-0004-4004-8004-000000000004";
const FOLDED_ID = "d31c0695-0005-4005-8005-000000000005";
const KEPT_THREAD = "d31c0695-0006-4006-8006-000000000006";
const FOLDED_THREAD = "d31c0695-0007-4007-8007-000000000007";
const FOLDED_PHONE = "+16135550196";

beforeAll(async () => {
  h = await startHarness();
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@merge.test`, "Merge Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, plan, current_period_start, current_period_end,
       aup_accepted_at)
    values ('${COMPANY_ID}', 'Westside Plumbing', '${OWNER_ID}', 'US', true, '613',
            'active', 'starter', now(), now() + interval '30 days', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'merge_${h.runId}', 'US',
            '+16135550190');

    insert into public.contacts (id, company_id, phone_e164, name) values
      ('${KEPT_ID}', '${COMPANY_ID}', '+16135550195', 'Dana Kerr'),
      ('${FOLDED_ID}', '${COMPANY_ID}', '${FOLDED_PHONE}', 'Dana K');

    insert into public.conversations
      (id, company_id, contact_id, phone_number_id, status, last_message_at)
    values
      ('${KEPT_THREAD}', '${COMPANY_ID}', '${KEPT_ID}', '${NUMBER_ID}', 'open', now()),
      ('${FOLDED_THREAD}', '${COMPANY_ID}', '${FOLDED_ID}', '${NUMBER_ID}', 'open', now());

    insert into public.messages
      (company_id, conversation_id, direction, body, status, segments)
    values
      ('${COMPANY_ID}', '${KEPT_THREAD}', 'inbound', 'Leak under the sink.', 'received', 1),
      ('${COMPANY_ID}', '${FOLDED_THREAD}', 'inbound', 'Same leak, other phone.', 'received', 1);
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
    ${h.clearAuditSql(COMPANY_ID)}
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    ${deleteCompaniesSql([COMPANY_ID])}
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

async function listedContactIds(token: string): Promise<string[]> {
  const res = await h.call("GET", "/v1/contacts", { token, companyId: COMPANY_ID });
  expect(res.status).toBe(200);
  return ((res.json as { data: { id: string }[] }).data ?? []).map((row) => row.id);
}

async function threadAndMessageCounts(): Promise<{ threads: number; messages: number }> {
  const threads = await h.db
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_ID);
  const messages = await h.db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_ID);
  return { threads: threads.count ?? -1, messages: messages.count ?? -1 };
}

describe("#695 a wrong merge is undone end to end", () => {
  it("merges, hides the folded record, then unmerges with every thread and message kept", async () => {
    const token = await h.token(OWNER_ID);
    expect((await listedContactIds(token)).sort()).toEqual([KEPT_ID, FOLDED_ID].sort());

    const merged = await h.call("POST", `/v1/contacts/${FOLDED_ID}/merge`, {
      token,
      companyId: COMPANY_ID,
      body: { into_contact_id: KEPT_ID },
    });
    expect(merged.status).toBe(200);
    expect(await listedContactIds(token)).toEqual([KEPT_ID]);
    expect(await threadAndMessageCounts()).toEqual({ threads: 2, messages: 2 });

    const unmerged = await h.call("POST", `/v1/contacts/${FOLDED_ID}/unmerge`, {
      token,
      companyId: COMPANY_ID,
    });
    expect(unmerged.status).toBe(200);

    expect((await listedContactIds(token)).sort()).toEqual([KEPT_ID, FOLDED_ID].sort());
    const restored = await h.db
      .from("contacts")
      .select("id,phone_e164,merged_into")
      .eq("id", FOLDED_ID)
      .single();
    expect(restored.data).toMatchObject({ phone_e164: FOLDED_PHONE, merged_into: null });
    expect(await threadAndMessageCounts()).toEqual({ threads: 2, messages: 2 });
  });
});
