#!/usr/bin/env node
/**
 * D142: the rig's configuration names only the rig.
 *
 * "Cannot touch production" holds only while every address the rig is
 * configured with is its own: the *.rig.internal names Caddy serves on a
 * private network, loopback, the edge on workers.dev (docs/RIG.md), and the
 * two VMnet8 addresses of the rig's VM (tools/rig/host/contract.json): the
 * VM's own 192.168.70.10, where the emulators reach Caddy and dnsmasq, and the
 * workstation's 192.168.70.1, the only peer the VM's firewall admits. The NAT
 * gateway, 192.168.70.2, passes only where it is named as the gateway: the
 * contract's vm.gateway and the firewall's `define gateway`. A production
 * host in a unit, the settings template or a derived
 * config is a rig that reaches production while every verdict it records says
 * rig.
 *
 * What it reads, and what counts as naming a host in each:
 *   - the box's configs (tools/rig/box): every name and address outside a
 *     comment, except a dnsmasq line that makes a name resolve to nothing,
 *     which names production only to refuse it, and an address block in the
 *     firewall (`10.0.0.0/8`), which names a range, not a host. Installers (*.sh) and the
 *     pins they read (INSTALLER_PINS) are left out: they fetch Node, Docker, the Stripe CLI,
 *     the JDK and the Android SDK from their publishers;
 *   - the API's settings template (tools/rig/templates): literal values. A
 *     {{placeholder}} is filled from the settings below or from the edge, so a
 *     host that is only a placeholder is not judged, while the literal part of
 *     one beside a placeholder (`{{ref}}.supabase.co`, `{{key}}@sentry.io`) is;
 *   - the deploy CLI's settings defaults (tools/rig/src/layout.mjs);
 *   - every JSON and JSONC file under tools/rig, tools/edge and tools/guard:
 *     every URL in a string value, and a value that is a host and nothing
 *     else (with a port, a path or a leading `*.`), so prose naming a domain
 *     is not read;
 *   - the configs the deploy CLI derives, by running its derivations: the
 *     Worker configs from apps/api and apps/web, once more fed production
 *     routes, which must not survive it, and the Supabase config.toml from
 *     supabase/config.toml, once more fed production auth URLs, which must
 *     not survive it either. Every other line of that config reaches the rig
 *     verbatim, so its string values are read too;
 *   - the edge's and the guard's wrangler configs: no routes, and the guard
 *     with workers_dev and preview_urls false, since the edge's service
 *     binding is its only way in.
 *
 * Usage: node scripts/check-rig-hosts.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EDGE_NAME = "loonext-rig-edge";
const GUARD_NAME = "loonext-telnyx-guard";
const EDGE_HOST = /^loonext-rig-edge\.[a-z0-9-]+\.workers\.dev$/;
/** The VM's own address and the workstation's, on VMnet8. */
const VM_ADDRESSES = new Set(["192.168.70.10", "192.168.70.1"]);
export const GATEWAY = "192.168.70.2";
const CONTRACT = "tools/rig/host/contract.json";

/** The deploy CLI's derivation inputs, as `rig deploy` passes them. */
const INSTALLER_PINS = new Set(["tools/rig/box/android-toolchain.json"]);

const DERIVED = [
  { source: "apps/api/wrangler.jsonc", options: { port: 8787, aiShim: true } },
  { source: "apps/web/wrangler.jsonc", options: { port: 8788 } },
];

/** What the derivation must drop: production wiring that names hosts or the account. */
const PRODUCTION_WIRING = {
  routes: [{ pattern: "api.loonext.com", custom_domain: true }],
  route: "loonext.com/*",
  account_id: "rig-hosts-probe",
};
const WIRING_KEYS = Object.keys(PRODUCTION_WIRING);

/** What the Supabase derivation must replace in [auth]: production's own auth URLs. */
const PRODUCTION_AUTH = {
  site_url: '"https://app.loonext.com"',
  additional_redirect_urls: '["https://app.loonext.com/**"]',
  external_url: '"https://auth.loonext.com/auth/v1"',
  jwt_issuer: '"https://auth.loonext.com/auth/v1"',
};

