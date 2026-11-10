/**
 * #691: deleting messages, conversations, calls and voicemails, and the Trash.
 *
 * What is pinned here:
 *   - `records.delete` gates every route; a member and a read-only observer get 403
 *     and the database is never asked.
 *   - the number deny-list (#106) rides every RPC, so a hidden number's items 404.
 *   - "Delete forever" removes the storage objects BEFORE it erases rows, and a
 *     failed removal leaves the rows alone for the next run.
 *   - a legal hold refuses the erasure.
 *   - an audit row and a webhook are written, and neither carries content.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { trashRoutes } from "./trash";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const MESSAGE_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const CONV_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const CALL_ID = "cccccccc-1111-4222-8333-444444444444";
const HIDDEN_NUMBER = "eeeeeeee-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(trashRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Rpc = Record<string, unknown>;

function world(
  role: string,
  rpc: Record<string, (args: Rpc) => unknown> = {},
  options: { removeFails?: boolean; onRemove?: (path: string) => void } = {},
) {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  for (const [name, respond] of Object.entries(rpc)) {
    sb.on("POST", `/rest/v1/rpc/${name}`, (req) => respond(req.body as Rpc));
  }
  sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
  sb.on("DELETE", /^\/storage\/v1\/object\//, (req) => {
    options.onRemove?.(req.path);
    return options.removeFails
      ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
      : [];
  });
  return sb;
}

async function call(
  sb: ReturnType<typeof world>,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
) {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(app, env, await auth.token(), `/v1${path}`, {
    method,
    companyId: COMPANY_ID,
    ...(body === undefined ? {} : { body }),
  });
}

const ROUTES: [string, "GET" | "POST" | "DELETE", string, unknown?][] = [
  ["delete a message", "DELETE", `/messages/${MESSAGE_ID}`],
  ["delete a conversation", "DELETE", `/conversations/${CONV_ID}`],
  ["bulk delete", "POST", "/conversations/delete", { ids: [CONV_ID] }],
  ["delete a call", "DELETE", `/calls/${CALL_ID}`],
  ["delete a voicemail", "DELETE", `/calls/${CALL_ID}/voicemail`],
  ["list the trash", "GET", "/trash"],
  ["restore", "POST", "/trash/restore", { kind: "message", id: MESSAGE_ID }],
  ["delete forever", "DELETE", `/trash/message/${MESSAGE_ID}`],
];

describe("#691 records.delete gates every route", () => {
  it.each(["member", "read_only", "bookkeeper"])(
    "refuses a %s on all of them without asking the database",
    async (role) => {
      for (const [label, method, path, body] of ROUTES) {
        const sb = world(role);
        const res = await call(sb, method, path, body);
        expect(res.status, `${role}: ${label}`).toBe(403);
        const rpcs = sb.calls.filter(
          (c) =>
            c.path.startsWith("/rest/v1/rpc/") &&
            !c.path.endsWith("api_authorize_request") &&
            !c.path.endsWith("member_number_levels"),
        );
        expect(rpcs, `${role}: ${label} reached the database`).toHaveLength(0);
      }
    },
  );

  it.each(["admin", "owner"])("lets an %s through", async (role) => {
    const sb = world(role, {
      api_trash_message: () => ({ outcome: "trashed", conversation_id: CONV_ID, direction: "outbound" }),
    });
    const res = await call(sb, "DELETE", `/messages/${MESSAGE_ID}`);
    expect(res.status).toBe(200);
  });
});

describe("#691 delete", () => {
  it("trashes a message, audits it without content and tells subscribers by id", async () => {
    const sb = world("admin", {
      api_trash_message: () => ({
        outcome: "trashed",
        conversation_id: CONV_ID,
        direction: "outbound",
      }),
    });
    sb.on("GET", "/rest/v1/webhook_endpoints", () => [{ id: "e1" }]);
    sb.on("POST", "/rest/v1/webhook_deliveries", () => new Response(null, { status: 201 }));
    const res = await call(sb, "DELETE", `/messages/${MESSAGE_ID}`);
    expect(res.status).toBe(200);

    const rpc = sb.find("POST", "/rest/v1/rpc/api_trash_message")[0];
    expect(rpc.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_message_id: MESSAGE_ID,
    });

    const audit = sb.find("POST", "/rest/v1/audit_log")[0]?.body as Record<string, unknown>;
    expect(audit).toMatchObject({
      action: "record.deleted",
      target_type: "message",
      target_id: MESSAGE_ID,
      company_id: COMPANY_ID,
    });
    expect(JSON.stringify(audit)).not.toMatch(/"body"/);
  });

  it("is a 404 when the database finds nothing to trash", async () => {
    const sb = world("admin", { api_trash_message: () => ({ outcome: "not_found" }) });
    expect((await call(sb, "DELETE", `/messages/${MESSAGE_ID}`)).status).toBe(404);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(0);
  });

  it("passes a restricted member's hidden numbers into the SQL", async () => {
    const sb = world("admin", {
      api_trash_conversations: () => ({ trashed: [], calls: 0 }),
    });
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN_NUMBER, level: "none" },
    ]);
    const res = await call(sb, "DELETE", `/conversations/${CONV_ID}`);
    expect(res.status).toBe(404);
  });

  it("trashes a conversation, and a bulk selection one audit row each", async () => {
    const other = "dddddddd-1111-4222-8333-444444444444";
    const sb = world("admin", {
      api_trash_conversations: (args) => ({ trashed: args.p_ids, calls: 0 }),
    });
    const res = await call(sb, "POST", "/conversations/delete", {
      ids: [CONV_ID, other, CONV_ID],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: [CONV_ID, other] });
    const rpc = sb.find("POST", "/rest/v1/rpc/api_trash_conversations")[0];
    expect((rpc.body as { p_ids: string[] }).p_ids).toEqual([CONV_ID, other]);
    expect(sb.find("POST", "/rest/v1/audit_log")).toHaveLength(2);
  });

  it("refuses a bulk delete of nothing or of too many", async () => {
    const sb = world("admin");
    expect((await call(sb, "POST", "/conversations/delete", { ids: [] })).status).toBe(422);
    const many = Array.from({ length: 101 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect((await call(sb, "POST", "/conversations/delete", { ids: many })).status).toBe(422);
  });

  it("deletes a call and a voicemail alone through the same function", async () => {
    const sb = world("admin", { api_trash_call: () => ({ outcome: "trashed" }) });
    expect((await call(sb, "DELETE", `/calls/${CALL_ID}`)).status).toBe(200);
    expect((await call(sb, "DELETE", `/calls/${CALL_ID}/voicemail`)).status).toBe(200);
    const bodies = sb
      .find("POST", "/rest/v1/rpc/api_trash_call")
      .map((c) => (c.body as { p_voicemail_only: boolean }).p_voicemail_only);
    expect(bodies).toEqual([false, true]);
  });
});

describe("#691 trash, restore, delete forever", () => {
  it("lists the trash as a page", async () => {
    const rows = [
      { kind: "conversation", id: CONV_ID, deleted_at: "2026-11-10T10:00:00Z" },
    ];
    const sb = world("admin", { api_list_trash: () => rows });
    const res = await call(sb, "GET", "/trash");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: rows, next_cursor: null });
  });

  it("restores, and says so when the conversation is still in the trash", async () => {
    let outcome = "restored";
    const sb = world("admin", { api_restore_trash: () => ({ outcome }) });
    expect(
      (await call(sb, "POST", "/trash/restore", { kind: "message", id: MESSAGE_ID })).status,
    ).toBe(200);
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "record.restored",
    });

    outcome = "conversation_trashed";
    expect(
      (await call(sb, "POST", "/trash/restore", { kind: "message", id: MESSAGE_ID })).status,
    ).toBe(409);

    outcome = "not_found";
    expect(
      (await call(sb, "POST", "/trash/restore", { kind: "call", id: CALL_ID })).status,
    ).toBe(404);
  });

  it("refuses an unknown kind", async () => {
    const sb = world("admin");
    expect(
      (await call(sb, "POST", "/trash/restore", { kind: "contact", id: MESSAGE_ID })).status,
    ).toBe(422);
    expect((await call(sb, "DELETE", `/trash/contact/${MESSAGE_ID}`)).status).toBe(422);
  });

  it("removes the objects first, then the rows, scoped to the caller", async () => {
    const order: string[] = [];
    const sb = world(
      "admin",
      {
        api_trash_object_paths: () => [
          { bucket: "mms-media", path: "co/msg/0" },
          { bucket: "attachments", path: "co/note/1-file.pdf" },
        ],
        api_purge_trash_item: () => {
          order.push("rows");
          return { outcome: "purged", company_id: COMPANY_ID };
        },
      },
      { onRemove: (path) => order.push(`remove ${path.split("/").pop()}`) },
    );
    const res = await call(sb, "DELETE", `/trash/conversation/${CONV_ID}`);
    expect(res.status).toBe(204);
    expect(order).toEqual(["remove mms-media", "remove attachments", "rows"]);
    const purge = sb.find("POST", "/rest/v1/rpc/api_purge_trash_item")[0].body;
    expect(purge).toMatchObject({
      p_kind: "conversation",
      p_id: CONV_ID,
      p_actor: auth.subject,
      p_company_id: COMPANY_ID,
    });
  });

  it("leaves the rows alone when an object will not go", async () => {
    const sb = world(
      "admin",
      {
        api_trash_object_paths: () => [{ bucket: "voicemails", path: "co/vm.mp3" }],
        api_purge_trash_item: () => ({ outcome: "purged", company_id: COMPANY_ID }),
      },
      { removeFails: true },
    );
    const res = await call(sb, "DELETE", `/trash/voicemail/${CALL_ID}`);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(sb.find("POST", "/rest/v1/rpc/api_purge_trash_item")).toHaveLength(0);
  });

  it("is a 409 under a legal hold and a 404 for something not in the trash", async () => {
    let outcome = "legal_hold";
    const sb = world("admin", {
      api_trash_object_paths: () => [],
      api_purge_trash_item: () => ({ outcome }),
    });
    expect((await call(sb, "DELETE", `/trash/call/${CALL_ID}`)).status).toBe(409);
    outcome = "not_found";
    expect((await call(sb, "DELETE", `/trash/call/${CALL_ID}`)).status).toBe(404);
  });
});
