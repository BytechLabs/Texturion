/**
 * `rig apk --ref <ref>`: builds the Android `nonprod` variant, signed with the
 * rig's own key (made on the first run, kept for good), and refuses any APK
 * whose package is not com.loonext.android.nonprod.
 *
 * The package is read from the APK itself, from the compiled manifest, with no
 * SDK tool in the way, and checked again against Gradle's own output
 * metadata. A refused APK is deleted, so nothing downstream can install it.
 * A release-style build is then placed where the device lane installs it.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { run } from "./exec.mjs";

export const NONPROD_PACKAGE = "com.loonext.android.nonprod";

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, 0, length, position);
  return buffer;
}

/** One stored or deflated entry from a zip, found through its central directory. */
export function readZipEntry(path, name) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const tailLength = Math.min(size, 65_557);
    const tail = readAt(fd, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new Error("rig apk: not a zip file");
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    const directory = readAt(fd, directoryOffset, directorySize);
    let at = 0;
    for (let i = 0; i < entries; i += 1) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error("rig apk: corrupt central directory");
      const method = directory.readUInt16LE(at + 10);
      const compressedSize = directory.readUInt32LE(at + 20);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const localOffset = directory.readUInt32LE(at + 42);
      const entryName = directory.toString("utf8", at + 46, at + 46 + nameLength);
      if (entryName === name) {
        const local = readAt(fd, localOffset, 30);
        const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        const data = readAt(fd, dataStart, compressedSize);
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data);
        throw new Error(`rig apk: ${name} uses zip method ${method}`);
      }
      at += 46 + nameLength + extraLength + commentLength;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

const RES_STRING_POOL = 0x0001;
const RES_XML_START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;

function poolString(pool, index) {
  const { data, offsets, stringsStart, utf8 } = pool;
  let at = stringsStart + offsets[index];
  if (utf8) {
    // Two lengths, each one or two bytes: characters, then bytes.
    at += data[at] & 0x80 ? 2 : 1;
    let length = data[at];
    if (length & 0x80) {
      length = ((length & 0x7f) << 8) | data[at + 1];
      at += 2;
    } else at += 1;
    return data.toString("utf8", at, at + length);
  }
  let length = data.readUInt16LE(at);
  if (length & 0x8000) {
    length = ((length & 0x7fff) << 16) | data.readUInt16LE(at + 2);
    at += 4;
  } else at += 2;
  return data.toString("utf16le", at, at + length * 2);
}

/** The `package` attribute of `<manifest>` in a compiled AndroidManifest.xml. */
export function manifestPackage(xml) {
  if (xml.readUInt16LE(0) !== 0x0003) throw new Error("rig apk: the manifest is not compiled XML");
  let at = xml.readUInt16LE(2);
  let pool = null;
  while (at < xml.length) {
    const type = xml.readUInt16LE(at);
    const headerSize = xml.readUInt16LE(at + 2);
    const size = xml.readUInt32LE(at + 4);
    if (type === RES_STRING_POOL) {
      const count = xml.readUInt32LE(at + 8);
      const flags = xml.readUInt32LE(at + 16);
      const offsets = [];
      for (let i = 0; i < count; i += 1) offsets.push(xml.readUInt32LE(at + headerSize + i * 4));
      pool = { data: xml, offsets, stringsStart: at + xml.readUInt32LE(at + 20), utf8: (flags & UTF8_FLAG) !== 0 };
    } else if (type === RES_XML_START_ELEMENT) {
      if (pool === null) throw new Error("rig apk: the manifest has no string pool");
      const name = poolString(pool, xml.readUInt32LE(at + 20));
      if (name !== "manifest") throw new Error("rig apk: the first element is not <manifest>");
      const attributeStart = xml.readUInt16LE(at + 24);
      const attributeSize = xml.readUInt16LE(at + 26);
      const attributeCount = xml.readUInt16LE(at + 28);
      const first = at + 16 + attributeStart;
      for (let i = 0; i < attributeCount; i += 1) {
        const attribute = first + i * attributeSize;
        if (poolString(pool, xml.readUInt32LE(attribute + 4)) !== "package") continue;
        const raw = xml.readInt32LE(attribute + 8);
        if (raw >= 0) return poolString(pool, raw);
        // No raw value: the typed value must itself be a string reference.
        const TYPE_STRING = 0x03;
        if (xml[attribute + 15] === TYPE_STRING) return poolString(pool, xml.readUInt32LE(attribute + 16));
        throw new Error("rig apk: the package attribute is not a string");
      }
      throw new Error("rig apk: <manifest> has no package attribute");
    }
    if (size === 0) break;
    at += size;
  }
  throw new Error("rig apk: no <manifest> element");
}

