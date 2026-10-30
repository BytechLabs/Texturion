#!/usr/bin/env node
/**
 * Turn a real Telnyx webhook trace into a fixture this public repository can hold.
 *
 *   node scripts/trace-to-fixture.mjs <trace.json|trace.ndjson> [--out <fixture.json>]
 *
 * WHY. The fake switch in apps/api/e2e/fake-telnyx-voice.ts is modelled from
 * the API reference. The rig records what the real switch sends, and those
 * traces are how the fake gets checked against it. A trace is full of things
 * that must never be published: customers' and robots' phone numbers, account
 * resource ids, softphone credentials, presigned recording URLs, a caller's
 * dipped name, a text's words.
 *
 * WHAT IT CHANGES, consistently across the whole trace so the events still
 * join up (the session id inside a ring leg's client_state still names the
 * customer leg's session):
 *   - phone numbers become the NANP fictional range 555-0100..0199, keeping a
 *     NANP number's area code so country and Caribbean rules still apply;
 *     numbers already fictional are kept and never reused;
 *   - UUIDs, call control ids, connection and profile ids, SIP usernames;
 *   - URLs become a path under /fixtures/urls/, which a replayer resolves
 *     against its fake; IPv4 addresses become TEST-NET addresses; a SIP host
 *     that is not Telnyx's becomes one too;
 *   - client_state is base64: it is decoded, changed the same way and
 *     re-encoded the way it came (UTF-8, or byte for byte when it is not);
 *   - a caller's name and a message's words become placeholders, except the
 *     carrier keywords (STOP, HELP and their kin), which a fixture exists to
 *     replay.
 * Timestamps, event types, causes and states are kept: they are the trace.
 *
 * A trace it cannot fully renumber is refused, and nothing is written. The
 * judge is check-rig-no-e164's own reader, run over the fixture as it would be
 * committed and over every decoded client_state, so a fixture this writes is
 * one that guard passes. A client_state that is not base64 is refused outright:
 * a number inside it would be invisible to both.
 *
 * INPUT. A JSON array of webhook envelopes, one envelope, `{ "data": [...] }`,
 * or one envelope per line. A `webhook_events` row (`{ payload: envelope }`)
 * is unwrapped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findNumbers } from "./check-rig-no-e164.mjs";

export const FIXTURE_SCHEMA = "loonext.telnyx-trace-fixture.v1";

// What the repo guard reads as a number: a `+` or `%2B` before the digits, and
// nothing alphanumeric touching either end unless it ends an escape. Kept in
// step with it by the refusal, which is the guard itself: if these ever read
// less than it does, the tool refuses instead of writing what the guard flags.
const E164 = /(\+|%2[Bb])([1-9]\d{7,14})(?![0-9A-Za-z])/g;
const TOUCHING = /[A-Za-z0-9+]$/;
const ESCAPE = /(?:%[0-9A-Fa-f]{2}|\\[nrt])$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const WRITTEN = /(?<![\d+])\(?([2-9]\d{2})(?:\)\s?|[-. ])([2-9]\d{2})[-. ](\d{4})(?!\d)/g;
const BARE_NANP = /^(1?)([2-9]\d{2}[2-9]\d{6})$/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CALL_CONTROL_ID = /\bv[23]:[A-Za-z0-9_-]{6,}/g;
const WHOLE_UUID = new RegExp(`^${UUID.source}$`, "i");
const WHOLE_CALL_CONTROL_ID = new RegExp(`^${CALL_CONTROL_ID.source}$`);
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const SIP_URI = /\bsips?:([^@\s;"']+)@([^\s;:>"']+)/gi;
/** RFC 5737's documentation ranges, which is where stand-in addresses come from. */
const DOCUMENTATION_IPV4 = /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;

const TELNYX_SIP_DOMAIN = "sip.telnyx.com";
const ID_KEY = /(?:^|_)id$/;
const USERNAME_KEYS = new Set(["sip_username", "username", "user_name"]);
const NUMBER_KEYS = new Set(["from", "to", "phone_number", "number", "caller_id_number"]);
const NAME_KEYS = new Set(["caller_id_name", "cnam", "from_display_name", "display_name"]);
const TEXT_KEYS = new Set(["text", "subject", "transcript", "transcription_text"]);
const CLIENT_STATE_KEYS = new Set(["client_state", "target_leg_client_state"]);
const CARRIER_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "START", "UNSTOP",
  "YES", "HELP", "INFO", "ARRET", "ARRÊT", "AIDE",
]);

