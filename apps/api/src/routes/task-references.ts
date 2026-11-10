/**
 * Task relations, linked tasks and reference chips (#690). Mounted at /v1.
 *
 *   GET    /v1/tasks/:id/links               R: { data: [{ relation, task_id,
 *          number, title, done }] }. `relation` is what the OTHER task is to
 *          this one: blocked_by, blocks, parent or sub_task. A related task on a
 *          number the caller is denied is not listed.
 *   POST   /v1/tasks/:id/links               N: { relation, task_id } -> 201
 *          { data: [...the links] }. blocked_by / blocks / parent / sub_task. A
 *          loop (A blocked by B blocked by A, a task under its own sub-task) is
 *          422; a second parent is 409; the same link twice is a 200 no-op. Both
 *          tasks get a link_added event. Done stays per task: finishing a
 *          sub-task never finishes its parent.
 *   DELETE /v1/tasks/:id/links/:otherId?relation=...   N: remove it, with a
 *          link_removed event on both tasks.
 *   GET    /v1/conversations/:id/linked-tasks    R: { data: [{ id, number, title,
 *          done, due_at, how: ("anchored"|"mentioned"|"points_at")[] }] }
 *   GET    /v1/contacts/:id/linked-tasks         R: the same, for a contact.
 *   GET    /v1/references/resolve?tasks=142,139&contacts=1a2b3c4d&conversations=abcdef01
 *          R: what each `#T-142` / `#contact-...` / `#conv-...` chip says right
 *          now: { tasks: [{ number, id, title, done }], contacts: [{ prefix, id,
 *          name }], conversations: [{ prefix, id, contact_name }] }. Anything
 *          unknown, deleted or on a denied number is simply absent.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import {
  requireConversationAccess,
  resolveNumberAccess,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid } from "./core/http";
import { requireTask } from "./task-activity";

const RELATIONS = ["blocked_by", "blocks", "parent", "sub_task"] as const;

const linkSchema = z.object({
  relation: z.enum(RELATIONS),
  task_id: z.uuid(),
});

interface LinkOutcome {
  outcome: string;
  items?: unknown[];
}

export const taskReferenceRoutes = new Hono<AppEnv>();

async function readLinks(c: Context<AppEnv>, taskId: string): Promise<LinkOutcome> {
  const db = getDb(getEnv(c.env));
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const { data, error } = await db.rpc("api_task_links", {
    p_company_id: c.get("companyId"),
    p_task_id: taskId,
    p_hidden_number_ids: access.hiddenNumberIds,
  });
  if (error) throw new Error(`api_task_links failed: ${error.message}`);
  return data as LinkOutcome;
}

taskReferenceRoutes.get(
  "/tasks/:id/links",
  requireCapability("conversations.read"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const result = await readLinks(c, taskId);
    if (result.outcome !== "ok") return errorResponse(c, "not_found", "No such task.");
    return c.json({ data: result.items ?? [] });
  },
);

async function changeLink(
  c: Context<AppEnv>,
  args: { taskId: string; otherId: string; relation: (typeof RELATIONS)[number]; add: boolean },
): Promise<Response | string> {
  const db = getDb(getEnv(c.env));
  // Writing is a note-level act on BOTH tasks' conversations.
  for (const id of [args.taskId, args.otherId]) {
    const gate = await requireTask(c, db, id, "note");
    if (gate instanceof Response) return gate;
  }
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const { data, error } = await db.rpc("api_set_task_link", {
    p_company_id: c.get("companyId"),
    p_task_id: args.taskId,
    p_other_task_id: args.otherId,
    p_relation: args.relation,
    p_add: args.add,
    p_actor_user_id: c.get("userId"),
    p_hidden_number_ids: access.hiddenNumberIds,
  });
  if (error) throw new Error(`api_set_task_link failed: ${error.message}`);
  const outcome = (data as { outcome?: string } | null)?.outcome ?? "invalid";
  switch (outcome) {
    case "ok":
    case "unchanged":
      return outcome;
    case "not_found":
      return errorResponse(c, "not_found", "No such task.");
    case "cycle":
      throw new ApiError("validation_failed", "task_id: that would make a loop.");
    case "has_parent":
      throw new ApiError("conflict", "That task already has a parent. Remove it first.");
    case "too_many":
      throw new ApiError("validation_failed", "A task has at most 50 links.");
    default:
      throw new ApiError("validation_failed", "task_id: not a valid link.");
  }
}

taskReferenceRoutes.post(
  "/tasks/:id/links",
  requireCapability("conversations.note"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const body = await parseJsonBody(c, linkSchema);
    const result = await changeLink(c, {
      taskId,
      otherId: body.task_id,
      relation: body.relation,
      add: true,
    });
    if (result instanceof Response) return result;
    const links = await readLinks(c, taskId);
    return c.json({ data: links.items ?? [] }, result === "ok" ? 201 : 200);
  },
);

taskReferenceRoutes.delete(
  "/tasks/:id/links/:otherId",
  requireCapability("conversations.note"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const otherId = pathUuid(c, "otherId");
    const relation = z.enum(RELATIONS).safeParse(c.req.query("relation"));
    if (!relation.success) {
      throw new ApiError("validation_failed", `relation must be one of ${RELATIONS.join(", ")}.`);
    }
    const result = await changeLink(c, { taskId, otherId, relation: relation.data, add: false });
    if (result instanceof Response) return result;
    const links = await readLinks(c, taskId);
    return c.json({ data: links.items ?? [] });
  },
);

async function linkedTasks(
  c: Context<AppEnv>,
  kind: "conversation" | "contact",
  id: string,
): Promise<Response> {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  if (kind === "conversation") {
    await requireConversationAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId: id,
      need: "read",
    });
  }
  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const { data, error } = await db.rpc("api_linked_tasks", {
    p_company_id: companyId,
    p_kind: kind,
    p_id: id,
    p_hidden_number_ids: access.hiddenNumberIds,
  });
  if (error) throw new Error(`api_linked_tasks failed: ${error.message}`);
  const result = data as LinkOutcome;
  if (result.outcome !== "ok") return errorResponse(c, "not_found", `No such ${kind}.`);
  return c.json({ data: result.items ?? [] });
}

taskReferenceRoutes.get(
  "/conversations/:id/linked-tasks",
  requireCapability("conversations.read"),
  (c) => linkedTasks(c, "conversation", pathUuid(c, "id")),
);

taskReferenceRoutes.get(
  "/contacts/:id/linked-tasks",
  requireCapability("conversations.read"),
  (c) => linkedTasks(c, "contact", pathUuid(c, "id")),
);

const csv = (raw: string | undefined): string[] =>
  raw ? raw.split(",").filter((s) => s.length > 0) : [];

taskReferenceRoutes.get(
  "/references/resolve",
  requireCapability("conversations.read"),
  async (c) => {
    const tasks = csv(c.req.query("tasks"));
    const contacts = csv(c.req.query("contacts"));
    const conversations = csv(c.req.query("conversations"));
    if (
      tasks.length > 50 ||
      contacts.length > 50 ||
      conversations.length > 50 ||
      tasks.some((n) => !/^\d{1,9}$/.test(n)) ||
      [...contacts, ...conversations].some((p) => !/^[0-9a-fA-F]{8}$/.test(p))
    ) {
      throw new ApiError(
        "validation_failed",
        "tasks must be numbers; contacts and conversations eight hex digits; at most 50 of each.",
      );
    }
    const db = getDb(getEnv(c.env));
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });
    const { data, error } = await db.rpc("api_resolve_references", {
      p_company_id: c.get("companyId"),
      p_task_numbers: tasks.map(Number),
      p_contact_prefixes: contacts,
      p_conv_prefixes: conversations,
      p_hidden_number_ids: access.hiddenNumberIds,
    });
    if (error) throw new Error(`api_resolve_references failed: ${error.message}`);
    return c.json(data);
  },
);
