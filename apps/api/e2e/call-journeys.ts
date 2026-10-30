/**
 * The hermetic call journeys: inbound answered, voicemail, outbound answered
 * and blind transfer, written once and driven by two harnesses.
 *
 *   - src/calls/call-journeys.test.ts runs them through the real routes, the
 *     session Durable Object and the real Telnyx command layer, over an
 *     in-memory database. It needs nothing but node, so it runs wherever the
 *     unit suite does.
 *   - e2e/call-journeys.e2e.ts runs them through the whole Worker, the signed
 *     webhook route and a real local Supabase.
 *
 * One script per journey, so the two layers cannot drift into measuring
 * different calls. Each script plays the far end (the caller's phone, each
 * member's softphone) and asserts only what both layers can see: leg states on
 * the fake switch and the session state the server reports. What only one
 * layer can see (database rows, stored audio) is asserted by that layer.
 *
 * The far ends are scripted the way the rig's robot and pages behave: an
 * answered call is picked up by the first member, a voicemail is a ring-out,
 * and the softphone answers its own placer leg without a person touching it.
 *
 * Two kinds of teardown hold because the fake switch models them, not because
 * the server commands them: a bridged partner ending when its leg hangs up,
 * and a blind transfer dropping the sender. Those assertions say "switch" in
 * their messages; the rig's runs are where the model meets the real switch.
 */
import { expect } from "vitest";

import {
  committedBudget,
  committedBudgets,
  drainCallEvents,
  emitCallBudget,
  measuredBudget,
  type JourneyBudget,
} from "./call-budget";
import type { FakeLeg, FakeVoice, TelnyxWebhookEvent } from "./fake-telnyx-voice";

export interface JourneyMember {
  userId: string;
  sipUsername: string;
}

/** The line a journey calls, and the crew it rings in ring order. */
export interface JourneyCrew {
  businessE164: string;
  /** The far end. On the rig it is a robot number; here it is fictional. */
  farEndE164: string;
  members: JourneyMember[];
}

export interface JourneyDriver {
  voice: FakeVoice;
  /** Deliver one webhook the way this layer's edge does. */
  deliver(event: TelnyxWebhookEvent): Promise<void>;
  /** Resolve once every session object has finished what it was handed. */
  idle(): Promise<void>;
  /** The session's state as this layer records it, or null if it has none. */
  state(sessionId: string): Promise<string | null>;
  answeredBy(sessionId: string): Promise<string | null>;
  /** A member places a call to the far end; resolves to the session id. */
  placeCall(crew: JourneyCrew, placer: JourneyMember): Promise<string>;
  /** The answering member blind-transfers the caller to a teammate. */
  transfer(
    crew: JourneyCrew,
    sessionId: string,
    sender: JourneyMember,
    target: JourneyMember,
  ): Promise<void>;
}

export interface JourneyResult {
  sessionId: string;
  budget: JourneyBudget;
}

interface JourneySpec {
  /** The docs/RIG.md scenario this journey is the hermetic twin of. */
  rigScenario: string;
  /** How many members the layer must give the crew. */
  crewSize: number;
  run(driver: JourneyDriver, crew: JourneyCrew): Promise<string>;
}

function sipUri(member: JourneyMember): string {
  return `sip:${member.sipUsername}@sip.telnyx.com`;
}

async function settle(driver: JourneyDriver): Promise<void> {
  await drainCallEvents(driver.voice, (event) => driver.deliver(event), () => driver.idle());
}

/** The one ringing leg to a member, or a failure naming what was there instead. */
function ringingLegTo(voice: FakeVoice, member: JourneyMember): FakeLeg {
  const legs = voice
    .live()
    .filter((leg) => leg.to === sipUri(member) && leg.state === "ringing");
  expect(
    legs.map((leg) => leg.origin),
    `exactly one ringing leg to ${member.userId}`,
  ).toHaveLength(1);
  return legs[0];
}

function legNow(voice: FakeVoice, leg: FakeLeg): FakeLeg {
  const current = voice.leg(leg.callControlId);
  if (!current) throw new Error(`fake-telnyx forgot leg ${leg.callControlId}`);
  return current;
}

async function expectSession(
  driver: JourneyDriver,
  sessionId: string,
  state: string,
  answeredBy?: string,
): Promise<void> {
  expect(await driver.state(sessionId), "session state").toBe(state);
  if (answeredBy !== undefined) {
    expect(await driver.answeredBy(sessionId), "answered by").toBe(answeredBy);
  }
}

/** A customer rings the line; the first member answers; the customer hangs up. */
async function inboundAnswered(driver: JourneyDriver, crew: JourneyCrew): Promise<string> {
  const [owner] = crew.members;
  const customer = driver.voice.incoming({
    from: crew.farEndE164,
    to: crew.businessE164,
  });
  const sessionId = customer.callSessionId;
  await settle(driver);
  await expectSession(driver, sessionId, "ringing");

  const ring = ringingLegTo(driver.voice, owner);
  driver.voice.answer(ring.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "answered", owner.userId);
  expect(legNow(driver.voice, customer).state).toBe("answered");
  expect(legNow(driver.voice, customer).bridgedWith).toBe(ring.callControlId);

  driver.voice.hangup(customer.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "ended_answered");
  expect(driver.voice.live(), "the switch ends the bridged member leg").toEqual([]);
  return sessionId;
}

