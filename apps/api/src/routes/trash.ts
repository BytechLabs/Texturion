/**
 * #691 — deleting a message, a conversation, a call or a voicemail, and the
 * workspace Trash that holds them for 30 days.
 *
 * Every route here asks for `records.delete`: owner and admin by default, never a
 * member. Deleting is a soft move into the Trash: the item is hidden from every
 * read path at once and restorable until the daily job (or "Delete forever")
 * erases it. The #106 number-access list is applied INSIDE the SQL, so a member
 * who cannot see a number can neither delete nor restore anything on it.
 *
 * What does NOT happen here, deliberately:
 *   - Opt-outs are keyed on (company, phone) and are never read or written, so a
 *     STOP survives deleting its thread and its contact.
 *   - Usage, segment counts and call records are never touched; delete hides
 *     content, it does not change the meter.
 *   - A text already sent cannot be unsent. The clients say so; the API cannot.
 *
 * Audit events carry ids and kinds, never content.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import { purgeTrashItem } from "../trash/purge";
import { enqueueWebhookEvent } from "../webhooks/outbound";
import {
  parseCursor,
  parseJsonBody,
  parseLimit,
  parseWith,
  pathUuid,
  unwrap,
} from "./core/http";

export const trashRoutes = new Hono<AppEnv>();

const MAX_BULK_DELETE = 100;

const kindSchema = z.enum(["message", "conversation", "call", "voicemail"]);

const restoreSchema = z.object({ kind: kindSchema, id: z.uuid() });

const bulkDeleteSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_BULK_DELETE),
});

type Ctx = Context<AppEnv>;

async function whoIs(c: Ctx) {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
  });
  return {
    db,
    companyId,
    userId: c.get("userId"),
    hidden: access.hiddenNumberIds,
  };
}

/** DELETE /v1/messages/:id — one message or internal note into the Trash. */
trashRoutes.delete(
  "/messages/:id",
  requireCapability("records.delete"),
  async (c) => {
    const id = pathUuid(c, "id");
    const who = await whoIs(c);

    const result = unwrap<{
      outcome: string;
      conversation_id?: string;
      direction?: string;
    }>(
      await who.db.rpc("api_trash_message", {
        p_company_id: who.companyId,
        p_user_id: who.userId,
        p_message_id: id,
        p_hidden_number_ids: who.hidden,
      }),
      "message trash",
    );
    if (result.outcome !== "trashed") {
      return errorResponse(c, "not_found", "No such message.");
    }

    await recordAuditFromRequest(who.db, c, {
      companyId: who.companyId,
      action: "record.deleted",
      targetType: "message",
      targetId: id,
      after: { direction: result.direction ?? null },
    });
    await enqueueWebhookEvent(who.db, {
      companyId: who.companyId,
      type: "message.deleted",
      data: { id, conversation_id: result.conversation_id ?? null },
    });
    return c.json({ kind: "message", id });
  },
);

async function trashConversations(c: Ctx, ids: string[]): Promise<string[]> {
  const who = await whoIs(c);
  const result = unwrap<{ trashed: string[]; calls: number }>(
    await who.db.rpc("api_trash_conversations", {
      p_company_id: who.companyId,
      p_user_id: who.userId,
      p_ids: ids,
      p_hidden_number_ids: who.hidden,
    }),
    "conversation trash",
  );
  const trashed = result.trashed ?? [];
  await Promise.all(
    trashed.flatMap((id) => [
      recordAuditFromRequest(who.db, c, {
        companyId: who.companyId,
        action: "record.deleted",
        targetType: "conversation",
        targetId: id,
        after: { bulk: ids.length > 1 },
      }),
      enqueueWebhookEvent(who.db, {
        companyId: who.companyId,
        type: "conversation.deleted",
        data: { id },
      }),
    ]),
  );
  return trashed;
}

/** DELETE /v1/conversations/:id — a whole thread, and its calls, into the Trash. */
trashRoutes.delete(
  "/conversations/:id",
  requireCapability("records.delete"),
  async (c) => {
    const id = pathUuid(c, "id");
    const trashed = await trashConversations(c, [id]);
    if (trashed.length === 0) {
      return errorResponse(c, "not_found", "No such conversation.");
    }
    return c.json({ kind: "conversation", id });
  },
);

/**
 * POST /v1/conversations/delete — the inbox's bulk select. A POST with ids and not
 * a DELETE with a body, because proxies and several HTTP clients drop DELETE
 * bodies. Ids only: there is no "delete everything matching this filter".
 */