/** True when ten NANP digits sit in 555-0100..0199, whatever the area code. */
export function isFictionalNanp(national) {
  return /^\d{3}55501\d{2}$/.test(national);
}

function nanpNational(digits) {
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
}

/** The guard's rule for a match at `index`: base64 and longer runs are not numbers. */
function standsAlone(text, index) {
  const before = text.slice(Math.max(0, index - 3), index);
  return !TOUCHING.test(before) || ESCAPE.test(before);
}

/** A client_state's text and how it was encoded, or null when it is not base64. */
export function decodeClientState(value) {
  const unpadded = value.replace(/=+$/, "");
  if (!BASE64.test(value) || unpadded.length % 4 === 1) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== unpadded) return null;
  const utf8 = bytes.toString("utf8");
  // Bytes that are not UTF-8 are read one character each, which every byte
  // survives, so a number among them is still found and still renumbered.
  return Buffer.from(utf8, "utf8").equals(bytes)
    ? { text: utf8, encoding: "utf8" }
    : { text: bytes.toString("latin1"), encoding: "latin1" };
}

function encodeClientState(text, encoding, original) {
  const encoded = Buffer.from(text, encoding).toString("base64");
  const cameUnpadded = !original.includes("=") && original.length % 4 !== 0;
  return cameUnpadded ? encoded.replace(/=+$/, "") : encoded;
}

/** Every string under a client_state key, wherever it sits. */
function clientStatesIn(value, key = null, found = []) {
  if (typeof value === "string") {
    if (CLIENT_STATE_KEYS.has(key)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) clientStatesIn(entry, key, found);
  } else if (value !== null && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) clientStatesIn(child, childKey, found);
  }
  return found;
}

/** Fictional numbers in a text, in the shapes the scrubber renumbers. */
function fictionalNationalsIn(text) {
  const found = [];
  for (const match of text.matchAll(E164)) {
    const national = nanpNational(match[2]);
    if (standsAlone(text, match.index) && national && isFictionalNanp(national)) found.push(national);
  }
  for (const match of text.matchAll(WRITTEN)) {
    const national = match[1] + match[2] + match[3];
    if (isFictionalNanp(national)) found.push(national);
  }
  return found;
}

/**
 * One renumbering for one trace: every table is shared by every event, so a
 * value maps to the same stand-in wherever it appears.
 */
