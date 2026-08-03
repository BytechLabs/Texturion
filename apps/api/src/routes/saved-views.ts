/**
 * #280 — saved views.
 *
 *   GET    /v1/saved-views?surface=            every view this member may see,
 *          in order, with which one they land on.
 *   POST   /v1/saved-views                     { surface, name, filters, shared? }
 *   PATCH  /v1/saved-views/:id                 { name?, filters?, shared? }
 *   DELETE /v1/saved-views/:id
 *   POST   /v1/saved-views/reorder             { surface, ids[] }
 *   PUT    /v1/saved-views/default             { surface, view_id | null }
 *   GET    /v1/saved-views/counts?surface=&ids= bounded queue badges.
 *
 * ---------------------------------------------------------------------------
 * A VIEW IS A QUERY, WHICH IS WHAT MAKES A SHARED ONE SAFE
 *
 * #280 names the trap: "a shared view resolves per viewer, and must never
 * reveal the existence of conversations on numbers that viewer cannot see. A
 * shared view is a query, not a permission grant."
 *
 * Nothing here reads a conversation. A view stores filter parameters; opening
 * one replays them through the ordinary list endpoint, where #106's
 * number-access filtering already lives. The counts endpoint is the one place
 * that could have cheated by counting rows directly, and it does not — it calls
 * the same `api_list_conversations` the list does, with the same caller, so a
 * badge can never be larger than the list it labels.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY DO WHAT
 *
 * A PERSONAL view is read-side convenience: anybody who can see the inbox can
 * keep their own filters, `read_only` included. That is the point of the role.
 *
 * A SHARED view is workspace configuration — it is how an owner encodes the
 * crew's process — so creating, editing or deleting one needs
 * `settings.manage`. The check is in the handler rather than the middleware
 * because which capability applies depends on the body.
 */