/**
 * What a run of {{placeholders}} becomes before the template is read: one
 * plain label, so a URL or a name around it stays whole.
 */
const STAND_IN = "rig-template-placeholder";

/**
 * Last labels read as a host name. A token like `root.crt`,
 * `loonext-rig-api.service` or `rig.mjs` ends in a file extension, not a
 * domain, so a closed list is what keeps file names out.
 */
const TLDS = new Set([
  "ai", "app", "biz", "ca", "cloud", "co", "com", "de", "dev", "email", "eu",
  "example", "fr", "info", "internal", "invalid", "io", "local", "localhost",
  "me", "net", "online", "org", "page", "run", "site", "tech", "test", "uk",
  "us", "xyz",
]);

const normalise = (raw) => raw.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");

export function isLoopback(raw) {
  const host = normalise(raw);
  return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export function isRigHost(raw) {
  const host = normalise(raw);
  if (host === "rig.internal" || host.endsWith(".rig.internal")) return true;
  if (isLoopback(host)) return true;
  if (VM_ADDRESSES.has(host)) return true;
  return EDGE_HOST.test(host);
}

const URL_AUTHORITY = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/?#"'`<>{}()|,;\\]*)/gi;
const LABELS = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+`;
const LAST_LABEL = String.raw`[a-z][a-z0-9-]*[a-z0-9]`;
const BARE_NAME = new RegExp(String.raw`(?<![\w.@-])(${LABELS}(${LAST_LABEL}))(?![\w-]|\.[a-z0-9])`, "gi");
const IPV4 = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g;

/**
 * A value that is a host and nothing else, in the shapes a route pattern
 * (`*.host/*`), an SMTP host (`host:465`) or a proxy target takes.
 */
const HOST_VALUE = new RegExp(
  String.raw`^(?:\/\/)?(?:\*\.?)?(\[[0-9a-f:]+\]|\d{1,3}(?:\.\d{1,3}){3}|${LABELS}(${LAST_LABEL}))\.?(?::\d+)?(?:[/?#]\S*)?$`,
  "i",
);

/** A dotted quad that is a netmask (dhcp-range), not an address. */
const isNetmask = (quad) => quad.startsWith("255.");

/** An address block such as config.toml's `allowed_cidrs`: who may connect in, not a host anything reaches. */
const CIDR = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)\/\d{1,3}$/i;

/** The host in a URL's authority: after any userinfo, before any port. */
function authorityHost(authority) {
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  return host.split(":")[0];
}

/**
 * Every host a line of text names: URL hosts, bare names under a known
 * domain, and IPv4 literals. An email address names a mailbox, not a host.
 */
export function hostsInText(text) {
  const found = [];
  const taken = [];
  for (const match of text.matchAll(URL_AUTHORITY)) {
    const host = authorityHost(match[1]);
    if (host !== "") found.push(host);
    taken.push([match.index, match.index + match[0].length]);
  }
  const outsideUrls = (index) => !taken.some(([start, end]) => index >= start && index < end);
  for (const match of text.matchAll(BARE_NAME)) {
    if (!outsideUrls(match.index)) continue;
    if (TLDS.has(match[2].toLowerCase())) found.push(match[1]);
  }
  for (const match of text.matchAll(IPV4)) {
    if (!outsideUrls(match.index) || isNetmask(match[1])) continue;
    found.push(match[1]);
  }
  return found;
}

/**
 * The names a dnsmasq line makes resolve to nothing: `local=/a/b/` and an
 * `address=/a/` with no answer or a null one. Null for any other line.
 */
export function dnsmasqRefusal(line) {
  const local = /^local=\/(.+)\/$/.exec(line);
  if (local) return local[1].split("/").filter(Boolean);
  const address = /^address=\/(.+)\/([^/]*)$/.exec(line);
  if (address && ["", "0.0.0.0", "::", "#"].includes(address[2])) {
    return address[1].split("/").filter(Boolean);
  }
  return null;
}