/** Nobody answers: the ring leg times out, the caller hears the greeting and leaves a message. */
async function voicemail(driver: JourneyDriver, crew: JourneyCrew): Promise<string> {
  const [owner] = crew.members;
  const customer = driver.voice.incoming({
    from: crew.farEndE164,
    to: crew.businessE164,
  });
  const sessionId = customer.callSessionId;
  await settle(driver);

  driver.voice.ringOut(ringingLegTo(driver.voice, owner).callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "voicemail_recording");
  const answered = legNow(driver.voice, customer);
  expect(answered.state).toBe("answered");
  expect(answered.recording, "recording started after the greeting").not.toBeNull();
  expect(driver.voice.live().map((leg) => leg.callControlId)).toEqual([
    customer.callControlId,
  ]);

  driver.voice.leaveMessage(customer.callControlId, 9);
  await settle(driver);
  await expectSession(driver, sessionId, "ended_voicemail");
  expect(driver.voice.recordings()).toHaveLength(1);
  expect(driver.voice.live()).toEqual([]);
  return sessionId;
}

/** A member calls the far end from the browser; the far end answers, then hangs up. */
async function outboundAnswered(driver: JourneyDriver, crew: JourneyCrew): Promise<string> {
  const [placer] = crew.members;
  const sessionId = await driver.placeCall(crew, placer);
  await settle(driver);
  await expectSession(driver, sessionId, "dialing", placer.userId);

  const customerLegs = driver.voice
    .live()
    .filter((leg) => leg.origin === "dial" && leg.to === crew.farEndE164);
  expect(customerLegs, "one leg to the far end").toHaveLength(1);
  const [customer] = customerLegs;

  // The placer's softphone answers its own leg as soon as it rings.
  const placerLeg = ringingLegTo(driver.voice, placer);
  driver.voice.answer(placerLeg.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "dialing");

  driver.voice.answer(customer.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "answered", placer.userId);
  expect(legNow(driver.voice, customer).bridgedWith).toBe(placerLeg.callControlId);

  driver.voice.hangup(customer.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "ended_answered");
  expect(driver.voice.live(), "the switch ends the bridged placer leg").toEqual([]);
  return sessionId;
}

/**
 * The whole crew rings, the owner answers, then blind-transfers the caller to
 * the technician, who answers. Two members because the transfer target has to
 * be a teammate, and ringing both is what a two-person crew's line does.
 */
async function transferBlind(driver: JourneyDriver, crew: JourneyCrew): Promise<string> {
  const [owner, technician] = crew.members;
  const customer = driver.voice.incoming({
    from: crew.farEndE164,
    to: crew.businessE164,
  });
  const sessionId = customer.callSessionId;
  await settle(driver);

  const ownerRing = ringingLegTo(driver.voice, owner);
  const technicianRing = ringingLegTo(driver.voice, technician);
  driver.voice.answer(ownerRing.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "answered", owner.userId);
  expect(legNow(driver.voice, technicianRing).state, "the other ring is cancelled").toBe("ended");

  await driver.transfer(crew, sessionId, owner, technician);
  await settle(driver);
  const target = ringingLegTo(driver.voice, technician);
  expect(target.origin).toBe("transfer");
  expect(legNow(driver.voice, ownerRing).state, "the switch drops the sender").toBe("ended");

  driver.voice.answer(target.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "answered", technician.userId);
  expect(legNow(driver.voice, customer).bridgedWith).toBe(target.callControlId);

  driver.voice.hangup(customer.callControlId);
  await settle(driver);
  await expectSession(driver, sessionId, "ended_answered");
  expect(driver.voice.live(), "the switch ends the bridged target leg").toEqual([]);
  return sessionId;
}

export const CALL_JOURNEYS: Record<string, JourneySpec> = {
  "inbound-answered": { rigScenario: "S02", crewSize: 1, run: inboundAnswered },
  voicemail: { rigScenario: "S04", crewSize: 1, run: voicemail },
  "outbound-answered": { rigScenario: "S01", crewSize: 1, run: outboundAnswered },
  "transfer-blind": { rigScenario: "S07", crewSize: 2, run: transferBlind },
};

/** Journeys this module runs and journeys the committed budget prices, both ways. */
export function journeyRegistryMismatch(): string[] {
  const run = Object.keys(CALL_JOURNEYS);
  const priced = Object.keys(committedBudgets());
  return [
    ...run.filter((name) => !priced.includes(name)).map((name) => `${name} is run but not priced`),
    ...priced.filter((name) => !run.includes(name)).map((name) => `${name} is priced but never run`),
  ];
}

/**
 * Run one journey from a clean switch, print its numbers, and hold them to the
 * committed budget. The comparison is whole-object, so a journey that gains a
 * dial, a leg or a different rig scenario fails until the file says so too.
 */
export async function runCallJourney(
  name: string,
  layer: "session" | "e2e",
  driver: JourneyDriver,
  crew: JourneyCrew,
): Promise<JourneyResult> {
  const spec = CALL_JOURNEYS[name];
  if (!spec) throw new Error(`no call journey named ${name}`);
  expect(crew.members, `${name} needs a crew of ${spec.crewSize}`).toHaveLength(spec.crewSize);
  driver.voice.resetCalls();
  const sessionId = await spec.run(driver, crew);
  expect(driver.voice.pendingEvents(), "every webhook was delivered").toBe(0);
  const budget = measuredBudget(spec.rigScenario, driver.voice.ledger());
  emitCallBudget(name, layer, budget);
  expect(budget, `${name} measured against call-journey-budget.json`).toEqual(
    committedBudget(name),
  );
  return { sessionId, budget };
}