import {
  SAVED_VIEW_COUNT_MAX_VIEWS,
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SURFACES,
  filtersToQuery,
  resolveAssignee,
  sanitizeFilters,
  type SavedViewSurface,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";
import { roleHasCapability } from "@loonext/shared";

const VIEW_COLUMNS =
  "id,surface,name,filters,position,owner_user_id,created_by,created_at,updated_at";

/** The count ceiling, +1 so the route can tell "at the ceiling" from "past it". */
const COUNT_PROBE_LIMIT = 100;

interface ViewRow {
  id: string;
  surface: SavedViewSurface;
  name: string;
  filters: unknown;
  position: number;
  owner_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const surfaceSchema = z.enum(SAVED_VIEW_SURFACES);

const createSchema = z.object({
  surface: surfaceSchema,
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX),
  // Unknown keys are DROPPED by sanitizeFilters rather than rejected here: a
  // client one release ahead sending a filter this deploy does not know should
  // save the view it can, not fail.
  filters: z.record(z.string(), z.unknown()).optional(),
  shared: z.boolean().optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    shared: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.filters !== undefined ||
      body.shared !== undefined,
    { message: "Provide at least one field to update." },
  );

const reorderSchema = z.object({
  surface: surfaceSchema,
  // Bounded at the per-surface cap: a reorder is a rewrite of one list, and an
  // unbounded id array is an unbounded UPDATE.
  ids: z.array(z.uuid()).min(1).max(80),
});

const defaultSchema = z.object({
  surface: surfaceSchema,
  view_id: z.uuid().nullable(),
});

/** The membership column that holds this surface's landing view. */
function defaultColumn(surface: SavedViewSurface): string {
  return surface === "conversations"
    ? "default_conversation_view_id"
    : "default_task_view_id";
}

/** Shape a row for the client, with its filters sanitised on the way out. */
function toClient(row: ViewRow) {
  return {
    id: row.id,
    surface: row.surface,
    name: row.name,
    // Sanitised on READ as well as write. A row stored before a filter was
    // renamed replays into a 422 otherwise, on a screen the person cannot fix.
    filters: sanitizeFilters(row.surface, row.filters),
    position: row.position,
    shared: row.owner_user_id === null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const savedViewsRoutes = new Hono<AppEnv>();

savedViewsRoutes.get(
  "/saved-views",
  requireCapability("conversations.read"),
  async (c) => {
    const surface = surfaceSchema.safeParse(c.req.query("surface"));
    const db = getDb(getEnv(c.env));
    const userId = c.get("userId");

    let query = db
      .from("saved_views")
      .select(VIEW_COLUMNS)
      .eq("company_id", c.get("companyId"))
      // Shared views, plus this member's own. Never another member's personal
      // ones: a view they named is theirs, and the names are free text.
      .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      // Two surfaces, each capped at 40 personal + 40 shared. Bounded well
      // above that rather than paginated: this list is a sidebar, not a feed.
      .limit(200);
    if (surface.success) query = query.eq("surface", surface.data);

    const rows = unwrap<ViewRow[]>(await query, "saved views list");

    const membership = unwrap<
      { default_conversation_view_id: string | null; default_task_view_id: string | null }[]
    >(
      await db
        .from("company_members")
        .select("default_conversation_view_id,default_task_view_id")
        .eq("company_id", c.get("companyId"))
        .eq("user_id", userId)
        .limit(1),
      "saved views default",
    );

    return c.json({
      data: rows.map(toClient),
      next_cursor: null,
      defaults: {
        conversations: membership[0]?.default_conversation_view_id ?? null,
        tasks: membership[0]?.default_task_view_id ?? null,
      },
    });
  },
);

savedViewsRoutes.post(
  "/saved-views",
  requireCapability("conversations.read"),
  async (c) => {
    const body = await parseJsonBody(c, createSchema);
    if (body.shared === true && !roleHasCapability(c.get("role"), "settings.manage")) {
      return errorResponse(
        c,
        "forbidden",
        "Only an owner or admin can save a view for the whole crew. You can still save it for yourself.",
      );
    }

    const db = getDb(getEnv(c.env));
    const result = unwrap<{
      outcome: string;
      limit?: number;
      view?: ViewRow;
    }>(
      await db.rpc("api_create_saved_view", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_surface: body.surface,
        p_name: body.name,
        p_filters: sanitizeFilters(body.surface, body.filters ?? {}),
        p_shared: body.shared === true,
      }),
      "saved view create",
    );

    if (result.outcome === "cap") {
      return errorResponse(
        c,
        "conflict",
        `That is ${String(result.limit)} saved views already, which is the most one list can hold. Delete one you no longer open.`,
      );
    }
    if (result.outcome === "duplicate_name") {
      return errorResponse(
        c,
        "conflict",
        "A view with that name already exists. Two views a letter apart are two views nobody can tell you to open.",
      );
    }
    return c.json(toClient(result.view as ViewRow), 201);
  },
);

savedViewsRoutes.patch(
  "/saved-views/:id",
  requireCapability("conversations.read"),
  async (c) => {
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, patchSchema);
    const db = getDb(getEnv(c.env));

    // Read first: the answer to "may you edit this" depends on whether the row
    // is shared, which the request does not say.
    const existing = unwrap<ViewRow[]>(
      await db
        .from("saved_views")
        .select(VIEW_COLUMNS)
        .eq("company_id", c.get("companyId"))
        .eq("id", id)
        .limit(1),
      "saved view read",
    );
    const row = existing[0];
    if (!row) return errorResponse(c, "not_found", "No such view.");

    const canManageShared = roleHasCapability(c.get("role"), "settings.manage");
    const isMine = row.owner_user_id === c.get("userId");
    // Somebody else's PERSONAL view is not editable by anyone, admin included:
    // it never appears on their list, and an admin editing a screen they cannot
    // see is a change nobody can explain.
    if (row.owner_user_id !== null && !isMine) {
      return errorResponse(c, "not_found", "No such view.");
    }
    if (row.owner_user_id === null && !canManageShared) {
      return errorResponse(
        c,
        "forbidden",
        "This view belongs to the whole crew. Ask an owner or admin to change it.",
      );
    }
    if (body.shared === true && !canManageShared) {
      return errorResponse(
        c,
        "forbidden",
        "Only an owner or admin can share a view with the crew.",
      );
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.filters !== undefined) {
      patch.filters = sanitizeFilters(row.surface, body.filters);
    }
    if (body.shared !== undefined) {
      // Un-sharing hands it to the member doing it, not to whoever created it:
      // the person taking a crew view private is the one who will keep using it.
      patch.owner_user_id = body.shared ? null : c.get("userId");
    }

    const updated = unwrap<ViewRow[]>(
      await db
        .from("saved_views")
        .update(patch)
        .eq("company_id", c.get("companyId"))
        .eq("id", id)
        .select(VIEW_COLUMNS),
      "saved view update",
      "A view with that name already exists.",
    );
    if (updated.length === 0) return errorResponse(c, "not_found", "No such view.");
    return c.json(toClient(updated[0]));
  },
);

savedViewsRoutes.delete(
  "/saved-views/:id",
  requireCapability("conversations.read"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));

    const existing = unwrap<ViewRow[]>(
      await db
        .from("saved_views")
        .select(VIEW_COLUMNS)
        .eq("company_id", c.get("companyId"))
        .eq("id", id)
        .limit(1),
      "saved view read",
    );
    const row = existing[0];
    if (!row) return errorResponse(c, "not_found", "No such view.");
    if (row.owner_user_id !== null && row.owner_user_id !== c.get("userId")) {
      return errorResponse(c, "not_found", "No such view.");
    }
    if (
      row.owner_user_id === null &&
      !roleHasCapability(c.get("role"), "settings.manage")
    ) {
      return errorResponse(
        c,
        "forbidden",
        "This view belongs to the whole crew. Ask an owner or admin to delete it.",
      );
    }

    // The membership columns are ON DELETE SET NULL, so deleting a shared view
    // drops it from everybody's landing screen rather than stranding them on a
    // row that no longer exists.
    unwrap(
      await db
        .from("saved_views")
        .delete()
        .eq("company_id", c.get("companyId"))
        .eq("id", id),
      "saved view delete",
    );
    return c.body(null, 204);
  },
);