export function apkPackage(path) {
  const manifest = readZipEntry(path, "AndroidManifest.xml");
  if (manifest === null) throw new Error("rig apk: no AndroidManifest.xml in the APK");
  return manifestPackage(manifest);
}

/** Null when the APK may be installed, else why not. */
export function apkRefusal(path, metadataPath) {
  const packageName = apkPackage(path);
  if (packageName !== NONPROD_PACKAGE) return `the APK's package is ${packageName}, not ${NONPROD_PACKAGE}`;
  if (metadataPath && existsSync(metadataPath)) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadata.applicationId !== NONPROD_PACKAGE) {
      return `Gradle built ${metadata.applicationId}, not ${NONPROD_PACKAGE}`;
    }
  }
  return null;
}

export const KEYSTORE_FILE = "android-nonprod.keystore";
export const KEYSTORE_SECRETS = "android-nonprod-keystore.json";
export const KEY_ALIAS = "loonext-rig-nonprod";
export const GOOGLE_SERVICES = "android-nonprod-google-services.json";
/** Where the device lane installs from, under `$RIG_HOME/work` (rigd's wiring.ts). */
export const APK_DIR = "apk";
export const CURRENT_APK = "current.apk";
export const PREVIOUS_APK = "previous.apk";
const CURRENT_RECORD = "current.json";
/** keytool reads the password from here, so it is on no command line. */
const PASSWORD_VARIABLE = "RIG_NONPROD_KEYSTORE_PASSWORD";

/**
 * Where tools/rig/box/android-toolchain.sh installs the JDK and the SDK, under
 * the rig account's home. A systemd unit or a plain ssh command has no login
 * profile, so the build looks here when its environment names neither.
 */
export function toolchainEnv({ env = process.env, home = homedir(), exists = existsSync } = {}) {
  const found = {};
  for (const [variable, dir] of [["JAVA_HOME", "jdk"], ["ANDROID_HOME", "android-sdk"]]) {
    if (!env[variable] && exists(join(home, dir))) found[variable] = join(home, dir);
  }
  return found;
}

