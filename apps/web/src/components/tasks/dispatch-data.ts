import { apiFetch } from "@/lib/api/client";

export interface DispatchWindow { start: string; end: string }
export interface DispatchShift { start: string | null; end: string | null; breaks: DispatchWindow[] }

export interface DispatchTask {
  id: string;
  title: string;
  due_on: string | null;
  due_at: string | null;
  dispatch_estimate: number | null;
  windows: DispatchWindow[];
  assigned_user_id: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
  done: boolean;
  scheduled_count: number;
}

export interface DispatchBlock {
  id: string;
  task_id: string;
  assignee_id: string;
  starts_at: string;
  ends_at: string;
  locked: boolean;
  visit: boolean;
  address_confirmed: boolean;
}

export interface DispatchDay {
  date: string;
  start: string;
  end: string;
  closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
}

export interface DispatchPlan {
  revision: number;
  timezone: string;
  members: { id: string; name: string | null; shifts?: Record<string, DispatchShift> }[];
  days: DispatchDay[];
  tasks: DispatchTask[];
  blocks: DispatchBlock[];
  queue_truncated: boolean;
}

export interface DispatchDetail {
  task_id: string;
  updated_at: string;
  estimate: number | null;
  windows: DispatchWindow[];
}

export type DispatchEdit = {
  id: string; task_id: string; updated_at: string; reschedule: boolean;
} & ({ remove: true } | (Omit<DispatchBlock, "address_confirmed"> & { remove: false; confirm_address: boolean }));

export interface DispatchDraft { blocks: DispatchEdit[]; details: DispatchDetail[] }
export interface DispatchRange { day: string; days: number; task?: string }
export interface DispatchRequest extends DispatchRange, DispatchDraft { revision: number }

interface WorkloadCell {
  date: string;
  assignee_id: string;
  booked: number;
  available: number | null;
  overloaded?: boolean;
}

export interface DispatchRoute {
  stops: DispatchBlock[];
  proposal: DispatchBlock[];
  before: number;
  after: number;
  skipped: { id: string; reason: "address" | "capacity" }[];
}

export interface DispatchPreview {
  plan: DispatchPlan;
  workload: WorkloadCell[];
  conflicts: { id: string; reason: "hours" | "window" | "overlap" | "travel" | "address"; minutes?: number }[];
  slots: DispatchBlock[];
  route: DispatchRoute | null;
  notify: string[];
}

type PlanResponse = Pick<DispatchPreview, "plan" | "workload">;

export function fetchDispatch(companyId: string, range: DispatchRange, signal?: AbortSignal) {
  const searchParams = { day: range.day, days: range.days, task: range.task };
  return apiFetch<PlanResponse>("/v1/dispatch", { companyId, searchParams, signal });
}

export function previewDispatch(companyId: string, body: DispatchRequest & {
  focus: string;
  route?: { assignee_id: string; optimize: boolean; order?: string[] };
  slot?: { id: string; task_id: string; duration: number; visit: boolean; confirm_address: boolean; assignee_id?: string };
}) {
  return apiFetch<DispatchPreview>("/v1/dispatch/preview", { companyId, method: "POST", body });
}

export function publishDispatch(companyId: string, body: DispatchRequest) {
  return apiFetch<PlanResponse>("/v1/dispatch/publish", { companyId, method: "POST", body });
}

export function saveDispatchShift(companyId: string, body: DispatchRange & {
  revision: number; worker_id: string; weekday: number; shift: DispatchShift | null;
}) {
  return apiFetch<PlanResponse>("/v1/dispatch/shifts", { companyId, method: "PUT", body });
}

export function blocksOnDay(plan: DispatchPlan, date: string) {
  const day = plan.days.find((value) => value.date === date);
  if (!day) return [];
  return plan.blocks.filter((block) =>
    Date.parse(block.starts_at) < Date.parse(day.end) && Date.parse(block.ends_at) > Date.parse(day.start));
}

export function dispatchEdit(block: DispatchBlock, task: DispatchTask, reschedule: boolean): DispatchEdit {
  const { address_confirmed, ...rest } = block;
  return { ...rest, updated_at: task.updated_at, remove: false, reschedule, confirm_address: address_confirmed };
}
