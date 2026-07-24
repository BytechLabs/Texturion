import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/api/types";

import { taskCoords } from "./map-types";

/** Minimal Task with just the fields taskCoords reads. */
function task(over: Partial<Task>): Task {
  return {
    lat: null,
    lng: null,
    contact: null,
    ...over,
  } as Task;
}

// CN Tower, Toronto vs a Calgary contact (the founder's reported case).
const TORONTO = { lat: 43.6426, lng: -79.3871 };
const CALGARY = { lat: 51.0447, lng: -114.0719 };

describe("taskCoords", () => {
  it("PREFERS the task's own geocode over the contact's", () => {
    const t = task({
      lat: TORONTO.lat,
      lng: TORONTO.lng,
      contact: { id: "c1", name: "Dana", lat: CALGARY.lat, lng: CALGARY.lng },
    });
    expect(taskCoords(t)).toEqual({ ...TORONTO, name: "Dana" });
  });

  it("falls back to the contact's geocode when the task has none", () => {
    const t = task({
      lat: null,
      lng: null,
      contact: { id: "c1", name: "Dana", lat: CALGARY.lat, lng: CALGARY.lng },
    });
    expect(taskCoords(t)).toEqual({ ...CALGARY, name: "Dana" });
  });

  it("returns null when neither the task nor the contact has a geocode", () => {
    expect(taskCoords(task({ contact: null }))).toBeNull();
    expect(
      taskCoords(task({ contact: { id: "c1", name: "D", lat: null, lng: null } })),
    ).toBeNull();
  });

  it("rejects an out-of-range / non-finite task geocode (never plots a bad pin)", () => {
    const t = task({
      lat: 999,
      lng: 0,
      contact: { id: "c1", name: "Dana", lat: CALGARY.lat, lng: CALGARY.lng },
    });
    // Bad own-geocode → falls back to the valid contact geocode, not the pin at 999.
    expect(taskCoords(t)).toEqual({ ...CALGARY, name: "Dana" });
  });
});
