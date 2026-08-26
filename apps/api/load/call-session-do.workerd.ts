import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { capacityResult } from "../e2e/load-report";
import { buildMemberRingState } from "../src/messaging/inbound-ring";
import type { TelnyxEvent } from "../src/messaging/types";
import { ctx, makeRuntime, SESSION } from "../src/calls/session-do-fake";
import { DIAL_BATCH_SIZE, MAX_LEGS_PER_SESSION } from "../src/calls/transitions";
import type { CallSessionDO } from "../src/calls/session-do";

/**
 * #251 — the ring fan-out and the FIFO, on workerd.
 *
 * ## What this measures that node could not
 *
 * The node suites drive this class with a storage double and prove the FIFO
 * serializes — which is true, and is a property of plain JavaScript. What they
 * cannot show is the object on the real runtime: real Durable Object SQLite
 * storage with real I/O gates, in a real single-threaded isolate.
 * `docs/CAPACITY.md` §2 used to say that nothing in this repository had run a
 * Durable Object under concurrency on the real runtime. This suite closes that
 * structural gap for one full session and a twelve-object fleet. Deployed
 * latency, provider round trips, co-tenancy, and compute cost remain open.
 *
 * ## Why there are no milliseconds here
 *
 * Because workerd will not give honest ones. A Worker's clock only advances on
 * I/O — a deliberate timing-attack mitigation — so `Date.now()` deltas inside
 * an isolate measure when I/O happened, not how long work took. The first
 * version of this file reported a 24-target fan-out of 24 sixty-millisecond
 * sleeps completing in "65ms". That is not a fast fan-out. That is a frozen
 * clock, and publishing it would have put a fabricated number into a capacity
 * document a prospect reads.
 *
 * So: **local wall-clock latency for a Durable Object is not obtainable, at any
 * effort.** What IS obtainable is the structure — how many vendor calls are in
 * flight at once, and whether an event arriving mid-cascade is serialized
 * behind it. Those are counts and orderings, immune to the clock, and they are
 * the half that transfers off this machine anyway.
 *
 * ## The ACK is not the cascade
 *
 * `onTelnyxEvent` resolves at the atomic persist, not when the work it caused
 * has finished — that is #617, deliberate, and it is the first thing a harness
 * gets wrong here. Awaiting it measures how fast we say "got it". `whenIdle()`
 * is the FIFO's tail and is what "the fan-out has finished" actually means.
 */

const CUSTOMER_CCID = "cust-ccid";
const HOT_OBJECTS = 12;

interface FleetGauge {
  inFlight: number;
  peakInFlight: number;
  opened: number;
}

function initiatedEvent(id: string): TelnyxEvent {
  return {
    data: {
      id,
      event_type: "call.initiated",
      payload: {
        call_control_id: CUSTOMER_CCID,
        call_session_id: SESSION,
        direction: "incoming",
        to: "+19995000",
        from: "+15551000",
      } as never,
    },
  };
}

function memberAnsweredEvent(id: string, ccid: string): TelnyxEvent {
  return {
    data: {
      id,
      event_type: "call.answered",
      payload: {
        call_control_id: ccid,
        client_state: buildMemberRingState({
          sessionId: SESSION,
          userId: "u0",
          caller: "+15551000",
          inboundCcid: CUSTOMER_CCID,
        }),
        to: "sip:s0@sip.telnyx.com",
      } as never,
    },
  };
}

/** A crew of `n` reachable technicians — the fan-out this is about. */
function crew(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    sipUsername: `s${i}`,
  }));
}

/**
 * A runtime whose dials take a moment and then release THEMSELVES.
 *
 * The obvious design — hold each dial open and release it from the test — is
 * impossible here, and the reason is a platform rule worth writing down:
 *
 *   Cannot perform I/O on behalf of a different Durable Object. I/O objects
 *   created in the context of one Durable Object cannot be accessed from a
 *   different Durable Object in the same isolate.
 *
 * A promise the test creates and the object awaits is exactly that. So the
 * timer is created DURING the object's own execution, which puts it in the
 * object's context, and the test never touches it.
 *
 * The counters are plain numbers in a closure. They are not I/O, they cross
 * nothing, and they are the whole instrument: peak concurrency is a count, and
 * a count is immune to the frozen clock this file's header is about.
 */
