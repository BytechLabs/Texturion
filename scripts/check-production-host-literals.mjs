#!/usr/bin/env node
/**
 * Production hosts appear in the phone apps only where a build can replace them.
 *
 *   node scripts/check-production-host-literals.mjs
 *
 * WHY. The rig installs a nonprod Android build and points it at its own API,
 * web app and database. That works only if every production host the app
 * opens, signs in against or trusts comes from build configuration, which the
 * nonprod build type overrides. A literal anywhere else is a request the
 * nonprod build still sends to production, and nothing in the run's result
 * says so: a captcha solved on the production web app, a passkey ceremony for
 * the production relying party, a push deep link accepted only from the
 * production origin.
 *
 * WHAT COUNTS. Hosts with a session or data behind them: the API, the web app,
 * and any hosted Supabase project (the rig's database is local, so every
 * supabase.co host is production's). The marketing site is public and
 * sessionless and `support@` is a mailbox, so neither counts. In code and XML a
 * host counts only where it is used as one: after a scheme, a quote, a key such
 * as `applinks:`, `=` or `>`. Copy that tells a person to open the web app puts
 * it after a space, and nothing is ever requested from it. In YAML, properties
 * and similar config every mention counts, because config has no copy. Comments
 * are blanked first, so a doc comment quoting a URL is not a use.
 *
 * THE BUILD FILE. The Android build file may set production hosts, but only as
 * a buildConfigField, a resValue or a manifest placeholder that the nonprod
 * build type sets again. That build type inherits every value it does not
 * replace, so a new production field without an override passes as config
 * while the nonprod build still talks to production.
 *
 * WHAT IT READS. The shipping sources of both apps, tracked or new. Tests are
 * left out: they are not in the APK or the IPA, and they pin production values
 * on purpose.
 *
 * LEGACY. iOS has no nonprod build, so its literals stay until it gets one, and
 * Android keeps one display-only stand-in. They are counted per file. A count
 * may only fall, and a count that has fallen must be lowered here, so the list
 * cannot go stale while looking current.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The modules that hold build configuration; a nonprod build replaces these. */
export const SANCTIONED = {
  "apps/android/app/build.gradle.kts": "android",
  "apps/ios/Loonext/Core/AppConfig.swift": "ios",
  "apps/ios/project.yml": "ios",
};

/** Files that held production hosts before this check existed. */
export const LEGACY = {
  // A same-length stand-in for a payment link in a message preview. The real
  // link is minted by the server; nothing opens this one.
  "apps/android/app/src/main/kotlin/com/loonext/android/features/thread/AskForPayment.kt": 1,
  "apps/ios/Loonext/Features/Auth/CaptchaSheet.swift": 1,
  "apps/ios/Loonext/Features/Payments/PaymentsLogic.swift": 1,
  "apps/ios/Loonext/Features/Push/PushPayload.swift": 2,
  "apps/ios/Loonext/Features/Settings/PasskeyEnrolment.swift": 1,
  "apps/ios/Loonext/Features/Settings/SettingsLogic.swift": 1,
  "apps/ios/Loonext/Features/Shell/RootView.swift": 2,
};

const BINARY =
  /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|jar|class|woff2?|ttf|otf|mp3|wav|ogg|m4a|mp4|keystore|jks|apk|aab)$/i;

