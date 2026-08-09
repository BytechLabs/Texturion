#!/usr/bin/env node
/**
 * #565 — every column `GET /v1/conversations/:id` sends is declared by every
 * client that reads it.
 *
 * The READABLE half of the pairing `company-view.writable.test.ts` guards for the
 * company view. `emergency_at` had been in the server's select list since #414
 * and in neither phone's model, so both decoders dropped it silently — Kotlin
 * because `ignoreUnknownKeys = true`, Swift because a `Codable` ignores keys it
 * has no property for. The thread you land on from an urgent notification was
 * therefore the one screen that could not say why you were there.
 *
 * Nothing failed. Nothing logged. The field simply was not there, which is the
 * whole problem with this shape: a select list and a model are two lists of field
 * names describing one object, and until something compares them, silence is
 * indistinguishable from agreement.
 *
 * ## Why "declare everything" rather than "declare what you use"
 *
 * A client that does not need a column still has to say so. Declaring it costs a
 * line; the alternative is a field arriving for months with nobody having decided
 * whether the screen should show it — which is exactly how this bug lasted. A
 * genuine exemption goes in NOT_NEEDED below with a reason, and that reason is the
 * decision this guard exists to force.
 */
import { readFileSync } from "node:fs";

const API_FILE = "apps/api/src/routes/conversations.ts";

/** Columns a client may legitimately not declare, with the reason it may not. */
const NOT_NEEDED = {
  // Nothing yet. An entry here is a decision that a client does not need a
  // field the server sends — write the sentence, then add the line.
};

const CLIENTS = [
  {
    label: "Android",
    file: "apps/android/app/src/main/kotlin/com/loonext/android/core/model/Messaging.kt",
    // `data class ConversationDetail( … )` — properties are `val name: Type`.
    block: /data class ConversationDetail\(([\s\S]*?)\n\)/,
    field: /^\s*(?:val|var)\s+([a-z_][A-Za-z0-9_]*)\s*:/gm,
  },
  {
    label: "iOS",
    file: "apps/ios/Loonext/Core/Model/Messaging.swift",
    // `struct ConversationDetail: Codable, Sendable { … }`
    block: /struct ConversationDetail: [^{]*\{([\s\S]*?)\n\}/,
    // `let name: Type`, `var name: Type`, and `@Default<…> var name: Type`.
    field: /^\s*(?:@Default<[^>]*>\s*)?(?:let|var)\s+([a-z_][A-Za-z0-9_]*)\s*:/gm,
  },
  {
    label: "web",
    file: "apps/web/src/lib/api/types.ts",
    block: /export interface Conversation \{([\s\S]*?)\n\}/,
    field: /^\s*([a-z_][A-Za-z0-9_]*)\??\s*:/gm,
  },
];

/** Strip comments so a `,` or `:` inside prose cannot be read as syntax. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/\/?.*$/gm, "");
}

const problems = [];

// ---------------------------------------------------------------------------
// What the server sends
// ---------------------------------------------------------------------------

let serverColumns = [];
try {
  const api = readFileSync(API_FILE, "utf8").replace(/\r\n/g, "\n");
  const declaration = /const CONVERSATION_COLUMNS =([\s\S]*?);\n/.exec(api);
  if (declaration === null) {
    problems.push(
      `cannot find CONVERSATION_COLUMNS in ${API_FILE} — this guard has lost its ` +
        `subject and is no longer checking anything.`,
    );
  } else {
    // The declaration is string fragments joined by `+`, interleaved with long
    // comments. Comments first: one of them contains a comma.
    serverColumns = [...stripComments(declaration[1]).matchAll(/"([^"]*)"/g)]
      .flatMap((match) => match[1].split(","))
      .map((column) => column.trim())
      // Drop embeds like `message_attachments(...)` — not a scalar column.
      .filter((column) => column !== "" && !column.includes("("));
  }
} catch {
  problems.push(`cannot read ${API_FILE}`);
}

if (serverColumns.length < 5) {
  // Loud rather than vacuous: a parse that found almost nothing would pass every
  // client below and read exactly like a clean bill of health.
  problems.push(
    `parsed only ${serverColumns.length} columns from CONVERSATION_COLUMNS ` +
      `(${serverColumns.join(", ") || "none"}) — the parse is broken, not the code.`,
  );
}

// ---------------------------------------------------------------------------
// What each client asks for
// ---------------------------------------------------------------------------

for (const client of CLIENTS) {
  let source;
  try {
    source = readFileSync(client.file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    problems.push(`${client.label}: cannot read ${client.file}`);
    continue;
  }

  const block = client.block.exec(source);
  if (block === null) {
    problems.push(
      `${client.label}: cannot find the ConversationDetail declaration in ` +
        `${client.file} — this guard has lost its subject. Fix the pattern ` +
        `(${client.block}) or the declaration it names.`,
    );
    continue;
  }

  const declared = new Set(
    [...stripComments(block[1]).matchAll(client.field)].map((m) => m[1]),
  );
  if (declared.size < 5) {
    problems.push(
      `${client.label}: parsed only ${declared.size} fields from ` +
        `ConversationDetail — the field pattern is broken, not the model.`,
    );
    continue;
  }

  const exempt = NOT_NEEDED[client.label] ?? {};
  for (const column of serverColumns) {
    if (declared.has(column) || column in exempt) continue;
    problems.push(
      `${client.label}: GET /v1/conversations/:id sends "${column}" and ` +
        `${client.file} does not declare it, so the decoder drops it in silence. ` +
        `Add it, or add it to NOT_NEEDED["${client.label}"] with the sentence ` +
        `saying why this client does not need it.`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    "Conversation detail: the server sends fields a client never asked for (#565):\n",
  );
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Conversation detail: ${serverColumns.length} server columns, all declared by ` +
    `${CLIENTS.length} clients.`,
);
