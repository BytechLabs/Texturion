import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Pins what `scripts/check-rig-scenarios.mjs` holds the rig's scenario
 * catalogue to: it cannot drift from docs/RIG.md or the measured journeys, and
 * it says nothing about when a scenario runs, because the rig runs nothing on
 * a timer.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (file: string) => readFileSync(join(REPO, file), "utf8");

type Run = { label?: string };
type Scenario = Record<string, unknown> & {
  id: string;
  runs: Run[];
  dials: number;
  far_end_legs: number;
};
type Registry = { caps: Record<string, unknown>; scenarios: Scenario[] } & Record<string, unknown>;
const guard = (await import(join(REPO, "scripts", "check-rig-scenarios.mjs"))) as {
  REGISTRY_FILE: string;
  DOC_FILE: string;
  JOURNEYS_FILE: string;
  expandIds: (text: string) => string[];
  readDoc: (markdown: string) => {
    problems: string[];
    scenarios: Map<string, { dials: string }>;
    rooms: { room: number; runs: string }[];
  };
  judge: (input: { registry: unknown; markdown: string; journeys: unknown }) => {
    problems: string[];
    result: { scenarios: number; rig: number; overHourlyCap: string[]; journeys: number; roomsMatched: number } | null;
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
  it("expands the id ranges 4.1 writes", () => {
    expect(guard.expandIds("S04-S06, D09-D12 and D02p")).toEqual(["S04", "S05", "S06", "D09", "D10", "D11", "D12", "D02p"]);
  });

  it("reads every 4.2 row with its dials per run, and 4.1's four room rows", () => {
    const doc = guard.readDoc(markdown);
    expect(doc.problems).toEqual([]);
    expect(doc.scenarios.get("D12")?.dials).toBe("3");
    expect(doc.scenarios.get("R00")?.dials).toBe("0");
    expect(doc.rooms.map((row) => row.room)).toEqual([4, 3, 2, 1]);
  });
});

describe("the real registry", () => {
  it("matches the doc and the journeys", () => {
    const { problems: found, result } = guard.judge({ registry: fresh(), markdown, journeys });
    expect(found).toEqual([]);
    expect(result?.scenarios).toBeGreaterThan(0);
    expect(result?.journeys).toBe(Object.keys(journeys.journeys).length);
    expect(result?.roomsMatched).toBe(result?.scenarios);
  });

  it("lists the runs the guard's hourly cap can never admit, instead of failing them", () => {
    const { problems: found, result } = guard.judge({ registry: fresh(), markdown, journeys });
    expect(found).toEqual([]);
    expect(result?.overHourlyCap).toEqual(expect.arrayContaining(["S07 (4)", "S09 (5)"]));
  });

  it("says nothing about when a scenario runs", () => {
    const registry = fresh();
    expect(Object.keys(registry)).not.toContain("budget");
    for (const s of registry.scenarios) {
      expect(Object.keys(s), s.id).not.toContain("cadence");
      expect(Object.keys(s), s.id).not.toContain("scheduled");
      for (const run of s.runs) expect(Object.keys(run).filter((key) => key !== "label"), s.id).toEqual([]);
    }
  });
});

describe("scheduling fields", () => {
  it("fails every field the catalogue used to schedule with", () => {
    const cadence = fresh();
    byId(cadence, "S11").cadence = "Weekly (2)";
    expect(problems(cadence)).toMatch(/S11: "cadence" is a scheduling field, and the rig runs nothing on a timer/);

    const scheduled = fresh();
    byId(scheduled, "S11").scheduled = true;
    expect(problems(scheduled)).toMatch(/S11: "scheduled" is a scheduling field/);

    const period = fresh();
    byId(period, "S22").runs = [{ every: "7d" } as Run];
    expect(problems(period)).toMatch(/S22 runs\[0\]: "every" is a scheduling field/);

    const placed = fresh();
    byId(placed, "S05").runs = [{ offset_days: 3, hour_utc: 8 } as Run];
    expect(problems(placed)).toMatch(/S05 runs\[0\]: "offset_days" is a scheduling field/);
    expect(problems(placed)).toMatch(/S05 runs\[0\]: "hour_utc" is a scheduling field/);

    const monthly = fresh();
    monthly.caps.retry_reserve = 0.2;
    monthly.caps.repro_reserve_dials = 60;
    monthly.caps.days_per_month = 30;
    expect(problems(monthly)).toMatch(/caps: "retry_reserve" is a scheduling field/);
    expect(problems(monthly)).toMatch(/caps: "repro_reserve_dials" is a scheduling field/);
    expect(problems(monthly)).toMatch(/caps: "days_per_month" is a scheduling field/);

    const budget = fresh();
    (budget as Record<string, unknown>).budget = budget.caps;
    expect(problems(budget)).toMatch(/scenarios\.json: "budget" is a scheduling field/);
  });
});