export function createScrubber() {
  const numbers = new Map();
  const taken = new Map();
  const tables = new Map();
  const report = { numbers: 0, foreignNumbers: 0, ids: 0 };

  function reserve(national) {
    const area = national.slice(0, 3);
    if (!taken.has(area)) taken.set(area, new Set());
    taken.get(area).add(national.slice(8));
  }

  function fictionalFor(area) {
    if (!taken.has(area)) taken.set(area, new Set());
    const used = taken.get(area);
    for (let line = 0; line < 100; line += 1) {
      const suffix = String(line).padStart(2, "0");
      if (!used.has(suffix)) {
        used.add(suffix);
        return `${area}55501${suffix}`;
      }
    }
    throw new Error(
      `more than 100 distinct numbers in area code ${area}; the fictional range has no room. Split the trace`,
    );
  }

  /** E.164 digits (no plus) in, fictional E.164 digits out. */
  function renumberDigits(digits) {
    const national = nanpNational(digits);
    if (national && isFictionalNanp(national)) return digits;
    const known = numbers.get(digits);
    if (known) return known;
    let replacement;
    if (national) {
      replacement = `1${fictionalFor(national.slice(0, 3))}`;
    } else {
      // Outside NANP there is no fictional range, so a foreign number takes a
      // fictional NANP one. The report says how many lost their country.
      replacement = `1${fictionalFor("613")}`;
      report.foreignNumbers += 1;
    }
    numbers.set(digits, replacement);
    report.numbers += 1;
    return replacement;
  }

  function stand(table, value, make) {
    if (!tables.has(table)) tables.set(table, new Map());
    const map = tables.get(table);
    if (!map.has(value)) {
      map.set(value, make(map.size + 1));
      report.ids += 1;
    }
    return map.get(value);
  }

  const uuidFor = (value) =>
    stand("uuid", value.toLowerCase(), (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  const callControlIdFor = (value) => stand("ccid", value, (n) => `v3:fixture-leg-${n}`);
  const usernameFor = (value) => stand("username", value, (n) => `fixturecred${n}`);
  const ipFor = (value) => stand("ip", value, (n) => `192.0.2.${n}`);
  const sipHostFor = (value) => stand("sip-host", value.toLowerCase(), (n) => `203.0.113.${n}`);

  function urlFor(value) {
    return stand("url", value, (n) => {
      let extension = "";
      try {
        extension = /\.[a-z0-9]{2,4}$/i.exec(new URL(value).pathname)?.[0] ?? "";
      } catch {
        // Not parseable as a URL after all: no extension to keep.
      }
      return `/fixtures/urls/${n}${extension.toLowerCase()}`;
    });
  }

  function opaqueIdFor(key, value) {
    return stand(`id:${key}`, value, (n) =>
      /^\d+$/.test(value)
        ? `9${String(n).padStart(Math.max(value.length - 1, 1), "0")}`
        : `fixture-${key.replace(/_/g, "-")}-${n}`,
    );
  }

  /** A number written without a plus, in whichever of the two NANP shapes it came. */
  function renumberBare(raw) {
    const bare = BARE_NANP.exec(raw);
    if (bare) {
      const fictional = renumberDigits(`1${bare[2]}`);
      return bare[1] ? fictional : fictional.slice(1);
    }
    return /^\d{8,15}$/.test(raw) ? renumberDigits(raw) : null;
  }

  /** The renumbering every string gets, whatever field it is in. */
  function scrubString(text) {
    return text
      .replace(URL_PATTERN, (url) => urlFor(url))
      .replace(SIP_URI, (whole, user, host) => {
        const scheme = whole.slice(0, whole.indexOf(":"));
        const plus = user.startsWith("+") ? "+" : "";
        const number = renumberBare(user.slice(plus.length));
        const nextUser = number === null ? usernameFor(user) : `${plus}${number}`;
        const nextHost = host.toLowerCase() === TELNYX_SIP_DOMAIN ? host : sipHostFor(host);
        return `${scheme}:${nextUser}@${nextHost}`;
      })
      .replace(UUID, (uuid) => uuidFor(uuid))
      .replace(CALL_CONTROL_ID, (id) => callControlIdFor(id))
      .replace(E164, (whole, prefix, digits, offset, text) =>
        standsAlone(text, offset) ? `${prefix}${renumberDigits(digits)}` : whole,
      )
      .replace(WRITTEN, (whole, area, exchange, line) => {
        const fictional = renumberDigits(`1${area}${exchange}${line}`).slice(1);
        return `${fictional.slice(0, 3)}-${fictional.slice(3, 6)}-${fictional.slice(6)}`;
      })
      .replace(IPV4, (ip) => (DOCUMENTATION_IPV4.test(ip) ? ip : ipFor(ip)));
  }

  function scrubClientState(key, value) {
    const decoded = decodeClientState(value);
    if (!decoded) {
      throw new Error(
        `a ${key} is not base64, so a number inside it could be neither found nor renumbered; nothing written`,
      );
    }
    return encodeClientState(scrubString(decoded.text), decoded.encoding, value);
  }

  function scrubField(key, value) {
    if (CLIENT_STATE_KEYS.has(key)) return scrubClientState(key, value);
    if (NAME_KEYS.has(key)) {
      return value.trim() === "" ? value : stand("name", value, (n) => `Fixture Caller ${n}`);
    }
    if (TEXT_KEYS.has(key)) {
      const keyword = value.trim().toUpperCase();
      if (CARRIER_KEYWORDS.has(keyword)) return value;
      return value === "" ? value : stand("text", value, (n) => `Fixture message ${n}`);
    }
    if (USERNAME_KEYS.has(key) && !/^\+?\d+$/.test(value)) return usernameFor(value);
    if (NUMBER_KEYS.has(key) && BARE_NANP.test(value)) return renumberBare(value);
    if (
      ID_KEY.test(key) &&
      value !== "" &&
      !WHOLE_UUID.test(value) &&
      !WHOLE_CALL_CONTROL_ID.test(value)
    ) {
      return opaqueIdFor(key, value);
    }
    return scrubString(value);
  }

  function scrubValue(value, key) {
    if (typeof value === "string") return key === null ? scrubString(value) : scrubField(key, value);
    if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, key));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [childKey, scrubValue(child, childKey)]),
      );
    }
    return value;
  }

  return {
    reserve,
    scrub: (value) => scrubValue(value, null),
    report,
  };
}