/** The box's JDK, the one Gradle builds with: JAVA_HOME's, else whichever is on the PATH. */
export function keytoolCommand(env = { ...process.env, ...toolchainEnv() }) {
  return env.JAVA_HOME ? join(env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool") : "keytool";
}

/**
 * The nonprod APK's signing key and its passwords, made on the first
 * `rig apk` with the JDK's keytool and never again. Each build installs over
 * the last only while the signature stays the same (D10 and D12 upgrade over
 * the previous build), so an existing pair is never replaced, and half a pair
 * is refused rather than completed: a new key would sign every later build
 * differently from the one on the phone.
 *
 * PKCS12 keeps one password for the store and the key, so both are the same
 * 256 random bits. The certificate's SHA-256 is logged when the key is made,
 * for registering the nonprod app with Firebase (FA6).
 */
export function ensureNonprodKeystore({ store, log, keytool = keytoolCommand(), runner = run }) {
  const keystorePath = join(store.dir, KEYSTORE_FILE);
  const haveKeystore = existsSync(keystorePath);
  const haveSecrets = store.has(KEYSTORE_SECRETS);
  if (haveKeystore && haveSecrets) return { keystorePath, keystore: store.readJson(KEYSTORE_SECRETS), created: false };
  if (haveKeystore || haveSecrets) {
    const [present, absent] = haveKeystore ? [KEYSTORE_FILE, KEYSTORE_SECRETS] : [KEYSTORE_SECRETS, KEYSTORE_FILE];
    throw new Error(
      `rig apk: the store holds ${present} but not ${absent}, so the nonprod signing key is half there. ` +
        `Restore ${absent} from where it was kept. A new pair would sign builds the installed nonprod app refuses ` +
        `to upgrade to, so the rig never makes one over half of the old; only if no build signed with it was ever ` +
        `installed, remove ${present} from ${store.dir} and run rig apk again`,
    );
  }

  const password = randomBytes(32).toString("base64url");
  const env = { [PASSWORD_VARIABLE]: password };
  const storePass = ["-storepass:env", PASSWORD_VARIABLE];
  const temp = `${keystorePath}.${process.pid}.tmp`;
  mkdirSync(store.dir, { recursive: true, mode: 0o700 });
  rmSync(temp, { force: true });
  let sha256;
  try {
    runner(
      keytool,
      [
        "-genkeypair",
        "-keystore",
        temp,
        "-storetype",
        "PKCS12",
        "-alias",
        KEY_ALIAS,
        "-keyalg",
        "RSA",
        "-keysize",
        "3072",
        "-validity",
        // 25 years: the key must outlive the rig.
        "9131",
        "-dname",
        "CN=Loonext rig nonprod, O=Loonext",
        ...storePass,
        "-keypass:env",
        PASSWORD_VARIABLE,
        "-noprompt",
      ],
      { env },
    );
    if (!existsSync(temp)) throw new Error(`rig apk: ${keytool} exited 0 but wrote no keystore`);
    chmodSync(temp, 0o600);
    sha256 = certificateSha256({ keystorePath: temp, keystore: { storePassword: password }, keytool, runner });
    // The passwords go first: a keystore left without them could never be
    // opened, while passwords left without a keystore have signed nothing.
    store.write(KEYSTORE_SECRETS, { storePassword: password, keyAlias: KEY_ALIAS, keyPassword: password });
    renameSync(temp, keystorePath);
    log(`apk: made the nonprod signing key in the store; certificate SHA-256 ${sha256 ?? "(keytool did not print it)"}`);
  } finally {
    rmSync(temp, { force: true });
  }
  return { keystorePath, keystore: store.readJson(KEYSTORE_SECRETS), created: true, sha256 };
}

/** The signing certificate's SHA-256 as keytool prints it, or null when it prints none. */
export function certificateSha256({ keystorePath, keystore, keytool = keytoolCommand(), runner = run }) {
  const listed = runner(
    keytool,
    ["-list", "-v", "-keystore", keystorePath, "-storetype", "PKCS12", "-alias", KEY_ALIAS, "-storepass:env", PASSWORD_VARIABLE],
    { env: { [PASSWORD_VARIABLE]: keystore.storePassword } },
  );
  return /SHA-?256:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){31})/i.exec(listed.stdout)?.[1] ?? null;
}

/**
 * The Gradle properties the nonprod build type reads (apps/android/app/
 * build.gradle.kts), as ORG_GRADLE_PROJECT_ variables so no password is on a
 * command line.
 */
export function nonprodGradleEnv({ settings, publishableKey, keystorePath, keystore }) {
  const appHost = new URL(settings.appOrigin).hostname;
  return {
    ORG_GRADLE_PROJECT_loonextNonprodApiUrl: settings.apiOrigin,
    ORG_GRADLE_PROJECT_loonextNonprodAppHost: appHost,
    ORG_GRADLE_PROJECT_loonextNonprodSupabaseUrl: settings.supabaseUrl,
    ORG_GRADLE_PROJECT_loonextNonprodSupabasePublishableKey: publishableKey,
    ORG_GRADLE_PROJECT_loonextNonprodStoreFile: keystorePath,
    ORG_GRADLE_PROJECT_loonextNonprodStorePassword: keystore.storePassword,
    ORG_GRADLE_PROJECT_loonextNonprodKeyAlias: keystore.keyAlias,
    ORG_GRADLE_PROJECT_loonextNonprodKeyPassword: keystore.keyPassword,
  };
}

/**
 * Builds `assembleNonprod` (or the debuggable twin) in a worktree and returns
 * the checked APK's path. `signing` replaces the keytool the key is made
 * with, for tests.
 */
