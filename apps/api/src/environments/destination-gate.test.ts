/**
 * D142: every send and dial site asks the destination gate.
 *
 * The gate lives in two places. `telnyxRequest` asks it for every request
 * that names somebody to call or text, so a site that goes through the client
 * (directly or through a leg-command wrapper) is covered. A site that calls
 * `fetch` itself must ask `outboundDestinationRefusal` on its own, before the
 * fetch.
 *
 * This census finds every site by the Telnyx path it sends to and decides
 * which of the two it is. It also fails on finding no sites at all, since a
 * census that matched nothing would pass by not looking. A census reads text,
 * so each direct site also has a test below proving its refusal stops the
 * fetch.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { getEnv, type Bindings } from "../env";
import { dispatchOutbound, sendSystemText } from "../messaging/send";
import { runInboundCanaryJob } from "../observability/inbound-canary";
import { TELNYX_ENDPOINTS } from "../telnyx/endpoints";
import { attachHostedOrderDocuments } from "../telnyx/text-enablement";
import { telnyxDestinations } from "../telnyx/client";
import { messageRow, restMatch, stubRoute } from "../test/messaging-support";
import {
  OWNED_A,
  OWNED_B,
  RIG_SUPABASE_URL,
  RIG_TELNYX_API_BASE,
  rigEnv,
  STRANGER,
} from "../test/rig-env";
import { supabaseStub } from "../test/routes-harness";
import { productionSources, sourceText, stripComments } from "../test/source-tree";
import { clearedFor, completeEnv, stubFetch } from "../test/support";
import { RIG_DESTINATION_REFUSED, telnyxRequestRefusal } from "./policy";

const API_SRC = join(import.meta.dirname, "..");

/** A Telnyx path that makes Telnyx call or text somebody. */
const SITE_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "dial", pattern: /(["'`])\/v2\/calls\1/g },
  {
    kind: "leg action",
    pattern: /`\/v2\/calls\/\$\{[^}]+\}\/actions\/(?:transfer|refer|\$\{[^}]+\})`/g,
  },
  { kind: "text", pattern: /(["'`])\/v2\/messages(?:\/[\w-]+)?\1/g },
  { kind: "verification code", pattern: /(["'`])\/v2\/[^"'`\s]*\/verification_codes\1/g },
];

const NOT_A_SITE: Record<string, string> = {
  "telnyx/client.ts": "holds the gate and the classifier the gate uses",
  "telnyx/endpoints.ts": "the endpoint registry is data the guard is generated from; it sends nothing",
};

/**
 * Helpers that take a path and hand it to `telnyxRequest`. Each is checked
 * below to really be that and nothing more, or a wrapper that called `fetch`
 * would be counted as covered.
 */
const CLIENT_WRAPPERS = ["telnyxOnLiveLeg", "onLiveLeg", "swallow4xx"];
const CLIENT_CALLS = ["telnyxRequest", ...CLIENT_WRAPPERS];
const OPENER = new RegExp(
  `\\b(fetch|telnyxUpload|${CLIENT_CALLS.join("|")})\\s*(?:<[^>(]*>)?\\s*\\(`,
  "g",
);

type Route = "client" | "direct" | "upload" | "unclassified";

interface Site {
  file: string;
  line: number;
  kind: string;
  path: string;
  route: Route;
  /** For a direct site: the gate is asked inside the same function, earlier. */
  gated: boolean;
}

function relativeName(path: string): string {
  return path.slice(API_SRC.length + 1).replaceAll("\\", "/");
}

function productionCode(): Array<[string, string]> {
  return productionSources(API_SRC)
    .map((path) => [relativeName(path), path] as const)
    .filter(([name]) => !/^test\/|test-support\.ts$/.test(name))
    .map(([name, path]) => [name, stripComments(sourceText(path))]);
}

/** Whether the call opened at `open` (the index of its `(`) is still open at `at`. */
function stillOpen(code: string, open: number, at: number): boolean {
  let depth = 0;
  for (let i = open; i < at; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") depth -= 1;
    if (depth === 0) return false;
  }
  return depth > 0;
}

function routeOf(code: string, at: number): Route {
  let route: Route = "unclassified";
  for (const match of code.slice(0, at).matchAll(OPENER)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (!stillOpen(code, open, at)) continue;
    const name = match[1];
    route = name === "fetch" ? "direct" : name === "telnyxUpload" ? "upload" : "client";
  }
  return route;
}

function enclosingFunctionPrefix(code: string, at: number): string {
  const head = code.slice(0, at);
  const start = Math.max(head.lastIndexOf("function "), head.lastIndexOf("=> {"));
  return start === -1 ? head : head.slice(start);
}

function census(): Site[] {
  const sites: Site[] = [];
  for (const [file, code] of productionCode()) {
    if (file in NOT_A_SITE) continue;
    for (const { kind, pattern } of SITE_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const at = match.index ?? 0;
        const route = routeOf(code, at);
        sites.push({
          file,
          line: code.slice(0, at).split("\n").length,
          kind,
          path: match[0].slice(1, -1),
          route,
          gated:
            route === "direct" &&
            /\boutboundDestinationRefusal\s*\(/.test(enclosingFunctionPrefix(code, at)),
        });
      }
    }
  }
  return sites;
}

const where = (site: Site) => `${site.file}:${site.line} (${site.kind} ${site.path})`;

describe("the destination gate census", () => {
  const sites = census();

  it("finds the send and dial sites it exists to check", () => {
    expect(sites.filter((site) => site.route === "client").length).toBeGreaterThanOrEqual(5);
    expect(sites.filter((site) => site.route === "direct").length).toBeGreaterThanOrEqual(1);
    expect(new Set(sites.map((site) => site.kind))).toEqual(
      new Set(SITE_PATTERNS.map((entry) => entry.kind)),
    );
  });

  it("finds every site going through the client or a direct fetch", () => {
    expect(
      sites.filter((site) => site.route === "unclassified" || site.route === "upload").map(where),
    ).toEqual([]);
  });

  it("finds every direct fetch asking the gate before it sends", () => {
    expect(sites.filter((site) => site.route === "direct" && !site.gated).map(where)).toEqual(
      [],
    );
  });

  it("finds the client asking the gate before its fetch", () => {
    const client = stripComments(sourceText(join(API_SRC, "telnyx/client.ts")));
    const request = client.slice(client.indexOf("export async function telnyxRequest"));
    const gate = request.search(/\boutboundDestinationRefusal\s*\(/);
    const send = request.search(/\bfetch\s*\(/);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(send);
  });

  it("finds each wrapper to be nothing but a call to telnyxRequest", () => {
    const files = productionCode();
    for (const name of CLIENT_WRAPPERS) {
      const bodies = files.flatMap(([, code]) =>
        [...code.matchAll(new RegExp(`function ${name}\\s*\\(`, "g"))].map((match) => {
          const start = match.index ?? 0;
          const end = code.indexOf("\n}\n", start);
          return code.slice(start, end === -1 ? undefined : end);
        }),
      );
      expect(bodies.length, name).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body, name).toMatch(/\btelnyxRequest\s*\(/);
        expect(body, name).not.toMatch(/\bfetch\s*\(/);
      }
    }
  });

  it("finds the client's classifier naming a destination for every site's path", () => {
    for (const site of sites.filter((entry) => entry.route === "client")) {
      const path = site.path.replace(/\$\{[^}]+\}/g, "transfer");
      expect(
        telnyxDestinations({
          method: "POST",
          path,
          body: { to: "+14165550199", phone_numbers: ["+14165550199"] },
        }),
        where(site),
      ).toContain("+14165550199");
    }
  });
});

/**
 * The census finds sites by path, so a destination-bearing endpoint it has no
 * pattern for would go unseen. The endpoint registry is kept equal to the
 * code's Telnyx calls by `scripts/check-telnyx-endpoints.mjs`, so tying the
 * classifier to it closes that gap: a new dial or message endpoint must be one
 * the gate can read a destination from, or be named here as carrying none.
 */
const CARRIES_NO_DESTINATION: Record<string, string> = {
  "POST /v2/calls/:id/actions/bridge":
    "joins two legs that already exist; both were judged when they were dialled",
};

describe("the client's classifier and the endpoint registry", () => {
  const destinationBearing = TELNYX_ENDPOINTS.filter(
    (endpoint) =>
      endpoint.policy === "dial" ||
      endpoint.policy === "message" ||
      endpoint.path.endsWith("/verification_codes"),
  );

  it("covers every endpoint that calls or texts somebody", () => {
    expect(destinationBearing.length).toBeGreaterThanOrEqual(4);
    const unread = destinationBearing
      .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
      .filter((key) => !(key in CARRIES_NO_DESTINATION))
      .filter((key) => {
        const [method, path] = key.split(" ");
        return !telnyxDestinations({
          method,
          path: path.replaceAll(":id", "x"),
          body: { to: "+14165550199", phone_numbers: ["+14165550199"] },
        }).includes("+14165550199");
      });
    expect(unread).toEqual([]);
  });

  it("names no exception the registry no longer has", () => {
    const keys = new Set(TELNYX_ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    for (const key of Object.keys(CARRIES_NO_DESTINATION)) expect(keys).toContain(key);
  });

  // The refused class texts people too (a sole proprietor's OTP goes to a
  // mobile the request does not carry), so rather than read destinations from
  // it, the rig refuses the whole class before a request exists.
  it("refuses on the rig every endpoint the guard never forwards, and no other", () => {
    const rig = getEnv(rigEnv());
    const refused = TELNYX_ENDPOINTS.filter((endpoint) => endpoint.policy === "refused");
    expect(refused.length).toBeGreaterThanOrEqual(10);
    const mismatched = TELNYX_ENDPOINTS.filter(
      (endpoint) =>
        (telnyxRequestRefusal(rig, { path: endpoint.path.replaceAll(":id", "x") }) !== null) !==
        (endpoint.policy === "refused"),
    ).map((endpoint) => `${endpoint.method} ${endpoint.path} (${endpoint.policy})`);
    expect(mismatched).toEqual([]);
  });
});

describe("a direct send site, behaving", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function recordTelnyx(): string[] {
    const sent: string[] = [];
    stubFetch((url) => {
      sent.push(url.href);
      return Response.json({ data: { id: "msg-1" } });
    });
    return sent;
  }

  const text = (to: string) => ({
    from: OWNED_A,
    to,
    text: "code 123456",
    clearance: clearedFor(to),
    idempotencyKey: `k-${to}`,
  });

  it("fails a rig text to a stranger with the gate's code, and sends nothing", async () => {
    const sent = recordTelnyx();
    const result = await sendSystemText(getEnv(rigEnv()), text(STRANGER));
    expect(result).toMatchObject({ ok: false, errorCode: RIG_DESTINATION_REFUSED });
    expect(sent).toEqual([]);
  });

  it("sends a rig text to the partition through the guard", async () => {
    const sent = recordTelnyx();
    const result = await sendSystemText(getEnv(rigEnv()), text(OWNED_B));
    expect(result).toEqual({ ok: true, telnyxMessageId: "msg-1" });
    expect(sent).toEqual([`${RIG_TELNYX_API_BASE}/v2/messages`]);
  });

  it("sends to anybody outside the rig", async () => {
    const sent = recordTelnyx();
    const result = await sendSystemText(getEnv(completeEnv()), text(STRANGER));
    expect(result).toEqual({ ok: true, telnyxMessageId: "msg-1" });
    expect(sent).toEqual(["https://api.telnyx.com/v2/messages"]);
  });
});

/**
 * The hosted-number document attach downloads and uploads files, so it fetches
 * Telnyx directly rather than through telnyxRequest, and asks the account-wide
 * refusal itself.
 */
describe("an account-wide raw fetch, behaving", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const order = {
    telnyx_hosted_order_id: "hno-1",
    telnyx_loa_document_id: "doc-loa",
    telnyx_bill_document_id: "doc-bill",
  } as never;

  it("is refused on the rig before anything is fetched", async () => {
    const sent: string[] = [];
    stubFetch((url) => {
      sent.push(url.href);
      return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
    });
    await expect(attachHostedOrderDocuments(getEnv(rigEnv()), order)).rejects.toMatchObject({
      status: 403,
    });
    expect(sent).toEqual([]);
  });

  it("still downloads and uploads outside the rig", async () => {
    const sent: string[] = [];
    stubFetch((url) => {
      sent.push(url.pathname);
      return url.pathname.endsWith("/download")
        ? new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })
        : Response.json({ data: { id: "hno-1" } });
    });
    await attachHostedOrderDocuments(getEnv(completeEnv()), order);
    expect([...sent].sort()).toEqual([
      "/v2/documents/doc-bill/download",
      "/v2/documents/doc-loa/download",
      "/v2/messaging_hosted_number_orders/hno-1/actions/file_upload",
    ]);
  });
});

describe("the inbound canary, behaving", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function canary(to: string) {
    const env = getEnv(rigEnv({ CANARY_FROM_E164: OWNED_A, CANARY_TO_E164: to }));
    const sb = supabaseStub(env);
    // Owned either way: the rig's stranger is a number it owns but keeps off
    // its allowlist, so ownership alone must not be enough to text it.
    sb.on("GET", "/rest/v1/phone_numbers", () => [{ id: "num-1" }]);
    sb.on("POST", "/rest/v1/rpc/inbound_canary_unanswered", () => 0);
    sb.on("POST", "/rest/v1/rpc/confirm_inbound_canary", () => ({ confirmed: null, pending: false }));
    sb.on("POST", "/rest/v1/inbound_canary_runs", () => []);
    sb.on("PATCH", "/rest/v1/inbound_canary_runs", () => []);
    const telnyx: string[] = [];
    stubFetch(sb.route, (url) => {
      if (url.origin === RIG_SUPABASE_URL) return undefined;
      telnyx.push(url.href);
      return Response.json({ data: { id: "msg-1" } });
    });
    return { env, sb, telnyx };
  }

  it("records a failed send to a number off the allowlist, and sends nothing", async () => {
    const { env, sb, telnyx } = canary(STRANGER);
    const result = await runInboundCanaryJob(env, new Date());
    expect(result).toMatchObject({
      status: "send-failed",
      detail: expect.stringMatching(/RIG_OWNED_E164/),
    });
    expect(telnyx).toEqual([]);
    expect(sb.find("PATCH", "/rest/v1/inbound_canary_runs")).toHaveLength(1);
  });

  it("texts the partition's own number through the guard", async () => {
    const { env, telnyx } = canary(OWNED_B);
    const result = await runInboundCanaryJob(env, new Date());
    expect(result).toMatchObject({ status: "sent" });
    expect(telnyx).toEqual([`${RIG_TELNYX_API_BASE}/v2/messages`]);
  });
});

/**
 * The customer send path calls `fetch` itself, so the client's media seam
 * never sees its body: send.ts applies it, and this is what proves it does.
 */
describe("a customer picture message, behaving", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sendPicture(bindings: Bindings, to: string, mediaUrl: string) {
    const env = getEnv(bindings);
    const telnyx = stubRoute(
      (url, request) => request.method === "POST" && url.pathname.endsWith("/v2/messages"),
      () => ({ data: { id: "msg-1" } }),
    );
    // What Telnyx was handed is the whole question, so the tail stops at the
    // persist rather than stubbing the analytics and webhook follow-ups.
    const persist = stubRoute(restMatch(env, "PATCH", "messages"), () => []);
    stubFetch(telnyx.route, persist.route);
    await expect(
      dispatchOutbound(env, getDb(env), messageRow(), {
        from: OWNED_A,
        to,
        text: "the photo",
        mediaUrls: [mediaUrl],
        clearance: clearedFor(to),
      }),
    ).rejects.toThrow(/vanished during send/);
    expect(telnyx.calls).toHaveLength(1);
    return telnyx.calls[0];
  }

  it("hands Telnyx the edge's media path on the rig, never the rig's own storage", async () => {
    const call = await sendPicture(
      rigEnv({ TELNYX_MEDIA_PUBLIC_BASE: "https://edge.rig.internal/m" }),
      OWNED_B,
      `${RIG_SUPABASE_URL}/storage/v1/object/sign/mms/a.jpg?token=t`,
    );
    expect(call.url.href).toBe(`${RIG_TELNYX_API_BASE}/v2/messages`);
    expect(call.body).toMatchObject({
      media_urls: ["https://edge.rig.internal/m/object/sign/mms/a.jpg?token=t"],
    });
  });

  it("hands Telnyx production's signed URL untouched", async () => {
    const bindings = { ...completeEnv(), DEPLOY_ENV: "production" };
    const signed = `${getEnv(bindings).SUPABASE_URL}/storage/v1/object/sign/mms/a.jpg?token=t`;
    const call = await sendPicture(bindings, STRANGER, signed);
    expect(call.url.href).toBe("https://api.telnyx.com/v2/messages");
    expect(call.body).toMatchObject({ media_urls: [signed] });
  });
});
