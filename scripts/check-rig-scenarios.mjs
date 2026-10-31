#!/usr/bin/env node
/**
 * D142: the rig's scenario registry, and the dial budget it has to fit.
 *
 *   node scripts/check-rig-scenarios.mjs
 *
 * `tools/rig/scenarios.json` is the machine copy of docs/RIG.md 4.2. Telnyx
 * counts every leg as a dial, and the rig's default cap is 18 dials a day and
 * 3 an hour (4.1), so this checks four things:
 *
 * - THE BUDGET. Scheduled rig dials (`dials + far_end_legs`) times runs per
 *   month, plus the 20% retry reserve, plus the 60-dial repro reserve, fit the
 *   daily cap times 30. Every scheduled run is also laid out on its UTC hour
 *   over a whole cycle, and no hour may exceed the hourly cap or sit outside
 *   the dial window. A run that alone has more dials than the hourly cap can
 *   never be scheduled under it, and has to say so.
 * - THE JOURNEYS. A scenario measured by a hermetic journey in
 *   apps/api/e2e/call-journey-budget.json carries exactly the journey's dials,
 *   far-end legs and peaks, and every journey there belongs to a scenario.
 * - THE DOC. The ids, names, far ends and cadence text equal the 4.2 table,
 *   the dials in each cadence's brackets equal the entry's rig dials, the runs
 *   are the ones the row implies (its variants at their period, or "two
 *   runs"), the minimum room equals what 4.1's room table implies, a "phase-4"
 *   scenario is one 4.2 puts in Phase 4, every X defect 4.2 names is listed and
 *   exists in 4.3, and the cap, reserves and window are the ones 4.1 and 3.5
 *   state.
 * - THE FIELDS. Ids are unique, lanes are known, frequencies parse, counts are
 *   non-negative integers, and peaks fit the legs a run creates.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REGISTRY_FILE = "tools/rig/scenarios.json";
export const DOC_FILE = "docs/RIG.md";
export const JOURNEYS_FILE = "apps/api/e2e/call-journey-budget.json";
export const SCHEMA = "loonext.rig-scenarios.v1";

const COUNT_FIELDS = ["dials", "far_end_legs", "peak_concurrent_outbound_legs", "min_room"];
const JOURNEY_FIELDS = ["dials", "far_end_legs", "peak_concurrent_legs", "peak_concurrent_outbound_legs"];
const SCENARIO_KEYS = [
  "id",
  "name",
  "lane",
  "far_end",
  "cadence",
  "runs_on",
  "runs",
  "scheduled",
  "unscheduled_because",
  ...COUNT_FIELDS,
  "peak_concurrent_legs",
  "journey",
  "note",
];
const RUN_KEYS = ["label", "every", "offset_days", "hour_utc"];
export const RUNS_ON = ["rig", "ci", "production", "workstation"];
export const UNSCHEDULED_BECAUSE = ["hourly-cap", "phase-4"];

/** The leading words of a 4.2 cadence, and the period each one means. */
export const CADENCE_WORDS = [
  ["Every 15 min", "15m"],
  ["Every push", "push"],
  ["Hourly", "1h"],
  ["4 times a day", "6h"],
  ["Daily", "1d"],
  ["Every 2 days", "2d"],
  ["Every 3 days", "3d"],
  ["Weekly", "7d"],
  ["Fortnightly", "14d"],
  ["Monthly", "30d"],
];

const UNIT_MINUTES = { m: 1, h: 60, d: 1440 };

/** Minutes between runs, or null for a period that does not parse. `push` is 0. */
export function periodMinutes(every) {
  if (every === "push") return 0;
  const match = /^([1-9]\d*)([mhd])$/.exec(typeof every === "string" ? every : "");
  return match ? Number(match[1]) * UNIT_MINUTES[match[2]] : null;
}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const rigDials = (scenario) => scenario.dials + scenario.far_end_legs;

/** `S04-S06` and `D09-D12` to every id between, inclusive. */
export function expandIds(text) {
  const ids = [];
  for (const match of text.matchAll(/\b(PW|[RHGPSDEKX])(\d{2})p?\b(?:-(?:PW|[RHGPSDEKX])?(\d{2})\b)?/g)) {
    const [whole, prefix, from, to] = match;
    if (to === undefined) {
      ids.push(whole);
      continue;
    }
    for (let n = Number(from); n <= Number(to); n += 1) ids.push(`${prefix}${String(n).padStart(2, "0")}`);
  }
  return ids;
}