export function buildNonprodApk({ root, settings, store, publishableKey, variant = "nonprod", log, signing = {} }) {
  // The key comes before the google-services.json: Firebase hands that out
  // only once the app is registered with the key's certificate (FA6).
  const { keystorePath, keystore, sha256 } = ensureNonprodKeystore({ store, log, ...signing });
  if (!store.has(GOOGLE_SERVICES)) {
    const fingerprint = sha256 ?? certificateSha256({ keystorePath, keystore, ...signing });
    throw new Error(
      `rig apk: the store has no ${GOOGLE_SERVICES} yet. Register ${NONPROD_PACKAGE} in Firebase with the signing ` +
        `certificate's SHA-256 ${fingerprint ?? "(keytool did not print it)"} (docs/RIG.md FA6); the google-services.json ` +
        `it gives reaches the store as the rig environment's ANDROID_NONPROD_GOOGLE_SERVICES_JSON. Then run rig apk again`,
    );
  }
  const android = join(root, "apps", "android");
  const overlay = join(android, "app", "src", "nonprod");
  // The build file's own inputs, gitignored there (apps/android/.gitignore).
  mkdirSync(join(overlay, "res", "raw"), { recursive: true });
  writeFileSync(join(overlay, "google-services.json"), store.read(GOOGLE_SERVICES));
  writeFileSync(join(overlay, "res", "raw", "rig_ca.pem"), `${store.read("rig-ca.crt")}\n`);
  if (variant === "nonprodDebug") {
    mkdirSync(join(android, "app", "src", "nonprodDebug"), { recursive: true });
    writeFileSync(join(android, "app", "src", "nonprodDebug", "google-services.json"), store.read(GOOGLE_SERVICES));
  }

  const task = variant === "nonprodDebug" ? "assembleNonprodDebug" : "assembleNonprod";
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  log(`building :app:${task}`);
  run(gradlew, [`:app:${task}`, "--no-daemon", "--console=plain"], {
    cwd: android,
    inherit: true,
    env: { ...toolchainEnv(), ...nonprodGradleEnv({ settings, publishableKey, keystorePath, keystore }) },
  });

  const outputs = join(android, "app", "build", "outputs", "apk", variant);
  const metadataPath = join(outputs, "output-metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const apk = join(outputs, metadata.elements?.[0]?.outputFile ?? `app-${variant}.apk`);
  const refusal = apkRefusal(apk, metadataPath);
  if (refusal !== null) {
    rmSync(apk, { force: true });
    throw new Error(`rig apk: refused and deleted: ${refusal}`);
  }
  return apk;
}

/**
 * `rig apk`: builds, and places the release-style build of a commit where the
 * device lane installs it. A debuggable build, or one of a worktree that may
 * hold uncommitted changes, is for a person, so it stays where Gradle wrote it.
 */
export function buildApk({ debuggable = false, worktree = false, dir, sha, log, build = buildNonprodApk, ...options }) {
  const apk = build({ ...options, variant: debuggable ? "nonprodDebug" : "nonprod", log });
  log(`apk: ${apk}`);
  if (!debuggable && !worktree) placeApk({ apk, dir, sha, log });
  return apk;
}

/**
 * Puts a checked build where the device lane installs it. The build it
 * replaces becomes previous.apk, which D12 upgrades from, unless both are of
 * one commit: a rebuild must not make the release before it unreachable.
 */
export function placeApk({ apk, dir, sha, log }) {
  mkdirSync(dir, { recursive: true });
  const current = join(dir, CURRENT_APK);
  const record = join(dir, CURRENT_RECORD);
  const placedSha = placedCommit(record);
  if (existsSync(current) && placedSha !== sha) {
    renameSync(current, join(dir, PREVIOUS_APK));
    log(`apk: the build of ${placedSha ?? "an unrecorded commit"} is now ${PREVIOUS_APK}`);
  }
  const temp = `${current}.${process.pid}.tmp`;
  copyFileSync(apk, temp);
  renameSync(temp, current);
  writeFileSync(`${record}.${process.pid}.tmp`, `${JSON.stringify({ sha })}\n`);
  renameSync(`${record}.${process.pid}.tmp`, record);
  log(`apk: ${sha} placed as ${current}`);
  return current;
}

/** The commit current.apk was built from; a record that cannot be read names none. */
function placedCommit(record) {
  try {
    const sha = JSON.parse(readFileSync(record, "utf8")).sha;
    return typeof sha === "string" ? sha : undefined;
  } catch {
    return undefined;
  }
}
