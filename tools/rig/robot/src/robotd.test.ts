import type { AddressInfo } from "node:net";
import { EDGE_PATHS, GUARD_ROUTES, HEADER, MEDIA_MAX_BYTES } from "@loonext/rig-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { RobotClient } from "./client.ts";
import { Inbox, WebhookSink } from "./inbox.ts";
import { numberBook } from "./numbers.ts";
import { InlineProbe, StorageProbe } from "./probe.ts";
import { Robot } from "./robot.ts";
import { robotServer } from "./server.ts";
import { GuardedTelnyx, GuardRefusedError, TelnyxApiError } from "./telnyx.ts";
import { FakeCallControl, ManualClock, TEST_NUMBERS, telnyxEvent } from "./test-support.ts";

const EDGE = "https://rig-edge.example.workers.dev";

function recordingFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("GuardedTelnyx", () => {
  it("sends every command to the edge's /g/telnyx with the robot's token, lease and scenario", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Response.json({ data: { call_control_id: "c1", call_leg_id: "l1", call_session_id: "s1" } }),
    );
    const telnyx = new GuardedTelnyx({ edgeOrigin: EDGE, token: "robot-token", fetch });
    const ids = await telnyx.dial({ connection_id: "conn", from: "+14165550101", to: "+14165550111" }, { lease: "L1", scenario: "S02" });
    expect(ids).toEqual({ call_control_id: "c1", call_leg_id: "l1", call_session_id: "s1" });
    expect(calls[0]!.url).toBe(`${EDGE}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.telnyx}/v2/calls`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer robot-token");
    expect(headers[HEADER.lease]).toBe("L1");
    expect(headers[HEADER.scenario]).toBe("S02");

    await telnyx.playbackStart("c1", { audio_url: "https://x/a.wav" }, {});
    await telnyx.deleteRecording("rec/1", {});
    expect(calls[1]!.url).toMatch(/\/v2\/calls\/c1\/actions\/playback_start$/);
    expect(calls[2]).toMatchObject({ url: expect.stringMatching(/\/v2\/recordings\/rec%2F1$/), init: { method: "DELETE" } });
  });

  it("tells a guard refusal from a Telnyx error, and keeps Telnyx's detail text out", async () => {
    const refusing = recordingFetch(() =>
      Response.json({ error: "guard_refused", rule: "dial.to_not_owned" }, { status: 403, headers: { [HEADER.refusedBy]: "guard" } }),
    );
    await expect(new GuardedTelnyx({ edgeOrigin: EDGE, token: "t", fetch: refusing.fetch }).hangup("c1", {})).rejects.toEqual(
      new GuardRefusedError(403, "dial.to_not_owned"),
    );
    const failing = recordingFetch(() =>
      Response.json({ errors: [{ code: "90018", detail: "Call has already ended for +14165550111" }] }, { status: 422 }),
    );
    const error = await new GuardedTelnyx({ edgeOrigin: EDGE, token: "t", fetch: failing.fetch }).hangup("c1", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelnyxApiError);
    expect((error as Error).message).toBe("Telnyx 422 on /v2/calls/c1/actions/hangup (90018)");
  });
});

describe("the probe", () => {
  it("uploads the code once, signs it, and hands Telnyx the edge's media URL", async () => {
    let now = 1_000_000;
    const { fetch, calls } = recordingFetch((url) =>
      url.includes("/object/sign/")
        ? Response.json({ signedURL: "/object/sign/voicemail-greetings/rig-robot/codes/robot.wav?token=jwt" })
        : Response.json({ Key: "ok" }),
    );
    const probe = new StorageProbe({ supabaseUrl: "http://127.0.0.1:54321", serviceRoleKey: "service", edgeOrigin: EDGE, fetch, now: () => now });
    const playback = await probe.playback("robot");
    expect(playback).toEqual({
      audio_url: `${EDGE}${EDGE_PATHS.mediaPrefix}object/sign/voicemail-greetings/rig-robot/codes/robot.wav?token=jwt`,
      audio_type: "wav",
      loop: "infinity",
      target_legs: "self",
    });
    expect(calls[0]!.url).toBe("http://127.0.0.1:54321/storage/v1/object/voicemail-greetings/rig-robot/codes/robot.wav");
    expect((calls[0]!.init.body as Uint8Array).byteLength).toBeLessThan(MEDIA_MAX_BYTES);
    await probe.playback("robot");
    expect(calls).toHaveLength(2);
    now += 55 * 60 * 1000;
    await probe.playback("robot");
    expect(calls.map((c) => c.url.includes("/sign/"))).toEqual([false, true, true]);
  });

  it("can send the code inline instead", async () => {
    const playback = await new InlineProbe().playback("pixel");
    expect(Buffer.from(playback.playback_content!, "base64").subarray(0, 4).toString()).toBe("RIFF");
  });
});

