/**
 * Which test files a change can reach, and how to split test files into
 * shards. Pure functions over repo-relative POSIX paths; test-plan.mjs feeds
 * them from git, vitest and the recorded history.
 */

/** A change to any of these can alter every test, so the whole suite runs. */
export const FULL_RUN_TRIGGERS = [
  [/(^|\/)package\.json$/, "a package manifest"],
  [/^pnpm-(lock|workspace)\.yaml$/, "the workspace or lockfile"],
  [/^\.(npmrc|nvmrc|node-version)$/, "the Node or npm setup"],
  [/(^|\/)(vitest|vite)(\.[\w-]+)*\.config\.[cm]?[jt]s$/, "a vitest or vite config"],
  [/(^|\/)tsconfig[\w.-]*\.json$/, "a tsconfig"],
  [/^scripts\/ci\//, "the test selection scripts"],
  [/^\.github\/workflows\/(checks|main)\.yml$/, "the gate workflow"],
];

export function fullRunTrigger(changes, extraTriggers = []) {
  for (const change of changes) {
    for (const [pattern, reason] of FULL_RUN_TRIGGERS) {
      if (pattern.test(change.path)) return { path: change.path, reason };
    }
    const extra = extraTriggers.find((trigger) => trigger.paths.has(change.path));
    if (extra) return { path: change.path, reason: extra.reason };
  }
  return null;
}

/**
 * `git diff --name-status -M` output as changes. A rename is the old path
 * deleted and the new one added, because a test can depend on either.
 */
export function parseNameStatus(text) {
  const changes = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    const [kind] = status;
    if (kind === "R") {
      changes.push({ status: "D", path: paths[0] }, { status: "A", path: paths[1] });
    } else if (kind === "C") {
      changes.push({ status: "A", path: paths[1] });
    } else if (kind === "A" || kind === "D") {
      changes.push({ status: kind, path: paths[0] });
    } else {
      changes.push({ status: "M", path: paths[0] });
    }
  }
  return changes;
}

export function ancestors(file) {
  const parts = file.split("/");
  const dirs = [""];
  for (let index = 1; index < parts.length; index += 1) dirs.push(parts.slice(0, index).join("/"));
  return dirs;
}

const isUnder = (file, dir) => file.startsWith(`${dir}/`);

/**
 * Why each test file must run for `changes`, or no entry when it need not.
 *
 * units:     test files at the head commit, each with its package directory.
 * graph:     head import closure per unit (null when it could not be built).
 * history:   per unit, what the last full run on main recorded: imports, files
 *            read, directories listed, and whether it started a process.
 * untraced:  package directories whose tests run where reads are not recorded
 *            (workerd), each with the directories its tests can depend on.
 */
export function selectAffected({ units, changes, graph, history, untraced = new Map() }) {
  const selected = new Map();
  const changedPaths = new Set(changes.map((change) => change.path));
  for (const unit of units) {
    const reason = whyRun(unit, { changes, changedPaths, graph, history, untraced });
    if (reason) selected.set(unit.path, reason);
  }
  return selected;
}

function whyRun(unit, { changes, changedPaths, graph, history, untraced }) {
  if (changedPaths.has(unit.path)) return "the test file changed";
  const closure = graph.get(unit.path);
  if (closure === null || closure === undefined) return "its import graph could not be built";
  for (const change of changes) {
    if (change.status !== "D" && closure.has(change.path)) return `imports ${change.path}`;
  }
  const dirs = untraced.get(unit.pkg);
  if (dirs) {
    const hit = changes.find((change) => dirs.some((dir) => isUnder(change.path, dir)));
    return hit ? `its package runs on workerd and ${hit.path} changed` : null;
  }
  const recorded = history?.get(unit.path);
  if (!recorded) return "no recorded history for it";
  if (recorded.spawns) return "it starts a process, so its reads are not recorded";
  for (const change of changes) {
    if (recorded.reads.has(change.path)) return `reads ${change.path}`;
    if (change.status === "D" && recorded.imports.has(change.path)) return `imported ${change.path}`;
    if (change.status !== "M") {
      const listed = ancestors(change.path).find((dir) => recorded.lists.has(dir));
      if (listed !== undefined) return `lists ${listed || "the repository root"}`;
    }
  }
  return null;
}

/**
 * Longest-processing-time first: each file, slowest first, goes to the shard
 * with the least work so far. Durations come from the history; a file without
 * one is given the median. With no durations at all every file weighs the
 * same, which is file-count sharding.
 */
export function partition(paths, durations, shardCount) {
  const known = paths.map((p) => durations.get(p)).filter((ms) => typeof ms === "number" && ms > 0);
  const timing = known.length > 0 ? "recorded" : "file-count";
  const sorted = [...known].toSorted((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 1;
  const weight = (p) => (timing === "file-count" ? 1 : (durations.get(p) ?? median));
  const order = [...paths].toSorted((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const count = Math.max(1, Math.min(shardCount, paths.length));
  const shards = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  for (const file of order) {
    let [target] = shards;
    for (const shard of shards) if (shard.weight < target.weight) target = shard;
    target.files.push(file);
    target.weight += weight(file);
  }
  for (const shard of shards) shard.files.sort();
  return { timing, shards };
}

export function shardCountFor(paths, durations, { targetMs, fallback, max }) {
  if (paths.length === 0) return 1;
  const known = paths.map((p) => durations.get(p)).filter((ms) => typeof ms === "number");
  if (known.length === 0) return Math.min(fallback, paths.length);
  const mean = known.reduce((sum, ms) => sum + ms, 0) / known.length;
  const total = paths.reduce((sum, p) => sum + (durations.get(p) ?? mean), 0);
  return Math.max(1, Math.min(max, paths.length, Math.ceil(total / targetMs)));
}