/** The lines of one `### <number>` section of a Markdown document. */
export function sectionLines(markdown, number) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`### ${number} `));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3} /.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** A Markdown table's body rows as trimmed cells, header and rule dropped. */
export function tableRows(lines) {
  return lines
    .filter((line) => line.trim().startsWith("|"))
    .slice(1)
    .filter((line) => !/^\|\s*-/.test(line.trim()))
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
}

/** What the doc says about each scenario: 4.2's rows, 4.1's room table, 4.3's defects. */
export function readDoc(markdown) {
  const problems = [];
  const scenarios = new Map();
  const s42 = sectionLines(markdown, "4.2");
  if (s42 === null) return { problems: [`${DOC_FILE} has no section 4.2`], scenarios, rooms: [], defects: { named: [], known: [] } };
  for (const cells of tableRows(s42)) {
    if (cells.length !== 5) {
      problems.push(`${DOC_FILE} 4.2: a row has ${cells.length} cells, not 5: ${cells[0] ?? ""}`);
      continue;
    }
    const [idCell, name, farEnd, verify, cadence] = cells;
    const ids = idCell.split(",").map((id) => id.trim());
    for (const id of ids) scenarios.set(id, { id, name, far_end: farEnd, verify, cadence, rowIds: ids });
  }

  const rooms = [];
  const s41 = sectionLines(markdown, "4.1");
  if (s41 === null) {
    problems.push(`${DOC_FILE} has no section 4.1`);
  } else {
    for (const cells of tableRows(s41)) {
      const room = /^(\d+)(?: or (?:more|less))?$/.exec(cells[0] ?? "");
      if (!room) continue;
      rooms.push({ room: Number(room[1]), runs: cells[1] ?? "" });
    }
    if (rooms.length === 0) problems.push(`${DOC_FILE} 4.1: no room table found`);
  }

  const named = s42 === null ? [] : [...new Set(s42.join("\n").match(/\bX\d{1,3}\b/g) ?? [])];
  const s43 = sectionLines(markdown, "4.3");
  const known = s43 === null ? [] : tableRows(s43).map((cells) => cells[0]);
  const { budget, problems: budgetProblems } = budgetFromDoc(markdown, s41);
  problems.push(...budgetProblems);
  return { problems, scenarios, rooms, defects: { named, known }, budget };
}

/** The cap, reserves and window as 4.1 and 3.5 state them. */
export function budgetFromDoc(markdown, s41) {
  const problems = [];
  const budget = {};
  const text41 = (s41 ?? []).join("\n");
  const cap = /(\d+) dials a day and (\d+) an hour/.exec(text41);
  const rule = /plus a (\d+)% retry reserve, plus a (\d+)-dial monthly repro reserve, must fit the daily cap times (\d+)/.exec(
    text41,
  );
  const windows = [...markdown.matchAll(/the window is (\d{2}):00-(\d{2}):00 UTC/g)];
  if (cap === null) problems.push(`${DOC_FILE} 4.1: cannot read the default cap ("N dials a day and N an hour")`);
  else Object.assign(budget, { daily_cap: Number(cap[1]), hourly_cap: Number(cap[2]) });
  if (rule === null) problems.push(`${DOC_FILE} 4.1: cannot read the budget rule's reserves and month`);
  else {
    Object.assign(budget, {
      retry_reserve: Number(rule[1]) / 100,
      repro_reserve_dials: Number(rule[2]),
      days_per_month: Number(rule[3]),
    });
  }
  if (windows.length !== 1) {
    problems.push(`${DOC_FILE}: expected one "the window is HH:00-HH:00 UTC", found ${windows.length}`);
  } else {
    budget.window_utc = [Number(windows[0][1]), Number(windows[0][2])];
  }
  return { budget, problems };
}

/**
 * The totals 4.1 states in prose: the encoded schedule's dials a month with
 * and without the reserves, 4.2's at its written cadence, and the cycle's
 * busiest hour and day. They are arithmetic on the registry, so a cadence
 * edit that forgets them is caught here rather than left stale.
 */
