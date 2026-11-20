#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

export const REGISTRY_FILE = "tools/rig/scenarios.json";
export const DOC_FILE = "docs/RIG.md";
export const JOURNEYS_FILE = "apps/api/e2e/call-journey-budget.json";
export const SCHEMA = "loonext.rig-scenarios.v2";

const COUNT_FIELDS = ["dials", "far_end_legs", "peak_concurrent_outbound_legs"];
const JOURNEY_FIELDS = ["dials", "far_end_legs", "peak_concurrent_legs", "peak_concurrent_outbound_legs"];
const SCENARIO_KEYS = new Set(["id", "name", "lane", "far_end", "runs_on", "runs", ...COUNT_FIELDS, "peak_concurrent_legs", "journey", "note"]);
const RUN_KEYS = new Set(["label"]);
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

/** The lines of one `### <number>` section of a Markdown document. */
export function sectionLines(markdown, number) {
  const lines = markdown.replaceAll('\r\n', "\n").split("\n");
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

export function readDoc(markdown) {
  const problems = [];
  const scenarios = new Map();
  const s42 = sectionLines(markdown, "4.2");
  if (s42 === null) return { problems: [`${DOC_FILE} has no section 4.2`], scenarios, defects: { named: [], known: [] } };
  for (const cells of tableRows(s42)) {
    if (cells.length !== 5) {
      problems.push(`${DOC_FILE} 4.2: a row has ${cells.length} cells, not 5: ${cells[0] ?? ""}`);
      continue;
    }
    const [idCell, name, farEnd, verify, dials] = cells;
    const ids = idCell.split(",").map((id) => id.trim());
    for (const id of ids) scenarios.set(id, { id, name, far_end: farEnd, verify, dials, rowIds: ids });
  }

  const named = s42 === null ? [] : [...new Set(s42.join("\n").match(/\bX\d{1,3}\b/g))];
  const s43 = sectionLines(markdown, "4.3");
  const known = s43 === null ? [] : tableRows(s43).map((cells) => cells[0]);
  return { problems, scenarios, defects: { named, known } };
}

export const normalLabel = (text) => text.toLowerCase().replaceAll('-', " ").replaceAll(/\s+/g, " ").trim();

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

function checkScenario(s, lanes, problems) {
  const at = `${REGISTRY_FILE} ${typeof s?.id === "string" ? s.id : "scenario"}`;
  if (s === null || typeof s !== "object") {
    problems.push(`${at}: not an object`);
    return false;
  }
  for (const key of Object.keys(s)) {
    if (SCHEDULING_KEYS.includes(key)) problems.push(`${at}: "${key}" is a scheduling field, and the rig runs nothing on a timer`);
    else if (!SCENARIO_KEYS.has(key)) problems.push(`${at}: "${key}" is not a scenario field`);
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
      else if (!RUN_KEYS.has(key)) problems.push(`${where}: "${key}" is not a run field`);
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
  // Outbound legs are the legs Loonext creates, so a run holds at most as many
  // at once as it dials, and at least one if it dials at all.
  if (s.peak_concurrent_outbound_legs > s.dials) {
    problems.push(`${at}: peaks at ${s.peak_concurrent_outbound_legs} outbound legs but dials only ${s.dials}`);
  }
  if (s.dials > 0 && s.peak_concurrent_outbound_legs === 0) {
    problems.push(`${at}: dials ${s.dials} but peaks at 0 outbound legs; each dial holds a leg`);
  }
  if (
    s.peak_concurrent_legs !== undefined && isCount(s.peak_concurrent_legs) &&
    (s.peak_concurrent_legs < s.peak_concurrent_outbound_legs || s.peak_concurrent_legs > rigDials(s))
  ) {
    problems.push(
      `${at}: peak_concurrent_legs ${s.peak_concurrent_legs} must be between its outbound peak ` +
        `(${s.peak_concurrent_outbound_legs}) and its rig dials (${rigDials(s)})`,
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

export function judge({ registry, markdown, journeys }) {
  const problems = [];
  if (registry === null || typeof registry !== "object" || registry.schema !== SCHEMA) {
    return { problems: [`${REGISTRY_FILE}: schema must be "${SCHEMA}"`], result: null };
  }
  for (const key of ["budget", "caps", ...SCHEDULING_KEYS]) {
    if (key in registry) problems.push(`${REGISTRY_FILE}: "${key}" is a scheduling field, and the rig runs nothing on a timer`);
  }
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
    if (!checkScenario(s, lanes, problems)) valid = false;
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
      journeys: scenarios.filter((s) => s.journey).length,
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
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error(`\ncheck-rig-scenarios: ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(
    `check-rig-scenarios: ${result.scenarios} scenarios (${result.rig} on the rig, ${result.paid} paid), equal to 4.2; ` +
      `${result.journeys} measured by journeys; ` +
      `${result.defects} named defect(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) main();
