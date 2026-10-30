/**
 * The hermetic call journeys through the whole Worker, on every push.
 *
 * The scripts in call-journeys.ts, driven through the signed /webhooks/telnyx
 * route, the real routes a softphone calls (/v1/webrtc/token, /v1/calls/browser,
 * /v1/calls/live/:session/transfer), CALL_SESSIONS bound to the real
 * CallSessionDO with its real runtime, and the real local Supabase. Only the
 * vendor HTTP boundary is faked.
 *
 * Each journey gets its own workspace and line, so the one-call-per-line rule
 * and the outbound reservation window cannot leak from one journey into the
 * next. Each journey prints a CALL_BUDGET line and must agree with
 * call-journey-budget.json, exactly as the session-layer twin must.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CALL_JOURNEYS,
  journeyRegistryMismatch,
  runCallJourney,
  type JourneyCrew,
  type JourneyDriver,
  type JourneyMember,
} from "./call-journeys";
import { startHarness, type Harness } from "./harness";

let h: Harness;

const FAR_END_E164 = "+16135550180";
const LINES: Record<string, string> = {
  "inbound-answered": "+16135550170",
  voicemail: "+16135550171",
  "outbound-answered": "+16135550172",
  "transfer-blind": "+16135550173",
};

interface SeededCrew extends JourneyCrew {
  companyId: string;
  phoneNumberId: string;
  tokens: Map<string, string>;
}

const crews = new Map<string, SeededCrew>();
/** Webhook ids this file delivered, so a rerun can forget them. */
const deliveredEventIds: string[] = [];

interface CallRow {
  state: string | null;
  outcome: string | null;
  direction: string | null;
  answered_by_user_id: string | null;
  answered_at: string | null;
  customer_call_control_id: string | null;
  voicemail_path: string | null;
  voicemail_seconds: number | null;
}

async function callRow(sessionId: string): Promise<CallRow | null> {
  const { data, error } = await h.db
    .from("calls")
    .select(
      "state,outcome,direction,answered_by_user_id,answered_at,customer_call_control_id," +
        "voicemail_path,voicemail_seconds",
    )
    .eq("call_session_id", sessionId)
    .limit(1);
  if (error) throw new Error(`calls read failed: ${error.message}`);
  return ((data ?? [])[0] as unknown as CallRow | undefined) ?? null;
}

/**
 * A workspace with an active plan, one line, and `size` members whose
 * softphone credentials are minted the way the app mints them.
 */
async function seedCrew(journey: string, size: number): Promise<SeededCrew> {
  const companyId = randomUUID();
  const phoneNumberId = randomUUID();
  const businessE164 = LINES[journey];
  const userIds = Array.from({ length: size }, () => randomUUID());
  const roles = userIds.map((_, index) => (index === 0 ? "owner" : "member"));
  h.sql(`
    ${userIds
      .map((id, index) =>
        h.seedUserSql(id, `${h.runId}-${journey}-${index}@call-journeys.test`, `Journey ${index}`),
      )
      .join("\n")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, plan, current_period_start, current_period_end,
       aup_accepted_at)
    values ('${companyId}', 'Journey ${journey}', '${userIds[0]}', 'CA', false, '613',
            'active', 'starter', now(), now() + interval '30 days', now());

    insert into public.company_members (company_id, user_id, role)
    values ${userIds.map((id, index) => `('${companyId}', '${id}', '${roles[index]}')`).join(", ")};

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164,
       telnyx_phone_number_id)
    values ('${phoneNumberId}', '${companyId}', 'active', 'journey_${journey}_${h.runId}',
            'CA', '${businessE164}', 'pn-journey-${journey}-${h.runId}');
  `);

  const tokens = new Map<string, string>();
  const members: JourneyMember[] = [];
  for (const userId of userIds) {
    const token = await h.token(userId);
    tokens.set(userId, token);
    const minted = await h.call("POST", "/v1/webrtc/token", { token, companyId });
    expect(minted.status, minted.text).toBe(200);
    const { sip_username: sipUsername, token: login } = minted.json as {
      sip_username: string;
      token: string;
    };
    expect(login.split("."), "a JWT-shaped login token").toHaveLength(3);
    members.push({ userId, sipUsername });
  }
  return { businessE164, farEndE164: FAR_END_E164, members, companyId, phoneNumberId, tokens };
}

function tokenFor(crew: JourneyCrew, member: JourneyMember): { token: string; companyId: string } {
  const seeded = crew as SeededCrew;
  const token = seeded.tokens.get(member.userId);
  if (!token) throw new Error(`no token for ${member.userId}`);
  return { token, companyId: seeded.companyId };
}

const driver = (): JourneyDriver => ({
  voice: h.telnyx.voice,
  async deliver(event) {
    const result = await h.injectTelnyx(event);
    expect(result.status, `${event.data.event_type}: ${result.text}`).toBe(200);
    deliveredEventIds.push(event.data.id);
  },
  idle: () => h.sessions.idle(),
  state: async (sessionId) => (await callRow(sessionId))?.state ?? null,
  answeredBy: async (sessionId) => (await callRow(sessionId))?.answered_by_user_id ?? null,
  async placeCall(crew, placer) {
    const seeded = crew as SeededCrew;
    const placed = await h.call("POST", "/v1/calls/browser", {
      ...tokenFor(crew, placer),
      body: { to: crew.farEndE164, phone_number_id: seeded.phoneNumberId },
    });
    expect(placed.status, placed.text).toBe(200);
    return (placed.json as { call_session_id: string }).call_session_id;
  },
  async transfer(crew, sessionId, sender, target) {
    const transferred = await h.call("POST", `/v1/calls/live/${sessionId}/transfer`, {
      ...tokenFor(crew, sender),
      body: { target_user_id: target.userId },
    });
    expect(transferred.status, transferred.text).toBe(202);
  },
});

