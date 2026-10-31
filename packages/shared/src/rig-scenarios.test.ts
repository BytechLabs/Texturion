import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Pins the arithmetic `scripts/check-rig-scenarios.mjs` budgets the rig with,
 * and that the registry cannot drift from docs/RIG.md or the measured
 * journeys without failing.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (file: string) => readFileSync(join(REPO, file), "utf8");

type Run = { label?: string; every: string; offset_days?: number; hour_utc?: number };
type Scenario = Record<string, unknown> & {
  id: string;
  runs: Run[];
  dials: number;
  far_end_legs: number;
  scheduled: boolean;
  unscheduled_because?: string;
};
type Registry = { budget: Record<string, unknown>; scenarios: Scenario[] } & Record<string, unknown>;
type Totals = {
  scheduledDials: number;
  scheduledTotal: number;
  writtenDials: number;
  ceiling: number;
  busiestHour: number;
  busiestDay: number;
};
const guard = (await import(join(REPO, "scripts", "check-rig-scenarios.mjs"))) as {
  REGISTRY_FILE: string;
  DOC_FILE: string;
  JOURNEYS_FILE: string;
  periodMinutes: (every: unknown) => number | null;
  expandIds: (text: string) => string[];
  readDoc: (markdown: string) => {
    problems: string[];
    scenarios: Map<string, { cadence: string }>;
    rooms: { room: number; runs: string }[];
  };
  budget: (registry: Registry) => Totals;
  judge: (input: { registry: unknown; markdown: string; journeys: unknown }) => {
    problems: string[];
    result: { totals: Totals; scenarios: number; journeys: number; roomsMatched: number } | null;
  };
};

const markdown = read(guard.DOC_FILE);
const journeys = JSON.parse(read(guard.JOURNEYS_FILE)) as { journeys: Record<string, Record<string, unknown>> };
const fresh = () => JSON.parse(read(guard.REGISTRY_FILE)) as Registry;
const byId = (registry: Registry, id: string) => {
  const found = registry.scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};
const problems = (registry: Registry, journeyFile: unknown = journeys) =>
  guard.judge({ registry, markdown, journeys: journeyFile }).problems.join("\n");

describe("parsing", () => {
  it("reads periods, and refuses ones it does not know", () => {
    expect(guard.periodMinutes("15m")).toBe(15);
    expect(guard.periodMinutes("6h")).toBe(360);
    expect(guard.periodMinutes("14d")).toBe(14 * 1440);
    expect(guard.periodMinutes("push")).toBe(0);
    expect(guard.periodMinutes("weekly")).toBeNull();
    expect(guard.periodMinutes("0d")).toBeNull();
  });

  it("expands the id ranges 4.1 writes", () => {
    expect(guard.expandIds("S04-S06, D09-D12 and D02p")).toEqual(["S04", "S05", "S06", "D09", "D10", "D11", "D12", "D02p"]);
  });

  it("reads every 4.2 row and 4.1's four room rows", () => {
    const doc = guard.readDoc(markdown);
    expect(doc.problems).toEqual([]);
    expect(doc.scenarios.get("D12")?.cadence).toBe("Weekly, alternating (3)");
    expect(doc.rooms.map((row) => row.room)).toEqual([4, 3, 2, 1]);
  });
});

describe("the real registry", () => {
  it("matches the doc and the journeys, and fits the budget", () => {
    const { problems: found, result } = guard.judge({ registry: fresh(), markdown, journeys });
    expect(found).toEqual([]);
    expect(result?.scenarios).toBeGreaterThan(0);
    expect(result?.journeys).toBe(Object.keys(journeys.journeys).length);
    expect(result?.roomsMatched).toBe(result?.scenarios);
    expect(result?.totals.scheduledTotal).toBeLessThanOrEqual(result?.totals.ceiling ?? 0);
    expect(result?.totals.busiestHour).toBeLessThanOrEqual(3);
  });

  it("budgets 4.2 as written over the cap, which is why some scenarios are unscheduled", () => {
    const totals = guard.budget(fresh());
    expect(totals.writtenDials * 1.2 + 60).toBeGreaterThan(totals.ceiling);
  });
});

