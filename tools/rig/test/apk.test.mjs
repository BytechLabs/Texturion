import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { NONPROD_PACKAGE, apkPackage, apkRefusal, manifestPackage, nonprodGradleEnv } from "../src/apk.mjs";
import { DEFAULT_SETTINGS, TOOLING_ROOT } from "../src/layout.mjs";

/** The smallest compiled manifest aapt2 could emit: a string pool and <manifest package=…>. */
function compiledManifest(packageName, { utf8 = false } = {}) {
  const strings = ["package", "manifest", packageName];
  const encoded = strings.map((value) => {
    if (utf8) {
      const bytes = Buffer.from(value, "utf8");
      return Buffer.concat([Buffer.from([value.length, bytes.length]), bytes, Buffer.from([0])]);
    }
    const buffer = Buffer.alloc(2 + value.length * 2 + 2);
    buffer.writeUInt16LE(value.length, 0);
    buffer.write(value, 2, "utf16le");
    return buffer;
  });
  const offsets = [];
  let offset = 0;
  for (const entry of encoded) {
    offsets.push(offset);
    offset += entry.length;
  }
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const poolHeader = Buffer.alloc(28);
  poolHeader.writeUInt16LE(0x0001, 0);
  poolHeader.writeUInt16LE(28, 2);
  poolHeader.writeUInt32LE(28 + strings.length * 4 + data.length, 4);
  poolHeader.writeUInt32LE(strings.length, 8);
  poolHeader.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  poolHeader.writeUInt32LE(28 + strings.length * 4, 20);
  const offsetTable = Buffer.alloc(strings.length * 4);
  offsets.forEach((value, i) => offsetTable.writeUInt32LE(value, i * 4));
  const pool = Buffer.concat([poolHeader, offsetTable, data]);

  const element = Buffer.alloc(56);
  element.writeUInt16LE(0x0102, 0);
  element.writeUInt16LE(16, 2);
  element.writeUInt32LE(56, 4);
  element.writeUInt32LE(1, 8);
  element.writeInt32LE(-1, 12);
  element.writeInt32LE(-1, 16);
  element.writeUInt32LE(1, 20);
  element.writeUInt16LE(20, 24);
  element.writeUInt16LE(20, 26);
  element.writeUInt16LE(1, 28);
  element.writeInt32LE(-1, 36);
  element.writeUInt32LE(0, 40);
  element.writeUInt32LE(2, 44);
  element.writeUInt16LE(8, 48);
  element[51] = 0x03;
  element.writeUInt32LE(2, 52);

  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + pool.length + element.length, 4);
  return Buffer.concat([header, pool, element]);
}

/** A one-entry zip, deflated. */
function zipWith(name, content) {
  const compressed = deflateRawSync(content);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const directoryOffset = local.length + nameBytes.length + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, end]);
}

function withApk(packageName, body, options) {
  const dir = mkdtempSync(join(tmpdir(), "rig-apk-"));
  try {
    const path = join(dir, "app.apk");
    writeFileSync(path, zipWith("AndroidManifest.xml", compiledManifest(packageName, options)));
    return body(path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the package is read from the compiled manifest, UTF-16 or UTF-8", () => {
  assert.equal(manifestPackage(compiledManifest("com.example.a")), "com.example.a");
  assert.equal(manifestPackage(compiledManifest("com.example.b", { utf8: true })), "com.example.b");
});

test("a nonprod APK passes and anything else is refused", () => {
  withApk(NONPROD_PACKAGE, (path) => assert.equal(apkRefusal(path), null));
  withApk("com.loonext.android", (path) => assert.match(apkRefusal(path), /package is com\.loonext\.android, not/));
  withApk(`${NONPROD_PACKAGE}.evil`, (path) => assert.notEqual(apkRefusal(path), null));
});

test("Gradle's own metadata must agree with the APK", () => {
  withApk(NONPROD_PACKAGE, (path, dir) => {
    const metadata = join(dir, "output-metadata.json");
    writeFileSync(metadata, JSON.stringify({ applicationId: "com.loonext.android" }));
    assert.match(apkRefusal(path, metadata), /Gradle built com\.loonext\.android/);
    writeFileSync(metadata, JSON.stringify({ applicationId: NONPROD_PACKAGE }));
    assert.equal(apkRefusal(path, metadata), null);
  });
});

// A real aapt2-built APK of the production package, where one exists here.
const DEBUG_APK =
  process.env.RIG_TEST_APK ?? join(TOOLING_ROOT, "apps", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
test("a real debug APK reads as the production package and is refused", { skip: !existsSync(DEBUG_APK) }, () => {
  assert.equal(apkPackage(DEBUG_APK), "com.loonext.android");
  assert.notEqual(apkRefusal(DEBUG_APK), null);
});

test("the build's properties go through the environment and name rig hosts only", () => {
  const env = nonprodGradleEnv({
    settings: DEFAULT_SETTINGS,
    publishableKey: "sb_publishable_local",
    keystorePath: "/var/lib/loonext-rig/secrets/android-nonprod.keystore",
    keystore: { storePassword: "s", keyAlias: "a", keyPassword: "k" },
  });
  assert.equal(env.ORG_GRADLE_PROJECT_loonextNonprodApiUrl, "https://api.rig.internal");
  assert.equal(env.ORG_GRADLE_PROJECT_loonextNonprodAppHost, "app.rig.internal");
  assert.equal(env.ORG_GRADLE_PROJECT_loonextNonprodSupabaseUrl, "https://db.rig.internal");
  // Exactly the list the build file reads, which fails a half-configured build.
  const gradle = readFileSync(join(TOOLING_ROOT, "apps", "android", "app", "build.gradle.kts"), "utf8");
  const list = /val nonprodPropertyNames = listOf\(([\s\S]*?)\)/.exec(gradle)[1];
  const wanted = [...list.matchAll(/"(loonextNonprod\w+)"/g)].map((match) => match[1]).sort();
  const names = Object.keys(env).map((key) => key.replace("ORG_GRADLE_PROJECT_", ""));
  assert.ok(wanted.length >= 8);
  assert.deepEqual(names.sort(), wanted);
});
