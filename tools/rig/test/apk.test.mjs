import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  CURRENT_APK,
  KEY_ALIAS,
  KEYSTORE_FILE,
  KEYSTORE_SECRETS,
  NONPROD_PACKAGE,
  apkPackage,
  apkRefusal,
  buildApk,
  buildNonprodApk,
  ensureNonprodKeystore,
  keytoolCommand,
  manifestPackage,
  nonprodGradleEnv,
  placeApk,
  PREVIOUS_APK,
  toolchainEnv,
} from "../src/apk.mjs";
import { run } from "../src/exec.mjs";
import { DEFAULT_SETTINGS, TOOLING_ROOT } from "../src/layout.mjs";
import { secretStore } from "../src/secrets.mjs";

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
// CI builds none, so there this is skipped and the fixtures above stand alone.
const DEBUG_APK =
  process.env.RIG_TEST_APK ?? join(TOOLING_ROOT, "apps", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const NO_APK = "no Gradle-built APK here; RIG_TEST_APK names one";
test("a real debug APK reads as the production package and is refused", { skip: existsSync(DEBUG_APK) ? false : NO_APK }, () => {
  assert.equal(apkPackage(DEBUG_APK), "com.loonext.android");
  assert.notEqual(apkRefusal(DEBUG_APK), null);
});

const STUB_KEYTOOL = join(TOOLING_ROOT, "tools", "rig", "test", "support", "stub-keytool.mjs");

/** A store, and the stub keytool run as its own process the way `run` starts the real one. */
function withKeytool(body, stubEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rig-keystore-"));
  try {
    const store = secretStore(join(dir, "secrets"));
    const argvLog = join(dir, "keytool-argv.jsonl");
    let calls = 0;
    const runner = (command, args, options) => {
      calls += 1;
      return run(process.execPath, [command, ...args], { ...options, env: { ...options.env, ...stubEnv, STUB_KEYTOOL_LOG: argvLog } });
    };
    const lines = [];
    const log = (line) => lines.push(line);
    const signing = { keytool: STUB_KEYTOOL, runner };
    const ensure = (on = store) => ensureNonprodKeystore({ store: on, log, ...signing });
    const argv = () =>
      readFileSync(argvLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    return body({ dir, store, ensure, signing, log, lines, calls: () => calls, argv });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Each `-flag value` pair of one keytool call. */
const flagsOf = (args) => Object.fromEntries(args.flatMap((arg, i) => (arg.startsWith("-") && !String(args[i + 1]).startsWith("-") ? [[arg, args[i + 1]]] : [])));

test("the first rig apk makes the signing pair, its password never on a command line", () => {
  withKeytool(({ store, ensure, lines, argv }) => {
    const made = ensure();
    assert.equal(made.created, true);
    assert.equal(made.keystorePath, join(store.dir, KEYSTORE_FILE));
    assert.ok(existsSync(made.keystorePath));
    const secrets = store.readJson(KEYSTORE_SECRETS);
    assert.deepEqual(made.keystore, secrets);
    assert.equal(secrets.keyAlias, KEY_ALIAS);
    assert.match(secrets.storePassword, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(secrets.keyPassword, secrets.storePassword);
    assert.ok(!JSON.stringify(argv()).includes(secrets.storePassword));
    assert.match(lines.join("\n"), /certificate SHA-256 ([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.equal(made.sha256, /SHA-256 (\S+)$/.exec(lines.join("\n"))[1]);
    assert.deepEqual(readdirSync(store.dir).sort(), [KEYSTORE_SECRETS, KEYSTORE_FILE].sort());
  });
});

test("the key is RSA 3072, valid for the 25 years the rig must outlive", () => {
  withKeytool(({ ensure, argv }) => {
    ensure();
    const made = argv().find((args) => args[0] === "-genkeypair");
    assert.deepEqual(
      [flagsOf(made)["-keyalg"], flagsOf(made)["-keysize"], flagsOf(made)["-validity"], flagsOf(made)["-storetype"]],
      ["RSA", "3072", "9131", "PKCS12"],
    );
  });
});

test("keytool is the JDK's that JAVA_HOME names, else the one on the PATH", () => {
  const jdk = join(tmpdir(), "jdk-21");
  assert.equal(keytoolCommand({ JAVA_HOME: jdk }), join(jdk, "bin", process.platform === "win32" ? "keytool.exe" : "keytool"));
  assert.equal(keytoolCommand({}), "keytool");
});

test("the toolchain is found under the rig account's home unless the environment names one", () => {
  const exists = (path) => [join("/home/rig", "jdk"), join("/home/rig", "android-sdk")].includes(path);
  assert.deepEqual(toolchainEnv({ env: {}, home: "/home/rig", exists }), {
    JAVA_HOME: join("/home/rig", "jdk"),
    ANDROID_HOME: join("/home/rig", "android-sdk"),
  });
  assert.deepEqual(toolchainEnv({ env: { JAVA_HOME: "/opt/jdk", ANDROID_HOME: "/opt/sdk" }, home: "/home/rig", exists }), {});
  assert.deepEqual(toolchainEnv({ env: {}, home: "/home/rig", exists: () => false }), {});
});

test("a store that cannot take the passwords keeps no keystore either", () => {
  withKeytool(({ store, ensure }) => {
    const full = {
      ...store,
      write: () => {
        throw new Error("no space left on device");
      },
    };
    assert.throws(() => ensure(full), /no space left on device/);
    assert.deepEqual(readdirSync(store.dir), []);
  });
});

test("the first rig apk makes the key before it needs FA6's google-services.json, and names the SHA-256 FA6 asks for", () => {
  withKeytool(({ dir, store, signing, log, lines, calls }) => {
    store.write("rig-ca.crt", "-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----");
    const build = () => buildNonprodApk({ root: join(dir, "worktree"), settings: DEFAULT_SETTINGS, store, publishableKey: "k", log, signing });
    let first = "";
    assert.throws(build, (error) => {
      first = error.message;
      return /no android-nonprod-google-services\.json yet\. Register com\.loonext\.android\.nonprod in Firebase/.test(first);
    });
    assert.ok(existsSync(join(store.dir, KEYSTORE_FILE)));
    const logged = /certificate SHA-256 (\S+)$/.exec(lines.join("\n"))?.[1];
    assert.match(logged ?? "", /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.ok(first.includes(`SHA-256 ${logged} (docs/RIG.md FA6)`), first);

    // Asked again before FA6 is done, it names the same certificate and makes no second key.
    const before = calls();
    assert.throws(build, (error) => error.message.includes(`SHA-256 ${logged} `));
    assert.equal(calls(), before + 1, "keytool only listed the existing key");
    assert.equal(existsSync(join(dir, "worktree")), false, "nothing was written into the worktree");
  });
});

test("an existing pair is used as it is and never made again", () => {
  withKeytool(({ store, ensure, calls }) => {
    const first = ensure();
    const bytes = readFileSync(first.keystorePath);
    const before = calls();
    const again = ensure();
    assert.equal(again.created, false);
    assert.deepEqual(again.keystore, first.keystore);
    assert.equal(calls(), before, "keytool was not run again");
    assert.deepEqual(readFileSync(again.keystorePath), bytes);
    assert.deepEqual(store.readJson(KEYSTORE_SECRETS), first.keystore);
  });
});

test("half a pair is refused, naming the missing half, and nothing is made over it", () => {
  withKeytool(({ store, ensure, calls }) => {
    const { keystorePath } = ensure();
    const bytes = readFileSync(keystorePath);
    rmSync(join(store.dir, KEYSTORE_SECRETS));
    const before = calls();
    assert.throws(ensure, /holds android-nonprod\.keystore but not android-nonprod-keystore\.json/);
    assert.equal(calls(), before);
    assert.deepEqual(readFileSync(keystorePath), bytes);
    assert.equal(store.has(KEYSTORE_SECRETS), false);

    rmSync(keystorePath);
    store.write(KEYSTORE_SECRETS, { storePassword: "p", keyAlias: KEY_ALIAS, keyPassword: "p" });
    assert.throws(ensure, /holds android-nonprod-keystore\.json but not android-nonprod\.keystore/);
    assert.equal(existsSync(keystorePath), false);
  });
});

test("a keytool that fails leaves neither half behind", () => {
  withKeytool(
    ({ store, ensure }) => {
      assert.throws(ensure, /exited with 1: keytool error: the stub was told to fail/);
      assert.deepEqual(readdirSync(store.dir), []);
    },
    { STUB_KEYTOOL_FAIL: "1" },
  );
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

function withApkDir(body) {
  const root = mkdtempSync(join(tmpdir(), "rig-apk-place-"));
  try {
    const dir = join(root, "work", "apk");
    const built = (name, bytes) => {
      const path = join(root, name);
      writeFileSync(path, bytes);
      return path;
    };
    body({ dir, built, read: (name) => readFileSync(join(dir, name), "utf8") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

test("the first placed build is current, with no previous", () => {
  withApkDir(({ dir, built, read }) => {
    const current = placeApk({ apk: built("a.apk", "build A"), dir, sha: SHA_A, log: () => {} });
    assert.equal(current, join(dir, CURRENT_APK));
    assert.equal(read(CURRENT_APK), "build A");
    assert.equal(existsSync(join(dir, PREVIOUS_APK)), false);
  });
});

test("a build of a new commit keeps the one it replaces as previous", () => {
  withApkDir(({ dir, built, read }) => {
    placeApk({ apk: built("a.apk", "build A"), dir, sha: SHA_A, log: () => {} });
    placeApk({ apk: built("b.apk", "build B"), dir, sha: SHA_B, log: () => {} });
    assert.equal(read(CURRENT_APK), "build B");
    assert.equal(read(PREVIOUS_APK), "build A");
  });
});

test("a rebuild of the same commit replaces current and leaves previous alone", () => {
  withApkDir(({ dir, built, read }) => {
    placeApk({ apk: built("a.apk", "build A"), dir, sha: SHA_A, log: () => {} });
    placeApk({ apk: built("b.apk", "build B"), dir, sha: SHA_B, log: () => {} });
    placeApk({ apk: built("b2.apk", "build B again"), dir, sha: SHA_B, log: () => {} });
    assert.equal(read(CURRENT_APK), "build B again");
    assert.equal(read(PREVIOUS_APK), "build A");
    assert.deepEqual(readdirSync(dir).sort(), ["current.apk", "current.json", "previous.apk"]);
  });
});

test("a current.apk placed by hand, with no record of its commit, becomes previous", () => {
  withApkDir(({ dir, built, read }) => {
    placeApk({ apk: built("a.apk", "build A"), dir, sha: SHA_A, log: () => {} });
    rmSync(join(dir, "current.json"));
    placeApk({ apk: built("b.apk", "build B"), dir, sha: SHA_A, log: () => {} });
    assert.equal(read(PREVIOUS_APK), "build A");
    assert.equal(read(CURRENT_APK), "build B");
  });
});

test("rig apk places its nonprod build for the device lane", () => {
  withApkDir(({ dir, built, read }) => {
    const variants = [];
    const build = ({ variant }) => {
      variants.push(variant);
      return built("app-nonprod.apk", "nonprod build");
    };
    buildApk({ build, dir, sha: SHA_A, log: () => {} });
    assert.deepEqual(variants, ["nonprod"]);
    assert.equal(read(CURRENT_APK), "nonprod build");
  });
});

test("rig apk --debuggable leaves the device lane's builds as they were", () => {
  withApkDir(({ dir, built }) => {
    const variants = [];
    const build = ({ variant }) => {
      variants.push(variant);
      return built("app-nonprod-debug.apk", "debuggable build");
    };
    buildApk({ build, debuggable: true, dir, sha: SHA_A, log: () => {} });
    assert.deepEqual(variants, ["nonprodDebug"]);
    assert.equal(existsSync(dir), false);
  });
});

test("rig apk --worktree leaves the device lane's builds as they were", () => {
  withApkDir(({ dir, built }) => {
    buildApk({ build: () => built("app-nonprod.apk", "worktree build"), worktree: true, dir, sha: SHA_A, log: () => {} });
    assert.equal(existsSync(dir), false);
  });
});

test("a record that cannot be read names no commit, and the build still lands", () => {
  withApkDir(({ dir, built, read }) => {
    placeApk({ apk: built("a.apk", "build A"), dir, sha: SHA_A, log: () => {} });
    writeFileSync(join(dir, "current.json"), '{"sha":');
    placeApk({ apk: built("b.apk", "build B"), dir, sha: SHA_B, log: () => {} });
    assert.equal(read(PREVIOUS_APK), "build A");
    assert.equal(read(CURRENT_APK), "build B");
    assert.deepEqual(JSON.parse(read("current.json")), { sha: SHA_B });
    assert.deepEqual(readdirSync(dir).sort(), ["current.apk", "current.json", "previous.apk"]);
  });
});