describe("robotd's HTTP face and its client", () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  async function start() {
    const telnyx = new FakeCallControl();
    const robot = new Robot({
      telnyx,
      numbers: TEST_NUMBERS,
      probe: new InlineProbe(),
      connectionId: () => "conn-robot",
      clock: new ManualClock(),
      download: async () => new Uint8Array(),
    });
    const inbox = new Inbox(TEST_NUMBERS);
    const sink = new WebhookSink();
    const server = robotServer({ robot, inbox, sink, telnyx, numbers: TEST_NUMBERS, token: "local-token" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    close = () => server.close();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { telnyx, robot, base, client: new RobotClient({ base, token: "local-token" }) };
  }

  it("refuses a request without the local token", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect((await new RobotClient({ base, token: "wrong" }).inbox({}).catch((e: Error) => e.message))).toMatch(/401/);
  });

  it("takes plans, relayed events and texts, and reads them back", async () => {
    const { base, client, telnyx } = await start();
    const record = await client.dial({
      scenario: "S02",
      lease_id: "L1",
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-W1",
      hangup_after_ms: 20_000,
    });
    expect(record.state).toBe("ringing");

    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "x-robot-token": "local-token", ...headers }, body: JSON.stringify(body) });
    await post("/telnyx", telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    expect((await client.wait(record.plan_id, 0)).state).toBe("answered");

    await post(
      "/telnyx",
      telnyxEvent("message.received", {
        id: "m1",
        text: "Rig S20 abc",
        from: { phone_number: TEST_NUMBERS.number("DEV-W1") },
        to: [{ phone_number: TEST_NUMBERS.number("ROBOT-1"), status: "delivered" }],
      }),
    );
    expect(await client.inbox({ to_role: "ROBOT-1" })).toMatchObject([{ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Rig S20 abc" }]);

    await post("/sink", { type: "message.sent", data: { id: "x" } }, { "loonext-signature": "t=1,v1=abc" });
    expect(await client.sink({ type: "message.sent" })).toMatchObject([{ headers: { "loonext-signature": "t=1,v1=abc" } }]);

    expect(await client.sms({ from_role: "ROBOT-2", to_role: "DEV-E1", text: "START", scenario: "S24" })).toMatchObject({ id: expect.any(String) });
    expect(telnyx.named("send_message")[0]!.body).toEqual({
      from: TEST_NUMBERS.number("ROBOT-2"),
      to: TEST_NUMBERS.number("DEV-E1"),
      text: "START",
    });
    await expect(client.sms({ from_role: "DEV-W1" as never, to_role: "ROBOT-1", text: "x", scenario: "S24" })).rejects.toThrow(/400/);
  });
});

describe("the number book", () => {
  it("maps roles to numbers both ways and refuses a malformed entry without echoing it", () => {
    const book = numberBook({ "ROBOT-1": "+14165550101" });
    expect(book.number("ROBOT-1")).toBe("+14165550101");
    expect(book.role("+14165550101")).toBe("ROBOT-1");
    expect(() => numberBook({ "ROBOT-1": "4165550101" })).toThrow("numbers: ROBOT-1 is not an E.164 number");
    expect(() => numberBook({ robot: "+14165550101" })).toThrow(/role name/);
    expect(() => numberBook({ "ROBOT-1": "+14165550101", "ROBOT-2": "+14165550101" })).toThrow(/repeats/);
  });
});
