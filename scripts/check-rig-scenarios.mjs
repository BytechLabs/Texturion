#!/usr/bin/env node
/**
 * D142: the rig's scenario catalogue, and what each run costs in dials.
 *
 *   node scripts/check-rig-scenarios.mjs
 *
 * `tools/rig/scenarios.json` is the machine copy of docs/RIG.md 4.2. The rig
 * runs nothing on a timer, so the catalogue says what can be run and what a
 * run costs, never when. Telnyx counts every leg as a dial, and the guard's own
 * cap is 18 dials a day and 3 an hour (4.1), so this checks three things:
 *
 * - THE DOC. The ids, names and far ends equal the 4.2 table, the dials per run
 *   in its last column equal the entry's rig dials, the variants a row names
 *   are the runs the entry lists, the minimum room equals what 4.1's room
 *   table implies, every X defect 4.2 names is listed and exists in 4.3, and
 *   the caps and window are the ones 4.1 and 3.5 state.
 * - THE JOURNEYS. A scenario measured by a hermetic journey in
 *   apps/api/e2e/call-journey-budget.json carries exactly the journey's dials,
 *   far-end legs and peaks, and every journey there belongs to a scenario.
 * - THE FIELDS. Ids are unique, lanes are known, counts are non-negative
 *   integers, peaks fit the legs a run creates, and no scheduling field
 *   (cadence, periods, hours, a monthly budget) is left to be read.
 *
 * A run with more dials than the hourly cap is listed, not failed: the guard
 * counts a clock hour, so it cannot be admitted until the cap changes.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REGISTRY_FILE = "tools/rig/scenarios.json";
export const DOC_FILE = "docs/RIG.md";
export const JOURNEYS_FILE = "apps/api/e2e/call-journey-budget.json";
export const SCHEMA = "loonext.rig-scenarios.v2";

const COUNT_FIELDS = ["dials", "far_end_legs", "peak_concurrent_outbound_legs", "min_room"];
const JOURNEY_FIELDS = ["dials", "far_end_legs", "peak_concurrent_legs", "peak_concurrent_outbound_legs"];
const SCENARIO_KEYS = ["id", "name", "lane", "far_end", "runs_on", "runs", ...COUNT_FIELDS, "peak_concurrent_legs", "journey", "note"];
const RUN_KEYS = ["label"];
const CAPS_KEYS = ["daily_cap", "hourly_cap", "window_utc", "source"];
/** Scheduling fields: the rig runs nothing on a timer, so none belongs in the catalogue. */
const SCHEDULING_KEYS = [
  "cadence",
  "scheduled",
  "unscheduled_because",
  "every",
  "offset_days",
  "hour_utc",
  "retry_reserve",
  "repro_reserve_dials",
  "days_per_month",
];
export const RUNS_ON = ["rig", "ci", "production", "workstation"];

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
    const [idCell, name, farEnd, verify, dials] = cells;
    const ids = idCell.split(",").map((id) => id.trim());
    for (const id of ids) scenarios.set(id, { id, name, far_end: farEnd, verify, dials, rowIds: ids });
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
  const { caps, problems: capsProblems } = capsFromDoc(markdown, s41);
  problems.push(...capsProblems);
  return { problems, scenarios, rooms, defects: { named, known }, caps };
}

/** The guard's caps and window as 4.1 and 3.5 state them. */
export function capsFromDoc(markdown, s41) {
  const problems = [];
  const caps = {};
  const text41 = (s41 ?? []).join("\n");
  const cap = /(\d+) dials a day and (\d+) an hour/.exec(text41);
  const windows = [...markdown.matchAll(/the window is (\d{2}):00-(\d{2}):00 UTC/g)];
  if (cap === null) problems.push(`${DOC_FILE} 4.1: cannot read the guard's cap ("N dials a day and N an hour")`);
  else Object.assign(caps, { daily_cap: Number(cap[1]), hourly_cap: Number(cap[2]) });
  if (windows.length !== 1) {
    problems.push(`${DOC_FILE}: expected one "the window is HH:00-HH:00 UTC", found ${windows.length}`);
  } else {
    caps.window_utc = [Number(windows[0][1]), Number(windows[0][2])];
  }
  return { caps, problems };
}

