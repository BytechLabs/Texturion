/**
 * Ask the live model exactly what production asks it, and print what comes back.
 *
 * Reply drafting kept returning `{"suggestions": [], "reason": "unusable_output"}`
 * — the model answered, but nothing survived parsing and sanitation. There is no
 * way to see that from outside: the Worker's logs are not readable from a dev
 * machine, and the response deliberately carries no model text. So this runs the
 * REAL prompt builder and the REAL parser against the REAL model and prints every
 * stage, which turns a guess into an observation.
 *
 * Run from GitHub Actions (the AI probe workflow), where CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID exist. It prints the model's own words and never the
 * token. It is a diagnostic, so it stays cheap: one short conversation, one call.
 *
 *   npx -y tsx scripts/ai-probe.ts
 */
import {
  buildSuggestionMessages,
  parseSuggestionOutput,
  sanitizeSuggestions,
  SUGGEST_REPLY_MAX_OUTPUT_TOKENS,
  SUGGEST_REPLY_MODEL,
  type SuggestionMessage,
  threadTextOf,
} from "../apps/api/src/messaging/reply-suggestions";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !token) {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  process.exit(1);
}

/** Three ordinary threads a trade business would actually have. */
const CASES: { name: string; messages: SuggestionMessage[]; draft: string | null }[] = [
  {
    name: "unanswered question, empty composer",
    messages: [
      { direction: "inbound", body: "Hi, my kitchen sink is backing up. Can someone come take a look this week?" },
    ],
    draft: null,
  },
  {
    name: "we spoke last (the common case)",
    messages: [
      { direction: "inbound", body: "Are you free Thursday?" },
      { direction: "outbound", body: "Thursday works, morning or afternoon?" },
    ],
    draft: null,
  },
  {
    name: "half-typed reply",
    messages: [
      { direction: "inbound", body: "How soon can you get here? Water is everywhere." },
    ],
    draft: "We can have someone out",
  },
];

async function run(): Promise<void> {
  for (const testCase of CASES) {
    const prompt = buildSuggestionMessages({
      companyName: "Bolt Plumbing",
      contactName: "Dana",
      messages: testCase.messages,
      timezone: "America/Toronto",
      now: new Date(),
      businessHours: null,
      draft: testCase.draft,
    });

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${SUGGEST_REPLY_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: prompt,
          max_tokens: SUGGEST_REPLY_MAX_OUTPUT_TOKENS,
        }),
      },
    );

    console.log(`\n${"=".repeat(72)}\nCASE: ${testCase.name}\n${"=".repeat(72)}`);
    console.log(`HTTP ${response.status}`);

    const payload = (await response.json()) as {
      success?: boolean;
      result?: unknown;
      errors?: unknown;
    };
    if (!response.ok || payload.success === false) {
      console.log("ERRORS:", JSON.stringify(payload.errors));
      continue;
    }

    console.log("RAW result:", JSON.stringify(payload.result));

    const parsed = parseSuggestionOutput(payload.result);
    console.log(`PARSED ${parsed.length} candidate(s):`, JSON.stringify(parsed));

    const clean = sanitizeSuggestions(parsed, {
      threadText: threadTextOf(testCase.messages),
      draft: testCase.draft,
    });
    console.log(`SANITIZED ${clean.length} draft(s):`, JSON.stringify(clean));

    if (parsed.length > 0 && clean.length === 0) {
      console.log("VERDICT: the sanitizer dropped every candidate.");
    } else if (parsed.length === 0) {
      console.log("VERDICT: parsing produced nothing from the model's output.");
    } else {
      console.log("VERDICT: usable.");
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
