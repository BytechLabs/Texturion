// hostd's HTTP API, for the VM's Android lanes through the tunnel. Loopback
// only, one bearer token, and no VM control: the VM is driven from the
// command line alone.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export const BIND = "127.0.0.1";
const BODY_LIMIT = 4096;
const BOOT_KEYS = new Set(["cold", "wipe"]);
const KILL_KEYS = new Set(["hard"]);
const DEVICE_ROUTE = /^\/v1\/devices\/([^/]+)\/(boot|kill|tokens)$/;

const sha = (text) => createHash("sha256").update(text).digest();

/** Compares digests, so neither the length nor the content leaks through timing. */
export function bearerMatches(header, token) {
  const presented = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
  if (!presented || !token) return false;
  return timingSafeEqual(sha(presented), sha(token));
}

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(text);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const collect = (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        request.off("data", collect);
        request.resume();
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    };
    request.on("data", collect);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** An optional JSON object of booleans with only the allowed keys. */
export function parseFlags(text, allowed) {
  if (text.trim() === "") return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [key, flag] of Object.entries(value)) {
    if (!allowed.has(key) || typeof flag !== "boolean") return null;
  }
  return value;
}

/**
 * `devices` is createDevices(); `health()` resolves to the facts for
 * /v1/health; `log` receives one line per request: method, path and status,
 * never a header or a body.
 */
export function createHostdServer({ token, devices, health, log = () => {} }) {
  return createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    let status = 500;
    try {
      if (!bearerMatches(request.headers.authorization, token)) {
        status = 401;
        return send(response, status, { error: "unauthorized" });
      }
      if (request.method === "GET" && path === "/v1/health") {
        status = 200;
        return send(response, status, await health());
      }
      const route = DEVICE_ROUTE.exec(path);
      const action = route?.[2];
      let name = null;
      try {
        name = route ? decodeURIComponent(route[1]) : null;
      } catch {
        // a malformed escape names no device
      }
      const method = action === "tokens" ? "GET" : "POST";
      if (!route || request.method !== method || !devices.has(name)) {
        status = 404;
        return send(response, status, { error: "not_found" });
      }
      let result;
      if (action === "tokens") {
        result = devices.tokens(name);
      } else {
        const flags = parseFlags(await readBody(request), action === "boot" ? BOOT_KEYS : KILL_KEYS);
        if (!flags) {
          status = 400;
          return send(response, status, { error: "bad_body" });
        }
        result = action === "boot" ? await devices.boot(name, flags) : await devices.kill(name, flags);
      }
      status = result.status;
      return send(response, status, result.body);
    } catch (cause) {
      status = cause.status ?? 500;
      return send(response, status, { error: status === 413 ? "body_too_large" : "internal" });
    } finally {
      log(`${request.method} ${path} ${status}`);
    }
  });
}

/** Listens on loopback and nowhere else. */
export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host: BIND, exclusive: true }, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}