savedViewsRoutes.post(
  "/saved-views/reorder",
  requireCapability("conversations.read"),
  async (c) => {
    const body = await parseJsonBody(c, reorderSchema);
    const db = getDb(getEnv(c.env));
    // One statement for the whole order. Applying a drag row by row leaves the
    // list transiently wrong for anybody else reading it.
    const moved = unwrap<number>(
      await db.rpc("api_reorder_saved_views", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_surface: body.surface,
        p_ids: body.ids,
      }),
      "saved views reorder",
    );
    return c.json({ moved });
  },
);

savedViewsRoutes.put(
  "/saved-views/default",
  requireCapability("conversations.read"),
  async (c) => {
    const body = await parseJsonBody(c, defaultSchema);
    const db = getDb(getEnv(c.env));

    if (body.view_id !== null) {
      // Confirm the view exists AND that this member can see it, before
      // pointing their landing screen at it. Without the visibility check a
      // member could land on somebody else's personal view by id.
      const seen = unwrap<{ id: string }[]>(
        await db
          .from("saved_views")
          .select("id")
          .eq("company_id", c.get("companyId"))
          .eq("id", body.view_id)
          .eq("surface", body.surface)
          .or(`owner_user_id.is.null,owner_user_id.eq.${c.get("userId")}`)
          .limit(1),
        "saved view default check",
      );
      if (seen.length === 0) return errorResponse(c, "not_found", "No such view.");
    }

    unwrap(
      await db
        .from("company_members")
        .update({ [defaultColumn(body.surface)]: body.view_id })
        .eq("company_id", c.get("companyId"))
        .eq("user_id", c.get("userId")),
      "saved view default set",
    );
    return c.json({ surface: body.surface, view_id: body.view_id });
  },
);

