/**
 * #389 — what the product sends to an AI model, in the words a customer needs.
 *
 * This exists in `shared` rather than in the web page for one reason: it is the
 * BINDING between the code and the public disclosure. `docs/DATA-INVENTORY.md`
 * was updated when AI shipped and the customer-facing sub-processors page was
 * not, and the page went on saying "no message content stored" while the
 * product sent whole message threads and voicemail audio for inference.
 *
 * So the list lives here, the marketing page renders it, and a test in the API
 * package asserts it covers every feature in `AI_UNIT_COST_CENTS` — the typed
 * registry every AI call must already be declared in. A new AI feature cannot
 * ship without a public disclosure, because the two are checked against each
 * other rather than kept in step by memory. Same structural move as #377, #380
 * and #385: the guard belongs where the thing is declared.
 *
 * WHY THIS MATTERS MORE THAN A STALE DOC USUALLY WOULD. Our customers are
 * controllers and we are their processor — this page is the artifact they rely
 * on to meet their own obligations. And the data is not theirs either: the
 * voicemail is the homeowner's voice and the thread is the homeowner's words.
 * Those people never agreed to anything with us and cannot read our privacy
 * page. Their only protection is that the business they called was told the
 * truth about where it goes.
 */

export interface AiDisclosure {
  /** Matches the `AiCostFeature` key, which is what binds this to the code. */
  key: "enrich" | "suggest_reply" | "voicemail_transcript";
  /** What a customer would call it. */
  label: string;
  /** Exactly what leaves the product for this feature. No euphemisms. */
  sends: string;
  /**
   * The model identifiers, verbatim.
   *
   * Named because provenance is material to a reader: a customer reading
   * "Cloudflare — hosting, CDN, network security" would not conclude that
   * their customers' voicemails are transcribed by an OpenAI model, whether or
   * not the inference stays inside Cloudflare's boundary.
   */
  models: readonly string[];
  /** Whether it runs unless turned off, which changes what consent means. */
  defaultOn: boolean;
}

export const AI_DISCLOSURES: readonly AiDisclosure[] = [
  {
    key: "suggest_reply",
    label: "Suggested replies",
    sends:
      "the recent messages in that conversation and your business description, " +
      "to draft a reply for a person to edit and send",
    models: ["@cf/meta/llama-3.1-8b-instruct-fast"],
    defaultOn: false,
  },
  {
    key: "enrich",
    label: "Task details",
    sends: "the text of the message a task was made from, to fill in the task's details",
    models: ["@cf/meta/llama-3.2-1b-instruct"],
    defaultOn: true,
  },
  {
    key: "voicemail_transcript",
    label: "Voicemail transcripts",
    sends: "the voicemail recording, to write it down so it can be read instead of played",
    // Two, because the fallback is a real model that real audio reaches. A
    // disclosure that names only the happy path is a disclosure with a hole in
    // it exactly when something went wrong.
    models: ["@cf/openai/whisper-large-v3-turbo", "@cf/openai/whisper"],
    defaultOn: true,
  },
] as const;

/**
 * Cloudflare's own published position on Workers AI customer content, quoted
 * rather than paraphrased.
 *
 * Verified against developers.cloudflare.com/workers-ai/platform/data-usage on
 * 2026-07-28. It is quoted because "we don't train on your data" is the first
 * question every customer asks, and the answer has to be attributable to the
 * vendor who is actually bound by it rather than to us.
 */
export const AI_TRAINING_STATEMENT =
  "Cloudflare does not use your Customer Content to (1) train any AI models " +
  "made available on Workers AI or (2) improve any Cloudflare or third-party " +
  "services";
