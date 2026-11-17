import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ancestors,
  fullRunTrigger,
  parseNameStatus,
  partition,
  selectAffected,
  shardCountFor,
} from "../test-selection.mjs";

const unit = (path, pkg = "apps/web") => ({ path, pkg });
const record = ({ imports = [], reads = [], lists = [], spawns = false } = {}) => ({
  ms: 100,
  imports: new Set(imports),
  reads: new Set(reads),
  lists: new Set(lists),
  spawns,
});

test("a rename is a deletion of the old path and an addition of the new one", () => {
  assert.deepEqual(parseNameStatus("M\ta.ts\nR087\told.ts\tnew.ts\nA\tb.ts\nD\tc.ts\nC100\tx.ts\ty.ts\n"), [
    { status: "M", path: "a.ts" },
    { status: "D", path: "old.ts" },
    { status: "A", path: "new.ts" },
    { status: "A", path: "b.ts" },
    { status: "D", path: "c.ts" },
    { status: "A", path: "y.ts" },
  ]);
});

test("manifests, configs, the lockfile and these scripts force the whole suite", () => {
  for (const path of [
    "package.json",
    "apps/web/package.json",
    "pnpm-lock.yaml",
    "apps/api/vitest.config.ts",
    "apps/api/vitest.e2e.config.ts",
    "apps/web/tsconfig.json",
    "apps/api/scripts/tsconfig.json",
    "scripts/ci/test-plan.mjs",
    ".github/workflows/checks.yml",
  ]) {
    assert.ok(fullRunTrigger([{ status: "M", path }]), path);
  }
  assert.equal(fullRunTrigger([{ status: "M", path: "apps/web/src/lib/utils.ts" }]), null);
  const setup = { paths: new Set(["apps/web/src/test/setup.ts"]), reason: "a setup file" };
  assert.ok(fullRunTrigger([{ status: "M", path: "apps/web/src/test/setup.ts" }], [setup]));
});

test("every directory above a path, the root first", () => {
  assert.deepEqual(ancestors("apps/web/src/a.ts"), ["", "apps", "apps/web", "apps/web/src"]);
});

test("selection follows imports, reads, listings, deletions and the unknown", () => {
  const units = [
    unit("apps/web/src/a.test.ts"),
    unit("apps/web/src/guard.test.ts"),
    unit("apps/web/src/lister.test.ts"),
    unit("apps/web/src/spawner.test.ts"),
    unit("apps/web/src/new.test.ts"),
    unit("apps/web/src/broken.test.ts"),
    unit("apps/web/src/untouched.test.ts"),
  ];
  const graph = new Map([
    ["apps/web/src/a.test.ts", new Set(["apps/web/src/a.test.ts", "apps/web/src/a.ts"])],
    ["apps/web/src/guard.test.ts", new Set(["apps/web/src/guard.test.ts"])],
    ["apps/web/src/lister.test.ts", new Set(["apps/web/src/lister.test.ts"])],
    ["apps/web/src/spawner.test.ts", new Set(["apps/web/src/spawner.test.ts"])],
    ["apps/web/src/new.test.ts", new Set(["apps/web/src/new.test.ts"])],
    ["apps/web/src/broken.test.ts", null],
    ["apps/web/src/untouched.test.ts", new Set(["apps/web/src/untouched.test.ts", "apps/web/src/b.ts"])],
  ]);
  const history = new Map([
    ["apps/web/src/a.test.ts", record({ imports: ["apps/web/src/a.ts"] })],
    ["apps/web/src/guard.test.ts", record({ reads: ["docs/RIG.md"] })],
    ["apps/web/src/lister.test.ts", record({ lists: ["apps/android/app/src"] })],
    ["apps/web/src/spawner.test.ts", record({ spawns: true })],
    ["apps/web/src/broken.test.ts", record()],
    ["apps/web/src/untouched.test.ts", record({ imports: ["apps/web/src/b.ts", "apps/web/src/gone.ts"] })],
  ]);
  const select = (changes) => selectAffected({ units, changes, graph, history });

  const docs = select([{ status: "M", path: "docs/RIG.md" }]);
  assert.deepEqual([...docs.keys()].toSorted(), [
    "apps/web/src/broken.test.ts",
    "apps/web/src/guard.test.ts",
    "apps/web/src/new.test.ts",
    "apps/web/src/spawner.test.ts",
  ]);
  assert.equal(docs.get("apps/web/src/guard.test.ts"), "reads docs/RIG.md");
  assert.equal(docs.get("apps/web/src/new.test.ts"), "no recorded history for it");

  const source = select([{ status: "M", path: "apps/web/src/a.ts" }]);
  assert.equal(source.get("apps/web/src/a.test.ts"), "imports apps/web/src/a.ts");
  assert.equal(source.has("apps/web/src/untouched.test.ts"), false);

  const edited = select([{ status: "M", path: "apps/android/app/src/Main.kt" }]);
  assert.equal(edited.has("apps/web/src/lister.test.ts"), false, "an edit does not change a listing");
  const added = select([{ status: "A", path: "apps/android/app/src/feature/New.kt" }]);
  assert.equal(added.get("apps/web/src/lister.test.ts"), "lists apps/android/app/src");

  const deleted = select([{ status: "D", path: "apps/web/src/gone.ts" }]);
  assert.equal(deleted.get("apps/web/src/untouched.test.ts"), "imported apps/web/src/gone.ts");

  const itself = select([{ status: "M", path: "apps/web/src/untouched.test.ts" }]);
  assert.equal(itself.get("apps/web/src/untouched.test.ts"), "the test file changed");
});

