/**
 * scripts/trace-to-fixture.mjs: a real webhook trace in, a publishable
 * fixture out, with the events still joined up.
 *
 * A real trace's numbers are outside the fictional range, so the samples here
 * must be too. They sit in area codes 370 and 960, which NANPA holds in
 * reserve and has never assigned: no line anywhere answers them, so nothing
 * real is published. They are still assembled from parts at run time, because
 * check-rig-no-e164 reads this file and passes only 555-0100..0199.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildMemberRingState,
  buildVoicemailState,
  parseMemberRingState,
} from "../messaging/inbound-ring";
import type { TelnyxEvent } from "../messaging/types";
import { isOwnDialedLeg } from "./outbound-leg-gate";
import { sessionKeyFor } from "./webhook-router";

// The REAL tool and the REAL guard, not copies of their rules. Both guard
// their entry points, so importing them runs nothing.
import {
  decodeClientState,
  parseTrace,
  realNumbersIn,
  traceToFixture,
  // @ts-expect-error — a plain .mjs with no types, which is what CI executes.
} from "../../../../scripts/trace-to-fixture.mjs";
// @ts-expect-error — a plain .mjs with no types, which is what CI executes.
import { findNumbers } from "../../../../scripts/check-rig-no-e164.mjs";

const SCRIPT = fileURLToPath(new URL("../../../../scripts/trace-to-fixture.mjs", import.meta.url));

/** A NANP number outside the fictional range, from its three parts. */
const realNumber = (area: string, exchange: string, line: string) => `+1${area}${exchange}${line}`;

const CALLER = realNumber("370", "362", "4417");
const BUSINESS = realNumber("960", "283", "9050");
const CUSTOMER_SESSION = "7c1e2f30-5d6b-4a7c-9e8f-0a1b2c3d4e5f";
const MEMBER_ID = "3b9d1c22-8e4f-4a6b-b7c8-d9e0f1a2b3c4";
const CUSTOMER_LEG = "v3:Zm9vYmFyYmF6cXV4Y3VzdG9tZXI";
const MEMBER_LEG = "v3:bWVtYmVybGVnZm9yYW5zd2VyMQ";
const VOICE_CONNECTION = "2847561930284756193";
const SIP_USERNAME = "gencredq7Wm2xKp4NbZ";
const RECORDING_URL = "https://recordings.vendor.test/2026/10/30/aa11bb22.mp3?X-Signature=deadbeef";

interface Envelope {
  data: { id: string; event_type: string; occurred_at: string; payload: Record<string, unknown> };
}

function envelope(id: string, eventType: string, payload: Record<string, unknown>): Envelope {
  return {
    data: { id, event_type: eventType, occurred_at: "2026-10-30T12:00:00.000Z", payload },
  };
}

/** A call the way the switch reports it: the caller rings, a member's softphone rings, voicemail records. */
function callTrace(): Envelope[] {
  return [
    envelope("0d6f3a1e-1b2c-4d3e-8f4a-5b6c7d8e9f01", "call.initiated", {
      call_control_id: CUSTOMER_LEG,
      call_session_id: CUSTOMER_SESSION,
      connection_id: VOICE_CONNECTION,
      direction: "incoming",
      from: CALLER,
      to: BUSINESS,
      caller_id_name: "Avery Example-Person",
      state: "parked",
    }),
    envelope("0d6f3a1e-1b2c-4d3e-8f4a-5b6c7d8e9f02", "call.initiated", {
      call_control_id: MEMBER_LEG,
      call_session_id: "5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716",
      connection_id: VOICE_CONNECTION,
      direction: "outgoing",
      from: BUSINESS,
      to: `sip:${SIP_USERNAME}@sip.telnyx.com`,
      client_state: buildMemberRingState({
        sessionId: CUSTOMER_SESSION,
        userId: MEMBER_ID,
        caller: CALLER,
        inboundCcid: CUSTOMER_LEG,
      }),
      custom_headers: [
        { name: "X-Loonext-Session", value: CUSTOMER_SESSION },
        { name: "X-Loonext-Caller", value: CALLER },
      ],
    }),
    envelope("0d6f3a1e-1b2c-4d3e-8f4a-5b6c7d8e9f03", "call.recording.saved", {
      call_control_id: CUSTOMER_LEG,
      call_session_id: CUSTOMER_SESSION,
      connection_id: VOICE_CONNECTION,
      client_state: buildVoicemailState(CALLER),
      recording_urls: { mp3: RECORDING_URL },
      sip_call_id: "8f2c1a@10.21.4.7",
    }),
  ];
}

function payloads(fixture: { events: Envelope[] }): Record<string, unknown>[] {
  return fixture.events.map((event) => event.data.payload);
}

