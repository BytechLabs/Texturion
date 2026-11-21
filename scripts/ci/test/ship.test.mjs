import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("iOS reuses previously uploaded dSYM UUIDs", () => {
  const ship = new URL("../../../.github/workflows/ship.yml", import.meta.url);
  const commands = readFileSync(ship, "utf8").replaceAll(/\\\r?\n[ \t]*/g, "");
  assert.match(
    commands,
    /^ +npx --yes @posthog\/cli@\S+ dsym upload [^\r\n]* --skip-on-conflict(?:[ \t]|$)/m,
  );
});
