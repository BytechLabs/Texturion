import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `scripts/check-telnyx-endpoints.mjs` fails by going blind: a call shape it
 * stops following looks exactly like a call that is not there. So these pin
 * every shape the API uses, and the shapes it must refuse rather than guess at.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Request = { method: string; path: string; where: string };
type Entry = { method: string; path: string; policy: string; line: number };
type Scan = { requests: Request[]; problems: string[] };

const guard = (await import(join(REPO, "scripts", "check-telnyx-endpoints.mjs"))) as {
  loadTypeScript: () => unknown;
  scanFile: (ts: unknown, file: string, text: string) => Scan;
  readRegistry: (ts: unknown, text: string, file?: string) => { entries: Entry[]; problems: string[] };
  compare: (entries: Entry[], requests: Request[]) => string[];
  coverage: (requests: Request[], entries: Entry[]) => string[];
  REGISTRY_FILE: string;
};

const ts = guard.loadTypeScript();
const FILE = "apps/api/src/example.ts";
const IMPORTS = `import { telnyxApiBase, telnyxRequest } from "./telnyx/client";\n`;
const scan = (body: string) => guard.scanFile(ts, FILE, IMPORTS + body);
const endpoints = (body: string) => {
  const result = scan(body);
  expect(result.problems).toEqual([]);
  return result.requests.map((r) => `${r.method} ${r.path}`).sort();
};

describe("the call shapes the API uses", () => {
  it("reads a path written beside its method, with each id as :id", () => {
    expect(
      endpoints(`
        export async function release(env, id) {
          await telnyxRequest(env, { method: "DELETE", path: \`/v2/phone_numbers/\${id}\` });
        }`),
    ).toEqual(["DELETE /v2/phone_numbers/:id"]);
  });

  it("drops the query string, which is not part of the endpoint", () => {
    expect(
      endpoints(`
        export async function list(env, group) {
          return telnyxRequest(env, {
            method: "GET",
            path: \`/v2/phone_numbers?filter[billing_group_id]=\${group}\`,
          });
        }`),
    ).toEqual(["GET /v2/phone_numbers"]);
  });

  it("follows a path held in a local first", () => {
    expect(
      endpoints(`
        export async function alive(env, ccid) {
          const path = \`/v2/calls/\${ccid}\`;
          return telnyxRequest(env, { method: "GET", path });
        }`),
    ).toEqual(["GET /v2/calls/:id"]);
  });

  it("follows a path into a wrapper in the same file that adds the method", () => {
    expect(
      endpoints(`
        async function post(env, path, body) {
          return telnyxRequest(env, { method: "POST", path, body });
        }
        export async function send(env) {
          return post(env, "/v2/messages", {});
        }`),
    ).toEqual(["POST /v2/messages"]);
  });

  it("lists every action a private wrapper is handed in its file", () => {
    expect(
      endpoints(`
        async function command(env, ccid, action) {
          return telnyxRequest(env, { method: "POST", path: \`/v2/calls/\${ccid}/actions/\${action}\` });
        }
        export const hang = (env, ccid) => command(env, ccid, "hangup");
        export const answer = (env, ccid, early) => command(env, ccid, early ? "answer" : "reject");`),
    ).toEqual([
      "POST /v2/calls/:id/actions/answer",
      "POST /v2/calls/:id/actions/hangup",
      "POST /v2/calls/:id/actions/reject",
    ]);
  });

  it("reads a raw fetch built on the Telnyx base", () => {
    expect(
      endpoints(`
        export async function send(env) {
          return fetch(\`\${telnyxApiBase(env)}/v2/messages\`, { method: "POST", body: "{}" });
        }`),
    ).toEqual(["POST /v2/messages"]);
  });

  it("ignores a /v2/ path sent to some other vendor", () => {
    const result = scan(`
      const CALENDAR = "https://calendar.invalid";
      export async function events(token) {
        return fetch(\`\${CALENDAR}/v2/events\`, { headers: { authorization: token } });
      }`);
    expect(result).toEqual({ requests: [], problems: [] });
  });

  it("judges a URL by its base, not by an id in its path", () => {
    const result = scan(`
      const CALENDAR = "https://calendar.invalid";
      export const event = (telnyxId) => fetch(\`\${CALENDAR}/v2/events/\${telnyxId}\`);`);
    expect(result).toEqual({ requests: [], problems: [] });
  });
});