trashRoutes.post(
  "/conversations/delete",
  requireCapability("records.delete"),
  async (c) => {
    const body = await parseJsonBody(c, bulkDeleteSchema);
    const trashed = await trashConversations(c, [...new Set(body.ids)]);
    return c.json({ deleted: trashed });
  },
);

async function trashCall(c: Ctx, id: string, voicemailOnly: boolean) {
  const who = await whoIs(c);
  const result = unwrap<{ outcome: string }>(
    await who.db.rpc("api_trash_call", {
      p_company_id: who.companyId,
      p_user_id: who.userId,
      p_call_id: id,
      p_voicemail_only: voicemailOnly,
      p_hidden_number_ids: who.hidden,
    }),
    "call trash",
  );
  if (result.outcome !== "trashed") return false;
  await recordAuditFromRequest(who.db, c, {
    companyId: who.companyId,
    action: "record.deleted",
    targetType: voicemailOnly ? "voicemail" : "call",
    targetId: id,
  });
  await enqueueWebhookEvent(who.db, {
    companyId: who.companyId,
    type: "call.deleted",
    data: { id, voicemail_only: voicemailOnly },
  });
  return true;
}

/** DELETE /v1/calls/:id/voicemail — the recording and its words, not the call. */
trashRoutes.delete(
  "/calls/:id/voicemail",
  requireCapability("records.delete"),
  async (c) => {
    const id = pathUuid(c, "id");
    if (!(await trashCall(c, id, true))) {
      return errorResponse(c, "not_found", "No voicemail on this call.");
    }
    return c.json({ kind: "voicemail", id });
  },
);

/** DELETE /v1/calls/:id — a call-log entry, with its voicemail. */
trashRoutes.delete(
  "/calls/:id",
  requireCapability("records.delete"),
  async (c) => {
    const id = pathUuid(c, "id");
    if (!(await trashCall(c, id, false))) {
      return errorResponse(c, "not_found", "No such call.");
    }
    return c.json({ kind: "call", id });
  },
);

/** GET /v1/trash — what is in the Trash, newest deletion first. */
trashRoutes.get("/trash", requireCapability("records.delete"), async (c) => {
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);
  const who = await whoIs(c);

  const rows = unwrap<({ id: string; deleted_at: string } & Record<string, unknown>)[]>(
    await who.db.rpc("api_list_trash", {
      p_company_id: who.companyId,
      p_limit: limit + 1,
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_hidden_number_ids: who.hidden,
    }),
    "trash list",
  );
  return c.json(buildPage(rows, limit, "deleted_at"));
});

/** POST /v1/trash/restore — put one item back. */
trashRoutes.post(
  "/trash/restore",
  requireCapability("records.delete"),
  async (c) => {
    const body = await parseJsonBody(c, restoreSchema);
    const who = await whoIs(c);

    const result = unwrap<{ outcome: string }>(
      await who.db.rpc("api_restore_trash", {
        p_company_id: who.companyId,
        p_user_id: who.userId,
        p_kind: body.kind,
        p_id: body.id,
        p_hidden_number_ids: who.hidden,
      }),
      "trash restore",
    );
    if (result.outcome === "conversation_trashed") {
      throw new ApiError(
        "conflict",
        "Its conversation is in the Trash. Restore the conversation first.",
      );
    }
    if (result.outcome !== "restored") {
      return errorResponse(c, "not_found", "That item is not in the Trash.");
    }
    await recordAuditFromRequest(who.db, c, {
      companyId: who.companyId,
      action: "record.restored",
      targetType: body.kind,
      targetId: body.id,
    });
    return c.json({ kind: body.kind, id: body.id });
  },
);

/** DELETE /v1/trash/:kind/:id — Delete forever. Reaches only what is in the Trash. */
trashRoutes.delete(
  "/trash/:kind/:id",
  requireCapability("records.delete"),
  async (c) => {
    const kind = parseWith(kindSchema, c.req.param("kind"));
    const id = pathUuid(c, "id");
    const who = await whoIs(c);

    const result = await purgeTrashItem(who.db, kind, id, who.userId, {
      companyId: who.companyId,
      hiddenNumberIds: who.hidden,
    });
    if (result.outcome === "legal_hold") {
      throw new ApiError(
        "conflict",
        "This workspace is under a legal hold, so nothing can be erased yet.",
      );
    }
    if (result.outcome !== "purged") {
      return errorResponse(c, "not_found", "That item is not in the Trash.");
    }
    return c.body(null, 204);
  },
);
