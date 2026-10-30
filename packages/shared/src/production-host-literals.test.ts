import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `scripts/check-production-host-literals.mjs` has to tell a host the code uses
 * from one a comment quotes or a sentence tells a person to open, and it has to
 * keep `https://` inside a string from reading as a comment. These pin both,
 * per language.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Host = { host: string; line: number };
type Files = { file: string; text: string }[];
const guard = (await import(join(REPO, "scripts", "check-production-host-literals.mjs"))) as {
  SANCTIONED: Record<string, "android" | "ios">;
  LEGACY: Record<string, number>;
  inScope: (file: string) => boolean;
  syntaxOf: (file: string) => string;
  blankComments: (text: string, syntax: string) => string;
  findHosts: (text: string, syntax: string) => Host[];
  nonprodGaps: (text: string) => string[];
  judge: (
    files: Files,
    lists?: { sanctioned?: Record<string, "android" | "ios">; legacy?: Record<string, number> },
  ) => { failures: string[]; used: number; configured: Record<string, number> };
};

const hosts = (text: string, syntax: string) => guard.findHosts(text, syntax).map((h) => h.host);

/** The shape of the real Android build file: production defaults, replaced for nonprod. */
const DEFAULTS_END = "    }\n\n    buildTypes {\n";
const PLACEHOLDER_OVERRIDE = '            manifestPlaceholders["appLinkHost"] = "nonprod.invalid"\n';
const GRADLE_TEXT =
  "android {\n" +
  "    defaultConfig {\n" +
  '        buildConfigField("String", "API_URL", "\\"https://api.loonext.com\\"")\n' +
  "        // The App Links host: https://app.loonext.com, in a comment, is not a use.\n" +
  '        manifestPlaceholders["appLinkHost"] = "app.loonext.com"\n' +
  DEFAULTS_END +
  "        release {\n" +
  "        }\n" +
  '        create("nonprod") {\n' +
  '            initWith(getByName("release"))\n' +
  "            nonprodProperties?.let { props ->\n" +
  '                buildConfigField("String", "API_URL", buildConfigString(props.getValue("loonextNonprodApiUrl")))\n' +
  "            }\n" +
  PLACEHOLDER_OVERRIDE +
  "        }\n" +
  "    }\n" +
  "}\n";

describe("blanking comments", () => {
  it("keeps offsets and newlines, so line numbers still match the file", () => {
    const text = 'val a = 1 // note\n/* two\nlines */ val b = "x"\n';
    const blanked = guard.blankComments(text, "kotlin");
    expect(blanked).toHaveLength(text.length);
    expect(blanked.split("\n")).toHaveLength(text.split("\n").length);
    expect(blanked).toContain('val b = "x"');
    expect(blanked).not.toContain("note");
  });

  it("does not read the slashes of a URL in a string as a comment", () => {
    expect(hosts('val u = "https://app.loonext.com/x" // see https://api.loonext.com', "kotlin")).toEqual([
      "app.loonext.com",
    ]);
  });

  it("blanks nested block comments whole", () => {
    expect(hosts('/* a /* b */ "https://app.loonext.com" */ val x = 1', "kotlin")).toEqual([]);
    expect(hosts('/* a /* b */ "https://app.loonext.com" */ let x = 1', "swift")).toEqual([]);
  });

  it("follows Kotlin and Swift interpolation, quotes and all", () => {
    expect(hosts('val u = "${if (a) "https://app.loonext.com" else ""}/x"', "kotlin")).toEqual([
      "app.loonext.com",
    ]);
    expect(hosts('let u = "\\(pick("https://app.loonext.com"))/x"', "swift")).toEqual(["app.loonext.com"]);
  });

  it("reads multi-line strings", () => {
    expect(hosts('val u = """\n  https://app.loonext.com\n"""', "kotlin")).toEqual(["app.loonext.com"]);
  });

  it("does not let a quote in a Kotlin char literal open a string", () => {
    expect(hosts("val q = '\"' // https://app.loonext.com", "kotlin")).toEqual([]);
  });

  it("blanks XML comments and keeps attributes", () => {
    const xml = '<!-- a tap on https://app.loonext.com -->\n<data android:host="app.loonext.com" />';
    expect(guard.findHosts(xml, "xml")).toEqual([{ host: "app.loonext.com", line: 2 }]);
  });

  it("blanks config comments, but not a # inside a value", () => {
    const yml = "# Universal links: https://app.loonext.com\n- applinks:app.loonext.com\nurl: https://x.invalid/a#b";
    expect(guard.findHosts(yml, "config")).toEqual([{ host: "app.loonext.com", line: 2 }]);
  });
});

