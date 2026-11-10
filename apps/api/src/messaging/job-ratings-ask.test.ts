/**
 * The rating ask is a scheduled send like any other, so it must record the
 * thread's newest inbound when it is written. Without that the send reads every
 * inbound the thread ever had as a reply that came after, and holds the ask.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { askForJobRating } from "./job-ratings";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-10T06:20:00Z");

afterEach(() => vi.unstubAllGlobals());

function world(newestInbound: string | null) {
  const env = completeEnv();
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/tasks", () => ({
    conversation_id: CONVERSATION,
    assigned_user_id: OWNER,
    conversations: {
      contact_id: CONTACT,
      contact_phone_e164: "+16135550142",
      contacts: { timezone: "America/Toronto", locale: null },
    },
  }));
  sb.on("POST", "/rest/v1/rpc/api_claim_job_rating", () => ({ outcome: "claimed" }));
  sb.on("GET", "/rest/v1/messages", () =>
    newestInbound ? [{ created_at: newestInbound }] : [],
  );
  sb.on("POST", "/rest/v1/scheduled_messages", () => []);
  // Everything else the ask reads (clock, merge fields, locale) answers empty;
  // registered last because the harness is first-match-wins.
  sb.on("GET", /\/rest\/v1\//, () => []);
  sb.on("POST", /\/rest\/v1\/rpc\//, () => []);
  stubFetch(sb.route);
  return { env, sb };
}

describe("the rating ask's inbound watermark", () => {
  it("records the newest inbound, so only a later reply holds it", async () => {
    const { env, sb } = world("2026-11-09T18:00:00Z");

    const result = await askForJobRating(getDb(env), {
      companyId: COMPANY,
      taskId: TASK,
      userId: OWNER,
      now: NOW,
    });

    expect(result.outcome).toBe("asked");
    const insert = sb.find("POST", "/rest/v1/scheduled_messages")[0];
    expect(insert.body).toMatchObject({
      origin: "rating",
      inbound_watermark: "2026-11-09T18:00:00Z",
    });
  });

  it("leaves the watermark empty when the thread has no inbound yet", async () => {
    const { env, sb } = world(null);

    await askForJobRating(getDb(env), {
      companyId: COMPANY,
      taskId: TASK,
      userId: OWNER,
      now: NOW,
    });

    const insert = sb.find("POST", "/rest/v1/scheduled_messages")[0];
    expect(insert.body).toMatchObject({ inbound_watermark: null });
  });
});