function gatedRuntime(targets: number, fleet?: FleetGauge) {
  let inFlight = 0;
  let peak = 0;
  let opened = 0;

  const { runtime, calls } = makeRuntime({
    initiated: ctx({ dialTargets: crew(targets) }),
    pushAudience: crew(targets).map((t) => t.userId),
    dialResult: () => {
      inFlight += 1;
      opened += 1;
      peak = Math.max(peak, inFlight);
      if (fleet) {
        fleet.inFlight += 1;
        fleet.opened += 1;
        fleet.peakInFlight = Math.max(fleet.peakInFlight, fleet.inFlight);
      }
      const ccid = "cc" + String(opened - 1);
      // Long enough that a batch's members genuinely overlap, short enough
      // that 24 of them do not make this suite slow.
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          if (fleet) fleet.inFlight -= 1;
          resolve({ ccid });
        }, 5);
      });
    },
  });

  return {
    runtime,
    calls,
    peakInFlight: () => peak,
    openedSoFar: () => opened,
  };
}

describe("#251 CallSessionDO ring fan-out, on workerd", () => {
  it("runs the real Durable Object, so a number here means something", async () => {
    // The failure this repo has shipped before: a harness that quietly measures
    // a double and reports its numbers as the real thing. `runInDurableObject`
    // cannot reach anything that is not a real DO instance.
    const stub = env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName("smoke"));
    const kind = await runInDurableObject(stub, (instance: CallSessionDO) =>
      typeof instance.onTelnyxEvent,
    );
    expect(kind).toBe("function");
  });

  it("holds no more than one batch of dials open at a time", async () => {
    // THE claim CALLS-V3 T1d makes, checked on the runtime that has to honour
    // it. A serial loop and a batched one are indistinguishable at one target;
    // at 24 they are not.
    const gate = gatedRuntime(MAX_LEGS_PER_SESSION);
    const stub = env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName("bounded"));

    // Install INSIDE the object (this returns immediately), then drive it from
    // OUTSIDE through the stub. Doing the whole cascade inside
    // `runInDurableObject` deadlocks: the callback holds the object's I/O
    // context, so the pump that releases the dials never gets a turn.
    await runInDurableObject(stub, (instance: CallSessionDO) => {
      instance.installRuntime(gate.runtime);
    });

    // The ACK is deliberately NOT awaited — see the header. whenIdle() is the
    // FIFO tail, which is what "the fan-out finished" means.
    void stub.onTelnyxEvent(initiatedEvent("initiated-1"));
    await stub.whenIdle();

    expect(gate.calls.dials.length).toBe(MAX_LEGS_PER_SESSION);
    expect(gate.peakInFlight()).toBeLessThanOrEqual(DIAL_BATCH_SIZE);
    // And genuinely parallel, not serial-with-extra-steps.
    expect(gate.peakInFlight()).toBeGreaterThan(1);

    console.log(
      "\n#251 workerd — bounded parallelism at a full crew:\n" +
        "  targets dialled      " +
        gate.calls.dials.length +
        "\n  peak dials in flight " +
        gate.peakInFlight() +
        " (DIAL_BATCH_SIZE is " +
        DIAL_BATCH_SIZE +
        ")\n",
    );
    console.log(
      capacityResult({
        scenario: "durable-object-single-session-fanout",
        environment: "workerd",
        tested_bound: {
          hot_objects: 1,
          targets_per_object: MAX_LEGS_PER_SESSION,
        },
        ceiling_reached: false,
        measurements: {
          targets_dialled: gate.calls.dials.length,
          peak_dials_in_flight: gate.peakInFlight(),
          configured_batch_size: DIAL_BATCH_SIZE,
        },
        notes: [
          "Counts and ordering are valid; workerd wall-clock milliseconds are deliberately not reported.",
        ],
      }),
    );
  });

  it("serializes an answer that arrives mid-fan-out, behind every dial", async () => {
    // The customer-visible consequence, and the reason bounded parallelism
    // matters: a technician who picks up on the second ring is not connected
    // until the fan-out ahead of them finishes. This asserts the ORDER, which
    // is what the FIFO guarantees and what the clock cannot tell us.
    const gate = gatedRuntime(MAX_LEGS_PER_SESSION);
    const stub = env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName("ordering"));

    let dialsWhenAnswerRan = -1;

    await runInDurableObject(stub, (instance: CallSessionDO) => {
      instance.installRuntime(gate.runtime);
    });

    void stub.onTelnyxEvent(initiatedEvent("initiated-1"));
    // Delivered while the fan-out is still in flight — the sequence CALLS-V3
    // warns about, not a tidy after-the-fact answer.
    void stub.onTelnyxEvent(memberAnsweredEvent("answered-1", "cc0")).then(() => {
      dialsWhenAnswerRan = gate.openedSoFar();
    });
    await stub.whenIdle();

    expect(gate.calls.dials.length).toBe(MAX_LEGS_PER_SESSION);
    // The whole point: the answer was admitted only after the fan-out ahead of
    // it had opened every dial. A FIFO that let it jump the queue would show a
    // smaller number here.
    expect(
      dialsWhenAnswerRan,
      "the answer was admitted after only " +
        dialsWhenAnswerRan +
        " of " +
        MAX_LEGS_PER_SESSION +
        " dials had opened — the FIFO is not serializing on workerd, which " +
        "is the one thing it exists to do",
    ).toBe(MAX_LEGS_PER_SESSION);

    console.log(
      "\n#251 workerd — an answer arriving mid-fan-out:\n" +
        "  dials opened before it was admitted  " +
        dialsWhenAnswerRan +
        " of " +
        MAX_LEGS_PER_SESSION +
        "\n",
    );
    console.log(
      capacityResult({
        scenario: "durable-object-fifo-answer-admission",
        environment: "workerd",
        tested_bound: {
          hot_objects: 1,
          targets_per_object: MAX_LEGS_PER_SESSION,
        },
        ceiling_reached: false,
        measurements: {
          dials_opened_before_answer_admission: dialsWhenAnswerRan,
          total_dials: MAX_LEGS_PER_SESSION,
        },
        notes: [
          "The answer was submitted during fan-out and admitted only after the FIFO work ahead of it.",
        ],
      }),
    );
  });

  it("runs twelve hot call objects together without crossing any per-object batch", async () => {
    // The single-object cases above prove the FIFO and its batch. #251's buyer
    // question is twelve live calls, which means twelve DISTINCT objects. This
    // case makes that topology real on workerd and checks the structural facts
    // that do not require a production clock: every effect lands, every object
    // keeps its own batch bound, and more than one object is live at once.
    const fleet: FleetGauge = { inFlight: 0, peakInFlight: 0, opened: 0 };
    const sessions = Array.from({ length: HOT_OBJECTS }, (_, index) => {
      const gate = gatedRuntime(MAX_LEGS_PER_SESSION, fleet);
      const stub = env.CALL_SESSIONS.get(
        env.CALL_SESSIONS.idFromName(`fleet-${index}`),
      );
      return { index, gate, stub };
    });

    await Promise.all(
      sessions.map(({ gate, stub }) =>
        runInDurableObject(stub, (instance: CallSessionDO) => {
          instance.installRuntime(gate.runtime);
        }),
      ),
    );

    // Admission first, then the cascade tail. Awaiting only onTelnyxEvent would
    // measure the durable ACK (#617), not whether all fan-out effects finished.
    await Promise.all(
      sessions.map(({ index, stub }) =>
        stub.onTelnyxEvent(initiatedEvent(`fleet-initiated-${index}`)),
      ),
    );
    await Promise.all(sessions.map(({ stub }) => stub.whenIdle()));

    const perObjectDials = sessions.map(({ gate }) => gate.calls.dials.length);
    const perObjectPeaks = sessions.map(({ gate }) => gate.peakInFlight());
    const expectedDials = HOT_OBJECTS * MAX_LEGS_PER_SESSION;

    expect(perObjectDials).toEqual(
      Array(HOT_OBJECTS).fill(MAX_LEGS_PER_SESSION),
    );
    for (const peak of perObjectPeaks) {
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(DIAL_BATCH_SIZE);
    }
    expect(fleet.opened).toBe(expectedDials);
    expect(
      fleet.peakInFlight,
      "twelve object invocations never overlapped; this would only be twelve serial single-object tests",
    ).toBeGreaterThan(DIAL_BATCH_SIZE);
    expect(fleet.inFlight).toBe(0);

    console.log(
      capacityResult({
        scenario: "durable-object-multi-session-structure",
        environment: "workerd",
        tested_bound: {
          hot_objects: HOT_OBJECTS,
          targets_per_object: MAX_LEGS_PER_SESSION,
          total_dial_effects: expectedDials,
        },
        ceiling_reached: false,
        measurements: {
          completed_dial_effects: fleet.opened,
          per_object_dials_min: Math.min(...perObjectDials),
          per_object_dials_max: Math.max(...perObjectDials),
          per_object_peak_min: Math.min(...perObjectPeaks),
          per_object_peak_max: Math.max(...perObjectPeaks),
          fleet_peak_dials_in_flight: fleet.peakInFlight,
          unfinished_dials: fleet.inFlight,
        },
        notes: [
          "This is structural workerd evidence, not deployed latency, co-tenancy capacity, or a Telnyx round trip.",
        ],
      }),
    );
  });
});