function judgeHosts(where, hosts, findings) {
  for (const host of hosts) {
    findings.judged += 1;
    if (!isRigHost(host)) findings.problems.push(`${where}  names ${host}, which is not the rig's`);
  }
}

function newFindings() {
  return { judged: 0, refused: 0, problems: [] };
}

/** An IPv4 block (`10.0.0.0/8`) in a firewall line: a range, not a host. */
const IPV4_BLOCK = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}(?![\d.])/g;

/** A box config (Caddyfile, dnsmasq, nftables, sshd, systemd, apt). */
export function boxFindings(path, text) {
  const findings = newFindings();
  const dnsmasq = /\/dnsmasq\//.test(path);
  const nft = path.endsWith(".nft");
  text.split(/\r?\n/).forEach((raw, index) => {
    let line = raw.trim();
    const where = `${path}:${index + 1}`;
    if (line === "" || line.startsWith("#") || line.startsWith("//")) return;
    if (dnsmasq) {
      const refused = dnsmasqRefusal(line);
      if (refused) {
        findings.refused += refused.length;
        return;
      }
    }
    if (nft) {
      const gateway = /^define\s+gateway\s*=\s*(\S+)$/.exec(line);
      if (gateway) {
        findings.judged += 1;
        if (gateway[1] !== GATEWAY) findings.problems.push(`${where}  defines the gateway as ${gateway[1]}, not VMnet8's ${GATEWAY}`);
        return;
      }
      line = line.replace(IPV4_BLOCK, " ");
    }
    judgeHosts(where, hostsInText(line), findings);
  });
  return findings;
}

/** The API's settings template: literal values, and the literal part of a host built around a placeholder. */
export function templateFindings(path, text) {
  const findings = newFindings();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const hosts = hostsInText(line.replace(/(?:\{\{[^}]*\}\})+/g, STAND_IN))
      .filter((host) => host !== STAND_IN)
      .map((host) => host.split(STAND_IN).join("{{...}}"));
    judgeHosts(`${path}:${index + 1}`, hosts, findings);
  });
  return findings;
}

function* strings(value, at = "") {
  if (typeof value === "string") yield { at, value };
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, `${at}[${index}]`);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* strings(item, at ? `${at}.${key}` : key);
  }
}

/**
 * The hosts one configured string names: every URL in it, or the string
 * itself when it is a host and nothing else. Prose that mentions a domain
 * without a scheme is not read.
 */
export function hostsInString(text) {
  const trimmed = text.trim();
  const urls = [...trimmed.matchAll(URL_AUTHORITY)].map((match) => authorityHost(match[1])).filter(Boolean);
  if (urls.length > 0) return urls;
  if (CIDR.test(trimmed)) return [];
  const whole = HOST_VALUE.exec(trimmed);
  if (!whole || (whole[2] !== undefined && !TLDS.has(whole[2].toLowerCase()))) return [];
  return [whole[1]];
}

/** The hosts a parsed JSON value names, by where each string sits in it. */
export function hostsInValue(value) {
  const found = [];
  for (const { at, value: text } of strings(value)) {
    for (const host of hostsInString(text)) found.push({ at, host });
  }
  return found;
}

export function jsonFindings(path, value) {
  const findings = newFindings();
  for (const { at, host } of hostsInValue(value)) {
    if (path === CONTRACT && at === "vm.gateway" && host === GATEWAY) {
      findings.judged += 1;
      continue;
    }
    judgeHosts(`${path} ${at}`, [host], findings);
  }
  return findings;
}

/** The string values on one line of TOML, up to a comment. */
export function tomlStrings(line) {
  const values = [];
  for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|#/g)) {
    if (match[0] === "#") break;
    values.push(match[1] ?? match[2]);
  }
  return values;
}

/** A derived config.toml: every host its string values name. */
export function tomlFindings(where, text) {
  const findings = newFindings();
  text.split(/\r?\n/).forEach((line, index) => {
    for (const value of tomlStrings(line)) judgeHosts(`${where}:${index + 1}`, hostsInString(value), findings);
  });
  return findings;
}

