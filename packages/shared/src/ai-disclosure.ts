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

/**
 * #318 V7 — WHERE a model reads a customer's voicemail, answered from
 * Cloudflare's own published compatibility matrix rather than inferred.
 *
 * This was filed as a vendor question on the grounds that it "could not be
 * resolved from the repo". It could not — but it did not need a vendor reply
 * either, because Cloudflare publishes the answer. The Data Localization Suite
 * compatibility table marks Workers AI **✘ against Regional Services**, and the
 * page's own legend defines that mark as *"Not compatible — this product cannot
 * be used with this DLS feature."*
 *
 * That is a stronger answer than a support email would have given, because it is
 * a statement about the product's capability rather than about its current
 * behaviour: inference is not merely un-pinned today, it **cannot be pinned** by
 * the mechanism Cloudflare sells for pinning things. Regional Services is what
 * constrains where traffic is decrypted and processed; Workers AI is outside it.
 *
 * WHY THIS MATTERS ENOUGH TO SIT IN CODE. Our cross-border disclosure named the
 * United States, verified for Supabase, and said nothing about this. #318 put it
 * exactly right: *"a disclosure that implies US-only processing while inference
 * happens elsewhere is worse than one that admits the routing."* Law 25 makes the
 * answer materially different for Quebec, which #228 opens deliberately.
 *
 * SAME POSTURE AS THE OTHER EXTERNAL FIGURES in this repo (carrier list prices,
 * 10DLC ceilings, voice-AI costs): sourced, dated, and with a recheck a test
 * fails on. A vendor capability can change; a legal page asserting last year's
 * capability is the failure this whole file exists to prevent.
 */
export const AI_INFERENCE_LOCATION_VERIFIED_ON = "2026-07-30";

/** Re-read by this date; a test fails once it passes. */
export const AI_INFERENCE_LOCATION_RECHECK_AFTER = "2027-01-30";

/** The primary source, so a reader can check the claim rather than trust it. */
export const AI_INFERENCE_LOCATION_SOURCE =
  "https://developers.cloudflare.com/data-localization/compatibility/";

/**
 * What we can say truthfully about where inference runs, in a customer's words.
 *
 * Deliberately NOT softened into "processed globally for performance". The
 * honest shape of this fact is that we cannot promise a country for this one
 * class of processing, and the reason is a published vendor limitation rather
 * than a choice we made and could reverse.
 */
export const AI_INFERENCE_LOCATION_STATEMENT =
  "AI inference runs on Cloudflare's global network and is not restricted to " +
  "any one country. Cloudflare's own data-localization compatibility list " +
  "marks Workers AI as not compatible with Regional Services, the feature that " +
  "confines processing to a region. So we cannot pin it to Canada or to the " +
  "United States, and we will not imply otherwise.";

/**
 * The retention half of the same question, also from Cloudflare's published
 * Workers AI data-usage page (read 2026-07-30): inference input is not kept
 * unless the caller writes it somewhere itself.
 *
 * Worth stating beside the location, because "where does it go" and "how long
 * does it stay there" are one question in a customer's head, and answering only
 * the first invites the worst assumption about the second.
 */
export const AI_INFERENCE_RETENTION_STATEMENT =
  "Cloudflare does not store what is sent for inference unless the application " +
  "writes it to a storage service itself. What comes back, we store in your " +
  "workspace like any other message data, and delete with it.";