/** The line of every number in a text that check-rig-no-e164 would refuse. */
export function realNumbersIn(text) {
  return findNumbers(text)
    .filter((number) => !number.fictional)
    .map((number) => number.line);
}

/** Where a fixture still holds a number the guard would refuse, one entry per number. */
function survivorsIn(fixture) {
  const found = realNumbersIn(JSON.stringify(fixture, null, 2)).map((line) => `fixture line ${line}`);
  fixture.events.forEach((event, index) => {
    for (const state of clientStatesIn(event)) {
      const decoded = decodeClientState(state);
      const where = `client_state in event ${index + 1}`;
      if (!decoded) found.push(`an unreadable ${where}`);
      else found.push(...realNumbersIn(decoded.text).map(() => `a ${where}`));
    }
  });
  return found;
}

/** The envelopes in a trace file, in the order they were delivered. */
export function parseTrace(text) {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("the trace is empty");
  let items;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) items = parsed;
    else if (Array.isArray(parsed?.data)) items = parsed.data;
    else items = [parsed];
  } catch {
    items = trimmed
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`line ${index + 1} is not JSON`);
        }
      });
  }
  const events = items.map((item) =>
    item && typeof item === "object" && !item.data && item.payload?.data ? item.payload : item,
  );
  events.forEach((event, index) => {
    if (typeof event?.data?.event_type !== "string") {
      throw new Error(`entry ${index + 1} is not a Telnyx webhook envelope (no data.event_type)`);
    }
  });
  return events;
}

/**
 * A trace in, a fixture out. Throws, writing nothing, if any number survives.
 */
export function traceToFixture(events) {
  const scrubber = createScrubber();
  // Numbers already fictional keep their place, so nothing real is renumbered onto them.
  const texts = [JSON.stringify(events)];
  for (const state of clientStatesIn(events)) texts.push(decodeClientState(state)?.text ?? "");
  for (const national of texts.flatMap(fictionalNationalsIn)) scrubber.reserve(national);

  const fixture = { schema: FIXTURE_SCHEMA, events: scrubber.scrub(events) };
  const leftover = survivorsIn(fixture);
  if (leftover.length > 0) {
    throw new Error(
      `${leftover.length} phone number(s) survived renumbering (${[...new Set(leftover)].join(", ")}); nothing written`,
    );
  }
  return { fixture, report: { events: events.length, ...scrubber.report } };
}

const USAGE =
  "usage: node scripts/trace-to-fixture.mjs <trace.json|trace.ndjson> [--out <fixture.json>]";

function main(argv) {
  let input = null;
  let out = null;
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out" && args[index + 1]) {
      out = args[index + 1];
      index += 1;
    } else if (input === null && !args[index].startsWith("--")) {
      input = args[index];
    } else {
      console.error(USAGE);
      process.exit(2);
    }
  }
  if (input === null) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const { fixture, report } = traceToFixture(parseTrace(readFileSync(input, "utf8")));
    const text = `${JSON.stringify(fixture, null, 2)}\n`;
    if (out) writeFileSync(out, text);
    else process.stdout.write(text);
    console.error(
      `trace-to-fixture: ${report.events} events, ${report.numbers} numbers renumbered` +
        (report.foreignNumbers ? ` (${report.foreignNumbers} outside NANP, now NANP)` : "") +
        `, ${report.ids} identifiers replaced.`,
    );
  } catch (cause) {
    console.error(`trace-to-fixture: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