/**
 * Queue badges, bounded twice.
 *
 * #280 asks for counts and says in the same breath that they must be cheap: "a
 * badge that costs a full query per view per poll is a cost problem". So the
 * request is capped at twelve views, and each count stops at a hundred rows and
 * reports `99+` above it. The worst case is a fixed, small amount of work
 * regardless of how organised the customer is — which is the right shape,
 * because the alternative charges the most to the crews using the product best.
 *
 * Tasks are deliberately not counted here. Their list is a different RPC with a
 * different cursor, and a half-bounded second path is how the cost hole gets
 * reopened; the clients show task views without a badge until that is done
 * properly.
 */
savedViewsRoutes.get(
  "/saved-views/counts",
  requireCapability("conversations.read"),
  async (c) => {
    const surface = surfaceSchema.safeParse(c.req.query("surface"));
    if (!surface.success || surface.data !== "conversations") {
      return c.json({ counts: {} });
    }
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => z.uuid().safeParse(id).success)
      .slice(0, SAVED_VIEW_COUNT_MAX_VIEWS);
    if (ids.length === 0) return c.json({ counts: {} });

    const db = getDb(getEnv(c.env));
    const rows = unwrap<ViewRow[]>(
      await db
        .from("saved_views")
        .select(VIEW_COLUMNS)
        .eq("company_id", c.get("companyId"))
        .eq("surface", "conversations")
        .in("id", ids)
        .or(`owner_user_id.is.null,owner_user_id.eq.${c.get("userId")}`)
        .limit(SAVED_VIEW_COUNT_MAX_VIEWS),
      "saved view counts",
    );

    if (rows.length === 0) return c.json({ counts: {} });

    // #106/#368: the SAME deny list the inbox list resolves. Without it a badge
    // would count threads on numbers this viewer cannot see — the exact leak
    // #280 warns a shared view must not become. The `number-access-surfaces`
    // guard caught this call site missing it, which is why that guard exists.
    // Resolved after the early return so a request naming no visible view costs
    // one query rather than two.
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });

    const counts: Record<string, number> = {};
    for (const row of rows) {
      const clean = sanitizeFilters("conversations", row.filters);
      const filters = Object.fromEntries(filtersToQuery(clean));
      // "Mine" means whoever is asking. Resolved with the shared helper the
      // three clients also use, so a badge can never label a list built from a
      // different assignee than the one the person will see.
      const assignee = resolveAssignee(clean, c.get("userId"));
      // The SAME function the list endpoint calls, with the same caller. A
      // badge computed any other way could be larger than the list it labels,
      // which under #106 would be a leak rather than a rounding error.
      const listed = unwrap<unknown[]>(
        await db.rpc("api_list_conversations", {
          p_company_id: c.get("companyId"),
          p_user_id: c.get("userId"),
          p_limit: COUNT_PROBE_LIMIT,
          p_status: filters.status ?? null,
          p_assigned_user_id: assignee ?? null,
          p_tag_id: filters.tag_id ?? null,
          p_is_spam: filters.is_spam === "true",
          p_unread: filters.unread === "true",
          p_q: null,
          p_cursor_ts: null,
          p_cursor_id: null,
          p_pinned: filters.pinned ?? null,
          p_snoozed: filters.snoozed ?? null,
          // #508: a view saved from the Unanswered filter counts the set it
          // opens. Omitting it here is how a badge comes to be larger than the
          // list it labels.
          p_awaiting: filters.awaiting ?? null,
          p_hidden_number_ids: access.hiddenNumberIds,
        }),
        "saved view count",
      );
      counts[row.id] = listed.length;
    }
    return c.json({ counts });
  },
);