describe("names, resolved by declaration", () => {
  const bare = (body: string) => {
    const result = guard.scanFile(ts, FILE, body);
    expect(result.problems).toEqual([]);
    return result.requests.map((r) => `${r.method} ${r.path}`).sort();
  };

  it("reads the client imported under another name", () => {
    expect(
      bare(`
        import { telnyxRequest as tr } from "./telnyx/client";
        export const dial = (env) => tr(env, { method: "POST", path: "/v2/calls" });`),
    ).toEqual(["POST /v2/calls"]);
  });

  it("reads the client reached through a namespace import", () => {
    expect(
      bare(`
        import * as telnyx from "./telnyx/client";
        export const dial = (env) => telnyx.telnyxRequest(env, { method: "POST", path: "/v2/calls" });`),
    ).toEqual(["POST /v2/calls"]);
  });

  it("reads a Telnyx URL builder imported under another name", () => {
    expect(
      bare(`
        import { telnyxUrl as url } from "./telnyx/client";
        export const send = (env) => fetch(url(env, "/v2/messages"), { method: "POST" });`),
    ).toEqual(["POST /v2/messages"]);
  });

  it("keeps two locals of the same name apart", () => {
    expect(
      endpoints(`
        export async function hang(env, id) {
          const action = "hangup";
          return telnyxRequest(env, { method: "POST", path: \`/v2/calls/\${id}/actions/\${action}\` });
        }
        export async function move(env, id) {
          const action = "transfer";
          return telnyxRequest(env, { method: "POST", path: \`/v2/calls/\${id}/actions/\${action}\` });
        }`),
    ).toEqual(["POST /v2/calls/:id/actions/hangup", "POST /v2/calls/:id/actions/transfer"]);
  });

  it("still sees a Telnyx send after another function's local of the same name", () => {
    expect(
      bare(`
        import { telnyxUrl } from "./telnyx/client";
        export async function health() {
          const url = "https://status.invalid/health";
          return fetch(url);
        }
        export async function send(env) {
          const url = telnyxUrl(env, "/v2/messages").toString();
          return fetch(url, { method: "POST" });
        }`),
    ).toEqual(["POST /v2/messages"]);
  });

  it("follows a base handed to a private helper by its callers", () => {
    expect(
      bare(`
        const send = (base) => fetch(\`\${base}/v2/messages\`, { method: "POST" });
        export const go = (env) => send(env.TELNYX_API_BASE);`),
    ).toEqual(["POST /v2/messages"]);
  });

  it("reads a sub-resource a private wrapper is handed, after an id", () => {
    expect(
      endpoints(`
        async function part(env, id, sub) {
          return telnyxRequest(env, { method: "GET", path: \`/v2/phone_numbers/\${id}/\${sub}\` });
        }
        export const voice = (env, id) => part(env, id, "voice");`),
    ).toEqual(["GET /v2/phone_numbers/:id/voice"]);
  });

  it("reads a method written as a shorthand", () => {
    expect(
      bare(`
        import { telnyxUrl } from "./telnyx/client";
        export async function send(env) {
          const method = "POST";
          return fetch(telnyxUrl(env, "/v2/messages"), { method });
        }`),
    ).toEqual(["POST /v2/messages"]);
  });

  it("ignores a type that names the client", () => {
    expect(
      endpoints(`
        type Reply = ReturnType<typeof telnyxRequest>;
        export const list = (env): Reply => telnyxRequest(env, { method: "GET", path: "/v2/phone_numbers" });`),
    ).toEqual(["GET /v2/phone_numbers"]);
  });
});