export const normalLabel = (text) => text.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();

/**
 * The variants a row names, when it names them: a "; ... variants" tail in the
 * name, or a "**Variants:**" clause in its verification. Null when it names none.
 */
export function namedVariants(row) {
  const fromName = /;\s*(.+?) variants$/.exec(row.name);
  const clause = /\*\*(?:(\w+) )?[Vv]ariants:\*\*\s*([^;.]+)/.exec(row.verify ?? "");
  if (!fromName && !clause) return null;
  const listed = fromName ? fromName[1] : clause[2];
  return listed
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map(normalLabel)
    .filter(Boolean);
}

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

function checkCapsBlock(c, problems) {
  const at = `${REGISTRY_FILE} caps`;
  if (c === null || typeof c !== "object") {
    problems.push(`${at}: missing`);
    return false;
  }
  for (const key of Object.keys(c)) {
    if (SCHEDULING_KEYS.includes(key)) problems.push(`${at}: "${key}" is a scheduling field, and the rig runs nothing on a timer`);
    else if (!CAPS_KEYS.includes(key)) problems.push(`${at}: "${key}" is not a caps field`);
  }
  for (const key of ["daily_cap", "hourly_cap"]) {
    if (!isCount(c[key]) || c[key] === 0) problems.push(`${at}: ${key} must be a positive integer`);
  }
  const w = c.window_utc;
  if (!Array.isArray(w) || w.length !== 2 || !w.every(isCount) || !(w[0] < w[1] && w[1] <= 24)) {
    problems.push(`${at}: window_utc must be [start hour, end hour) in UTC`);
  }
  return problems.length === 0;
}

