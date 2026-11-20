const MINUTE = 60_000;
const SLOT_STEP = 15 * MINUTE;

export interface DispatchWindow {
  start: string;
  end: string;
}

export interface DispatchTask {
  id: string;
  title: string;
  due_on: string | null;
  due_at: string | null;
  dispatch_estimate: number | null;
  windows: DispatchWindow[];
  assigned_user_id: string | null;
  conversation_id?: string | null;
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
  members: { id: string; name: string | null }[];
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

export type DispatchChange =
  | (Omit<DispatchBlock, "address_confirmed"> & {
      remove: false;
      updated_at: string;
      confirm_address: boolean;
      reschedule: boolean;
    })
  | { id: string; task_id: string; updated_at: string; remove: true; reschedule: boolean };

export interface DispatchDraft {
  blocks: DispatchChange[];
  details: DispatchDetail[];
}

export function dispatchRecipients(plan: DispatchPlan, draft: DispatchDraft, actorId: string): Map<string, string[]> {
  const blocks = new Map(plan.blocks.map((block) => [block.id, block]));
  const byTask = new Map<string, Set<string>>();
  for (const edit of draft.blocks) {
    const old = blocks.get(edit.id);
    if (!edit.remove && old && old.assignee_id === edit.assignee_id &&
      start(old) === ms(edit.starts_at) && end(old) === ms(edit.ends_at) && old.visit === edit.visit) continue;
    const ids = byTask.get(edit.task_id) ?? new Set<string>();
    if (old && old.assignee_id !== actorId) ids.add(old.assignee_id);
    if (!edit.remove && edit.assignee_id !== actorId) ids.add(edit.assignee_id);
    if (ids.size > 0) byTask.set(edit.task_id, ids);
  }
  return new Map([...byTask].map(([taskId, ids]) => [taskId, [...ids]]));
}

export type DispatchIssue = "hours" | "window" | "overlap" | "travel" | "address";

const ms = Date.parse;
const start = (block: DispatchBlock) => ms(block.starts_at);
const end = (block: DispatchBlock) => ms(block.ends_at);
const iso = (time: number) => new Date(time).toISOString();

export function draftPlan(plan: DispatchPlan, draft: DispatchDraft): DispatchPlan {
  const details = new Map(draft.details.map((detail) => [detail.task_id, detail]));
  const previous = new Map(plan.blocks.map((block) => [block.id, block]));
  const edited = new Set(draft.blocks.map((block) => block.id));
  const blockCounts = new Map<string, number>();
  for (const block of draft.blocks) {
    const delta = Number(!block.remove) - Number(previous.has(block.id));
    blockCounts.set(block.task_id, (blockCounts.get(block.task_id) ?? 0) + delta);
  }
  const blocks = plan.blocks.filter((block) => !edited.has(block.id));
  for (const block of draft.blocks) {
    if (block.remove) continue;
    blocks.push({
      id: block.id, task_id: block.task_id, assignee_id: block.assignee_id, locked: block.locked,
      starts_at: block.starts_at, ends_at: block.ends_at, visit: block.visit,
      address_confirmed: block.visit && (block.confirm_address || previous.get(block.id)?.address_confirmed === true),
    });
  }
  return {
    ...plan,
    blocks: blocks.toSorted((left, right) => start(left) - start(right)),
    tasks: plan.tasks.map((task) => {
      const detail = details.get(task.id);
      return {
        ...task,
        scheduled_count: task.scheduled_count + (blockCounts.get(task.id) ?? 0),
        ...(detail && { dispatch_estimate: detail.estimate, windows: detail.windows }),
      };
    }),
  };
}

function dayBlocks(plan: DispatchPlan, day: DispatchDay, member: string): DispatchBlock[] {
  return plan.blocks.filter((block) =>
    block.assignee_id === member && start(block) < ms(day.end) && end(block) > ms(day.start));
}

function location(task: DispatchTask | undefined): [number, number] | null {
  return task?.lat != null && task.lng != null ? [task.lat, task.lng] : null;
}

function travelMinutes(a: DispatchTask | undefined, b: DispatchTask | undefined): number | null {
  const from = location(a);
  const to = location(b);
  if (!from || !to) return null;
  const radians = Math.PI / 180;
  const dLat = (to[0] - from[0]) * radians;
  const dLng = (to[1] - from[1]) * radians;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(from[0] * radians) * Math.cos(to[0] * radians) * Math.sin(dLng / 2) ** 2;
  const straightKm = 12_742 * Math.asin(Math.sqrt(Math.min(1, h)));
  return Math.ceil(straightKm * 1.3 / 40 * 60);
}

function routeLegs(blocks: DispatchBlock[], tasks: Map<string, DispatchTask>) {
  const stops = blocks.filter((block) => block.visit && block.address_confirmed);
  return stops.slice(1).map((to, index) => {
    const from = stops[index];
    const minutes = travelMinutes(tasks.get(from.task_id), tasks.get(to.task_id));
    const inBetween = blocks.filter((block) => start(block) >= end(from) && end(block) <= start(to));
    // Driving needs a continuous gap between fixed commitments.
    let cursor = end(from);
    let free = 0;
    for (const block of inBetween) {
      free = Math.max(free, start(block) - cursor);
      cursor = Math.max(cursor, end(block));
    }
    free = Math.max(free, start(to) - cursor);
    return { from, to, minutes, free: Math.floor(free / MINUTE) };
  });
}

function issueFor(
  plan: DispatchPlan, day: DispatchDay, block: DispatchBlock, task: DispatchTask,
  scheduled: DispatchBlock[], tasks: Map<string, DispatchTask>,
): { reason: DispatchIssue; minutes?: number } | null {
  if (block.visit && (!task.address || !block.address_confirmed)) return { reason: "address" };
  if (start(block) < ms(day.start) || end(block) > ms(day.end) ||
    (day.opens_at !== null && start(block) < ms(day.opens_at)) ||
    (day.closes_at !== null && end(block) > ms(day.closes_at)) || day.closed) {
    return { reason: "hours" };
  }
  if (task.windows.length > 0 && !task.windows.some((window) =>
    start(block) >= ms(window.start) && end(block) <= ms(window.end))) {
    return { reason: "window" };
  }
  if (scheduled.some((other) => start(block) < end(other) && end(block) > start(other))) {
    return { reason: "overlap" };
  }
  const line = [...scheduled, block].toSorted((a, b) => start(a) - start(b));
  const impossible = routeLegs(line, tasks).find((leg) =>
    leg.minutes !== null && leg.free < leg.minutes &&
    (leg.from.id === block.id || leg.to.id === block.id ||
      (start(block) >= end(leg.from) && end(block) <= start(leg.to))));
  return impossible?.minutes == null ? null : { reason: "travel", minutes: impossible.minutes - impossible.free };
}

function taskIndex(plan: DispatchPlan) {
  return new Map(plan.tasks.map((task) => [task.id, task]));
}

export function dispatchConflicts(plan: DispatchPlan, ids: Set<string>) {
  const tasks = taskIndex(plan);
  return plan.blocks.flatMap((block) => {
    if (!ids.has(block.id)) return [];
    const day = plan.days.find((d) => ms(d.start) <= start(block) && start(block) < ms(d.end));
    const task = tasks.get(block.task_id);
    if (!day || !task) return [{ id: block.id, reason: "hours" as const }];
    const others = dayBlocks(plan, day, block.assignee_id).filter((other) => other.id !== block.id);
    const issue = issueFor(plan, day, block, task, others, tasks);
    return issue ? [{ id: block.id, ...issue }] : [];
  });
}

export function dispatchWorkload(plan: DispatchPlan) {
  const tasks = taskIndex(plan);
  return plan.members.flatMap((member) => plan.days.map((day) => {
    const scheduled = dayBlocks(plan, day, member.id);
    const work = scheduled.reduce((total, block) =>
      total + (Math.min(end(block), ms(day.end)) - Math.max(start(block), ms(day.start))) / MINUTE, 0);
    const legs = routeLegs(scheduled, tasks);
    const drive = legs.reduce((total, leg) => total + (leg.minutes ?? 0), 0);
    const available = day.opens_at && day.closes_at
      ? (Math.min(ms(day.closes_at), ms(day.end)) - ms(day.opens_at)) / MINUTE
      : (day.closed ? 0 : null);
    return { date: day.date, assignee_id: member.id, booked: work + drive, travel: drive, available,
      travel_incomplete: legs.some((leg) => leg.minutes === null) };
  }));
}

interface SlotQuery {
  id: string;
  task_id: string;
  duration: number;
  visit: boolean;
  confirm_address: boolean;
  assignee_id?: string;
}

function feasibleTime(
  plan: DispatchPlan, day: DispatchDay, block: DispatchBlock, task: DispatchTask,
  others: DispatchBlock[], tasks: Map<string, DispatchTask>, earliest: number,
): DispatchBlock | null {
  if (!day.opens_at || !day.closes_at) return null;
  const duration = end(block) - start(block);
  const first = Math.ceil(Math.max(ms(day.opens_at), earliest) / SLOT_STEP) * SLOT_STEP;
  const until = Math.min(ms(day.closes_at), ms(day.end)) - duration;
  for (let time = first; time <= until; time += SLOT_STEP) {
    const option = { ...block, starts_at: iso(time), ends_at: iso(time + duration) };
    if (!issueFor(plan, day, option, task, others, tasks)) return option;
  }
  return null;
}

export function dispatchSlots(plan: DispatchPlan, day: DispatchDay, query: SlotQuery, now: number) {
  const tasks = taskIndex(plan);
  const task = tasks.get(query.task_id);
  if (!task) return [];
  const baseline = plan.blocks.find((block) => block.id === query.id && block.task_id === task.id);
  const members = plan.members.filter((member) => !query.assignee_id || query.assignee_id === member.id);
  return members.flatMap((member) => {
    const base = {
      id: query.id, task_id: task.id, assignee_id: member.id, locked: baseline?.locked ?? false,
      visit: query.visit, address_confirmed: query.confirm_address || baseline?.address_confirmed === true,
      starts_at: day.start, ends_at: iso(ms(day.start) + query.duration * MINUTE),
    };
    const others = dayBlocks(plan, day, member.id).filter((block) => block.id !== base.id);
    const slot = feasibleTime(plan, day, base, task, others, tasks, now);
    return slot ? [slot] : [];
  }).toSorted((a, b) => start(a) - start(b)).slice(0, 5);
}

export function dispatchRoute(plan: DispatchPlan, day: DispatchDay, assignee: string, order?: string[] | false) {
  const blocks = dayBlocks(plan, day, assignee);
  const tasks = taskIndex(plan);
  const stops = blocks.filter((block) => block.visit && block.address_confirmed);
  const movable = stops.filter((block) => !block.locked && location(tasks.get(block.task_id)) !== null);
  const fixed = blocks.filter((block) => !movable.includes(block));
  const travel = (line: DispatchBlock[]) => routeLegs(line, tasks).reduce((n, leg) => n + (leg.minutes ?? 0), 0);
  const before = travel(blocks);
  const proposed: DispatchBlock[] = [];
  const skipped: { id: string; reason: "address" | "capacity" }[] = blocks
    .filter((block) => block.visit && (!block.address_confirmed || !location(tasks.get(block.task_id))))
    .map((block) => ({ id: block.id, reason: "address" }));
  if (order === false) return { stops, before, after: before, skipped, proposal: [] };
  let earliest = ms(day.start);
  let last: DispatchTask | undefined;
  while (movable.length > 0) {
    const previous = last;
    const [next] = movable
      .map((block) => ({ block, rank: order?.indexOf(block.id) ?? -1,
        travel: travelMinutes(previous, tasks.get(block.task_id)) ?? 0 }))
      .toSorted((a, b) => {
        const rank = (a.rank < 0 ? Infinity : a.rank) - (b.rank < 0 ? Infinity : b.rank);
        return rank || a.travel - b.travel || start(a.block) - start(b.block);
      });
    const { block } = next;
    movable.splice(movable.indexOf(block), 1);
    const task = tasks.get(block.task_id);
    const busy = [...fixed, ...proposed].toSorted((a, b) => start(a) - start(b));
    const slot = task && feasibleTime(plan, day, block, task, busy, tasks, earliest);
    if (slot) {
      proposed.push(slot);
      earliest = end(slot);
      last = task;
    } else {
      skipped.push({ id: block.id, reason: "capacity" });
    }
  }
  const complete = !skipped.some((stop) => stop.reason === "capacity");
  const after = complete ? travel([...fixed, ...proposed].toSorted((a, b) => start(a) - start(b))) : before;
  const useProposal = complete && (order !== undefined || after <= before);
  return {
    stops, before, after: useProposal ? after : before, skipped,
    proposal: useProposal ? proposed.filter((candidate) =>
      blocks.some((old) => old.id === candidate.id && start(old) !== start(candidate))) : [],
  };
}
