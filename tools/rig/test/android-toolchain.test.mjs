import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { TOOLING_ROOT } from "../src/layout.mjs";

const box = join(TOOLING_ROOT, "tools", "rig", "box");
const pins = JSON.parse(readFileSync(join(box, "android-toolchain.json"), "utf8"));
const gradle = readFileSync(join(TOOLING_ROOT, "apps", "android", "app", "build.gradle.kts"), "utf8");

test("every download is pinned to an exact URL and a SHA-256", () => {
  for (const [name, pin] of [["jdk", pins.jdk], ["cmdlineTools", pins.cmdlineTools]]) {
    assert.match(pin.url, /^https:\/\/(dl\.google\.com\/android\/repository|github\.com\/adoptium)\//, name);
    assert.match(pin.url, /\d{6,}_latest\.zip$|jdk-\d+\.\d+\.\d+/, `${name} must name a build`);
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, name);
  }
  assert.match(pins.cmdlineTools.sha1, /^[0-9a-f]{40}$/);
});

test("the SDK packages are the platform the app compiles against, pinned to an exact version", () => {
  const compileSdk = /compileSdk = (\d+)/.exec(gradle)[1];
  assert.ok(pins.packages.some((name) => name.startsWith(`platforms;android-${compileSdk}.`)), `platforms for ${compileSdk}`);
  assert.ok(pins.packages.some((name) => /^build-tools;\d+\.\d+\.\d+$/.test(name)));
  for (const name of pins.packages) assert.doesNotMatch(name, /latest|-rc|-beta|-alpha/, name);
});

test("the JDK is at least the Java the app targets", () => {
  const target = Number(/JavaVersion\.VERSION_(\d+)/.exec(gradle)[1]);
  assert.ok(Number(pins.jdk.version.split(".")[0]) >= target);
});

test("bootstrap installs the toolchain and never accepts the licences itself", () => {
  const bootstrap = readFileSync(join(box, "bootstrap.sh"), "utf8");
  assert.match(bootstrap, /android-toolchain\.sh"?\n/);
  assert.doesNotMatch(bootstrap, /^[^#\n]*android-toolchain\.sh[^\n]*--accept/m);
  assert.match(bootstrap, /\bunzip\b/);
});