export function statedTotals(markdown) {
  const text41 = (sectionLines(markdown, "4.1") ?? []).join("\n");
  const scheduled = /([\d.]+) scheduled dials a month, ([\d.]+) with both reserves/.exec(text41);
  const written = /would need ([\d.]+) dials a month \(([\d.]+) with reserves\)/.exec(text41);
  const cycle = /Over its (\d+)-day cycle the busiest hour holds (\d+) dials and the busiest day (\d+)/.exec(text41);
  const missing = [];
  if (scheduled === null) missing.push('"N scheduled dials a month, N with both reserves"');
  if (written === null) missing.push('"would need N dials a month (N with reserves)"');
  if (cycle === null) missing.push('"Over its N-day cycle the busiest hour holds N dials and the busiest day N"');
  if (missing.length > 0) return { stated: null, problems: [`${DOC_FILE} 4.1: cannot read ${missing.join(", ")}`] };
  return {
    stated: {
      scheduledDials: Number(scheduled[1]),
      scheduledTotal: Number(scheduled[2]),
      writtenDials: Number(written[1]),
      writtenTotal: Number(written[2]),
      cycle: Number(cycle[1]),
      busiestHour: Number(cycle[2]),
      busiestDay: Number(cycle[3]),
    },
    problems: [],
  };
}

/**
 * The runs 4.2's row implies beyond the first: named variants at their own
 * period, or a stated number of runs at the row's period. Null when the row
 * implies one run.
 */
export function impliedRuns(row) {
  const many = /, (two|three|four) runs \(/.exec(row.cadence);
  if (many) return { kind: "count", count: ["two", "three", "four"].indexOf(many[1]) + 2 };
  const fromName = /;\s*(.+?) variants$/.exec(row.name);
  const clause = /\*\*(?:(\w+) )?[Vv]ariants:\*\*\s*([^;.]+)/.exec(row.verify ?? "");
  if (!fromName && !clause) return null;
  const listed = fromName ? fromName[1] : clause[2];
  const items = listed
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map(normalLabel)
    .filter(Boolean);
  const word = /; variants (\w+)/.exec(row.cadence)?.[1] ?? clause?.[1];
  const period = word === undefined ? undefined : CADENCE_WORDS.find(([words]) => words.toLowerCase() === word.toLowerCase())?.[1];
  return { kind: "variants", items, period: period ?? null, word: word?.toLowerCase() ?? null };
}

export const normalLabel = (text) => text.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();

/** The smallest room each paid scenario runs at, per 4.1's table. */
export function roomsFromTable(rooms, paidIds) {
  const problems = [];
  const runsAt = new Map();
  for (const { room, runs } of rooms) {
    let set;
    const except = /^Everything except (.+?)(?:\.|$)/.exec(runs);
    const only = /\bonly \(([^)]*)\)/.exec(runs);
    if (except) {
      const out = new Set(expandIds(except[1]));
      set = paidIds.filter((id) => !out.has(id));
    } else if (/^Everything\b/.test(runs)) {
      set = [...paidIds];
    } else if (only) {
      set = expandIds(only[1]);
    } else if (/^No paid calls\b/.test(runs)) {
      set = [];
    } else {
      problems.push(`${DOC_FILE} 4.1: cannot read what runs at room ${room}: "${runs}"`);
      continue;
    }
    for (const id of set) {
      if (!paidIds.includes(id)) {
        problems.push(`${DOC_FILE} 4.1: room ${room} lists ${id}, which is not a paid scenario in the registry`);
        continue;
      }
      runsAt.set(id, Math.min(runsAt.get(id) ?? Infinity, room));
    }
  }
  return { runsAt, problems };
}

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a * b) / gcd(a, b);

