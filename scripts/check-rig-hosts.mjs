#!/usr/bin/env node
/**
 * D142: the rig's configuration names only the rig.
 *
 * "Cannot touch production" holds only while every address the rig is
 * configured with is its own: the *.rig.internal names Caddy serves on a
 * private network, loopback, the access point's 10.77.0.0/24, and the edge on
 * workers.dev (docs/RIG.md). A production host in a unit, the settings
 * template or a derived Worker config is a rig that reaches production while
 * every verdict it records says rig.
 *
 * What it reads, and what counts as naming a host in each:
 *   - the box's configs (tools/rig/box): every name and address outside a
 *     comment, except a dnsmasq line that makes a name resolve to nothing,
 *     which names production only to refuse it. Installers (*.sh) are left
 *     out: they fetch Node, Docker and the Stripe CLI from their publishers;
 *   - the API's settings template (tools/rig/templates): literal values. A
 *     {{placeholder}} is filled from the settings below or from the edge;
 *   - the deploy CLI's settings defaults (tools/rig/src/layout.mjs);
 *   - every JSON and JSONC file under tools/rig, tools/edge and tools/guard:
 *     string values that are a URL or a bare host name, so prose is not read;
 *   - the configs the deploy CLI derives from apps/api and apps/web, by running
 *     its derivation, and once more fed production routes, which must not
 *     survive it;
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

/** The deploy CLI's derivation inputs, as `rig deploy` passes them. */
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
  if (/^10\.77\.0\.\d{1,3}$/.test(host)) return true;
  return EDGE_HOST.test(host);
}

const URL_HOST = /\b[a-z][a-z0-9+.-]*:\/\/(\[[0-9a-f:]+\]|[^\s/:?#"'`<>{}()|,;\\]+)/gi;
const LABELS = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+`;
const LAST_LABEL = String.raw`[a-z][a-z0-9-]*[a-z0-9]`;
const BARE_NAME = new RegExp(String.raw`(?<![\w.@-])(${LABELS}(${LAST_LABEL}))(?![\w-]|\.[a-z0-9])`, "gi");
const WHOLE_NAME = new RegExp(`^${LABELS}${LAST_LABEL}$`, "i");
const IPV4 = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g;

/** A dotted quad that is a netmask (dhcp-range), not an address. */
const isNetmask = (quad) => quad.startsWith("255.");

/**
 * Every host a line of text names: URL hosts, bare names under a known
 * domain, and IPv4 literals. An email address names a mailbox, not a host.
 */
export function hostsInText(text) {
  const found = [];
  const taken = [];
  for (const match of text.matchAll(URL_HOST)) {
    found.push(match[1]);
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

/** A box config (Caddyfile, dnsmasq, systemd, sysctl, apt). */
export function boxFindings(path, text) {
  const findings = newFindings();
  const dnsmasq = /\/dnsmasq\//.test(path);
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("//")) return;
    if (dnsmasq) {
      const refused = dnsmasqRefusal(line);
      if (refused) {
        findings.refused += refused.length;
        return;
      }
    }
    judgeHosts(`${path}:${index + 1}`, hostsInText(line), findings);
  });
  return findings;
}

/** The API's settings template: literal values, placeholders aside. */
export function templateFindings(path, text) {
  const findings = newFindings();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    judgeHosts(`${path}:${index + 1}`, hostsInText(line.replace(/\{\{[^}]*\}\}/g, " ")), findings);
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
 * The hosts a parsed JSON value names: string values that are a URL, or that
 * are a host name and nothing else. Prose that mentions a domain is not read.
 */
export function hostsInValue(value) {
  const found = [];
  for (const { at, value: text } of strings(value)) {
    const trimmed = text.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      for (const host of hostsInText(trimmed.split(/\s/)[0])) found.push({ at, host });
      continue;
    }
    const name = WHOLE_NAME.exec(trimmed);
    if (name && TLDS.has(trimmed.split(".").pop().toLowerCase())) found.push({ at, host: trimmed });
    else if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(trimmed)) found.push({ at, host: trimmed.split(":")[0] });
  }
  return found;
}

export function jsonFindings(path, value) {
  const findings = newFindings();
  for (const { at, host } of hostsInValue(value)) judgeHosts(`${path} ${at}`, [host], findings);
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

  const surfaces = {};
  const coverage = [];
  const surface = (name) => (surfaces[name] ??= { files: 0, ...newFindings() });

  for (const path of trackedFiles("tools/rig/box").filter((file) => !file.endsWith(".sh"))) {
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
  for (const path of jsonFiles) {
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

  for (const name of ["box", "template", "settings", "json", "wrangler", "derived"]) {
    if (!surfaces[name] || surfaces[name].files === 0) coverage.push(`found no ${name} files to read`);
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
      "\nThe rig may name *.rig.internal, loopback, its access point (10.77.0.0/24) " +
        `and its edge (${EDGE_NAME}.<account>.workers.dev), nothing else (docs/RIG.md 3.2-3.4, D142).\n`,
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
