#!/usr/bin/env node
/**
 * #564 — the two phones agree about what kinds of push exist and where each one
 * lands.
 *
 * Both clients say so in a comment. iOS's `PushCategory` is documented as "the
 * iOS analogue of the Android notification channel ids (same constants, so the
 * parse tests mirror 1:1)" — and nothing checked it. A comment is not a
 * mechanism; the two lists had been kept in step by hand, and adding
 * `emergency` to one of them is exactly the moment that stops happening.
 *
 * A drift here is silent and splits a crew: an urgent text gets its own channel
 * on Android and sits among ordinary texts on the iPhone, so half the crew is
 * woken and half is not.
 *
 * ## What this deliberately does NOT check
 *
 * The first version also compared these against what the server sends, by
 * grepping `kind: "…"` out of the notification sources. Six of its seven
 * findings were wrong: `kind` is also the tag of the discriminated union saying
 * what was ASSIGNED (`{ kind: "conversation"; conversationId }`), and no regex
 * can tell that from a push-payload field. Separating them needs the type
 * checker, and the server side is already covered — `inbound.test.ts` asserts
 * the emergency path sends the discriminator and the ordinary path does not.
 *
 * A guard that cries wolf six times out of seven is one people learn to skip.
 */
import { readFileSync } from "node:fs";

const ANDROID_KINDS =
  "apps/android/app/src/main/kotlin/com/loonext/android/push/PushPayload.kt";
const ANDROID_CHANNELS =
  "apps/android/app/src/main/kotlin/com/loonext/android/push/Channels.kt";
const IOS_KINDS = "apps/ios/Loonext/Features/Push/PushPayload.swift";

/**
 * Kinds one phone deliberately does not name, with the reason it does not.
 *
 * `call_end` is Android-only by contract (calls-v3 §9.2): iOS cannot retag a
 * remote alert, so its coalescing is server-side and there is nothing for a
 * revocation to cancel.
 */
const PHONE_EXEMPT = { iOS: ["call_end"] };

/**
 * Kinds that reach a destination without going through the ordinary routing —
 * so "declared but not in the routing switch" is correct for them.
 *
 * Both call kinds are handled by an early return above the switch on each phone
 * (the ring channel, and the revocation that renders nothing at all).
 */
const ROUTED_BEFORE_THE_SWITCH = new Set(["call", "call_end"]);

/** Strip comments so a quoted string inside prose is not read as a constant. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/\/?.*$/gm, "");
}

function read(file) {
  return stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

/** `object X { const val NAME = "value" }` → [[NAME, value], …]. */
function kotlinConstants(source, objectName) {
  const block = new RegExp(`object ${objectName} \\{([\\s\\S]*?)\\n\\}`).exec(
    source,
  );
  if (block === null) return null;
  return [
    ...block[1].matchAll(
      /const val (\w+)\s*(?::\s*String)?\s*=\s*"([^"]*)"/g,
    ),
  ].map((m) => [m[1], m[2]]);
}

/** `enum X { static let name = "value" }` → [[name, value], …]. */
function swiftConstants(source, enumName) {
  const block = new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (block === null) return null;
  return [...block[1].matchAll(/static let (\w+)\s*=\s*"([^"]*)"/g)].map((m) => [
    m[1],
    m[2],
  ]);
}

const problems = [];

/** Loud rather than skipped: a guard that lost its subject looks like a pass. */
function required(value, what) {
  if (value === null || value.length === 0) {
    problems.push(
      `cannot parse ${what} — this guard has lost its subject and is no longer ` +
        `checking anything.`,
    );
    return null;
  }
  return value;
}

const androidSource = read(ANDROID_KINDS);
const iosSource = read(IOS_KINDS);