/** The budget arithmetic, and every hour the schedule fills. */
export function budget(registry) {
  const b = registry.budget;
  const perMonth = (run) => {
    const minutes = periodMinutes(run.every);
    return minutes === 0 ? 0 : (b.days_per_month * 1440) / minutes;
  };
  const monthly = (list) =>
    list.reduce((sum, s) => sum + s.runs.reduce((acc, run) => acc + rigDials(s) * perMonth(run), 0), 0);
  const scheduled = registry.scenarios.filter((s) => s.scheduled);
  const scheduledDials = monthly(scheduled);
  const writtenDials = monthly(registry.scenarios.filter((s) => s.runs_on === "rig"));
  const withReserves = (dials) => dials * (1 + b.retry_reserve) + b.repro_reserve_dials;
  const ceiling = b.daily_cap * b.days_per_month;

  const placed = scheduled.filter((s) => rigDials(s) > 0).flatMap((s) => s.runs.map((run) => ({ s, run })));
  const cycle = placed.reduce((acc, { run }) => lcm(acc, periodMinutes(run.every) / 1440), 1);
  let busiestHour = 0;
  let busiestDay = 0;
  let daysAtCap = 0;
  const overHours = [];
  for (let day = 0; day < cycle; day += 1) {
    const hours = new Map();
    for (const { s, run } of placed) {
      const every = periodMinutes(run.every) / 1440;
      if (day % every !== run.offset_days) continue;
      const entry = hours.get(run.hour_utc) ?? { dials: 0, ids: [] };
      entry.dials += rigDials(s);
      entry.ids.push(s.id);
      hours.set(run.hour_utc, entry);
    }
    let total = 0;
    for (const [hour, entry] of hours) {
      total += entry.dials;
      busiestHour = Math.max(busiestHour, entry.dials);
      if (entry.dials > b.hourly_cap && overHours.length < 5) {
        overHours.push(`day ${day} ${String(hour).padStart(2, "0")}:00 UTC holds ${entry.dials} dials (${entry.ids.join(", ")})`);
      }
    }
    busiestDay = Math.max(busiestDay, total);
    if (total >= b.daily_cap) daysAtCap += 1;
  }
  return {
    scheduledDials,
    scheduledTotal: withReserves(scheduledDials),
    writtenDials,
    writtenTotal: withReserves(writtenDials),
    ceiling,
    cycle,
    busiestHour,
    busiestDay,
    daysAtCap,
    overHours,
  };
}

function checkBudgetBlock(b, problems) {
  const at = `${REGISTRY_FILE} budget`;
  if (b === null || typeof b !== "object") {
    problems.push(`${at}: missing`);
    return false;
  }
  const counts = ["daily_cap", "hourly_cap", "days_per_month", "repro_reserve_dials"];
  for (const key of counts) {
    if (!isCount(b[key]) || b[key] === 0) problems.push(`${at}: ${key} must be a positive integer`);
  }
  if (typeof b.retry_reserve !== "number" || b.retry_reserve < 0 || b.retry_reserve >= 1) {
    problems.push(`${at}: retry_reserve must be a fraction`);
  }
  const w = b.window_utc;
  if (!Array.isArray(w) || w.length !== 2 || !w.every(isCount) || !(w[0] < w[1] && w[1] <= 24)) {
    problems.push(`${at}: window_utc must be [start hour, end hour) in UTC`);
  }
  return problems.length === 0;
}