const decode = (value: unknown) => Buffer.from(String(value), "base64").toString("utf8");

describe("trace-to-fixture: what it hides", () => {
  const { fixture, report } = traceToFixture(callTrace()) as {
    fixture: { schema: string; events: Envelope[] };
    report: { events: number; numbers: number; foreignNumbers: number; ids: number };
  };
  const text = JSON.stringify(fixture, null, 2);
  const [initiated, , saved] = payloads(fixture);

  it("leaves no number the rig guard would refuse, and the guard did read some", () => {
    const numbers = findNumbers(text) as { line: number; fictional: boolean }[];
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.filter((n) => !n.fictional)).toEqual([]);
    expect(text).not.toContain(CALLER);
    expect(text).not.toContain(BUSINESS);
    expect(report).toMatchObject({ events: 3, numbers: 2, foreignNumbers: 0 });
  });

  it("keeps each number's area code, inside the fictional range", () => {
    expect(initiated.from).toMatch(/^\+137055501\d\d$/);
    expect(initiated.to).toMatch(/^\+196055501\d\d$/);
    expect(initiated.from).not.toBe(initiated.to);
  });

  it("replaces account ids, softphone credentials, URLs, addresses and the caller's name", () => {
    expect(text).not.toContain(VOICE_CONNECTION);
    expect(text).not.toContain(SIP_USERNAME);
    expect(text).not.toContain("vendor.test");
    expect(text).not.toContain("10.21.4.7");
    expect(text).not.toContain("Avery");
    expect(text).not.toContain(CUSTOMER_SESSION);
    expect(text).not.toContain(CUSTOMER_LEG);
    expect(initiated.connection_id).toMatch(/^9\d{18}$/);
    expect(initiated.caller_id_name).toBe("Fixture Caller 1");
    expect(saved.recording_urls).toEqual({ mp3: "/fixtures/urls/1.mp3" });
    expect(saved.sip_call_id).toMatch(/^fixture-sip-call-id-\d+$/);
  });
});

describe("trace-to-fixture: what it keeps joined up", () => {
  const { fixture } = traceToFixture(callTrace()) as { fixture: { events: Envelope[] } };
  const [initiated, ring, saved] = payloads(fixture);

  it("maps a value to the same stand-in in every event and every field", () => {
    expect(ring.connection_id).toBe(initiated.connection_id);
    expect(saved.call_session_id).toBe(initiated.call_session_id);
    expect(saved.call_control_id).toBe(initiated.call_control_id);
    expect(ring.from).toBe(initiated.to);
    const headers = ring.custom_headers as { name: string; value: string }[];
    expect(headers).toEqual([
      { name: "X-Loonext-Session", value: initiated.call_session_id },
      { name: "X-Loonext-Caller", value: initiated.from },
    ]);
  });

  it("renumbers inside client_state and re-encodes it, so the router still routes it", () => {
    const state = parseMemberRingState(ring.client_state as string);
    expect(state).toMatchObject({
      sessionId: initiated.call_session_id,
      userId: expect.stringMatching(/^00000000-0000-4000-8000-\d{12}$/),
      caller: initiated.from,
      inboundCcid: initiated.call_control_id,
    });
    expect(decode(saved.client_state)).toBe(`vmi|${initiated.from}`);
    // The ring leg and the customer leg still land on one session object.
    const [customerEvent, ringEvent] = fixture.events as unknown as TelnyxEvent[];
    expect(sessionKeyFor(ringEvent)).toBe(sessionKeyFor(customerEvent));
  });

  it("keeps a Telnyx credential URI a credential URI, so the dial-target gate reads it the same", () => {
    expect(ring.to).toMatch(/^sip:fixturecred\d+@sip\.telnyx\.com$/);
    expect(isOwnDialedLeg(ring.to as string)).toBe(true);
  });

  it("keeps a SIP URI with a number in it a number, and a foreign SIP host foreign", () => {
    const { fixture: other } = traceToFixture([
      envelope("e1", "call.initiated", {
        from: `sip:${CALLER}@pbx.vendor.test`,
        to: `sip:${BUSINESS.slice(2)}@sip.telnyx.com`,
      }),
    ]) as { fixture: { events: Envelope[] } };
    const [payload] = payloads(other);
    expect(payload.from).toMatch(/^sip:\+137055501\d\d@203\.0\.113\.\d+$/);
    expect(payload.to).toMatch(/^sip:96055501\d\d@sip\.telnyx\.com$/);
    expect(isOwnDialedLeg(payload.to as string)).toBe(false);
  });
});

