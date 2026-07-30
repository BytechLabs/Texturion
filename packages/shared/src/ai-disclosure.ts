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
  key: "enrich" | "suggest_reply" | "voicemail_transcript" | "voicemail_intake";
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
    // Corrected 2026-07-30 (#367). This said `false` while
    // `company_ai_settings.suggest_replies` has defaulted to `true` since the
    // column was added (20260724090000) and `DEFAULT_AI_SETTINGS` says so too.
    // So the public page told customers they had opted IN to nothing, for a
    // feature that sends whole message threads for inference — the #389 drift
    // happening again, in the direction that understates what we do.
    //
    // Found by the test below that derives this field from the settings the
    // gate actually reads, rather than from a list kept in step by memory.
    defaultOn: true,
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
  {
    key: "voicemail_intake",
    label: "Voicemail intake",
    sends:
      "the voicemail transcript, to pull out what the caller said the problem " +
      "was and the address they gave",
    models: ["@cf/meta/llama-3.1-8b-instruct-fast"],
    // The only AI feature in the product that is OFF until a business turns it
    // on, and the difference is who it speaks to. Every other one produces a
    // suggestion a member reads; this one changes what a STRANGER hears in the
    // business's own voice when they ring. That is not a default anyone else
    // gets to pick — see D89.
    defaultOn: false,
  },
] as const;

/**
 * Who publishes the models we name, counted from the list rather than by hand.
 *
 * The page said "two of those models are published by OpenAI and one by Meta"
 * for as long as there were two Meta models in the table, because a sentence
 * written next to a three-row list stopped being true when the list grew and
 * nothing connected the two. Same failure as #389 and the `defaultOn` drift
 * beside it: a fact about the data, kept in step with the data by memory.
 *
 * Distinct model IDs, because the same model serving two features is one model
 * a customer's data reaches, not two. Keyed on the `@cf/<vendor>/` segment,
 * which is the vendor Workers AI itself names.
 */
export function aiModelsByVendor(): { vendor: string; count: number }[] {
  const seen = new Map<string, Set<string>>();
  for (const row of AI_DISCLOSURES) {
    for (const model of row.models) {
      const vendor = model.split("/")[1] ?? "unknown";
      const bucket = seen.get(vendor) ?? new Set<string>();
      bucket.add(model);
      seen.set(vendor, bucket);
    }
  }
  return [...seen.entries()]
    .map(([vendor, models]) => ({ vendor, count: models.size }))
    // Most models first, then alphabetically — a stable order, so the sentence
    // does not reshuffle itself between builds.
    .sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));
}

/** Vendor slug → the name a customer would recognise. */
export const AI_VENDOR_NAMES: Record<string, string> = {
  openai: "OpenAI",
  meta: "Meta",
};

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
