import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { deliverPush } from "../notifications/deliver";
import { reportHandledFailure } from "../observability/capture";
import { dispatchConflicts, dispatchRecipients, dispatchRoute, dispatchSlots, dispatchWorkload, draftPlan } from "../tasks/dispatch";
import type { DispatchPlan } from "../tasks/dispatch";
import { filterToTaskViewers } from "../tasks/notify";
import { executionCtxOf, parseJsonBody, parseWith, unwrap } from "./core/http";

const timestamp = z.iso.datetime({ offset: true });
const duration = z.number().int().min(5).max(720);
const date = z.iso.date();
const id = z.uuid();
const range = z.object({ day: date, days: z.coerce.number().int().min(1).max(14).default(7), task: id.optional() });
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const shiftWindow = z.object({ start: localTime, end: localTime });
const shift = z.object({
  start: localTime.nullable(), end: localTime.nullable(), breaks: z.array(shiftWindow).max(6),
});
const shiftRequest = range.extend({
  revision: z.number().int().nonnegative(), worker_id: id, weekday: z.number().int().min(1).max(7),
  shift: shift.nullable(),
});
const taskVersion = z.object({ task_id: id, updated_at: timestamp });
const blockEdit = taskVersion.extend({ id, reschedule: z.boolean().default(false) });
const change = z.discriminatedUnion("remove", [
  blockEdit.extend({ remove: z.literal(true) }),
  blockEdit.extend({
    remove: z.literal(false), assignee_id: id, starts_at: timestamp, ends_at: timestamp,
    visit: z.boolean(), locked: z.boolean(), confirm_address: z.boolean().default(false),
  }).refine((b) => {
    const elapsed = Date.parse(b.ends_at) - Date.parse(b.starts_at);
    return elapsed >= 300_000 && elapsed <= 43_200_000;
  }),
]);
const detail = taskVersion.extend({
  estimate: duration.nullable().default(null),
  windows: z.array(z.object({ start: timestamp, end: timestamp })
    .refine((w) => Date.parse(w.start) < Date.parse(w.end))).max(20),
});
const request = range.extend({
  revision: z.number().int().nonnegative(),
  blocks: z.array(change).max(100).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
  details: z.array(detail).max(100).refine((rows) => new Set(rows.map((row) => row.task_id)).size === rows.length),
});
const preview = request.extend({
  focus: date,
  route: z.object({ assignee_id: id, optimize: z.boolean(), order: z.array(id).max(100).optional() }).optional(),
  slot: z.object({
    id, task_id: id, duration, visit: z.boolean(), confirm_address: z.boolean(), assignee_id: id.optional(),
  }).optional(),
});

const PUBLISH_ISSUES = {
  stale: ["conflict", "The plan changed. Reload the schedule and review your changes.", "dispatchStale"],
  locked: ["conflict", "Reschedule the locked appointment explicitly before moving it.", "dispatchLocked"],
  overlap: ["conflict", "This person already has work during that time.", "dispatchOverlap"],
  window: ["validation_failed", "The work falls outside the customer's available times.", "dispatchWindow"],
  travel: ["validation_failed", "This plan leaves too little travel time between visits.", "dispatchTravel"],
  address: ["validation_failed", "Confirm the service address before scheduling the visit.", "dispatchAddress"],
  hours: ["validation_failed", "Choose a time within the dispatch day and available hours.", "dispatchHours"],
  shift: ["validation_failed", "Use a shift with a start before its end and breaks that fit without overlapping.", "dispatchShift"],
  duration: ["validation_failed", "Use a duration between 5 minutes and 12 hours.", "dispatchDuration"],
  assignee: ["validation_failed", "Choose an active teammate who can open this task.", "dispatchAssignee"],
  not_found: ["not_found", "No such task.", "bookingNotFound"],
} as const;

function refusal(reason: keyof typeof PUBLISH_ISSUES): ApiError {
  const [status, message, key] = PUBLISH_ISSUES[reason];
  return new ApiError(status, message, { key: `apiRefusals.${key}` });
}

async function readPlan(c: Context<AppEnv>, args: z.output<typeof range>): Promise<DispatchPlan> {
  const db = getDb(getEnv(c.env));
  const plan = unwrap<DispatchPlan | null>(await db.rpc("api_dispatch_read", {
    p_company_id: c.get("companyId"), p_actor_id: c.get("userId"), p_day: args.day,
    p_days: args.days, p_task_id: args.task ?? null,
  }), "read dispatch plan");
  if (!plan) throw refusal("not_found");
  return plan;
}

function changesOnPlan(base: DispatchPlan, body: z.output<typeof request>) {
  if (base.revision !== body.revision) throw refusal("stale");
  const byId = new Map(base.tasks.map((task) => [task.id, task]));
  for (const edit of [...body.blocks, ...body.details]) {
    const task = byId.get(edit.task_id);
    if (!task) throw refusal("not_found");
    if (task.updated_at !== edit.updated_at) throw refusal("stale");
  }
  const plan = draftPlan(base, body);
  const changedIds = new Set(body.blocks.map((block) => block.id));
  for (const block of plan.blocks) {
    if (body.details.some((entry) => entry.task_id === block.task_id)) changedIds.add(block.id);
  }
  return { plan, conflicts: dispatchConflicts(plan, changedIds) };
}

