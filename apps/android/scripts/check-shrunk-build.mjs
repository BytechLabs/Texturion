#!/usr/bin/env node
/**
 * Checks what R8 actually produced for the release build.
 *
 * The unit tests and the debug APK run unshrunk, so a class R8 renames or strips
 * passes every other gate. The Telnyx SDK was exactly that: it ships no rules,
 * reads its message classes by field name, and every release build shipped with
 * calling broken.
 *
 * Reads, from the release build and app/r8-inventory.json:
 *   - R8's mapping.txt: for each class a reflective library needs, whether it
 *     kept its name ("renamed to x") or was removed ("stripped");
 *   - the merged manifest: every class it names is loaded by name;
 *   - the APK: the native libraries' JNI symbols and class strings, the
 *     ServiceLoader files, and the asset names the code reads.
 *
 * Usage, from apps/android after `./gradlew :app:assembleRelease`:
 *   node scripts/check-shrunk-build.mjs [--build-dir app/build] [--inventory app/r8-inventory.json]
 */
import { createReadStream, readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { inflateRawSync } from "node:zlib";
import { parseArgs } from "node:util";

const REMOVED = "R8$$REMOVED$$CLASS$$";
const { values: args } = parseArgs({
  options: {
    "build-dir": { type: "string", default: "app/build" },
    inventory: { type: "string", default: "app/r8-inventory.json" },
  },
});
const BUILD = args["build-dir"];
const PATHS = {
  mapping: `${BUILD}/outputs/mapping/release/mapping.txt`,
  apk: `${BUILD}/outputs/apk/release/app-release-unsigned.apk`,
  config: `${BUILD}/outputs/mapping/release/configuration.txt`,
  manifest: `${BUILD}/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`,
};

const failures = [];
const fail = (what) => {
  if (!failures.includes(what)) failures.push(what);
};
const report = [];

/** Every class R8 saw, by its original name. */
async function readMapping(path) {
  const classes = new Map();
  let current = null;
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.length === 0 || line.charCodeAt(0) === 35) continue; // blank, or a "# " comment
    if (line.charCodeAt(0) !== 32) {
      const header = /^(\S+) -> (\S+):$/.exec(line);
      current = header ? { mapped: header[2], members: new Map() } : null;
      if (header) classes.set(header[1], current);
      continue;
    }
    // Four spaces is a member; six is R8's metadata under it.
    if (!current || line.charCodeAt(4) === 32 || line.charCodeAt(4) === 35) continue;
    const arrow = line.lastIndexOf(" -> ");
    if (arrow < 0) continue;
    const mapped = line.slice(arrow + 4);
    // "1:3:void name(int):10:10" or "java.lang.String name"
    let decl = line.slice(4, arrow).replace(/^\d+:\d+:/, "").replace(/:\d+(:\d+)?$/, "");
    const space = decl.indexOf(" ");
    if (space < 0) continue;
    decl = decl.slice(space + 1);
    const paren = decl.indexOf("(");
    const name = paren < 0 ? decl : decl.slice(0, paren);
    // A name with a dot is an inlined frame of another class's method.
    if (name.includes(".")) continue;
    if (!current.members.has(name)) current.members.set(name, new Set());
    current.members.get(name).add(mapped);
  }
  return classes;
}

const stripped = (entry) => entry.mapped.startsWith(REMOVED);
const synthetic = (name) => name.includes("$$ExternalSynthetic");

/** "stripped", "renamed to x", or null when the class kept its name. */
function classFate(name, entry) {
  if (!entry) return "absent from R8's mapping";
  if (stripped(entry)) return "stripped by R8";
  return entry.mapped === name ? null : `renamed to ${entry.mapped}`;
}

function membersRenamed(entry, only) {
  const out = [];
  for (const [name, mapped] of entry.members) {
    if (name.startsWith("$r8$") || (only && !only.includes(name))) continue; // $r8$ members are R8's own
    if (!mapped.has(name)) out.push(`${name} -> ${[...mapped].join("/")}`);
  }
  return out;
}

function checkPackages(classes, packages) {
  for (const { prefix, minClasses } of packages) {
    let seen = 0;
    const problems = [];
    for (const [name, entry] of classes) {
      if (!name.startsWith(prefix) || synthetic(name)) continue;
      seen++;
      const fate = classFate(name, entry);
      if (fate) problems.push(`${name} was ${fate}`);
      else for (const m of membersRenamed(entry)) problems.push(`${name}.${m}`);
    }
    report.push(`${prefix}*: ${seen} classes seen, ${problems.length} problems`);
    if (seen < minClasses) {
      fail(
        `Only ${seen} classes under ${prefix} are in the shrunk build; r8-inventory.json expects at least ${minClasses}. ` +
          `Either the library is gone from the app or R8 stripped it.`,
      );
    }
    if (problems.length > 0) {
      // Whole classes first: they are the rule missing, not one member.
      problems.sort((a, b) => Number(b.includes(" was ")) - Number(a.includes(" was ")));
      fail(`${problems.length} classes and members of ${prefix}* lost their names to R8, for example:\n    ${problems.slice(0, 8).join("\n    ")}`);
    }
  }
}