describe("trace-to-fixture: edges", () => {
  it("never moves a number that is already fictional, and never renumbers onto one", () => {
    const fictional = "+13705550100";
    const { fixture } = traceToFixture([
      envelope("e1", "call.initiated", { from: CALLER, to: fictional }),
    ]) as { fixture: { events: Envelope[] } };
    const [payload] = payloads(fixture);
    expect(payload.to).toBe(fictional);
    expect(payload.from).toBe("+13705550101");
  });

  it("gives a number outside NANP a fictional NANP one, and says so", () => {
    const foreign = `+44${"20"}${"7946"}${"0321"}`;
    const { fixture, report } = traceToFixture([
      envelope("e1", "call.initiated", { from: foreign, to: BUSINESS }),
    ]) as { fixture: { events: Envelope[] }; report: { foreignNumbers: number } };
    expect(payloads(fixture)[0].from).toMatch(/^\+161355501\d\d$/);
    expect(report.foreignNumbers).toBe(1);
  });

  it("scrubs a text's words but keeps the carrier keywords a fixture exists to replay", () => {
    const { fixture } = traceToFixture([
      envelope("m1", "message.received", {
        from: { phone_number: CALLER, carrier: "Example Wireless" },
        to: [{ phone_number: BUSINESS }],
        text: "My furnace is out, the key is under the mat",
      }),
      envelope("m2", "message.received", {
        from: { phone_number: CALLER },
        to: [{ phone_number: BUSINESS }],
        text: " stop ",
      }),
    ]) as { fixture: { events: Envelope[] } };
    const [first, second] = payloads(fixture);
    expect(first.text).toBe("Fixture message 1");
    expect(second.text).toBe(" stop ");
    expect((first.from as { phone_number: string }).phone_number).toMatch(/^\+137055501\d\d$/);
    expect((first.to as { phone_number: string }[])[0].phone_number).toMatch(/^\+196055501\d\d$/);
  });

  it("renumbers a bare ten- or eleven-digit number in a number field, keeping its shape", () => {
    const { fixture } = traceToFixture([
      envelope("e1", "call.initiated", { from: CALLER.slice(2), to: BUSINESS.slice(1) }),
    ]) as { fixture: { events: Envelope[] } };
    const [payload] = payloads(fixture);
    expect(payload.from).toMatch(/^37055501\d\d$/);
    expect(payload.to).toMatch(/^196055501\d\d$/);
  });

  it("refuses a trace with more numbers in one area code than the range holds", () => {
    const events = Array.from({ length: 101 }, (_, index) =>
      envelope(`e${index}`, "call.initiated", {
        from: realNumber("370", "362", String(1000 + index)),
      }),
    );
    expect(() => traceToFixture(events)).toThrow(/more than 100 distinct numbers in area code 370/);
  });

  it("renumbers a number after `=` and one written %2B, the query-string and form shapes the guard reads", () => {
    const { fixture } = traceToFixture([
      envelope("e1", "call.initiated", {
        note: `ani=${CALLER}`,
        body_form: `From=${encodeURIComponent(CALLER)}&To=${encodeURIComponent(BUSINESS)}`,
      }),
    ]) as { fixture: { events: Envelope[] } };
    const [payload] = payloads(fixture);
    expect(payload.note).toMatch(/^ani=\+137055501\d\d$/);
    expect(payload.body_form).toMatch(/^From=%2B137055501\d\d&To=%2B196055501\d\d$/);
    // One caller, one stand-in, whichever way it was written.
    const formFrom = decodeURIComponent((payload.body_form as string).split("&")[0].slice("From=".length));
    expect(formFrom).toBe((payload.note as string).slice("ani=".length));
  });

  it("reads inside a client_state that is not ASCII, and re-encodes it the way it came", () => {
    const utf8 = Buffer.from(`vmi|${CALLER}|déjà`, "utf8").toString("base64");
    const latin1 = Buffer.from(`vmi|${CALLER}|déjà`, "latin1").toString("base64");
    const unpadded = Buffer.from(`vmi|${CALLER}|`, "utf8").toString("base64").replace(/=+$/, "");
    const { fixture } = traceToFixture([
      envelope("e1", "call.initiated", { from: CALLER, client_state: utf8 }),
      envelope("e2", "call.answered", { client_state: latin1 }),
      envelope("e3", "call.hangup", { client_state: unpadded }),
    ]) as { fixture: { events: Envelope[] } };
    const [first, second, third] = payloads(fixture);
    expect(decodeClientState(first.client_state)).toEqual({
      text: `vmi|${first.from}|déjà`,
      encoding: "utf8",
    });
    expect(decodeClientState(second.client_state)).toEqual({
      text: `vmi|${first.from}|déjà`,
      encoding: "latin1",
    });
    expect(third.client_state).not.toMatch(/=$/);
    expect(decodeClientState(third.client_state)?.text).toBe(`vmi|${first.from}|`);
  });
});