function checkScenario(s, lanes, caps, problems) {
  const at = `${REGISTRY_FILE} ${typeof s?.id === "string" ? s.id : "scenario"}`;
  if (s === null || typeof s !== "object") {
    problems.push(`${at}: not an object`);
    return false;
  }
  for (const key of Object.keys(s)) {
    if (SCHEDULING_KEYS.includes(key)) problems.push(`${at}: "${key}" is a scheduling field, and the rig runs nothing on a timer`);
    else if (!SCENARIO_KEYS.includes(key)) problems.push(`${at}: "${key}" is not a scenario field`);
  }
  let ok = true;
  for (const key of ["id", "name", "far_end"]) {
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
  if (!Array.isArray(s.runs) || s.runs.length === 0) {
    problems.push(`${at}: runs must list at least one run`);
    return false;
  }
  if (!ok) return false;

  const paid = rigDials(s) > 0;
  const labels = new Set();
  for (const [i, run] of s.runs.entries()) {
    const where = `${at} runs[${i}]`;
    for (const key of Object.keys(run ?? {})) {
      if (SCHEDULING_KEYS.includes(key)) problems.push(`${where}: "${key}" is a scheduling field, and the rig runs nothing on a timer`);
      else if (!RUN_KEYS.includes(key)) problems.push(`${where}: "${key}" is not a run field`);
    }
    if (run?.label !== undefined && (typeof run.label !== "string" || run.label.trim() === "")) {
      problems.push(`${where}: label must be a non-empty string`);
    } else if (typeof run?.label === "string") {
      if (labels.has(run.label)) problems.push(`${where}: label "${run.label}" repeats an earlier run`);
      labels.add(run.label);
    }
  }
  if (s.runs.length > 1 && s.runs.some((run) => typeof run?.label !== "string")) {
    problems.push(`${at}: a scenario with several runs labels each of them`);
  }
  if (s.runs_on !== "rig" && paid) problems.push(`${at}: only the rig dials, so a ${s.runs_on} scenario has 0 dials`);
  if (rigDials(s) > caps.daily_cap) {
    problems.push(`${at}: one run is ${rigDials(s)} dials and the daily cap is ${caps.daily_cap}, so the guard can never admit it`);
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

/** The variants a row names are the runs after the first that the entry lists, and the other way round. */
function checkVariants(s, row, problems) {
  const labels = s.runs.map((run) => (typeof run.label === "string" ? normalLabel(run.label) : null));
  const text = normalLabel(`${row.name} ${row.verify}`);
  for (const [i, label] of labels.entries()) {
    if (label !== null && !text.includes(label)) problems.push(`${s.id}: runs[${i}] is labelled "${s.runs[i].label}", and 4.2's row does not name it`);
  }
  const named = namedVariants(row);
  if (named === null) return;
  const extra = labels.slice(1).filter((label) => label !== null);
  const missing = named.filter((item) => !extra.includes(item));
  const unnamed = extra.filter((label) => !named.includes(label));
  if (missing.length > 0) problems.push(`${s.id}: 4.2 names the ${missing.join(", ")} variant(s), and runs lists no such run`);
  if (unnamed.length > 0) problems.push(`${s.id}: runs lists variant(s) ${unnamed.join(", ")} that 4.2 does not name`);
}

function checkCapsAgainstDoc(c, docCaps, problems) {
  for (const [key, value] of Object.entries(docCaps)) {
    if (JSON.stringify(c[key]) !== JSON.stringify(value)) {
      problems.push(`${REGISTRY_FILE} caps: ${key} is ${JSON.stringify(c[key])} but ${DOC_FILE} says ${JSON.stringify(value)}`);
    }
  }
}

export function judge({ registry, markdown, journeys }) {
  const problems = [];
  if (registry === null || typeof registry !== "object" || registry.schema !== SCHEMA) {
    return { problems: [`${REGISTRY_FILE}: schema must be "${SCHEMA}"`], result: null };
  }
  for (const key of ["budget", ...SCHEDULING_KEYS]) {
    if (key in registry) problems.push(`${REGISTRY_FILE}: "${key}" is a scheduling field, and the rig runs nothing on a timer`);
  }
  if (!checkCapsBlock(registry.caps, problems)) return { problems, result: null };
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
    if (!checkScenario(s, lanes, registry.caps, problems)) valid = false;
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
  checkCapsAgainstDoc(registry.caps, doc.caps, problems);
  for (const [id, row] of doc.scenarios) {
    const s = byId.get(id);
    if (s === undefined) {
      problems.push(`${DOC_FILE} 4.2 lists ${id} and ${REGISTRY_FILE} does not`);
      continue;
    }
    for (const key of ["name", "far_end"]) {
      if (s[key] !== row[key]) {
        problems.push(`${id}: ${key} is ${JSON.stringify(s[key])} but 4.2 says ${JSON.stringify(row[key])}`);
      }
    }
    if (!/^\d+$/.test(row.dials)) {
      problems.push(`${id}: 4.2's dials per run is "${row.dials}", which is not a whole number`);
    } else if (Number(row.dials) !== rigDials(s)) {
      problems.push(`${id}: dials + far_end_legs is ${rigDials(s)} but 4.2 says ${row.dials} a run`);
    }
    checkVariants(s, row, problems);
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

  const scenarios = [...byId.values()];
  const rig = scenarios.filter((s) => s.runs_on === "rig");
  return {
    problems,
    result: {
      scenarios: scenarios.length,
      rig: rig.length,
      paid: paidIds.length,
      /** Runs the guard cannot admit under its hourly cap, whatever the hour. */
      overHourlyCap: rig.filter((s) => rigDials(s) > registry.caps.hourly_cap).map((s) => `${s.id} (${rigDials(s)})`),
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
    const c = registry.caps;
    console.log(
      `  caps: the guard's ${c.daily_cap} dials a day and ${c.hourly_cap} an hour, window ` +
        `${String(c.window_utc[0]).padStart(2, "0")}:00-${String(c.window_utc[1]).padStart(2, "0")}:00 UTC`,
    );
    console.log(`  over the hourly cap, so never admitted: ${result.overHourlyCap.join(", ") || "none"}`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`\ncheck-rig-scenarios: ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(
    `check-rig-scenarios: ${result.scenarios} scenarios (${result.rig} on the rig, ${result.paid} paid), equal to 4.2; ` +
      `${result.journeys} measured by journeys; room matches 4.1 for ${result.roomsMatched}; ` +
      `${result.defects} named defect(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