beforeAll(async () => {
  h = await startHarness();
  // A crashed earlier run on this database can leave these lines live; a
  // released row is invisible to the call path and frees the number.
  h.sql(`
    update public.phone_numbers set status = 'released'
     where number_e164 in (${Object.values(LINES).map((n) => `'${n}'`).join(", ")})
       and status <> 'released';
  `);
  for (const [journey, spec] of Object.entries(CALL_JOURNEYS)) {
    crews.set(journey, await seedCrew(journey, spec.crewSize));
  }
});

afterAll(async () => {
  if (!h) return;
  try {
    h.sql(`
      update public.phone_numbers set status = 'released'
       where number_e164 in (${Object.values(LINES).map((n) => `'${n}'`).join(", ")})
         and status <> 'released';
      ${
        deliveredEventIds.length > 0
          ? `delete from public.webhook_events where provider = 'telnyx'
               and event_id in (${deliveredEventIds.map((id) => `'${id}'`).join(", ")});`
          : ""
      }
    `);
  } finally {
    await h.close();
  }
});

function crewFor(journey: string): SeededCrew {
  const crew = crews.get(journey);
  if (!crew) throw new Error(`no crew seeded for ${journey}`);
  return crew;
}

describe("hermetic call journeys (whole Worker, real database)", () => {
  it("runs every journey the budget file prices, and has a line for each", () => {
    expect(journeyRegistryMismatch()).toEqual([]);
    expect(Object.keys(LINES).sort()).toEqual(Object.keys(CALL_JOURNEYS).sort());
  });

  it("minted one softphone credential per member, on the WebRTC connection", () => {
    const members = [...crews.values()].flatMap((crew) => crew.members);
    const credentials = h.telnyx.voice.credentials();
    expect(credentials.map((c) => c.sipUsername).sort()).toEqual(
      members.map((m) => m.sipUsername).sort(),
    );
    for (const credential of credentials) {
      expect(credential.connectionId).toBe(h.env.TELNYX_WEBRTC_CONNECTION_ID);
      expect(credential.tokensIssued).toBe(1);
    }
  });

  it("S02 inbound answered: the row is answered by the member who picked up", async () => {
    const crew = crewFor("inbound-answered");
    const { sessionId } = await runCallJourney("inbound-answered", "e2e", driver(), crew);
    expect(await callRow(sessionId)).toMatchObject({
      direction: "inbound",
      outcome: "answered",
      state: "ended_answered",
      answered_by_user_id: crew.members[0].userId,
    });
  });

  it("S04 voicemail: stored in our bucket, and Telnyx's copy is deleted", async () => {
    const crew = crewFor("voicemail");
    const { sessionId } = await runCallJourney("voicemail", "e2e", driver(), crew);
    const row = await callRow(sessionId);
    expect(row).toMatchObject({
      direction: "inbound",
      outcome: "voicemail",
      state: "ended_voicemail",
      voicemail_seconds: 9,
    });
    expect(row?.voicemail_path).toBe(`${crew.companyId}/${sessionId}.mp3`);
    const [recording] = h.telnyx.voice.recordings();
    expect(recording.deleted, "the Telnyx copy is gone").toBe(true);
    const media = await fetch(`${h.telnyx.origin}/media/recordings/${recording.id}.mp3`);
    expect(media.status).toBe(404);
  });

  it("S01 outbound answered: one row under the server's session id, answered", async () => {
    const crew = crewFor("outbound-answered");
    const { sessionId } = await runCallJourney("outbound-answered", "e2e", driver(), crew);
    const customer = h.telnyx.voice
      .legs()
      .find((leg) => leg.to === FAR_END_E164 && leg.origin === "dial");
    expect(await callRow(sessionId)).toMatchObject({
      direction: "outbound",
      outcome: "answered",
      state: "ended_answered",
      answered_by_user_id: crew.members[0].userId,
      customer_call_control_id: customer?.callControlId,
    });
  });

  it("S07 blind transfer: the target owns the call and the ledger names the real leg", async () => {
    const crew = crewFor("transfer-blind");
    const [, technician] = crew.members;
    const { sessionId } = await runCallJourney("transfer-blind", "e2e", driver(), crew);
    expect(await callRow(sessionId)).toMatchObject({
      outcome: "answered",
      state: "ended_answered",
      answered_by_user_id: technician.userId,
    });
    const target = h.telnyx.voice.legs().find((leg) => leg.origin === "transfer");
    const { data } = await h.db
      .from("call_member_legs")
      .select("call_control_id,user_id,state")
      .eq("call_session_id", sessionId)
      .eq("kind", "transfer");
    expect(data).toEqual([
      { call_control_id: target?.callControlId, user_id: technician.userId, state: "answered" },
    ]);
  });
});
