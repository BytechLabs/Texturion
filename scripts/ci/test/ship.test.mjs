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

test("ship.yml wires iOS signing secrets and ios-ship.sh", () => {
  const ship = readFileSync(new URL("../../../.github/workflows/ship.yml", import.meta.url), "utf8");
  const script = readFileSync(new URL("../../../.github/scripts/ios-ship.sh", import.meta.url), "utf8");
  assert.match(ship, /APPLE_DISTRIBUTION_P12_BASE64/);
  assert.match(ship, /APP_STORE_CONNECT_API_PRIVATE_KEY/);
  assert.match(ship, /ios-ship\.sh/);
  assert.match(script, /xcrun altool --upload-app/);
});