const androidKinds = required(
  kotlinConstants(androidSource, "PushKind"),
  `PushKind in ${ANDROID_KINDS}`,
);
const androidChannels = required(
  kotlinConstants(read(ANDROID_CHANNELS), "ChannelIds"),
  `ChannelIds in ${ANDROID_CHANNELS}`,
);
const iosKinds = required(
  swiftConstants(iosSource, "PushKind"),
  `PushKind in ${IOS_KINDS}`,
);
const iosCategories = required(
  swiftConstants(iosSource, "PushCategory"),
  `PushCategory in ${IOS_KINDS}`,
);

const values = (pairs) => (pairs ?? []).map(([, value]) => value);

// --- The two phones name the same kinds -------------------------------------

if (androidKinds !== null && iosKinds !== null) {
  const iosValues = values(iosKinds);
  const androidValues = values(androidKinds);
  const exemptForIos = new Set(PHONE_EXEMPT.iOS);
  for (const kind of androidValues) {
    if (!iosValues.includes(kind) && !exemptForIos.has(kind)) {
      problems.push(
        `Android declares push kind "${kind}" and iOS does not. One phone would ` +
          `route it and the other would treat it as an ordinary text. Add it to ` +
          `PushKind in ${IOS_KINDS}, or to PHONE_EXEMPT.iOS with the reason.`,
      );
    }
  }
  for (const kind of iosValues) {
    if (!androidValues.includes(kind)) {
      problems.push(
        `iOS declares push kind "${kind}" and Android does not. Add it to ` +
          `PushKind in ${ANDROID_KINDS}.`,
      );
    }
  }
}

// --- And the same destinations ----------------------------------------------

if (androidChannels !== null && iosCategories !== null) {
  const channelValues = values(androidChannels);
  const categoryValues = values(iosCategories);
  for (const channel of channelValues) {
    if (!categoryValues.includes(channel)) {
      problems.push(
        `Android has notification channel "${channel}" with no matching ` +
          `PushCategory on iOS. The two are documented as mirroring 1:1, and a ` +
          `destination on one platform with nothing on the other means half a ` +
          `crew is alerted differently from the other half.`,
      );
    }
  }
  for (const category of categoryValues) {
    if (!channelValues.includes(category)) {
      problems.push(
        `iOS has PushCategory "${category}" with no matching Android channel in ` +
          `${ANDROID_CHANNELS}.`,
      );
    }
  }
}

// --- And each phone actually routes what it declares ------------------------

/**
 * A kind that is declared and never routed lands on the ordinary channel, which
 * looks exactly like not knowing about it at all. iOS declared `task_due` and
 * routed nothing, so an iPhone put a due-date reminder among the customer texts
 * while Android gave it its own channel — found by this guard on its first run.
 */
if (androidKinds !== null) {
  const routing = androidSource.slice(androidSource.indexOf("channelId = when"));
  for (const [name, value] of androidKinds) {
    if (ROUTED_BEFORE_THE_SWITCH.has(value)) continue;
    if (!routing.includes(`PushKind.${name}`)) {
      problems.push(
        `Android declares push kind "${value}" and its channel switch does not ` +
          `mention PushKind.${name}, so it posts to Messages — indistinguishable ` +
          `from not knowing about it.`,
      );
    }
  }
}

if (iosKinds !== null) {
  const marker = iosSource.indexOf("func pushCategory");
  if (marker === -1) {
    problems.push(
      `cannot find pushCategory(for:) in ${IOS_KINDS} — the routing check has ` +
        `lost its subject.`,
    );
  } else {
    const routing = iosSource.slice(marker);
    for (const [name, value] of iosKinds) {
      if (ROUTED_BEFORE_THE_SWITCH.has(value)) continue;
      if (!routing.includes(`PushKind.${name}`)) {
        problems.push(
          `iOS declares push kind "${value}" and pushCategory(for:) does not ` +
            `mention PushKind.${name}, so it lands in Messages while Android ` +
            `gives it its own channel. Half a crew alerted one way, half the other.`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("Push kinds must mean the same thing on both phones (#564):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Push kinds: ${androidKinds?.length ?? 0} kinds and ` +
    `${androidChannels?.length ?? 0} destinations, matched across both phones, ` +
    `each one routed.`,
);