test("a package that runs on workerd runs whole when anything it can reach changes", () => {
  const units = [unit("tools/edge/src/a.test.ts", "tools/edge"), unit("tools/edge/src/b.test.ts", "tools/edge")];
  const graph = new Map(units.map((u) => [u.path, new Set([u.path])]));
  const untraced = new Map([["tools/edge", ["tools/edge", "tools/rig-protocol"]]]);
  const select = (path) =>
    selectAffected({ units, changes: [{ status: "M", path }], graph, history: new Map(), untraced });
  assert.equal(select("tools/rig-protocol/src/index.ts").size, 2);
  assert.equal(select("tools/edge/src/index.ts").size, 2);
  assert.equal(select("apps/web/src/a.ts").size, 0);
});

test("shards balance recorded time, slowest first", () => {
  const durations = new Map([
    ["a", 90],
    ["b", 60],
    ["c", 50],
    ["d", 40],
    ["e", 10],
  ]);
  const { timing, shards } = partition(["a", "b", "c", "d", "e"], durations, 2);
  assert.equal(timing, "recorded");
  assert.deepEqual(
    shards.map((s) => s.weight),
    [130, 120],
  );
  assert.deepEqual(shards.map((s) => s.files), [["a", "d"], ["b", "c", "e"]]);
});

test("a file with no recorded time weighs the median", () => {
  const { shards } = partition(["a", "b", "new"], new Map([["a", 100], ["b", 10]]), 2);
  assert.deepEqual(shards.map((s) => s.weight).toSorted((x, y) => x - y), [100, 110]);
});

test("with no recorded time, shards balance file count", () => {
  const files = ["a", "b", "c", "d", "e", "f", "g"];
  const { timing, shards } = partition(files, new Map(), 3);
  assert.equal(timing, "file-count");
  assert.deepEqual(shards.map((s) => s.files.length).toSorted(), [2, 2, 3]);
  assert.deepEqual(shards.flatMap((s) => s.files).toSorted(), files);
});

test("every file lands in exactly one shard", () => {
  const files = Array.from({ length: 500 }, (_, i) => `f${i}`);
  const durations = new Map(files.map((f, i) => [f, (i * 7919) % 1000]));
  const { shards } = partition(files, durations, 6);
  const seen = shards.flatMap((s) => s.files);
  assert.equal(seen.length, files.length);
  assert.equal(new Set(seen).size, files.length);
});

test("the shard count follows the total recorded time", () => {
  const durations = new Map([["a", 100_000], ["b", 100_000], ["c", 100_000]]);
  assert.equal(shardCountFor(["a", "b", "c"], durations, { targetMs: 150_000, fallback: 6, max: 8 }), 2);
  assert.equal(shardCountFor(["a", "b", "c"], new Map(), { targetMs: 150_000, fallback: 6, max: 8 }), 3);
  assert.equal(shardCountFor([], durations, { targetMs: 150_000, fallback: 6, max: 8 }), 1);
});