describe("which mentions are uses", () => {
  it("counts a host after a scheme, a quote, a key, = or >", () => {
    expect(hosts('URL(string: "https://api.loonext.com")!', "swift")).toEqual(["api.loonext.com"]);
    expect(hosts('if (uri.host != "app.loonext.com") return', "kotlin")).toEqual(["app.loonext.com"]);
    expect(hosts('"applinks:app.loonext.com"', "swift")).toEqual(["app.loonext.com"]);
    expect(hosts("<domain>api.loonext.com</domain>", "xml")).toEqual(["api.loonext.com"]);
  });

  it("counts a host under the production hosts", () => {
    expect(hosts('"https://edge.app.loonext.com"', "kotlin")).toEqual(["edge.app.loonext.com"]);
  });

  it("counts any hosted Supabase project, because the rig's database is local", () => {
    expect(hosts('"https://example.supabase.co"', "kotlin")).toEqual(["example.supabase.co"]);
  });

  it("leaves copy that tells a person where to go", () => {
    expect(hosts('"shell.setupWorkspaceAction" to "Open app.loonext.com"', "kotlin")).toEqual([]);
  });

  it("leaves the mailbox and the public marketing site", () => {
    expect(hosts('"mailto:support@loonext.com"', "kotlin")).toEqual([]);
    expect(hosts('"https://loonext.com/legal/fair-use"', "kotlin")).toEqual([]);
    expect(hosts('"https://www.loonext.com"', "swift")).toEqual([]);
  });

  it("counts every mention in config, which has no copy", () => {
    expect(hosts("host: app.loonext.com", "config")).toEqual(["app.loonext.com"]);
  });
});

describe("judging files", () => {
  const KT = "apps/android/app/src/main/kotlin/com/loonext/android/Example.kt";
  const XML = "apps/android/app/src/main/AndroidManifest.xml";
  const SWIFT = "apps/ios/Loonext/Features/Example.swift";
  const GRADLE = "apps/android/app/build.gradle.kts";
  const CONFIG = "apps/ios/Loonext/Core/AppConfig.swift";
  const sanctioned = { [GRADLE]: "android", [CONFIG]: "ios" } as const;
  const configured: Files = [
    { file: GRADLE, text: GRADLE_TEXT },
    { file: CONFIG, text: 'static let apiURL = URL(string: "https://api.loonext.com")!' },
  ];
  const run = (files: Files, legacy: Record<string, number> = {}) =>
    guard.judge([...configured, ...files], { sanctioned, legacy });

  it("passes hosts in the config modules and code that reads them", () => {
    const result = run([{ file: KT, text: "val origin = BuildConfig.APP_ORIGIN" }]);
    expect(result.failures).toEqual([]);
    expect(result.configured).toEqual({ android: 2, ios: 1 });
  });

  it("holds the Android build file to the nonprod build type replacing its hosts", () => {
    const missing = GRADLE_TEXT.replace(PLACEHOLDER_OVERRIDE, "");
    const failures = guard
      .judge([{ file: GRADLE, text: missing }, configured[1]], { sanctioned, legacy: {} })
      .failures.join("\n");
    expect(failures).toMatch(/does not set manifestPlaceholders appLinkHost again/);
  });

  it("fails a host anywhere else, saying where the value belongs", () => {
    const failures = run([
      { file: KT, text: 'const val CAPTCHA_URL = "https://app.loonext.com/native-captcha"' },
      { file: XML, text: '<data android:scheme="https" android:host="app.loonext.com" />' },
      { file: SWIFT, text: 'static let rp = "app.loonext.com"' },
    ]).failures.join("\n");
    expect(failures).toMatch(/Example\.kt line 1 \(app\.loonext\.com\).*use BuildConfig/);
    expect(failures).toMatch(/AndroidManifest\.xml line 1 .*use a manifest placeholder/);
    expect(failures).toMatch(/Example\.swift line 1 .*read it from AppConfig/);
  });

  it("holds a legacy file to its count, both ways", () => {
    const two = { file: SWIFT, text: '"https://app.loonext.com/a"\n"https://app.loonext.com/b"' };
    expect(run([two], { [SWIFT]: 2 }).failures).toEqual([]);
    expect(run([two], { [SWIFT]: 1 }).failures.join("\n")).toMatch(/1 allowed as legacy/);
    expect(run([two], { [SWIFT]: 3 }).failures.join("\n")).toMatch(/Lower LEGACY .* to 2/);
  });

  it("fails list entries for files it never read", () => {
    const failures = guard
      .judge(configured, { sanctioned: { ...sanctioned, "apps/ios/Gone.swift": "ios" }, legacy: { [KT]: 1 } })
      .failures.join("\n");
    expect(failures).toMatch(/Example\.kt is in LEGACY but is gone/);
    expect(failures).toMatch(/Gone\.swift is sanctioned but is gone/);
  });

  it("fails when a platform's config holds no production host, since the reader is blind", () => {
    const failures = guard.judge([{ file: GRADLE, text: "" }, configured[1]], { sanctioned, legacy: {} }).failures;
    expect(failures.join("\n")).toMatch(/No production host found in the android config modules/);
  });

  it("keeps every real list entry inside its own scope", () => {
    for (const file of [...Object.keys(guard.SANCTIONED), ...Object.keys(guard.LEGACY)]) {
      expect(guard.inScope(file), file).toBe(true);
    }
  });
});

