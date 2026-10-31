import { CALL_EVENT_RELAY_TIMEOUT_MS, EDGE_PATHS } from "@loonext/rig-protocol";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { FakeSocket, TinyWsServer } from "./test-support.ts";
import { parseFrame, Uplink, uplinkUrl, type UplinkHandlers } from "./uplink.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function webhook(kind: "call" | "message" | "robot-call" | "robot-webhook", id = "evt-1") {
  return {
    t: "webhook",
    id,
    kind,
    path: "/t/v",
    headers: { "content-type": "application/json" },
    body: "{}",
    attempt: 1,
  };
}

function setup(handlers: Partial<UplinkHandlers> = {}) {
  const clock = new ManualClock();
  const sockets: FakeSocket[] = [];
  const opened: { url: string; token: string }[] = [];
  const states: boolean[] = [];
  const uplink = new Uplink({
    edgeOrigin: "https://rig-edge.example.workers.dev",
    token: "rig-control-token",
    clock,
    random: () => 1,
    onState: (connected) => states.push(connected),
    socket: (url, token) => {
      opened.push({ url, token });
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    handlers: {
      webhook: async () => ({ status: 200, body: "ok" }),
      media: async () => ({ status: 404 }),
      mail: async () => undefined,
      rpc: async () => ({ pong: true }),
      ...handlers,
    },
  });
  uplink.start();
  sockets[0]!.open();
  return { clock, sockets, opened, uplink, states, socket: sockets[0]! };
}

describe("the uplink", () => {
  it("dials the edge's uplink path with the control token, and beats on open", () => {
    const { opened, socket } = setup();
    expect(opened).toEqual([{ url: `wss://rig-edge.example.workers.dev${EDGE_PATHS.ctlUplink}`, token: "rig-control-token" }]);
    expect(socket.sent[0]).toMatchObject({ t: "heartbeat", component: "rig" });
  });

  it("answers a call event with the local status and body", async () => {
    const { socket } = setup({ webhook: async () => ({ status: 200, body: '{"ok":true}' }) });
    socket.receive(webhook("call"));
    await flush();
    expect(socket.sent.at(-1)).toEqual({ t: "webhook-result", id: "evt-1", status: 200, body: '{"ok":true}' });
  });

  it("answers 503 when the local API is slower than the relay timeout", async () => {
    const { socket, clock } = setup({ webhook: () => new Promise(() => undefined) });
    socket.receive(webhook("call"));
    await flush();
    clock.advance(CALL_EVENT_RELAY_TIMEOUT_MS - 1);
    await flush();
    expect(socket.sent.filter((f) => (f as { t: string }).t === "webhook-result")).toEqual([]);
    clock.advance(1);
    await flush();
    expect(socket.sent.at(-1)).toEqual({ t: "webhook-result", id: "evt-1", status: 503 });
  });

  it("acks a queued event only after a 2xx", async () => {
    const statuses = [500, 202];
    const { socket } = setup({ webhook: async () => ({ status: statuses.shift()! }) });
    socket.receive(webhook("message", "msg-1"));
    await flush();
    expect(socket.sent.some((f) => (f as { t: string }).t === "ack")).toBe(false);
    socket.receive({ ...webhook("message", "msg-1"), attempt: 2 });
    await flush();
    expect(socket.sent.at(-1)).toEqual({ t: "ack", id: "msg-1" });
  });

  it("does not handle a redelivery while the first delivery is still in hand", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const { socket } = setup({
      webhook: () => {
        calls++;
        return new Promise((resolve) => {
          release = () => resolve({ status: 200 });
        });
      },
    });
    socket.receive(webhook("robot-webhook", "r-1"));
    socket.receive({ ...webhook("robot-webhook", "r-1"), attempt: 2 });
    await flush();
    expect(calls).toBe(1);
    release();
    await flush();
    expect(socket.sent.filter((f) => (f as { t: string }).t === "ack")).toEqual([{ t: "ack", id: "r-1" }]);
  });

  it("answers the robot's call events synchronously, as the edge waits for them", async () => {
    const { socket } = setup({ webhook: async () => ({ status: 200, body: "robot" }) });
    socket.receive(webhook("robot-call", "rc-1"));
    await flush();
    expect(socket.sent.at(-1)).toEqual({ t: "webhook-result", id: "rc-1", status: 200, body: "robot" });
    expect(socket.sent.some((f) => (f as { t: string }).t === "ack")).toBe(false);
  });

  it("acks only a 2xx, even for a text whose signature aged out: the edge drops that one itself", async () => {
    const { socket } = setup({ webhook: async () => ({ status: 400, late: true }) });
    socket.receive(webhook("message", "late-1"));
    await flush();
    expect(socket.sent.some((f) => (f as { t: string }).t === "ack")).toBe(false);
  });

  it("answers an rpc with an error before the edge's 60 s timeout", async () => {
    const { socket, clock } = setup({ rpc: () => new Promise(() => undefined) });
    socket.receive({ t: "rpc", id: "slow", method: "triage.unresolved", params: {}, caller: "triage" });
    await flush();
    clock.advance(55_000);
    await flush();
    expect(socket.sent.at(-1)).toEqual({ t: "rpc-result", id: "slow", ok: false, error: "rpc_timeout" });
  });

  it("reports the socket's state for state/uplink.json: up, beating, down", () => {
    const { socket, clock, states } = setup();
    expect(states).toEqual([true]);
    clock.advance(60_000);
    expect(states).toEqual([true, true]);
    socket.emit("close", { data: undefined, code: 4000 });
    expect(states).toEqual([true, true, false]);
  });

  it("serves media, rpc and ping frames", async () => {
    const { socket } = setup({
      media: async () => ({ status: 200, content_type: "audio/wav", body_b64: "UklGRg==" }),
      rpc: async (frame) => {
        if (frame.method === "boom") throw new Error("no such thing");
        return { echoed: frame.params };
      },
    });
    socket.receive({ t: "media", id: "m-1", path: "/m/object/sign/mms-media/a.jpg?token=x" });
    socket.receive({ t: "rpc", id: "r-1", method: "echo", params: { a: 1 }, caller: "triage" });
    socket.receive({ t: "rpc", id: "r-2", method: "boom", params: {}, caller: "triage" });
    socket.receive({ t: "ping", at: "2026-10-31T00:00:00.000Z" });
    await flush();
    expect(socket.sent).toContainEqual({ t: "media-result", id: "m-1", status: 200, content_type: "audio/wav", body_b64: "UklGRg==" });
    expect(socket.sent).toContainEqual({ t: "rpc-result", id: "r-1", ok: true, result: { echoed: { a: 1 } } });
    expect(socket.sent).toContainEqual({ t: "rpc-result", id: "r-2", ok: false, error: "no such thing" });
    expect(socket.sent.filter((f) => (f as { t: string }).t === "heartbeat")).toHaveLength(2);
  });

  it("reconnects with a growing backoff, reset once a connection holds", () => {
    const { sockets, clock } = setup();
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      sockets.at(-1)!.drop();
      const before = sockets.length;
      let waited = 0;
      while (sockets.length === before) {
        clock.advance(500);
        waited += 500;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
    sockets.at(-1)!.open();
    clock.advance(10_000);
    sockets.at(-1)!.drop();
    const before = sockets.length;
    clock.advance(1_000);
    expect(sockets.length).toBe(before + 1);
  });

  it("caps the backoff at a minute", () => {
    const { sockets, clock } = setup();
    for (let i = 0; i < 12; i++) {
      sockets.at(-1)!.drop();
      clock.advance(60_000);
    }
    expect(sockets).toHaveLength(13);
  });

  it("stops reconnecting once stopped", () => {
    const { sockets, clock, uplink } = setup();
    uplink.stop();
    clock.advance(120_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closed).toBe(true);
  });
});

describe("parseFrame", () => {
  it("accepts the protocol's frames and nothing else", () => {
    expect(parseFrame(JSON.stringify(webhook("call")))).toMatchObject({ t: "webhook" });
    expect(parseFrame(JSON.stringify({ ...webhook("call"), kind: "sms" }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ ...webhook("call"), headers: { a: 1 } }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ t: "rpc", id: "1" }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ t: "shell", id: "1", cmd: "rm" }))).toBeUndefined();
    expect(parseFrame("not json")).toBeUndefined();
  });

  it("builds the socket URL from the edge origin", () => {
    expect(uplinkUrl("https://rig-edge.example.workers.dev/")).toBe(`wss://rig-edge.example.workers.dev${EDGE_PATHS.ctlUplink}`);
  });
});