/** Shipping sources of the two apps. */
export function inScope(file) {
  if (!/^apps\/(?:android|ios)\//.test(file)) return false;
  if (/^apps\/android\/app\/src\/(?:test|androidTest)[A-Za-z]*\//.test(file)) return false;
  if (/^apps\/android\/mws\//.test(file)) return false;
  if (/^apps\/ios\/[^/]*Tests\//.test(file)) return false;
  return !/\.md$/i.test(file) && !BINARY.test(file);
}

/** How a file writes comments, from its extension. */
export function syntaxOf(file) {
  if (/\.(?:kt|kts|java|gradle)$/.test(file)) return "kotlin";
  if (/\.swift$/.test(file)) return "swift";
  if (/\.(?:xml|plist|entitlements|storyboard|xib)$/.test(file)) return "xml";
  if (/\.(?:ya?ml|properties|pro|toml|txt)$/.test(file) || /(?:^|\/)\.gitignore$/.test(file)) {
    return "config";
  }
  return "plain";
}

/**
 * The text with every comment replaced by spaces, newlines kept, so offsets and
 * line numbers still match the file. Strings are skipped whole, interpolations
 * included, because `https://` inside one is not a comment.
 */
export function blankComments(text, syntax) {
  const out = text.split("");
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  const lineEnd = (i) => {
    const eol = text.indexOf("\n", i);
    return eol === -1 ? n : eol;
  };

  if (syntax === "xml") {
    for (let i = text.indexOf("<!--"); i !== -1; i = text.indexOf("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      blank(i, stop);
      i = stop;
    }
    return out.join("");
  }

  if (syntax === "config") {
    let quote = null;
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (ch === "\n") quote = null;
      else if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
        const stop = lineEnd(i);
        blank(i, stop);
        i = stop - 1;
      }
    }
    return out.join("");
  }

  if (syntax !== "kotlin" && syntax !== "swift") return text;

  const kotlin = syntax === "kotlin";
  const interpolation = kotlin ? "${" : "\\(";
  const [open, close] = kotlin ? ["{", "}"] : ["(", ")"];

  // Code up to the bracket that closes an interpolation, or to the end.
  const code = (start, nested) => {
    let depth = 0;
    let i = start;
    while (i < n) {
      const ch = text[i];
      if (text.startsWith("//", i)) {
        const stop = lineEnd(i);
        blank(i, stop);
        i = stop;
      } else if (text.startsWith("/*", i)) {
        let level = 1;
        let j = i + 2;
        // Kotlin and Swift both nest block comments.
        while (j < n && level > 0) {
          if (text.startsWith("/*", j)) {
            level += 1;
            j += 2;
          } else if (text.startsWith("*/", j)) {
            level -= 1;
            j += 2;
          } else {
            j += 1;
          }
        }
        blank(i, j);
        i = j;
      } else if (text.startsWith('"""', i)) {
        i = string(i + 3, '"""');
      } else if (ch === '"') {
        i = string(i + 1, '"');
      } else if (kotlin && ch === "'") {
        // A char literal: a quote inside one must not open a string.
        const literal = /^'(?:\\[^'\n]*|[^'\\\n])'/.exec(text.slice(i, i + 10));
        i += literal ? literal[0].length : 1;
      } else {
        if (nested && ch === open) depth += 1;
        if (nested && ch === close) {
          if (depth === 0) return i + 1;
          depth -= 1;
        }
        i += 1;
      }
    }
    return n;
  };

  const string = (start, delimiter) => {
    const escapes = !(kotlin && delimiter === '"""');
    let i = start;
    while (i < n) {
      if (text.startsWith(delimiter, i)) return i + delimiter.length;
      if (delimiter === '"' && text[i] === "\n") return i + 1;
      if (text.startsWith(interpolation, i)) i = code(i + interpolation.length, true);
      else i += escapes && text[i] === "\\" ? 2 : 1;
    }
    return n;
  };

  code(0, false);
  return out.join("");
}

const HOST =
  /(?<![A-Za-z0-9.-])((?:[a-z0-9-]+\.)*(?:(?:app|api)\.loonext\.com|[a-z0-9-]+\.supabase\.(?:co|in)))(?![A-Za-z0-9-])/gi;
const USED_AFTER = new Set(["/", '"', "'", "`", ":", "=", ">"]);

/** Uses of a production host in comment-blanked code, with their offsets. */
function hostUses(code, syntax) {
  const found = [];
  for (const match of code.matchAll(HOST)) {
    const before = code[match.index - 1];
    if (syntax !== "config" && !USED_AFTER.has(before)) continue;
    found.push({ host: match[1].toLowerCase(), index: match.index });
  }
  return found;
}

/** Production hosts the file uses as hosts, with their lines. */
export function findHosts(text, syntax) {
  const code = blankComments(text, syntax);
  return hostUses(code, syntax).map(({ host, index }) => ({
    host,
    line: code.slice(0, index).split("\n").length,
  }));
}

/** The offset of the bracket that closes the one at `open`, skipping strings. */
function closing(code, open) {
  const pair = { "(": ")", "{": "}" }[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') {
      for (i += 1; i < code.length && code[i] !== '"'; i++) if (code[i] === "\\") i += 1;
    } else if (ch === code[open]) depth += 1;
    else if (ch === pair && --depth === 0) return i;
  }
  return code.length;
}

/** The body of the first block `pattern` opens inside [from, to), or null. */
function block(code, pattern, from = 0, to = code.length) {
  const re = new RegExp(pattern.source, "g");
  re.lastIndex = from;
  const match = re.exec(code);
  if (!match || match.index >= to) return null;
  const open = match.index + match[0].length - 1;
  return { start: open, end: closing(code, open) };
}

const SETTERS = /(buildConfigField|resValue)\s*\(\s*"[^"]*"\s*,\s*"([^"]+)"/g;
const PLACEHOLDER = /manifestPlaceholders\s*\[\s*"([^"]+)"\s*\]\s*=/g;

/**
 * What the nonprod build type would still send to production: a production
 * host the Android build file sets that the `nonprod` build type does not set
 * again. That build type starts from release, and release from the default
 * config, so a value it does not replace is one it inherits.
 */
export function nonprodGaps(text) {
  const code = blankComments(text, "kotlin");
  const lineOf = (index) => code.slice(0, index).split("\n").length;
  const types = block(code, /\bbuildTypes\s*\{/);
  const nonprod = types && block(code, /\b(?:create|register|maybeCreate|getByName)\(\s*"nonprod"\s*\)\s*\{/, types.start, types.end);
  if (!nonprod) {
    return ["apps/android/app/build.gradle.kts: no nonprod build type, so nothing replaces its production hosts"];
  }

  const overridden = new Set();
  const body = code.slice(nonprod.start, nonprod.end);
  for (const [, fn, name] of body.matchAll(SETTERS)) overridden.add(`${fn} ${name}`);
  for (const [, name] of body.matchAll(PLACEHOLDER)) overridden.add(`manifestPlaceholders ${name}`);

  // Every nonprod-named build type is the rig's, and starts from nonprod.
  const rigTypes = [];
  const named = /\b(?:create|register|maybeCreate|getByName)\(\s*"nonprod[A-Za-z]*"\s*\)\s*\{/g;
  named.lastIndex = types.start;
  for (let m = named.exec(code); m && m.index < types.end; m = named.exec(code)) {
    const open = m.index + m[0].length - 1;
    rigTypes.push({ start: open, end: closing(code, open) });
  }

  const gaps = [];
  for (const { host, index } of hostUses(code, "kotlin")) {
    const where = `apps/android/app/build.gradle.kts line ${lineOf(index)} (${host})`;
    if (rigTypes.some((t) => index > t.start && index < t.end)) {
      gaps.push(`${where}: a nonprod build type sets a production host; set the rig's value from its Gradle properties`);
      continue;
    }
    const owner = ownerOf(code, index);
    if (!owner) {
      gaps.push(
        `${where}: write it as the value of a buildConfigField, a resValue or a ` +
          `manifestPlaceholders entry, so this check can see that nonprod replaces it`,
      );
    } else if (!overridden.has(owner)) {
      gaps.push(
        `${where}: the nonprod build type does not set ${owner} again, so the nonprod ` +
          `build inherits production's value. Set it there from a loonextNonprod property`,
      );
    }
  }
  return gaps;
}

/** The setting a host is the value of: `buildConfigField NAME` and the like. */
function ownerOf(code, index) {
  let owner = null;
  const calls = /\b(buildConfigField|resValue)\s*\(/g;
  for (let m = calls.exec(code); m && m.index < index; m = calls.exec(code)) {
    const open = m.index + m[0].length - 1;
    if (closing(code, open) > index) {
      const name = new RegExp(SETTERS.source).exec(code.slice(m.index, index));
      owner = name ? `${name[1]} ${name[2]}` : null;
    }
  }
  if (owner) return owner;
  const line = code.slice(code.lastIndexOf("\n", index) + 1, index);
  const placeholder = /manifestPlaceholders\s*\[\s*"([^"]+)"\s*\]\s*=\s*"$/.exec(line);
  return placeholder ? `manifestPlaceholders ${placeholder[1]}` : null;
}

/** Where the host should come from instead. */
function fixFor(file) {
  if (file.startsWith("apps/ios/")) return "read it from AppConfig, so a nonprod build can replace it";
  const from = file.endsWith(".xml") ? "a manifest placeholder" : "BuildConfig";
  return `use ${from} set in apps/android/app/build.gradle.kts, so the nonprod build replaces it`;
}

/** Failures for a set of files, plus what was read. */
export function judge(files, { sanctioned = SANCTIONED, legacy = LEGACY } = {}) {
  const failures = [];
  const seen = new Set();
  const configured = { android: 0, ios: 0 };
  let used = 0;
  for (const { file, text } of files) {
    seen.add(file);
    const hosts = findHosts(text, syntaxOf(file));
    used += hosts.length;
    if (sanctioned[file]) {
      configured[sanctioned[file]] += hosts.length;
      if (sanctioned[file] === "android" && file.endsWith(".gradle.kts")) {
        failures.push(...nonprodGaps(text));
      }
      continue;
    }
    const allowed = legacy[file] ?? 0;
    if (hosts.length > allowed) {
      const where = hosts.map((h) => `${h.line} (${h.host})`).join(", ");
      failures.push(
        `${file} line ${where}: ${hosts.length} production host(s)` +
          (allowed ? `, ${allowed} allowed as legacy` : "") +
          `. A nonprod build still sends this to production; ${fixFor(file)}`,
      );
    } else if (hosts.length < allowed) {
      failures.push(
        `${file}: legacy count is ${allowed} but ${hosts.length} remain. Lower LEGACY in ` +
          `scripts/check-production-host-literals.mjs to ${hosts.length}` +
          (hosts.length === 0 ? " (delete the entry)" : ""),
      );
    }
  }
  for (const file of Object.keys(legacy)) {
    if (!seen.has(file)) failures.push(`${file} is in LEGACY but is gone or out of scope; delete the entry`);
  }
  for (const file of Object.keys(sanctioned)) {
    if (!seen.has(file)) {
      failures.push(`${file} is sanctioned but is gone or out of scope; update SANCTIONED`);
    }
  }
  // The production API host has to be configured somewhere on each platform.
  // Finding none means this reader stopped seeing hosts, not that there are none.
  for (const [platform, count] of Object.entries(configured)) {
    if (count === 0) {
      failures.push(
        `No production host found in the ${platform} config modules. The reader is ` +
          `seeing nothing; fix it before trusting a pass`,
      );
    }
  }
  return { failures, used, configured };
}

/** Tracked and new files, never gitignored ones. */
function scopedFiles() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "apps/android", "apps/ios"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
  return [...new Set(listed)]
    .filter((file) => inScope(file) && existsSync(join(REPO_ROOT, file)))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), "utf8") }));
}

function main() {
  const files = scopedFiles();
  const { failures, used, configured } = judge(files);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error(`\ncheck-production-host-literals: ${failures.length} problem(s).`);
    process.exit(1);
  }
  const legacy = Object.values(LEGACY).reduce((sum, n) => sum + n, 0);
  console.log(
    `check-production-host-literals: ${files.length} files, ${used} production host uses: ` +
      `${configured.android} in Android config, ${configured.ios} in iOS config, ` +
      `${legacy} legacy in ${Object.keys(LEGACY).length} files.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