function checkScenario(s, lanes, b, problems) {
  const at = `${REGISTRY_FILE} ${typeof s?.id === "string" ? s.id : "scenario"}`;
  if (s === null || typeof s !== "object") {
    problems.push(`${at}: not an object`);
    return false;
  }
  for (const key of Object.keys(s)) {
    if (!SCENARIO_KEYS.includes(key)) problems.push(`${at}: "${key}" is not a scenario field`);
  }
  let ok = true;
  for (const key of ["id", "name", "far_end", "cadence"]) {
    if (typeof s[key] !== "string" || s[key].trim() === "") {
      problems.push(`${at}: ${key} is missing`);
      ok = false;
    }
  }
  if (!lanes.includes(s.lane)) problems.push(`${at}: lane ${JSON.stringify(s.lane)} is not one of ${lanes.join(", ")}`);
  if (!RUNS_ON.includes(s.runs_on)) problems.push(`${at}: runs_on must be one of ${RUNS_ON.join(", ")}`);
  for (const key of COUNT_FIELDS) {
    if (!isCount(s[key])) {
      problems.push(`${at}: ${key} must be a non-negative integer`);
      ok = false;
    }
  }
  if (s.peak_concurrent_legs !== undefined && !isCount(s.peak_concurrent_legs)) {
    problems.push(`${at}: peak_concurrent_legs must be a non-negative integer`);
  }
  if (typeof s.scheduled !== "boolean") problems.push(`${at}: scheduled must be true or false`);
  if (s.scheduled === false && !UNSCHEDULED_BECAUSE.includes(s.unscheduled_because)) {
    problems.push(`${at}: an unscheduled scenario says why: one of ${UNSCHEDULED_BECAUSE.join(", ")}`);
  }
  if (s.scheduled === true && s.unscheduled_because !== undefined) {
    problems.push(`${at}: a scheduled scenario has no unscheduled_because`);
  }
  if (!Array.isArray(s.runs) || s.runs.length === 0) {
    problems.push(`${at}: runs must list at least one run`);
    return false;
  }
  if (!ok) return false;

  const paid = rigDials(s) > 0;
  for (const [i, run] of s.runs.entries()) {
    const where = `${at} runs[${i}]`;
    for (const key of Object.keys(run ?? {})) {
      if (!RUN_KEYS.includes(key)) problems.push(`${where}: "${key}" is not a run field`);
    }
    const minutes = periodMinutes(run?.every);
    if (minutes === null) {
      problems.push(`${where}: every ${JSON.stringify(run?.every)} is not a period like 15m, 6h, 3d or push`);
      ok = false;
      continue;
    }
    if (!paid || s.scheduled !== true) continue;
    // A paid run is placed on a day and an hour, so the hourly cap can be
    // checked against the schedule rather than an average.
    if (minutes === 0 || minutes % 1440 !== 0) {
      problems.push(`${where}: a run with dials must recur in whole days, not ${run.every}`);
      ok = false;
      continue;
    }
    const every = minutes / 1440;
    if (!isCount(run.offset_days) || run.offset_days >= every) {
      problems.push(`${where}: offset_days must be a whole day from 0 to ${every - 1}`);
      ok = false;
    }
    if (!isCount(run.hour_utc) || run.hour_utc < b.window_utc[0] || run.hour_utc >= b.window_utc[1]) {
      problems.push(
        `${where}: hour_utc must be inside the dial window ` +
          `${String(b.window_utc[0]).padStart(2, "0")}:00-${String(b.window_utc[1]).padStart(2, "0")}:00 UTC`,
      );
      ok = false;
    }
  }
  if (s.runs.some((run) => run?.every === "push") && paid) {
    problems.push(`${at}: a run on every push cannot dial`);
  }
  if (s.runs_on !== "rig" && paid) problems.push(`${at}: only the rig dials, so a ${s.runs_on} scenario has 0 dials`);
  if (s.runs_on !== "rig" && s.scheduled !== true) problems.push(`${at}: the rig does not schedule a ${s.runs_on} scenario`);

  if (s.scheduled === true && rigDials(s) > b.hourly_cap) {
    problems.push(
      `${at}: one run is ${rigDials(s)} dials and the hourly cap is ${b.hourly_cap}, so it cannot be ` +
        `scheduled under this cap. Mark it unscheduled_because "hourly-cap"`,
    );
  }
  if (s.unscheduled_because === "hourly-cap" && rigDials(s) <= b.hourly_cap) {
    problems.push(`${at}: ${rigDials(s)} dials fit the hourly cap of ${b.hourly_cap}; schedule it`);
  }
  if (!paid && (s.min_room !== 0 || s.peak_concurrent_outbound_legs !== 0)) {
    problems.push(`${at}: a scenario with no dials holds no legs and needs no room`);
  }
  // Outbound legs are the legs Loonext creates, so a run holds at most as many
  // at once as it dials, and at least one if it dials at all.
  if (s.peak_concurrent_outbound_legs > s.dials) {
    problems.push(`${at}: peaks at ${s.peak_concurrent_outbound_legs} outbound legs but dials only ${s.dials}`);
  }
  if (s.dials > 0 && s.peak_concurrent_outbound_legs === 0) {
    problems.push(`${at}: dials ${s.dials} but peaks at 0 outbound legs; each dial holds a leg`);
  }
  if (s.peak_concurrent_legs !== undefined && isCount(s.peak_concurrent_legs)) {
    if (s.peak_concurrent_legs < s.peak_concurrent_outbound_legs || s.peak_concurrent_legs > rigDials(s)) {
      problems.push(
        `${at}: peak_concurrent_legs ${s.peak_concurrent_legs} must be between its outbound peak ` +
          `(${s.peak_concurrent_outbound_legs}) and its rig dials (${rigDials(s)})`,
      );
    }
  }
  if (paid && s.peak_concurrent_outbound_legs > s.min_room) {
    problems.push(
      `${at}: peaks at ${s.peak_concurrent_outbound_legs} outbound legs but its room is ${s.min_room}; ` +
        `the guard would refuse a leg mid-call`,
    );
  }
  return ok;
}