describe("the guard's caps", () => {
  it("are taken from the doc, so none can be widened here", () => {
    const window = fresh();
    window.caps.window_utc = [0, 24];
    expect(problems(window)).toMatch(/caps: window_utc is \[0,24\] but docs\/RIG\.md says \[4,10\]/);
    const cap = fresh();
    cap.caps.hourly_cap = 4;
    expect(problems(cap)).toMatch(/hourly_cap is 4 but docs\/RIG\.md says 3/);
    const day = fresh();
    day.caps.daily_cap = 30;
    expect(problems(day)).toMatch(/daily_cap is 30 but docs\/RIG\.md says 18/);
  });

  it("fails a doc whose cap sentences it cannot read, rather than trusting the registry", () => {
    const blind = markdown.replace("the window is 04:00-10:00 UTC", "the window is the quiet hours");
    expect(guard.judge({ registry: fresh(), markdown: blind, journeys }).problems.join("\n")).toMatch(
      /expected one "the window is HH:00-HH:00 UTC", found 0/,
    );
  });

  it("fails a run that is more dials than the guard's daily cap, which no day could admit", () => {
    const registry = fresh();
    byId(registry, "S05").dials = 19;
    expect(problems(registry)).toMatch(/S05: one run is \d+ dials and the daily cap is 18/);
  });
});

describe("variants", () => {
  it("fails dropping a variant 4.2 names, or every one of them", () => {
    const one = fresh();
    byId(one, "S07").runs = byId(one, "S07").runs.filter((run) => run.label !== "hop-cap");
    expect(problems(one)).toMatch(/S07: 4.2 names the hop cap variant\(s\), and runs lists no such run/);
    const all = fresh();
    byId(all, "E01").runs = byId(all, "E01").runs.slice(0, 1);
    expect(problems(all)).toMatch(/E01: 4.2 names the notifications revoked, force stopped variant\(s\)/);
  });

  it("fails a variant 4.2 does not name", () => {
    const invented = fresh();
    byId(invented, "S07").runs.push({ label: "busy" });
    expect(problems(invented)).toMatch(/S07: runs\[4\] is labelled "busy", and 4.2's row does not name it/);
    expect(problems(invented)).toMatch(/S07: runs lists variant\(s\) busy that 4.2 does not name/);
  });

  it("fails several runs where one is unlabelled, and a label twice", () => {
    const unlabelled = fresh();
    byId(unlabelled, "S25").runs = [{ label: "daytime" }, {}];
    expect(problems(unlabelled)).toMatch(/S25: a scenario with several runs labels each of them/);
    const twice = fresh();
    byId(twice, "S25").runs = [{ label: "night" }, { label: "night" }];
    expect(problems(twice)).toMatch(/S25 runs\[1\]: label "night" repeats an earlier run/);
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
  it("fails a dial count that differs from 4.2's dials per run", () => {
    const recount = fresh();
    byId(recount, "S11").far_end_legs = 2;
    expect(problems(recount)).toMatch(/S11: dials \+ far_end_legs is 3 but 4.2 says 2 a run/);
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
  it("fails a duplicate id, an unknown lane and a negative count", () => {
    const duplicate = fresh();
    duplicate.scenarios.push({ ...byId(duplicate, "S22") });
    expect(problems(duplicate)).toMatch(/S22 is listed twice/);
    const lane = fresh();
    byId(lane, "S22").lane = "pager";
    expect(problems(lane)).toMatch(/S22: lane "pager" is not one of/);
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
  expect(ciGuardSteps()).toContainEqual({ name: "Guard the rig's scenario catalogue", run: "node scripts/check-rig-scenarios.mjs" });
});
