/**
 * Fakes for rigd's tests: a socket the test drives by hand, a fetch that
 * answers from a route table and records every request, and a minimal real
 * WebSocket server (handshake plus unfragmented text frames) standing in for
 * the edge's Durable Object.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import type { SocketLike } from "./uplink.ts";

type SocketEvent = { data: unknown; code?: number };

export class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: unknown[] = [];
  readonly #listeners = new Map<string, ((event: SocketEvent) => void)[]>();
  closed = false;

  addEventListener(type: string, listener: (event: SocketEvent) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  receive(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  drop(): void {
    this.readyState = 3;
    this.emit("close");
  }

  emit(type: string, event: SocketEvent = { data: undefined }): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type Route = (request: Recorded) => Response | Promise<Response>;

/** A fetch that records, then answers with the first route whose key prefixes `METHOD url`. */
export function fakeFetch(routes: Record<string, Route>): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = init?.body === undefined || init.body === null ? undefined : typeof init.body === "string" ? init.body : Buffer.from(init.body as Uint8Array).toString("utf8");
    const request = { method: init?.method ?? "GET", url, headers, body };
    requests.push(request);
    const key = `${request.method} ${url}`;
    const match = Object.keys(routes).find((prefix) => key.startsWith(prefix));
    if (!match) return new Response("no route", { status: 599 });
    return routes[match]!(request);
  }) as typeof fetch;
  return { fetch: doFetch, requests };
}

export const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

/** An edge stand-in on loopback that speaks just enough WebSocket. */
export class TinyWsServer {
  readonly server: Server;
  readonly upgrades: { url: string; authorization?: string }[] = [];
  readonly received: unknown[] = [];
  #sockets: Socket[] = [];
  #onMessage: ((frame: unknown) => void) | undefined;
  readonly #accept: (authorization: string | undefined) => boolean;

  constructor(accept: (authorization: string | undefined) => boolean = () => true) {
    this.#accept = accept;
    this.server = createServer();
    this.server.on("upgrade", (request, socket: Socket) => {
      const authorization = request.headers.authorization;
      this.upgrades.push({ url: request.url ?? "", authorization });
      if (!this.#accept(authorization)) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const key = createHash("sha1")
        .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
      this.#sockets.push(socket);
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const frame = readClientFrame(buffer);
          if (!frame) break;
          buffer = buffer.subarray(frame.consumed);
          if (frame.opcode === 0x1) {
            const value = JSON.parse(frame.payload.toString("utf8")) as unknown;
            this.received.push(value);
            this.#onMessage?.(value);
          } else if (frame.opcode === 0x8) socket.end();
        }
      });
      socket.on("error", () => undefined);
    });
  }

  listen(): Promise<number> {
    return new Promise((resolve) => this.server.listen(0, "127.0.0.1", () => resolve((this.server.address() as { port: number }).port)));
  }

  onMessage(listener: (frame: unknown) => void): void {
    this.#onMessage = listener;
  }

  send(frame: unknown): void {
    const payload = Buffer.from(JSON.stringify(frame));
    const header =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    for (const socket of this.#sockets) socket.write(Buffer.concat([header, payload]));
  }

  dropAll(): void {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets = [];
  }

  close(): Promise<void> {
    this.dropAll();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

function readClientFrame(buffer: Buffer): { opcode: number; payload: Buffer; consumed: number } | undefined {
  if (buffer.length < 2) return undefined;
  const opcode = buffer[0]! & 0x0f;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return undefined;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return undefined;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const masked = (buffer[1]! & 0x80) !== 0;
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i]! ^= buffer[maskOffset + (i % 4)]!;
  return { opcode, payload, consumed: offset + length };
}
