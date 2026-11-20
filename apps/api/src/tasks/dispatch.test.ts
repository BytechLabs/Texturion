import { describe, expect, it } from "vitest";

import { dispatchConflicts, dispatchRoute, dispatchSlots, dispatchWorkload, draftPlan } from "./dispatch";
import type { DispatchBlock, DispatchPlan, DispatchTask } from "./dispatch";

const today = "2026-11-23";
const time = (hour: string) => `${today}T${hour}:00.000Z`;
const day = { date: today, start: time("00:00"), end: "2026-11-24T00:00:00.000Z",
  opens_at: time("08:00"), closes_at: time("17:00"), closed: false };

function task(id: string, fields: Partial<DispatchTask> = {}): DispatchTask {
  return {
    id, title: id, due_on: null, due_at: null, dispatch_estimate: 30, windows: [],
    assigned_user_id: null, address: null, lat: null, lng: null, updated_at: time("07:00"),
    done: false, scheduled_count: 0, ...fields,
  };
}

function block(id: string, taskId: string, from: string, to: string, fields: Partial<DispatchBlock> = {}): DispatchBlock {
  return {
    id, task_id: taskId, starts_at: time(from), ends_at: time(to), assignee_id: "crew",
    locked: false, visit: false, address_confirmed: false, ...fields,
  };
}

function plan(tasks: DispatchTask[], blocks: DispatchBlock[]): DispatchPlan {
  return { timezone: "UTC", revision: 0, members: [{ id: "crew", name: "Maya" }],
    days: [day], tasks, blocks, queue_truncated: false };
}

describe("dispatch planning", () => {
  it("finds an uninterrupted slot within customer hours around other work", () => {
    const state = plan([
      task("remote"), task("new", { windows: [{ start: time("10:00"), end: time("12:00") }] }),
    ], [block("call", "remote", "10:00", "10:30")]);
    const slots = dispatchSlots(state, day, {
      id: "next", task_id: "new", duration: 40, visit: false, confirm_address: false,
    }, Date.parse(time("08:00")));
    expect(slots).toMatchObject([{ starts_at: time("10:30"), ends_at: time("11:10") }]);
    expect(dispatchSlots(state, day, {
      id: "next", task_id: "new", duration: 100, visit: false, confirm_address: false,
    }, Date.parse(time("08:00")))).toEqual([]);
  });

  it("counts draft changes and travel in workload without changing the due date", () => {
    const first = task("first", { address: "A", lat: 43.65, lng: -79.38, scheduled_count: 1, due_on: "2026-11-27" });
    const second = task("second", { address: "B", lat: 43.68, lng: -79.4 });
    const onsite = { visit: true, address_confirmed: true };
    const original = plan([first, second], [block("a", first.id, "09:00", "09:30", onsite)]);
    const added = block("b", second.id, "10:00", "10:30", onsite);
    const next = draftPlan(original, { details: [], blocks: [{
      ...added, remove: false, updated_at: second.updated_at, reschedule: false, confirm_address: true,
    }] });
    expect(next.tasks[0].due_on).toBe("2026-11-27");
    expect(next.tasks[1].scheduled_count).toBe(1);
    expect(original.tasks[1].scheduled_count).toBe(0);
    expect(dispatchWorkload(next)[0]).toMatchObject({ booked: 68, available: 540, travel: 8 });
  });

  it("skips a worker's break for slots and drive time and counts only available minutes", () => {
    const onsite = { visit: true, address_confirmed: true };
    const state = plan([
      task("first", { address: "A", lat: 43.65, lng: -79.38 }),
      task("second", { address: "B", lat: 43.68, lng: -79.4 }),
      task("remote"),
    ], [block("a", "first", "09:00", "10:00", onsite), block("b", "second", "11:00", "11:40", onsite)]);
    state.members[0].availability = { [today]: {
      start: time("09:00"), end: time("15:00"), breaks: [{ start: time("10:00"), end: time("11:00") }],
    } };
    expect(dispatchConflicts(state, new Set(["b"]))).toEqual([{ id: "b", reason: "travel", minutes: 8 }]);
    expect(dispatchWorkload(state)).toMatchObject([{ available: 300, booked: 108, overloaded: true }]);
    expect(dispatchSlots(state, day, {
      id: "call", task_id: "remote", duration: 15, visit: false, confirm_address: false,
    }, Date.parse(time("09:55")))).toMatchObject([{ starts_at: time("11:45") }]);
  });

  it("explains a short drive gap and retains locked times in a route proposal", () => {
    const onsite = { visit: true, address_confirmed: true };
    const state = plan([
      task("first", { address: "A", lat: 43.65, lng: -79.38 }),
      task("locked", { address: "B", lat: 43.68, lng: -79.4 }),
      task("remote"),
      task("missing", { address: "C" }),
    ], [
      block("a", "first", "09:00", "09:30", onsite),
      block("b", "locked", "09:35", "10:00", { ...onsite, locked: true }),
      block("c", "remote", "08:00", "08:30"),
      block("d", "missing", "11:00", "11:30", onsite),
    ].toSorted((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)));
    expect(dispatchConflicts(state, new Set(["a"]))).toEqual([{ id: "a", reason: "travel", minutes: 3 }]);
    const result = dispatchRoute(state, day, "crew");
    expect(result.skipped).toEqual([{ id: "d", reason: "address" }]);
    expect(result.proposal).toMatchObject([{ id: "a", starts_at: time("08:30") }]);
    expect(result.stops.find((stop) => stop.id === "b")?.starts_at).toBe(time("09:35"));
  });
});