function checkClasses(classes, expected) {
  for (const { name, members } of expected) {
    const entry = classes.get(name);
    const fate = classFate(name, entry);
    if (fate) {
      fail(`${name} was ${fate}. It is loaded by name.`);
      continue;
    }
    for (const m of membersRenamed(entry, members)) fail(`${name}.${m}: R8 renamed a member that is read by name.`);
  }
  report.push(`${expected.length} named classes checked`);
}

/** Classes with a generated serializer must keep `Companion` and `Companion.serializer`. */
function checkSerializable(classes, { minClasses }) {
  let seen = 0;
  for (const [name, entry] of classes) {
    if (!name.endsWith("$$serializer") || stripped(entry) || !name.startsWith("com.loonext.")) continue;
    const owner = name.slice(0, -"$$serializer".length);
    const ownerEntry = classes.get(owner);
    if (!ownerEntry || stripped(ownerEntry)) continue;
    seen++;
    const companionField = ownerEntry.members.get("Companion");
    if (companionField && !companionField.has("Companion")) {
      fail(`${owner}.Companion was renamed to ${[...companionField].join("/")}; kotlinx.serialization finds it by name.`);
    }
    const companion = classes.get(`${owner}$Companion`);
    const serializerFn = companion && !stripped(companion) ? companion.members.get("serializer") : null;
    if (serializerFn && !serializerFn.has("serializer")) {
      fail(`${owner}$Companion.serializer() was renamed to ${[...serializerFn].join("/")}; kotlinx.serialization finds it by name.`);
    }
  }
  report.push(`${seen} serializable classes checked`);
  if (seen < minClasses) {
    fail(`Only ${seen} serializable classes were found in the shrunk build; r8-inventory.json expects at least ${minClasses}.`);
  }
}

/** An enum that kept values() or valueOf() must keep them under those names. */
function checkEnums(classes) {
  let seen = 0;
  for (const [name, entry] of classes) {
    if (stripped(entry) || !(entry.members.has("$VALUES") || entry.members.has("$values"))) continue;
    for (const fn of ["values", "valueOf"]) {
      const mapped = entry.members.get(fn);
      if (!mapped) continue;
      seen++;
      if (!mapped.has(fn)) fail(`${name}.${fn}() was renamed to ${[...mapped].join("/")}; Enum.valueOf reads it by name.`);
    }
  }
  report.push(`${seen} enum entry points checked`);
}

/** R8's final configuration, library rules included, must keep the attributes reflection reads. */
function checkKeptAttributes(path, attributes) {
  const text = readFileSync(path, "utf8").replace(/,\s*\r?\n\s*/g, ",");
  const kept = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("-keepattributes")) kept.push(...line.slice("-keepattributes".length).split(/[,\s]+/).filter(Boolean));
  }
  // A -keepattributes entry may be a wildcard such as RuntimeVisible*Annotation*.
  const matches = (pattern, attribute) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`).test(attribute);
  for (const { name } of attributes) {
    if (!kept.some((pattern) => matches(pattern, name))) {
      fail(`The class-file attribute ${name} is not kept by any -keepattributes in R8's final configuration. Reflection reads it.`);
    }
  }
  report.push(`${attributes.length} class-file attributes checked against ${kept.length} -keepattributes entries`);
}

/** Every class the merged manifest names is instantiated by name. */
function checkManifest(classes, path) {
  const xml = readFileSync(path, "utf8");
  const pkg = /<manifest[^>]*\spackage="([^"]+)"/.exec(xml)?.[1];
  const named = new Set();
  const add = (value) => {
    const name = value.startsWith(".") ? `${pkg}${value}` : value;
    if (/^[A-Za-z_][\w$]*(\.[\w$]+)+$/.test(name)) named.add(name);
  };
  for (const m of xml.matchAll(/<(?:application|activity|activity-alias|service|receiver|provider)\b[^>]*?\sandroid:name="([^"]+)"/g)) add(m[1]);
  for (const m of xml.matchAll(/<meta-data\s+android:name="([^"]+)"\s+android:value="([^"]*)"/g)) {
    if (m[1].startsWith("com.google.firebase.components:")) add(m[1].split(":")[1]);
    else if (m[2] === "androidx.startup") add(m[1]);
  }
  for (const name of named) {
    const fate = classFate(name, classes.get(name));
    // Absent from the mapping means the manifest names a class from a library
    // that never reached R8, which is the manifest's own problem, not R8's.
    if (fate && fate !== "absent from R8's mapping") fail(`${name} is named in the manifest and was ${fate}. The system loads it by name.`);
    else if (fate) fail(`${name} is named in the manifest but is missing from the shrunk build.`);
  }
  report.push(`${named.size} manifest classes checked`);
}