/** Every run after the first is one 4.2 names, at the period 4.2 gives it. */
function checkImpliedRuns(s, row, expected, shown, problems) {
  const implied = impliedRuns(row);
  const extra = s.runs.slice(1);
  if (implied === null) {
    if (extra.length > 0) {
      problems.push(`${s.id}: lists ${s.runs.length} runs, but 4.2's row implies one; budget only what 4.2 runs`);
    }
    return;
  }
  if (implied.kind === "count") {
    if (s.runs.length !== implied.count) {
      problems.push(`${s.id}: lists ${s.runs.length} run(s), but 4.2 says "${row.cadence}"`);
    }
    for (const [i, run] of s.runs.entries()) {
      if (periodMinutes(run.every) !== expected) {
        problems.push(`${s.id}: runs[${i}] is every ${run.every}, but each of its runs is every ${shown(expected)}`);
      }
      if (typeof run.label !== "string" || !normalLabel(row.verify).includes(normalLabel(run.label))) {
        problems.push(`${s.id}: runs[${i}] needs a label naming the run as 4.2 does`);
      }
    }
    return;
  }
  if (implied.period === null) {
    problems.push(`${s.id}: 4.2 names variants but no frequency for them that this reads`);
    return;
  }
  const labels = extra.map((run) => (typeof run.label === "string" ? normalLabel(run.label) : ""));
  const missing = implied.items.filter((item) => !labels.includes(item));
  const unnamed = labels.filter((label) => !implied.items.includes(label));
  if (missing.length > 0) {
    problems.push(`${s.id}: 4.2 runs the ${missing.join(", ")} variant(s) ${implied.word}, and runs lists no such run`);
  }
  if (unnamed.length > 0) {
    problems.push(`${s.id}: runs lists variant(s) ${unnamed.join(", ") || "(unlabelled)"} that 4.2 does not name`);
  }
  for (const [i, run] of extra.entries()) {
    if (periodMinutes(run.every) !== periodMinutes(implied.period)) {
      problems.push(`${s.id}: runs[${i + 1}] is every ${run.every}, but 4.2 runs its variants ${implied.word} (${implied.period})`);
    }
  }
}

function checkBudgetAgainstDoc(b, docBudget, problems) {
  for (const [key, value] of Object.entries(docBudget)) {
    if (JSON.stringify(b[key]) !== JSON.stringify(value)) {
      problems.push(`${REGISTRY_FILE} budget: ${key} is ${JSON.stringify(b[key])} but ${DOC_FILE} says ${JSON.stringify(value)}`);
    }
  }
}