describe("shapes it refuses rather than guesses at", () => {
  it("refuses an action wrapper other files can call, since their actions are unseen", () => {
    const result = scan(`
      export async function command(env, ccid, action) {
        return telnyxRequest(env, { method: "POST", path: \`/v2/calls/\${ccid}/actions/\${action}\` });
      }
      export const hang = (env, ccid) => command(env, ccid, "hangup");`);
    expect(result.requests).toEqual([]);
    expect(result.problems.join("\n")).toMatch(/"command" is exported or passed around/);
  });

  it("refuses a private wrapper handed around as a value", () => {
    const result = scan(`
      async function command(env, ccid, action) {
        return telnyxRequest(env, { method: "POST", path: \`/v2/calls/\${ccid}/actions/\${action}\` });
      }
      export const commands = { command };
      export const hang = (env, ccid) => command(env, ccid, "hangup");`);
    expect(result.problems.join("\n")).toMatch(/"command" is exported or passed around/);
  });

  it("flags a Telnyx request whose path arrives from another file", () => {
    const result = scan(`
      export async function get(env, path) {
        return telnyxRequest(env, { method: "GET", path });
      }`);
    expect(result.problems.join("\n")).toMatch(/a Telnyx request whose path this check cannot read/);
  });

  it("flags a raw fetch to a whole Telnyx URL", () => {
    const result = scan(`
      export async function send() {
        return fetch("https://api.telnyx.com/v2/messages", { method: "POST" });
      }`);
    expect(result.problems.join("\n")).toMatch(/a Telnyx request whose path this check cannot read/);
  });

  it("flags an interpolated collection, whose endpoint is unknowable", () => {
    const result = scan(`
      export async function get(env, kind) {
        return telnyxRequest(env, { method: "GET", path: \`/v2/\${kind}/x\` });
      }`);
    expect(result.problems.join("\n")).toMatch(/collection after \/v2\/ is interpolated/);
  });

  it("flags a request with no method", () => {
    const result = scan(`
      export async function get(env) {
        return telnyxRequest(env, { path: "/v2/phone_numbers" });
      }`);
    expect(result.problems.join("\n")).toMatch(/names no method/);
  });

  it("refuses the client held under another name, which would hide its calls", () => {
    for (const body of [
      `const req = telnyxRequest;
       export const dial = (env) => req(env, { method: "POST", path: "/v2/calls" });`,
      `export const deps = { telnyxRequest };`,
      `export { telnyxRequest as request };`,
    ]) {
      expect(scan(body).problems.join("\n"), body).toMatch(/telnyxRequest is used here as a value/);
    }
    const reexport = guard.scanFile(ts, FILE, `export { telnyxUpload } from "./telnyx/client";`);
    expect(reexport.problems.join("\n")).toMatch(/telnyxUpload is used here as a value/);
  });

  it("refuses a base that arrives from callers in other files", () => {
    const result = guard.scanFile(
      ts,
      FILE,
      `export const send = (base) => fetch(\`\${base}/v2/messages\`, { method: "POST" });`,
    );
    expect(result.requests).toEqual([]);
    expect(result.problems.join("\n")).toMatch(/cannot tell whether this request goes to Telnyx/);
  });

  it("refuses an interpolated sub-resource it cannot list", () => {
    const result = scan(`
      export async function part(env, id, sub) {
        return telnyxRequest(env, { method: "GET", path: \`/v2/phone_numbers/\${id}/\${sub}\` });
      }`);
    expect(result.requests).toEqual([]);
    expect(result.problems.join("\n")).toMatch(/"part" is exported or passed around/);
  });

  it("refuses a let, whose later assignments it would not see", () => {
    const result = scan(`
      async function command(env, id, early) {
        let action = "hangup";
        if (early) action = "reject";
        return telnyxRequest(env, { method: "POST", path: \`/v2/calls/\${id}/actions/\${action}\` });
      }
      export const answer = (env, id) => command(env, id, true);`);
    expect(result.problems.join("\n")).toMatch(/"action" is not a const/);
  });

  it("refuses options a spread could give a method", () => {
    const result = scan(`
      export const list = (env, options) =>
        telnyxRequest(env, { ...options, path: "/v2/phone_numbers" });`);
    expect(result.problems.join("\n")).toMatch(/a spread in the request options/);
  });

  it("refuses a Request object, whose method fetch never sees inline", () => {
    const result = guard.scanFile(
      ts,
      FILE,
      `import { telnyxUrl } from "./telnyx/client";
       export const send = (env) =>
         fetch(new Request(telnyxUrl(env, "/v2/messages"), { method: "POST" }));`,
    );
    expect(result.requests).toEqual([]);
    expect(result.problems.join("\n")).toMatch(/a Request object carries its method/);
  });
});