describe("the uplink over a real WebSocket", () => {
  let server: TinyWsServer | undefined;
  let uplink: Uplink | undefined;
  afterEach(async () => {
    uplink?.stop();
    await server?.close();
  });

  it("sends the bearer in the handshake, relays a call event and reconnects after a drop", async () => {
    server = new TinyWsServer((auth) => auth === "Bearer rig-control-token");
    const port = await server.listen();
    uplink = new Uplink({
      edgeOrigin: `http://127.0.0.1:${port}`,
      token: "rig-control-token",
      initialBackoffMs: 50,
      handlers: {
        webhook: async (frame) => ({ status: 200, body: `seen ${frame.id}` }),
        media: async () => ({ status: 404 }),
        mail: async () => undefined,
        rpc: async () => null,
      },
    });
    uplink.start();
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(check()).toBe(true);
    };
    await until(() => server!.received.length > 0);
    expect(server.upgrades[0]).toEqual({ url: EDGE_PATHS.ctlUplink, authorization: "Bearer rig-control-token" });
    expect(server.received[0]).toMatchObject({ t: "heartbeat", component: "rig" });

    server.send(webhook("call", "evt-real"));
    await until(() => server!.received.some((f) => (f as { t: string }).t === "webhook-result"));
    expect(server.received).toContainEqual({ t: "webhook-result", id: "evt-real", status: 200, body: "seen evt-real" });

    server.dropAll();
    await until(() => server!.upgrades.length === 2);
  });
});