async function notifyCrew(c: Context<AppEnv>, plan: DispatchPlan, changes: Map<string, string[]>) {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  for (const [taskId, ids] of changes) {
    const userIds = await filterToTaskViewers(db, companyId, tasks.get(taskId)?.conversation_id ?? null, ids);
    const failures: unknown[] = [];
    const web = (locale: "en" | "fr-CA") => ({
      title: locale === "fr-CA" ? "Horaire mis à jour" : "Schedule updated",
      body: locale === "fr-CA" ? "Ouvrez la tâche pour voir le nouvel horaire." : "Open the task to see the latest schedule.",
      url: `${env.APP_ORIGIN}/tasks/${taskId}`,
    });
    await deliverPush(env, db, {
      companyId, userIds, category: "tasks", content: { written: "us" },
      web, native: (locale) => ({ kind: "task_update", ...web(locale) }),
      collapseKey: `dispatch:${taskId}`, failures,
    });
    if (failures.length > 0) {
      await reportHandledFailure(env, "dispatch-publish-alert", new AggregateError(failures, "Dispatch notifications failed."));
    }
  }
}

export const dispatchRoutes = new Hono<AppEnv>();

dispatchRoutes.get("/dispatch", requireCapability("conversations.read"), async (c) => {
  const plan = await readPlan(c, parseWith(range, c.req.query()));
  return c.json({ plan, workload: dispatchWorkload(plan) });
});

dispatchRoutes.put("/dispatch/shifts", requireCapability("settings.manage"), async (c) => {
  const body = await parseJsonBody(c, shiftRequest);
  if (body.shift) {
    const { start, end, breaks } = body.shift;
    if (start === null || end === null) {
      if (start !== end || breaks.length > 0) throw refusal("shift");
    } else {
      if (start >= end) throw refusal("shift");
      const ordered = breaks.toSorted((a, b) => a.start.localeCompare(b.start));
      if (ordered.some((pause, i) => pause.start < start || pause.end > end || pause.start >= pause.end ||
        (i > 0 && ordered[i - 1].end > pause.start))) throw refusal("shift");
    }
  }
  const db = getDb(getEnv(c.env));
  const result = unwrap<string>(await db.rpc("api_dispatch_set_shift", {
    p_company_id: c.get("companyId"), p_actor_id: c.get("userId"), p_worker_id: body.worker_id,
    p_weekday: body.weekday, p_shift: body.shift, p_revision: body.revision,
  }), "save worker shift");
  if (result === "stale" || result === "not_found" || result === "hours") throw refusal(result);
  if (result !== "ok") throw new Error("Unexpected availability outcome.");
  const plan = await readPlan(c, body);
  return c.json({ plan, workload: dispatchWorkload(plan) });
});

dispatchRoutes.post("/dispatch/preview", requireCapability("conversations.note"), async (c) => {
  const body = await parseJsonBody(c, preview);
  const base = await readPlan(c, body);
  const { plan, conflicts } = changesOnPlan(base, body);
  const day = plan.days.find((value) => value.date === body.focus);
  if (!day) throw refusal("hours");
  return c.json({
    plan, conflicts, workload: dispatchWorkload(plan),
    notify: [...new Set([...dispatchRecipients(base, body, c.get("userId")).values()].flat())],
    slots: body.slot ? dispatchSlots(plan, day, body.slot, Date.now()) : [],
    route: body.route
      ? dispatchRoute(plan, day, body.route.assignee_id, body.route.optimize ? body.route.order : false)
      : null,
  });
});

dispatchRoutes.post("/dispatch/publish", requireCapability("conversations.note"), async (c) => {
  const body = await parseJsonBody(c, request);
  const base = await readPlan(c, body);
  const { conflicts } = changesOnPlan(base, body);
  if (conflicts[0]) throw refusal(conflicts[0].reason);
  if (body.blocks.length > 0 || body.details.length > 0) {
    const db = getDb(getEnv(c.env));
    const result = unwrap<string>(await db.rpc("api_dispatch_publish", {
      p_company_id: c.get("companyId"), p_actor_id: c.get("userId"), p_revision: body.revision,
      p_blocks: body.blocks, p_details: body.details,
    }), "publish dispatch plan");
    if (result !== "ok") {
      if (Object.hasOwn(PUBLISH_ISSUES, result)) throw refusal(result as keyof typeof PUBLISH_ISSUES);
      throw new Error("Unexpected dispatch publication outcome.");
    }
    const changes = dispatchRecipients(base, body, c.get("userId"));
    if (changes.size > 0) {
      const alerts = notifyCrew(c, base, changes).catch((error: unknown) =>
        reportHandledFailure(getEnv(c.env), "dispatch-publish-alert", error));
      const ctx = executionCtxOf(c);
      if (ctx) ctx.waitUntil(alerts);
      else await alerts;
    }
  }
  const plan = await readPlan(c, body);
  return c.json({ plan, workload: dispatchWorkload(plan) });
});
