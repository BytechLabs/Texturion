/**
 * A stand-in for the edge and guard, for tests and for the workstation
 * spikes in tools/rig/README.md. It answers the routes the rig CLI and the AI
 * shim call, records every request, and holds no key: every number in it is
 * in the fictional 555-01xx range.
 *
 *   node tools/rig/test/support/stub-guard.mjs [port]
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { EDGE_PATHS, GUARD_ROUTES, HEADER } from "../../../rig-protocol/src/index.ts";

export const STUB_TOKEN = "rig-stub-caller-token";

const ROLES = ["ROBOT-1", "ROBOT-2", "STRANGER-1", "DEV-W1", "DEV-W2", "DEV-A1", "DEV-C1", "DEV-E1"];
const PROFILE_OF = {
  "ROBOT-1": "stub-profile-robot",
  "ROBOT-2": "stub-profile-robot",
  "STRANGER-1": "stub-profile-robot",
  "DEV-W1": "stub-profile-qa-w",
  "DEV-W2": "stub-profile-qa-w",
  "DEV-A1": "stub-profile-qa-a",
  "DEV-C1": "stub-profile-qa-c",
  "DEV-E1": "stub-profile-qa-e",
};

export const STUB_STANDING = ROLES.map((role, index) => ({
  role,
  e164: `+1416555010${index}`,
  telnyx_phone_number_id: `stub-number-${index}`,
  messaging_profile_id: PROFILE_OF[role],
}));

export function stubPartition() {
  return {
    billing_group_id: "stub-billing-group",
    owned_e164: STUB_STANDING.map((entry) => entry.e164),
    standing_e164: STUB_STANDING.map((entry) => entry.e164),
    connection_ids: { voice: "stub-voice", robot: "stub-robot", webrtc: "stub-webrtc", sentinel: "stub-sentinel" },
    messaging_profile_ids: [...new Set(Object.values(PROFILE_OF))],
    standing: STUB_STANDING,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * @param {{ port?: number, aiAnswer?: (model: string, inputs: unknown) => unknown }} options
 */
export function startStubGuard({ port = 0, aiAnswer = () => ({ response: "stub" }) } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url, "http://stub");
    requests.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization ?? null, body });
    const send = (status, json, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(json));
    };
    if (request.headers.authorization !== `Bearer ${STUB_TOKEN}`) {
      return send(403, { error: "guard_refused", rule: "class.not_allowed" }, { [HEADER.refusedBy]: "stub-guard" });
    }
    const route = url.pathname.startsWith(EDGE_PATHS.guardPrefix) ? url.pathname.slice(EDGE_PATHS.guardPrefix.length) : null;
    if (route === GUARD_ROUTES.partition && request.method === "GET") return send(200, stubPartition());
    if (route === GUARD_ROUTES.health && request.method === "GET") {
      return send(200, { ok: true, balance_above_floor: true, room: 4 });
    }
    if (route?.startsWith(`${GUARD_ROUTES.ai}/run/`) && request.method === "POST") {
      const model = route.slice(`${GUARD_ROUTES.ai}/run/`.length);
      return send(200, aiAnswer(model, JSON.parse(body || "{}")));
    }
    return send(404, { error: "not_found" });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address();
      resolve({ origin: `http://127.0.0.1:${bound}`, requests, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] ?? 8899);
  // STUB_AI_RESPONSE: the model output to answer every AI run with, as JSON.
  const canned = process.env.STUB_AI_RESPONSE ? JSON.parse(process.env.STUB_AI_RESPONSE) : null;
  const guard = await startStubGuard({
    port,
    aiAnswer: (model) => canned ?? { response: `stub answer from ${model}` },
  });
  console.log(`stub guard on ${guard.origin}`);
  setInterval(() => {
    while (guard.requests.length > 0) {
      const { method, path } = guard.requests.shift();
      console.log(`${new Date().toISOString()} ${method} ${path}`);
    }
  }, 500);
}