describe("the nonprod build type", () => {
  const field = (name: string, value: string) =>
    `        buildConfigField(\n            "String",\n            "${name}",\n            "\\"${value}\\"",\n        )\n`;

  it("passes when every production value is set again for nonprod", () => {
    expect(guard.nonprodGaps(GRADLE_TEXT)).toEqual([]);
  });

  it("fails a production field nonprod does not replace, which it would inherit", () => {
    const text = GRADLE_TEXT.replace(DEFAULTS_END, field("REALTIME_URL", "wss://api.loonext.com/rt") + DEFAULTS_END);
    expect(guard.nonprodGaps(text).join("\n")).toMatch(
      /line \d+ \(api\.loonext\.com\): the nonprod build type does not set buildConfigField REALTIME_URL again/,
    );
  });

  it("fails a host it cannot tie to a setting nonprod could replace", () => {
    const text = GRADLE_TEXT.replace(DEFAULTS_END, '        val prod = "https://api.loonext.com"\n' + DEFAULTS_END);
    expect(guard.nonprodGaps(text).join("\n")).toMatch(/write it as the value of a buildConfigField/);
  });

  it("fails a production host set inside a nonprod build type", () => {
    const text = GRADLE_TEXT.replace('"nonprod.invalid"', '"app.loonext.com"');
    expect(guard.nonprodGaps(text).join("\n")).toMatch(/a nonprod build type sets a production host/);
  });

  it("fails a build file with no nonprod build type", () => {
    const text = GRADLE_TEXT.replace('create("nonprod")', 'create("staging")');
    expect(guard.nonprodGaps(text).join("\n")).toMatch(/no nonprod build type/);
  });

  it("does not take a nonprod signing config for the build type", () => {
    const text = `signingConfigs {\n    create("nonprod") {\n    }\n}\n${GRADLE_TEXT.replace('create("nonprod")', 'create("staging")')}`;
    expect(guard.nonprodGaps(text).join("\n")).toMatch(/no nonprod build type/);
  });
});

describe("scope", () => {
  it("reads the shipping sources and build config of both apps", () => {
    for (const file of [
      "apps/android/app/src/main/kotlin/com/loonext/android/MainActivity.kt",
      "apps/android/app/src/main/AndroidManifest.xml",
      "apps/android/app/src/main/res/xml/network_security_config.xml",
      "apps/android/app/build.gradle.kts",
      "apps/ios/Loonext/LoonextApp.swift",
      "apps/ios/project.yml",
    ]) {
      expect(guard.inScope(file), file).toBe(true);
    }
  });

  it("leaves tests, docs and the other apps alone", () => {
    for (const file of [
      "apps/android/app/src/test/kotlin/com/loonext/android/push/PushPayloadTest.kt",
      "apps/android/app/src/androidTest/kotlin/Example.kt",
      "apps/ios/LoonextTests/NotificationsPushPayloadTests.swift",
      "apps/android/README.md",
      "apps/web/src/lib/app-origin.ts",
    ]) {
      expect(guard.inScope(file), file).toBe(false);
    }
  });

  it("reads each file with its own comment syntax", () => {
    expect(guard.syntaxOf("a/Foo.kt")).toBe("kotlin");
    expect(guard.syntaxOf("a/build.gradle.kts")).toBe("kotlin");
    expect(guard.syntaxOf("a/Foo.swift")).toBe("swift");
    expect(guard.syntaxOf("a/AndroidManifest.xml")).toBe("xml");
    expect(guard.syntaxOf("apps/ios/project.yml")).toBe("config");
    expect(guard.syntaxOf("a/proguard-rules.pro")).toBe("config");
  });
});

it("runs in the CI guard job", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");
  expect(workflow).toMatch(/^\s*run: node scripts\/check-production-host-literals\.mjs\s*$/m);
});