export function judge({ registry, markdown, journeys }) {
  const problems = [];
  if (registry === null || typeof registry !== "object" || registry.schema !== SCHEMA) {
    return { problems: [`${REGISTRY_FILE}: schema must be "${SCHEMA}"`], result: null };
  }
  if (!checkBudgetBlock(registry.budget, problems)) return { problems, result: null };
  const lanes = Array.isArray(registry.lanes) ? registry.lanes.map((lane) => lane?.id) : [];
  if (lanes.length === 0 || lanes.some((lane) => typeof lane !== "string" || lane === "")) {
    problems.push(`${REGISTRY_FILE}: lanes must list each lane with an id`);
  }
  if (!Array.isArray(registry.scenarios) || registry.scenarios.length === 0) {
    problems.push(`${REGISTRY_FILE}: scenarios is empty. This check is reading nothing`);
    return { problems, result: null };
  }

  const byId = new Map();
  let valid = true;
  for (const s of registry.scenarios) {
    if (!checkScenario(s, lanes, registry.budget, problems)) valid = false;
    if (typeof s?.id !== "string") continue;
    if (byId.has(s.id)) problems.push(`${REGISTRY_FILE}: ${s.id} is listed twice`);
    byId.set(s.id, s);
  }
  for (const lane of lanes) {
    if (![...byId.values()].some((s) => s.lane === lane)) problems.push(`${REGISTRY_FILE}: lane ${lane} has no scenario`);
  }
  if (!valid) return { problems, result: null };

  // The doc.
  const doc = readDoc(markdown);
  problems.push(...doc.problems);
  checkBudgetAgainstDoc(registry.budget, doc.budget, problems);
  for (const [id, row] of doc.scenarios) {
    const s = byId.get(id);
    if (s === undefined) {
      problems.push(`${DOC_FILE} 4.2 lists ${id} and ${REGISTRY_FILE} does not`);
      continue;
    }
    for (const key of ["name", "far_end", "cadence"]) {
      if (s[key] !== row[key]) {
        problems.push(`${id}: ${key} is ${JSON.stringify(s[key])} but 4.2 says ${JSON.stringify(row[key])}`);
      }
    }
    const bracket = /\((\d+)\)$/.exec(row.cadence);
    if (!bracket) {
      problems.push(`${id}: 4.2's cadence "${row.cadence}" ends without its dials in brackets`);
    } else if (Number(bracket[1]) !== rigDials(s)) {
      problems.push(
        `${id}: dials + far_end_legs is ${rigDials(s)} but 4.2 budgets ${bracket[1]} a run`,
      );
    }
    const word = CADENCE_WORDS.find(([words]) => row.cadence.startsWith(words));
    if (!word) {
      problems.push(`${id}: 4.2's cadence "${row.cadence}" starts with no known frequency`);
    } else {
      // "Weekly, alternating" over two ids means each runs every other week.
      const share = row.rowIds.length > 1 && /alternating/.test(row.cadence) ? row.rowIds.length : 1;
      const expected = periodMinutes(word[1]) * share;
      const shown = (minutes) => (minutes % 1440 === 0 ? `${minutes / 1440}d` : `${minutes}m`);
      if (periodMinutes(s.runs[0].every) !== expected) {
        problems.push(`${id}: its first run is every ${s.runs[0].every}, but 4.2's "${row.cadence}" means every ${shown(expected)}`);
      }
      checkImpliedRuns(s, row, expected, shown, problems);
    }
    // Phase 4 is the one reason to leave a scenario out that the doc, not the
    // cap, decides, so the doc has to say it.
    if (s.unscheduled_because === "phase-4" && !/\bPhase 4\b/.test(`${row.name} ${row.verify}`)) {
      problems.push(`${id}: unscheduled_because is "phase-4" but 4.2 does not put ${id} in Phase 4; schedule it`);
    }
  }
  for (const id of byId.keys()) {
    if (!doc.scenarios.has(id)) problems.push(`${id} is in ${REGISTRY_FILE} but not in ${DOC_FILE} 4.2; delete it`);
  }

  const paidIds = [...byId.values()].filter((s) => rigDials(s) > 0).map((s) => s.id);
  const { runsAt, problems: roomProblems } = roomsFromTable(doc.rooms, paidIds);
  problems.push(...roomProblems);
  let roomsMatched = 0;
  for (const s of byId.values()) {
    const expected = rigDials(s) > 0 ? runsAt.get(s.id) : 0;
    if (expected === undefined) {
      problems.push(`${s.id}: 4.1's room table runs it at no room`);
    } else if (s.min_room !== expected) {
      problems.push(`${s.id}: min_room is ${s.min_room} but 4.1's room table runs it from room ${expected}`);
    } else {
      roomsMatched += 1;
    }
  }

  const defects = Array.isArray(registry.named_defects) ? registry.named_defects : [];
  const listedDefects = defects.map((d) => d?.id);
  for (const id of doc.defects.named) {
    if (!listedDefects.includes(id)) problems.push(`${DOC_FILE} 4.2 names defect ${id}; add it to named_defects`);
  }
  for (const d of defects) {
    if (typeof d?.id !== "string" || typeof d.gap !== "string" || !Array.isArray(d.named_by)) {
      problems.push(`${REGISTRY_FILE} named_defects: each needs an id, a gap and named_by`);
      continue;
    }
    if (!doc.defects.named.includes(d.id)) problems.push(`${d.id}: 4.2 no longer names it; delete it from named_defects`);
    if (!doc.defects.known.includes(d.id)) problems.push(`${d.id}: not a defect in ${DOC_FILE} 4.3`);
    for (const id of d.named_by) {
      if (!byId.has(id)) problems.push(`${d.id}: named_by ${id}, which is not a scenario`);
    }
  }

  // The journeys.
  const measured = journeys?.journeys;
  if (measured === null || typeof measured !== "object" || Object.keys(measured).length === 0) {
    problems.push(`${JOURNEYS_FILE}: no journeys. The journey check is reading nothing`);
  } else {
    const claimed = new Map();
    for (const s of byId.values()) {
      if (s.journey === undefined || s.journey === null) continue;
      const journey = measured[s.journey];
      if (journey === undefined) {
        problems.push(`${s.id}: journey "${s.journey}" is not in ${JOURNEYS_FILE}`);
        continue;
      }
      if (claimed.has(s.journey)) problems.push(`${s.id}: journey "${s.journey}" is already ${claimed.get(s.journey)}'s`);
      claimed.set(s.journey, s.id);
      if (journey.rig_scenario !== s.id) {
        problems.push(`${s.id}: ${JOURNEYS_FILE} records "${s.journey}" as ${journey.rig_scenario}'s`);
      }
      for (const key of JOURNEY_FIELDS) {
        if (s[key] !== journey[key]) {
          problems.push(`${s.id}: ${key} is ${s[key]} but the "${s.journey}" journey measured ${journey[key]}`);
        }
      }
    }
    for (const name of Object.keys(measured)) {
      if (!claimed.has(name)) problems.push(`${JOURNEYS_FILE}: journey "${name}" belongs to no scenario`);
    }
  }

  // The budget.
  const totals = budget(registry);
  const { stated, problems: statedProblems } = statedTotals(markdown);
  problems.push(...statedProblems);
  if (stated !== null) {
    for (const [key, value] of Object.entries(stated)) {
      const actual = Number.isInteger(value) && Number.isInteger(totals[key]) ? totals[key] : Number(totals[key].toFixed(1));
      if (actual !== value) {
        problems.push(`${DOC_FILE} 4.1 states ${key} ${value}, but ${REGISTRY_FILE} works out to ${actual}. Update the prose`);
      }
    }
  }
  if (totals.scheduledTotal > totals.ceiling) {
    problems.push(
      `the schedule needs ${totals.scheduledTotal.toFixed(1)} dials a month with reserves and the cap allows ` +
        `${totals.ceiling}. Move a scenario to a slower cadence or raise the cap with Telnyx's written limits`,
    );
  }
  for (const line of totals.overHours) problems.push(`over the hourly cap of ${registry.budget.hourly_cap}: ${line}`);
  if (totals.busiestDay > registry.budget.daily_cap) {
    problems.push(`the busiest day holds ${totals.busiestDay} dials and the daily cap is ${registry.budget.daily_cap}`);
  }

  const scenarios = [...byId.values()];
  return {
    problems,
    result: {
      totals,
      scenarios: scenarios.length,
      scheduled: scenarios.filter((s) => s.scheduled).length,
      unscheduled: scenarios.filter((s) => !s.scheduled).map((s) => `${s.id} (${s.unscheduled_because})`),
      journeys: scenarios.filter((s) => s.journey).length,
      roomsMatched,
      defects: listedDefects.length,
    },
  };
}