describe("the budget", () => {
  it("is the formula 4.1 states: dials x runs a month, x 1.2, + 60, against 18 x 30", () => {
    const registry = fresh();
    registry.scenarios = [byId(registry, "D02")];
    const totals = guard.budget(registry);
    expect(totals.scheduledDials).toBe(3 * 30);
    expect(totals.scheduledTotal).toBeCloseTo(90 * 1.2 + 60);
    expect(totals.ceiling).toBe(540);
  });

  it("fails a run that alone exceeds the hourly cap", () => {
    const registry = fresh();
    const s07 = byId(registry, "S07");
    s07.scheduled = true;
    delete s07.unscheduled_because;
    expect(problems(registry)).toMatch(/S07: one run is 4 dials and the hourly cap is 3/);
  });

  it("fails an unscheduled hourly-cap scenario that would fit", () => {
    const registry = fresh();
    const s05 = byId(registry, "S05");
    s05.scheduled = false;
    s05.unscheduled_because = "hourly-cap";
    expect(problems(registry)).toMatch(/S05: 2 dials fit the hourly cap of 3; schedule it/);
  });

  it("fails two runs placed in one hour past the cap", () => {
    const registry = fresh();
    byId(registry, "S05").runs = [{ every: "14d", offset_days: 0, hour_utc: 8 }];
    expect(problems(registry)).toMatch(/over the hourly cap of 3: day 0 08:00 UTC holds 5 dials \(S05, D04\)/);
  });

  it("fails a paid run outside the dial window", () => {
    const registry = fresh();
    byId(registry, "S05").runs = [{ every: "14d", offset_days: 3, hour_utc: 12 }];
    expect(problems(registry)).toMatch(/S05 runs\[0\]: hour_utc must be inside the dial window 04:00-10:00 UTC/);
  });

  it("fails a schedule over the monthly cap", () => {
    const registry = fresh();
    registry.budget.daily_cap = 12;
    expect(problems(registry)).toMatch(/the schedule needs .* dials a month with reserves and the cap allows 360/);
  });

  it("takes the cap, the reserves and the window from the doc, so none can be widened here", () => {
    const window = fresh();
    window.budget.window_utc = [0, 24];
    expect(problems(window)).toMatch(/budget: window_utc is \[0,24\] but docs\/RIG\.md says \[4,10\]/);
    const reserves = fresh();
    reserves.budget.retry_reserve = 0;
    reserves.budget.repro_reserve_dials = 1;
    expect(problems(reserves)).toMatch(/retry_reserve is 0 but docs\/RIG\.md says 0.2/);
    expect(problems(reserves)).toMatch(/repro_reserve_dials is 1 but docs\/RIG\.md says 60/);
    const cap = fresh();
    cap.budget.hourly_cap = 4;
    expect(problems(cap)).toMatch(/hourly_cap is 4 but docs\/RIG\.md says 3/);
  });

  it("fails a doc whose budget sentences it cannot read, rather than trusting the registry", () => {
    const blind = markdown.replace("the window is 04:00-10:00 UTC", "the window is the quiet hours");
    expect(guard.judge({ registry: fresh(), markdown: blind, journeys }).problems.join("\n")).toMatch(
      /expected one "the window is HH:00-HH:00 UTC", found 0/,
    );
  });

  it("excuses a scenario as phase-4 only when 4.2 puts it in Phase 4", () => {
    for (const id of ["S01", "D02"]) {
      const registry = fresh();
      const s = byId(registry, id);
      s.scheduled = false;
      s.unscheduled_because = "phase-4";
      expect(problems(registry)).toMatch(new RegExp(`${id}: unscheduled_because is "phase-4" but 4.2 does not put ${id} in Phase 4`));
    }
  });
});