describe("the registry", () => {
  const registryText = readFileSync(join(REPO, guard.REGISTRY_FILE), "utf8");

  it("reads the real registry as literal entries", () => {
    const { entries, problems } = guard.readRegistry(ts, registryText);
    expect(problems).toEqual([]);
    expect(entries.length).toBeGreaterThan(40);
    for (const entry of entries) {
      expect(entry.path.startsWith("/v2/")).toBe(true);
      expect(["read", "leg-command", "dial", "message", "provisioning", "refused"]).toContain(
        entry.policy,
      );
    }
  });

  it("refuses an entry it would have to evaluate", () => {
    const { entries, problems } = guard.readRegistry(
      ts,
      `const BASE = "/v2";
       export const TELNYX_ENDPOINTS = [{ method: "GET", path: BASE + "/calls", policy: "read" }];`,
    );
    expect(entries).toEqual([]);
    expect(problems.join("\n")).toMatch(/must all be string literals/);
  });

  it("reports a registry with no array instead of an empty one", () => {
    expect(guard.readRegistry(ts, "export const OTHER = [];").problems.join("\n")).toMatch(
      /no TELNYX_ENDPOINTS array literal/,
    );
  });
});

describe("comparing calls with the registry", () => {
  const entry = (method: string, path: string, line = 1): Entry => ({
    method,
    path,
    policy: "read",
    line,
  });
  const call = (method: string, path: string): Request => ({ method, path, where: `${FILE}:9` });

  it("passes when both sides agree", () => {
    expect(guard.compare([entry("GET", "/v2/calls/:id")], [call("GET", "/v2/calls/:id")])).toEqual([]);
  });

  it("fails a call the registry does not list, naming where it is made", () => {
    const failures = guard.compare([], [call("POST", "/v2/calls")]);
    expect(failures.join("\n")).toMatch(/POST \/v2\/calls is called at apps\/api\/src\/example\.ts:9/);
  });

  it("fails an entry nothing calls any more", () => {
    const failures = guard.compare([entry("DELETE", "/v2/recordings/:id")], []);
    expect(failures.join("\n")).toMatch(/registered but nothing calls it/);
  });

  it("fails a method registered against the wrong verb", () => {
    const failures = guard.compare([entry("PUT", "/v2/calls/:id")], [call("GET", "/v2/calls/:id")]);
    expect(failures).toHaveLength(2);
  });

  it("fails a duplicate and a path not written the registry's way", () => {
    const failures = guard.compare(
      [entry("GET", "/v2/calls/:id", 1), entry("GET", "/v2/calls/:id", 2), entry("GET", "/v2/calls/{id}", 3)],
      [call("GET", "/v2/calls/:id"), call("GET", "/v2/calls/{id}")],
    );
    expect(failures.join("\n")).toMatch(/registered twice/);
    expect(failures.join("\n")).toMatch(/must be a \/v2\/ path with :id/);
  });

  it("fails an id with no collection before it, which would grant every sub-resource", () => {
    for (const path of ["/v2/phone_numbers/:id/:id", "/v2/:id"]) {
      const failures = guard.compare([entry("GET", path)], [call("GET", path)]);
      expect(failures.join("\n"), path).toMatch(/has an id with no collection before it/);
    }
  });
});

describe("coverage", () => {
  it("fails when either side read nothing, since a blind reader passes everything", () => {
    const request = { method: "GET", path: "/v2/calls/:id", where: `${FILE}:1` };
    const entry = { method: "GET", path: "/v2/calls/:id", policy: "read", line: 1 };
    expect(guard.coverage([request], [entry])).toEqual([]);
    expect(guard.coverage([], [entry]).join("\n")).toMatch(/reading nothing/);
    expect(guard.coverage([request], []).join("\n")).toMatch(/reading nothing/);
  });
});

it("runs in the CI guard job", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");
  expect(workflow).toMatch(/^\s*run: node scripts\/check-telnyx-endpoints\.mjs\s*$/m);
});
