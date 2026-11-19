import type { Context } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { syncTaskReminders } from "../messaging/appointment-reminders";
import { askForJobRating } from "../messaging/job-ratings";
import { notifyAssigned } from "../notifications/assignment";
import { reportHandledFailure, workerEnv } from "../observability/capture";
import { executionCtxOf } from "../routes/core/http";
import { enqueueWebhookEventBatch } from "../webhooks/outbound";

const RATING_BATCH_SIZE = 8;

export interface TaskCompletion {
  id: string;
  title: string | null;
  source: { kind: "message" | "call"; id: string } | null;
  askForRating: boolean;
}

export function notifyAssignedTask(
  c: Context<AppEnv>,
  input: {
    companyId: string;
    actorUserId: string;
    assigneeUserId: string;
    task: Record<string, unknown> | null;
    taskId: string;
  },
): Promise<void> {
  const env = getEnv(c.env);
  const notify = notifyAssigned(env, {
    kind: "task",
    companyId: input.companyId,
    taskId: input.taskId,
    title: (input.task?.title as string | null | undefined) ?? null,
    conversationId: (input.task?.conversation_id as string | null | undefined) ?? null,
    actorUserId: input.actorUserId,
    assigneeUserId: input.assigneeUserId,
  }).catch((error: unknown) => reportHandledFailure(env, "task-assignment-alert", error));
  return finishFollowUp(c, notify);
}

export async function afterTaskCreated(
  c: Context<AppEnv>,
  input: {
    companyId: string;
    userId: string;
    task: Record<string, unknown>;
    assigneeIds: readonly string[];
  },
): Promise<void> {
  const { companyId, userId, task, assigneeIds } = input;
  const taskId = task.id as string;
  for (const assigneeUserId of assigneeIds) {
    await notifyAssignedTask(c, { companyId, actorUserId: userId, assigneeUserId, task, taskId });
  }
  if ((task.due_at || task.due_on) && task.conversation_id && task.reminders_off === false) {
    await syncRemindersAfterWrite(c, { companyId, userId, taskId });
  }
}

// Replan after every write because both the booking and rendered text can change.
export function syncRemindersAfterWrite(
  c: Context<AppEnv>,
  input: { companyId: string; taskId: string; userId: string },
): Promise<void> {
  const env = getEnv(c.env);
  const work = syncTaskReminders(getDb(env), input)
    .then(() => undefined)
    .catch((error: unknown) => reportHandledFailure(env, "task-reminder-sync", error));
  return finishFollowUp(c, work);
}

export function afterTasksCompleted(
  c: Context<AppEnv>,
  input: { companyId: string; userId: string; tasks: readonly TaskCompletion[] },
): Promise<void> {
  const env = getEnv(c.env);
  const work = completeTasks(getDb(env), input)
    .catch((error: unknown) => reportHandledFailure(env, "task-completion-follow-up", error));
  return finishFollowUp(c, work);
}

async function completeTasks(
  db: SupabaseClient,
  input: { companyId: string; userId: string; tasks: readonly TaskCompletion[] },
): Promise<void> {
  const { companyId, userId, tasks } = input;
  await enqueueWebhookEventBatch(db, {
    companyId,
    type: "task.completed",
    payloads: tasks.map((task) => ({
      task_id: task.id,
      title: task.title,
      message_id: task.source?.kind === "message" ? task.source.id : null,
      source: task.source,
    })),
  });
  const ratingTasks = tasks.filter((task) => task.askForRating);
  for (let start = 0; start < ratingTasks.length; start += RATING_BATCH_SIZE) {
    await Promise.all(ratingTasks.slice(start, start + RATING_BATCH_SIZE).map(({ id }) =>
      askForJobRating(db, { companyId, taskId: id, userId }).catch((error: unknown) =>
        reportHandledFailure(workerEnv(), "task-completion-follow-up", error),
      ),
    ));
  }
}

async function finishFollowUp(c: Context<AppEnv>, work: Promise<void>): Promise<void> {
  const ctx = executionCtxOf(c);
  if (ctx) ctx.waitUntil(work);
  else await work;
}