function main() {
  const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8");
  const registry = JSON.parse(read(REGISTRY_FILE));
  const { problems, result } = judge({
    registry,
    markdown: read(DOC_FILE),
    journeys: JSON.parse(read(JOURNEYS_FILE)),
  });
  if (result !== null) {
    const t = result.totals;
    const b = registry.budget;
    const fits = (total) => (total <= t.ceiling ? "<=" : ">");
    console.log(
      `  budget (cap ${b.daily_cap}/day and ${b.hourly_cap}/hour, ${b.days_per_month}-day month, ` +
        `${b.retry_reserve * 100}% retry reserve, ${b.repro_reserve_dials} repro dials):`,
    );
    console.log(
      `    scheduled: ${t.scheduledDials.toFixed(1)} dials/month -> ${t.scheduledTotal.toFixed(1)} with reserves ` +
        `${fits(t.scheduledTotal)} ${t.ceiling}`,
    );
    console.log(
      `    over a ${t.cycle}-day cycle: busiest hour ${t.busiestHour} dials, busiest day ${t.busiestDay}, ` +
        `${t.daysAtCap} day(s) at the daily cap`,
    );
    console.log(
      `    4.2 as written, every rig scenario at its cadence: ${t.writtenDials.toFixed(1)} dials/month -> ` +
        `${t.writtenTotal.toFixed(1)} with reserves ${fits(t.writtenTotal)} ${t.ceiling}`,
    );
    console.log(`    not scheduled: ${result.unscheduled.join(", ") || "none"}`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`\ncheck-rig-scenarios: ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(
    `check-rig-scenarios: ${result.scenarios} scenarios (${result.scheduled} scheduled), equal to 4.2; ` +
      `${result.journeys} measured by journeys; room matches 4.1 for ${result.roomsMatched}; ` +
      `${result.defects} named defect(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