describe("trace-to-fixture: the refusal", () => {
  it("judges with the repo guard's own reader, so what that guard flags, the tool flags", () => {
    for (const text of [`{"note": "${CALLER}"}`, `ani=${CALLER}`, `From=${encodeURIComponent(CALLER)}`]) {
      const guard = (findNumbers(text) as { line: number; fictional: boolean }[])
        .filter((number) => !number.fictional)
        .map((number) => number.line);
      expect(guard).toHaveLength(1);
      expect(realNumbersIn(text)).toEqual(guard);
    }
    expect(realNumbersIn(`{"note": "+13705550142"}`)).toEqual([]);
  });

  it("writes nothing when a number survives somewhere renumbering does not reach", () => {
    // Object keys are never rewritten, so a number used as one is left as it came.
    const events = [envelope("e1", "call.initiated", { from: CALLER, seen_by: { [CALLER]: true } })];
    expect(() => traceToFixture(events)).toThrow(
      /^1 phone number\(s\) survived renumbering \(fixture line \d+\); nothing written$/,
    );
  });

  it("refuses a client_state it cannot decode, because a number could hide inside it", () => {
    expect(() =>
      traceToFixture([envelope("e1", "call.hangup", { client_state: "not base64 at all" })]),
    ).toThrow(/^a client_state is not base64, .*nothing written$/);
    expect(() =>
      traceToFixture([envelope("e1", "call.hangup", { target_leg_client_state: "abcde" })]),
    ).toThrow(/^a target_leg_client_state is not base64/);
  });
});

describe("trace-to-fixture: reading traces", () => {
  const one = envelope("e1", "call.hangup", { hangup_cause: "normal_clearing" });

  it("reads an array, one envelope, a { data } listing, NDJSON and webhook_events rows", () => {
    expect(parseTrace(JSON.stringify([one, one]))).toHaveLength(2);
    expect(parseTrace(JSON.stringify(one))).toHaveLength(1);
    expect(parseTrace(JSON.stringify({ data: [one] }))).toHaveLength(1);
    expect(parseTrace(`${JSON.stringify(one)}\n\n${JSON.stringify(one)}\n`)).toHaveLength(2);
    expect(parseTrace(JSON.stringify([{ event_id: "e1", payload: one }]))).toEqual([one]);
  });

  it("refuses what is not a webhook envelope", () => {
    expect(() => parseTrace("")).toThrow(/empty/);
    expect(() => parseTrace(JSON.stringify([{ hello: "world" }]))).toThrow(/entry 1 is not a Telnyx webhook envelope/);
    expect(() => parseTrace("{not json\n")).toThrow(/line 1 is not JSON/);
  });
});

describe("trace-to-fixture: the command", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-to-fixture-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the fixture and reports counts, never values", () => {
    const input = join(dir, "trace.ndjson");
    const output = join(dir, "fixture.json");
    writeFileSync(input, callTrace().map((event) => JSON.stringify(event)).join("\n"));
    const run = spawnSync(process.execPath, [SCRIPT, input, "--out", output], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toMatch(/3 events, 2 numbers renumbered, \d+ identifiers replaced/);
    expect(run.stderr).not.toContain(CALLER);
    const written = JSON.parse(readFileSync(output, "utf8")) as { schema: string; events: unknown[] };
    expect(written.schema).toBe("loonext.telnyx-trace-fixture.v1");
    expect(written.events).toHaveLength(3);
  });

  it("exits non-zero and writes nothing when a number survives, naming where but not what", () => {
    const input = join(dir, "leaky.json");
    const output = join(dir, "leaky-fixture.json");
    writeFileSync(input, JSON.stringify([envelope("e1", "call.initiated", { seen_by: { [CALLER]: true } })]));
    const run = spawnSync(process.execPath, [SCRIPT, input, "--out", output], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/survived renumbering \(fixture line \d+\); nothing written/);
    expect(run.stderr).not.toContain(CALLER.slice(2));
    expect(existsSync(output)).toBe(false);
  });

  it("exits non-zero and writes nothing for a trace it cannot read", () => {
    const input = join(dir, "broken.json");
    const output = join(dir, "never.json");
    writeFileSync(input, JSON.stringify([{ hello: "world" }]));
    const run = spawnSync(process.execPath, [SCRIPT, input, "--out", output], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(existsSync(output)).toBe(false);
  });

  it("prints its usage for a call it does not understand", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--out"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/^usage:/);
  });
});