/** A tools/ wrangler config: no routes, and the guard closed to the internet. */
export function wranglerFindings(path, config) {
  const findings = newFindings();
  const sections = [["", config], ...Object.entries(config.env ?? {}).map(([name, env]) => [`env.${name}.`, env])];
  for (const [prefix, section] of sections) {
    if (section.route !== undefined) findings.problems.push(`${path}  sets ${prefix}route; the rig's Workers have no routes`);
    if (section.routes !== undefined && !(Array.isArray(section.routes) && section.routes.length === 0)) {
      findings.problems.push(`${path}  sets ${prefix}routes; the rig's Workers have no routes`);
    }
  }
  if (config.name === GUARD_NAME) {
    for (const key of ["workers_dev", "preview_urls"]) {
      if (config[key] !== false) {
        findings.problems.push(
          `${path}  ${config[key] === undefined ? `does not set "${key}", and absent means on` : `sets "${key}" to ${JSON.stringify(config[key])}`}; ` +
            "the guard is reached only through the edge's service binding",
        );
      }
    }
  }
  findings.judged += 1;
  return findings;
}

/**
 * A derived config, as the deploy CLI writes it: every host it names, no
 * production wiring at the top or in env.rig, and `wrangler dev` on loopback.
 */
export function derivedFindings(source, derived) {
  const findings = newFindings();
  const where = `${source} (derived wrangler.rig.jsonc)`;
  for (const { at, host } of hostsInValue(derived)) judgeHosts(`${where} ${at}`, [host], findings);
  for (const [prefix, section] of [["", derived], ["env.rig.", derived.env?.rig ?? {}]]) {
    for (const key of WIRING_KEYS) {
      if (section[key] !== undefined) findings.problems.push(`${where}  keeps ${prefix}${key}`);
    }
  }
  const ip = derived.dev?.ip;
  findings.judged += 1;
  if (typeof ip !== "string" || !isLoopback(ip)) {
    findings.problems.push(`${where}  serves on ${JSON.stringify(ip)}; wrangler dev must listen on loopback`);
  }
  return findings;
}

function merge(into, from) {
  into.judged += from.judged;
  into.refused += from.refused;
  into.problems.push(...from.problems);
}

