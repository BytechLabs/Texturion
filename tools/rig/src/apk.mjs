/**
 * `rig apk --ref <ref>`: builds the Android `nonprod` variant and refuses any
 * APK whose package is not com.loonext.android.nonprod.
 *
 * The package is read from the APK itself, from the compiled manifest, with no
 * SDK tool in the way, and checked again against Gradle's own output
 * metadata. A refused APK is deleted, so nothing downstream can install it.
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
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
 * the checked APK's path.
 */
export function buildNonprodApk({ root, settings, store, publishableKey, variant = "nonprod", log }) {
  const android = join(root, "apps", "android");
  const overlay = join(android, "app", "src", "nonprod");
  // The build file's own inputs, gitignored there (apps/android/.gitignore).
  mkdirSync(join(overlay, "res", "raw"), { recursive: true });
  writeFileSync(join(overlay, "google-services.json"), store.read("android-nonprod-google-services.json"));
  writeFileSync(join(overlay, "res", "raw", "rig_ca.pem"), `${store.read("rig-ca.crt")}\n`);
  if (variant === "nonprodDebug") {
    mkdirSync(join(android, "app", "src", "nonprodDebug"), { recursive: true });
    writeFileSync(join(android, "app", "src", "nonprodDebug", "google-services.json"), store.read("android-nonprod-google-services.json"));
  }
  const keystorePath = join(store.dir, "android-nonprod.keystore");
  if (!existsSync(keystorePath)) throw new Error("rig apk: android-nonprod.keystore is not in the store");

  const task = variant === "nonprodDebug" ? "assembleNonprodDebug" : "assembleNonprod";
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  log(`building :app:${task}`);
  run(gradlew, [`:app:${task}`, "--no-daemon", "--console=plain"], {
    cwd: android,
    inherit: true,
    env: nonprodGradleEnv({ settings, publishableKey, keystorePath, keystore: store.readJson("android-nonprod-keystore.json") }),
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