/** A minimal zip reader, so the check needs no unzip on the runner. */
function readZip(path) {
  const buf = readFileSync(path);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`${path} is not a zip file`);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** JNI looks Java up by name from C: exported Java_ symbols, and class strings. */
function checkNativeLibraries(classes, zip) {
  const mangle = (name) => name.replaceAll("_", "_1").replaceAll(".", "_").replaceAll("$", "_00024");
  const byMangled = new Map();
  for (const name of classes.keys()) byMangled.set(mangle(name), name);

  const libs = [...zip.keys()].filter((n) => n.endsWith(".so"));
  const seenClasses = new Set();
  let symbols = 0;
  for (const path of libs) {
    // The same library ships once per ABI; name it once.
    const lib = path.split("/").pop();
    const text = zip.get(path)().toString("latin1");
    for (const m of text.matchAll(/Java_[A-Za-z0-9_]{6,}/g)) {
      const symbol = m[0].slice(5);
      symbols++;
      // The class is the longest prefix that is a known class; the rest is the method.
      let owner = null;
      for (let i = symbol.length - 1; i > 0 && !owner; i--) {
        if (symbol[i] === "_" && symbol[i + 1] !== "1" && symbol[i - 1] !== "_") owner = byMangled.get(symbol.slice(0, i)) ?? null;
      }
      if (!owner) continue;
      const method = symbol.slice(mangle(owner).length + 1).replaceAll("_1", "_");
      const entry = classes.get(owner);
      const fate = classFate(owner, entry);
      if (fate) fail(`${lib} exports ${m[0]}, so ${owner} must keep its name, but it was ${fate}.`);
      else if (entry.members.has(method) && !entry.members.get(method).has(method)) {
        fail(`${lib} exports ${m[0]}, but ${owner}.${method} was renamed to ${[...entry.members.get(method)].join("/")}.`);
      }
      seenClasses.add(owner);
    }
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z0-9_$]+)+/g)) {
      const name = m[0].replaceAll("/", ".");
      const entry = classes.get(name);
      if (!entry || synthetic(name)) continue; // platform classes are not in the mapping
      seenClasses.add(name);
      const fate = classFate(name, entry);
      if (fate) fail(`${lib} refers to ${name} by name, but it was ${fate}.`);
    }
  }
  report.push(`${new Set(libs.map((p) => p.split("/").pop())).size} native libraries in ${libs.length} ABI builds, ${symbols} JNI symbols, ${seenClasses.size} Java classes they name`);
}

/** R8 rewrites META-INF/services as it renames; a provider that is not in the dex is a broken rewrite. */
function checkServiceFiles(classes, zip) {
  const dexNames = new Set();
  for (const entry of classes.values()) if (!stripped(entry)) dexNames.add(entry.mapped);
  let providers = 0;
  for (const [file, read] of zip) {
    if (!file.startsWith("META-INF/services/") || file.endsWith("/")) continue;
    for (const line of read().toString("utf8").split(/\r?\n/)) {
      const provider = line.replace(/#.*/, "").trim();
      if (!provider) continue;
      providers++;
      if (!dexNames.has(provider)) fail(`${file} lists ${provider}, which is not in the shrunk build. ServiceLoader will not find it.`);
    }
  }
  report.push(`${providers} ServiceLoader providers checked`);
}

function checkApkEntries(zip, entries) {
  for (const { path } of entries) {
    if (!zip.has(path)) fail(`${path} is missing from the APK. Code reads it by name.`);
  }
  report.push(`${entries.length} named APK entries checked`);
}

async function main() {
  for (const [what, path] of Object.entries(PATHS)) {
    if (!existsSync(path)) {
      console.error(`FAIL: no ${what} at ${path}. Run ./gradlew :app:assembleRelease first.`);
      process.exit(2);
    }
  }
  const { expect } = JSON.parse(readFileSync(args.inventory, "utf8"));
  const classes = await readMapping(PATHS.mapping);
  report.push(`${classes.size} classes in R8's mapping`);
  if (classes.size < expect.minMappedClasses) {
    console.error(`FAIL: R8's mapping has ${classes.size} classes; r8-inventory.json expects at least ${expect.minMappedClasses}. Is this the release build?`);
    process.exit(2);
  }
  const zip = readZip(PATHS.apk);

  checkPackages(classes, expect.packages);
  checkClasses(classes, expect.classes);
  checkSerializable(classes, expect.serializable);
  checkEnums(classes);
  checkKeptAttributes(PATHS.config, expect.attributes);
  checkManifest(classes, PATHS.manifest);
  checkNativeLibraries(classes, zip);
  checkServiceFiles(classes, zip);
  checkApkEntries(zip, expect.apkEntries);

  for (const line of report) console.log(`  ${line}`);
  if (failures.length > 0) {
    console.error(`\nFAIL: R8 changed ${failures.length} thing(s) the app depends on by name:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nAdd a keep rule to app/proguard-rules.pro, with a reason, and record the library in app/r8-inventory.json.",
    );
    process.exit(1);
  }
  console.log("OK: the shrunk build kept every name it is read by.");
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