describe("runs beyond the first", () => {
  it("fails dropping a variant 4.2 names, or every one of them", () => {
    const one = fresh();
    byId(one, "S07").runs = byId(one, "S07").runs.filter((run) => run.label !== "hop-cap");
    expect(problems(one)).toMatch(/S07: 4.2 runs the hop cap variant\(s\) monthly, and runs lists no such run/);
    const all = fresh();
    byId(all, "E01").runs = byId(all, "E01").runs.slice(0, 1);
    expect(problems(all)).toMatch(/E01: 4.2 runs the notifications revoked, force stopped variant\(s\) weekly/);
  });

  it("fails a variant at another period than 4.2's, or one 4.2 does not name", () => {
    const fast = fresh();
    byId(fast, "S07").runs[1].every = "1d";
    expect(problems(fast)).toMatch(/S07: runs\[1\] is every 1d, but 4.2 runs its variants monthly \(30d\)/);
    const invented = fresh();
    byId(invented, "S07").runs.push({ label: "busy", every: "30d" });
    expect(problems(invented)).toMatch(/S07: runs lists variant\(s\) busy that 4.2 does not name/);
  });

  it("fails dropping one of S25's two runs, and an extra run on a one-run row", () => {
    const night = fresh();
    byId(night, "S25").runs = byId(night, "S25").runs.slice(0, 1);
    expect(problems(night)).toMatch(/S25: lists 1 run\(s\), but 4.2 says "Weekly, two runs \(0\)"/);
    const extra = fresh();
    byId(extra, "S22").runs.push({ every: "7d" });
    expect(problems(extra)).toMatch(/S22: lists 2 runs, but 4.2's row implies one/);
  });
});

describe("peaks", () => {
  it("fails an outbound peak above the dials, or zero for a scenario that dials", () => {
    const zero = fresh();
    byId(zero, "S03").peak_concurrent_outbound_legs = 0;
    expect(problems(zero)).toMatch(/S03: dials \d+ but peaks at 0 outbound legs/);
    const over = fresh();
    byId(over, "D02").peak_concurrent_outbound_legs = 3;
    expect(problems(over)).toMatch(/D02: peaks at 3 outbound legs but dials only 2/);
  });

  it("fails a total peak below the outbound peak or above every leg the run creates", () => {
    const registry = fresh();
    byId(registry, "S07").peak_concurrent_legs = 5;
    expect(problems(registry)).toMatch(/S07: peak_concurrent_legs 5 must be between its outbound peak \(2\) and its rig dials \(4\)/);
  });
});

describe("the journeys", () => {
  it("fails a scenario whose counts differ from its journey", () => {
    const registry = fresh();
    byId(registry, "S02").peak_concurrent_outbound_legs = 2;
    expect(problems(registry)).toMatch(/S02: peak_concurrent_outbound_legs is 2 but the "inbound-answered" journey measured 1/);
  });

  it("fails a journey no scenario claims, and a scenario naming a journey that does not exist", () => {
    const extra = { journeys: { ...journeys.journeys, "consult-transfer": { rig_scenario: "S08" } } };
    expect(problems(fresh(), extra)).toMatch(/journey "consult-transfer" belongs to no scenario/);
    const registry = fresh();
    byId(registry, "S03").journey = "missing";
    expect(problems(registry)).toMatch(/S03: journey "missing" is not in/);
  });

  it("fails when the journey file is empty, since the check would read nothing", () => {
    expect(problems(fresh(), { journeys: {} })).toMatch(/no journeys/);
  });
});

describe("the doc", () => {
  it("fails a cadence or dial count that differs from 4.2", () => {
    const registry = fresh();
    byId(registry, "S11").cadence = "Daily (2)";
    expect(problems(registry)).toMatch(/S11: cadence is "Daily \(2\)" but 4.2 says "Weekly \(2\)"/);
    const recount = fresh();
    byId(recount, "S11").far_end_legs = 2;
    expect(problems(recount)).toMatch(/S11: dials \+ far_end_legs is 3 but 4.2 budgets 2 a run/);
  });

  it("fails a first run whose period is not the cadence's", () => {
    const registry = fresh();
    byId(registry, "D10").runs = [{ every: "7d", offset_days: 2, hour_utc: 8 }];
    expect(problems(registry)).toMatch(/D10: its first run is every 7d, but 4.2's "Weekly, alternating \(3\)" means every 14d/);
  });

  it("fails a room that differs from 4.1's table", () => {
    const registry = fresh();
    byId(registry, "S03").min_room = 4;
    expect(problems(registry)).toMatch(/S03: min_room is 4 but 4.1's room table runs it from room 3/);
  });

  it("fails a scenario missing from the registry, and one the doc does not have", () => {
    const registry = fresh();
    registry.scenarios = registry.scenarios.filter((s) => s.id !== "S22");
    expect(problems(registry)).toMatch(/4.2 lists S22 and tools\/rig\/scenarios\.json does not/);
    const extra = fresh();
    extra.scenarios.push({ ...byId(extra, "S22"), id: "S99" });
    expect(problems(extra)).toMatch(/S99 is in tools\/rig\/scenarios\.json but not in docs\/RIG\.md 4.2/);
  });
});

describe("fields", () => {
  it("fails a duplicate id, an unknown lane, a bad period and a negative count", () => {
    const duplicate = fresh();
    duplicate.scenarios.push({ ...byId(duplicate, "S22") });
    expect(problems(duplicate)).toMatch(/S22 is listed twice/);
    const lane = fresh();
    byId(lane, "S22").lane = "pager";
    expect(problems(lane)).toMatch(/S22: lane "pager" is not one of/);
    const period = fresh();
    byId(period, "S22").runs = [{ every: "weekly" }];
    expect(problems(period)).toMatch(/S22 runs\[0\]: every "weekly" is not a period/);
    const negative = fresh();
    byId(negative, "S22").dials = -1;
    expect(problems(negative)).toMatch(/S22: dials must be a non-negative integer/);
  });

  it("fails a scenario with no dials that claims a room", () => {
    const registry = fresh();
    byId(registry, "S22").min_room = 2;
    expect(problems(registry)).toMatch(/S22: a scenario with no dials holds no legs and needs no room/);
  });
});

/** Each step of the checks.yml job that runs the rig's other guards, as its name and command. */
function ciGuardSteps(): { name: string; run: string }[] {
  const lines = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8").split(/\r?\n/);
  const jobs = lines.indexOf("jobs:");
  const starts = lines.flatMap((line, i) => (i > jobs && /^ {2}[\w-]+:\s*$/.test(line) ? [i] : []));
  const anchor = lines.findIndex((line) => /^\s*run: node scripts\/check-rig-no-e164\.mjs\s*$/.test(line));
  if (jobs === -1 || anchor === -1) return [];
  const start = starts.filter((i) => i < anchor).at(-1) ?? jobs;
  const end = starts.find((i) => i > anchor) ?? lines.length;
  const unquote = (text: string) => text.replace(/^(["'])(.*)\1$/, "$2");
  const steps: { name: string; run: string }[] = [];
  for (let i = start; i < end - 1; i += 1) {
    const name = /^\s*- name: (.+?)\s*$/.exec(lines[i] ?? "")?.[1];
    const command = /^\s*run: (.+?)\s*$/.exec(lines[i + 1] ?? "")?.[1];
    if (name !== undefined && command !== undefined) steps.push({ name: unquote(name), run: unquote(command) });
  }
  return steps;
}

it("runs in the CI guard job", () => {
  expect(ciGuardSteps()).toContainEqual({ name: "Guard the rig's scenarios and dial budget", run: "node scripts/check-rig-scenarios.mjs" });
});