function trackedFiles(...patterns) {
  return execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--", ...patterns], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

async function rigModule(path) {
  return import(pathToFileURL(join(REPO_ROOT, path)).href);
}

async function main() {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const { parseJsonc } = await rigModule("tools/rig/src/jsonc.mjs");
  const { DEFAULT_SETTINGS } = await rigModule("tools/rig/src/layout.mjs");
  const { deriveRigConfig } = await rigModule("tools/rig/src/wrangler-config.mjs");
  const { deriveSupabaseConfig, setTomlKey } = await rigModule("tools/rig/src/supabase-config.mjs");

  const surfaces = {};
  const coverage = [];
  const surface = (name) => (surfaces[name] ??= { files: 0, ...newFindings() });

  for (const path of trackedFiles("tools/rig/box").filter((file) => !file.endsWith(".sh") && !INSTALLER_PINS.has(file))) {
    surface("box").files += 1;
    merge(surface("box"), boxFindings(path, read(path)));
  }

  for (const path of trackedFiles("tools/rig/templates")) {
    surface("template").files += 1;
    merge(surface("template"), templateFindings(path, read(path)));
  }

  surface("settings").files += 1;
  merge(surface("settings"), jsonFindings("tools/rig/src/layout.mjs DEFAULT_SETTINGS", DEFAULT_SETTINGS));

  const jsonFiles = trackedFiles(
    "tools/rig/*.json", "tools/rig/*.jsonc", "tools/edge/*.json", "tools/edge/*.jsonc",
    "tools/guard/*.json", "tools/guard/*.jsonc",
  );
  for (const path of jsonFiles.filter((file) => !INSTALLER_PINS.has(file))) {
    surface("json").files += 1;
    merge(surface("json"), jsonFindings(path, parseJsonc(read(path))));
  }

  const wranglers = trackedFiles("tools/**/wrangler.json", "tools/**/wrangler.jsonc");
  const names = new Set();
  for (const path of wranglers) {
    const config = parseJsonc(read(path));
    names.add(config.name);
    surface("wrangler").files += 1;
    merge(surface("wrangler"), wranglerFindings(path, config));
  }
  for (const name of [EDGE_NAME, GUARD_NAME]) {
    if (!names.has(name)) coverage.push(`no tracked wrangler config under tools/ is named ${name}`);
  }

  for (const { source, options } of DERIVED) {
    const config = parseJsonc(read(source));
    surface("derived").files += 1;
    try {
      merge(surface("derived"), derivedFindings(source, deriveRigConfig(config, options)));
      merge(
        surface("derived"),
        derivedFindings(`${source} with production routes`, deriveRigConfig({ ...config, ...PRODUCTION_WIRING }, options)),
      );
    } catch (cause) {
      surface("derived").problems.push(
        `${source}  the deploy CLI refuses to derive it: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  // `rig deploy` passes supabaseUrl only when it is not the CLI's own address,
  // so both shapes are derived; the production probe needs it to be replaced.
  const supabaseSource = "supabase/config.toml";
  const committed = read(supabaseSource);
  const auth = { appOrigin: DEFAULT_SETTINGS.appOrigin, totp: true };
  const withRigUrl = { ...auth, supabaseUrl: DEFAULT_SETTINGS.supabaseUrl };
  const withProductionAuth = Object.entries(PRODUCTION_AUTH).reduce(
    (text, [key, value]) => setTomlKey(text, "auth", key, value),
    committed,
  );
  surface("supabase").files += 1;
  try {
    for (const [label, text, options] of [
      ["", committed, withRigUrl],
      [" on the CLI's own address", committed, auth],
      [" with production auth URLs", withProductionAuth, withRigUrl],
    ]) {
      merge(
        surface("supabase"),
        tomlFindings(`${supabaseSource} (derived config.toml${label})`, deriveSupabaseConfig(text, options)),
      );
    }
  } catch (cause) {
    surface("supabase").problems.push(
      `${supabaseSource}  the deploy CLI refuses to derive it: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  for (const name of ["box", "template", "settings", "json", "wrangler", "derived", "supabase"]) {
    if (!surfaces[name] || surfaces[name].files === 0) coverage.push(`found no ${name} files to read`);
  }
  if (surfaces.supabase.problems.length === 0 && surfaces.supabase.judged === 0) {
    coverage.push("read no host in the derived config.toml, which always names the rig's site_url");
  }
  const total = Object.values(surfaces).reduce((sum, entry) => sum + entry.judged, 0);
  if (total === 0) coverage.push("judged no host at all, so a pass would mean nothing");

  if (coverage.length > 0) {
    console.error("check-rig-hosts: cannot vouch for the tree.\n");
    for (const line of coverage) console.error(`  ${line}`);
    process.exit(1);
  }

  const problems = Object.values(surfaces).flatMap((entry) => entry.problems);
  if (problems.length > 0) {
    console.error("check-rig-hosts: the rig's configuration names something that is not the rig.\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "\nThe rig may name *.rig.internal, loopback and its edge " +
        `(${EDGE_NAME}.<account>.workers.dev) (docs/RIG.md 3.2-3.4, D142), the VM's 192.168.70.10 and ` +
        `the workstation's 192.168.70.1 (${CONTRACT}), and ${GATEWAY} only as the gateway; nothing else.\n`,
    );
    process.exit(1);
  }

  const summary = Object.entries(surfaces)
    .map(([name, entry]) => `${name} ${entry.judged} in ${entry.files} file(s)`)
    .join(", ");
  console.log(
    `check-rig-hosts: ${total} hosts and settings judged (${summary}); ` +
      `all are the rig's own. ${surfaces.box.refused} production names are refused by the rig's DNS.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
