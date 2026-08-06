/**
 * Company routes (SPEC §4.1 step 2, §7, §10):
 *
 *   POST  /v1/companies  any authed user (company-exempt) — create company:
 *         zod body { name, country, requested_area_code, us_texting_enabled?,
 *         timezone?, aup_accepted: true }; area code must be a geographic
 *         US/CA NANP code in the company's country; AUP acceptance is
 *         mandatory (422); timezone must be a valid IANA zone when present
 *         (D15 — onboarding sends the browser's zone; DB default otherwise).
 *         Creates company + owner membership + pre-seeded pipeline tags +
 *         notification_prefs atomically (api_create_company SQL function).
 *         Capped per user (#31): the RPC refuses a 6th owned workspace with
 *         an { outcome: 'owner_cap' } sentinel, surfaced here as 409.
 *   GET   /v1/company    M   — company + plan/subscription/period/cap +
 *         numbers summary + registration summary.
 *   PATCH /v1/company    O/A — { name?, timezone? } (timezone IANA-validated,
 *         D15); { overage_cap_multiplier? } is owner-only (number or null —
 *         SPEC §2 cap, §10 matrix).
 */
import {
  isValidBusinessHours,
  isValidHoursExceptions,
  LOCALES,
  NANP_AREA_CODES,
  screenBusinessName,
  RING_SECONDS_MAX,
  RING_SECONDS_MIN,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { type CompanyAiSettings, loadAiSettings } from "../ai/settings";
import { auditDiff } from "../audit/diff";
import { recordAuditFromRequest } from "../audit/log";
import { alertProhibitedCategory } from "../messaging/aup-signup-screen";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import {
  ATTRIBUTION_PARAMS,
  CREW_SIZE_BUCKETS,
  sanitizeAttributionValue,
  sanitizeLandingPath,
} from "@loonext/shared";
import { attributeReferral } from "../referrals/referrals";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  effectiveCnamDisplayName,
  enableVoiceForCompany,
  syncCallSettingsForCompany,
} from "../telnyx/voice";
import {
  billingWritesEnabled,
  COMPANY_COLUMNS,
  loadCompanyView,
  withCallerIdDerived,
  withAwayDerived,
  withEmergencyDerived,
  withBillingRedacted,
  withIdentificationDerived,
  withMctbDerived,
  withSeatDerived,
} from "./core/company-view";
import { executionCtxOf, parseJsonBody, unwrap } from "./core/http";
import { isValidIanaTimezone } from "./core/timezone";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.enum(["US", "CA"]),
  requested_area_code: z.string().regex(/^\d{3}$/),
  // Choose-your-number: a specific onboarding pick to order exactly (validated
  // against its own area code's country below). Omitted = auto-search.
  chosen_number_e164: z
    .string()
    .trim()
    .regex(/^\+1\d{10}$/)
    .optional(),
  us_texting_enabled: z.boolean().optional(),
  // D15: onboarding sends the browser's IANA zone; validated below against
  // the runtime's timezone database (a zod enum cannot express it).
  timezone: z.string().trim().min(1).max(100).optional(),
  // AUP acceptance is implicit now (the create RPC stamps aup_accepted_at
  // unconditionally); the field is accepted for back-compat but no longer gates
  // creation — the visible checkbox was removed as needless signup friction.
  aup_accepted: z.literal(true).optional(),
  // #370: how big is the crew. A bucket rather than a number, and OPTIONAL —
  // a signup that skips the question is a signup we still want, and "not
  // asked" has to stay distinguishable from "solo" in the reporting.
  crew_size: z.enum(CREW_SIZE_BUCKETS).optional(),
  // #399: the code from a ?ref= link, if the signup arrived through one.
  // Bounded rather than shaped — a wrong code must produce a workspace without
  // attribution, never a 422 that blocks a signup over eight characters.
  referral_code: z.string().trim().max(64).optional(),
  /**
   * #296: which marketing page this owner FIRST landed on, and the campaign
   * that brought them. Re-sanitised below with the same shared allow-list the
   * browser used — the client is not trusted with what reaches a column.
   */
  first_touch: z
    .object({
      landing_path: z.string().max(200).optional(),
      referrer_host: z.string().max(200).optional(),
      params: z.record(z.string(), z.string().max(200)).optional(),
    })
    .optional(),
});

/** A weekday open/close window; both HH:MM. Full shape checked below. */
const dayHoursSchema = z.object({
  open: z.string(),
  close: z.string(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    // Onboarding "edit until checkout": the pending number's area code, country,
    // and US-texting choice. Mutable only while the company is pre-checkout
    // (validated + gated in the handler; a country change needs a new area code).
    requested_area_code: z.string().regex(/^\d{3}$/).optional(),
    country: z.enum(["US", "CA"]).optional(),
    us_texting_enabled: z.boolean().optional(),
    // Choose-your-number: the onboarding pick (null clears it). Mutable only
    // pre-checkout; validated against its own NDC's country; auto-nulled on a
    // country / area-code change (a stale pick would be for the wrong region).
    chosen_number_e164: z
      .string()
      .trim()
      .regex(/^\+1\d{10}$/)
      .nullable()
      .optional(),
    /**
     * #481: what a departing owner wants their customers told, in their own
     * words. `null` turns the off-ramp off and clears the opt-in with it.
     *
     * 320 characters — two segments. Long enough for "we've moved to
     * 555-0123, call or text us there" plus a sentence of context, short
     * enough that nobody writes a letter we then send to their whole contact
     * list one message at a time.
     */
    offramp_message: z.string().trim().min(1).max(320).nullable().optional(),
    // #12 Phase 0.3: the overage cap is an un-defeatable ceiling — bounded to
    // the (0, 10] safety range. `null` ("no cap") is still accepted for
    // backward-compat but resolves to the 10x hard maximum below.
    overage_cap_multiplier: z
      .number()
      .positive()
      .max(10)
      .nullable()
      .optional(),
    // FEATURE-GAPS Step 1 — after-hours away reply (O/A). business_hours is a
    // weekday→window map (company-local per timezone); structural validity is
    // checked with isValidBusinessHours below.
    business_hours: z
      .record(z.string(), dayHoursSchema.nullable())
      .optional(),
    // #402: dates that override the weekly loop. Shape checked by the shared
    // validator below, so the four surfaces share one rule rather than four
    // near-identical ones.
    business_hours_exceptions: z.array(z.unknown()).optional(),
    away_enabled: z.boolean().optional(),
    // Owner-authored away text; null clears it. Max 1000 for a comfortable
    // multi-line emergency-aware message.
    away_message: z.string().trim().max(1000).nullable().optional(),
    // #414: whether a customer replying URGENT wakes the whole crew at high
    // priority. A shop that does not offer emergency service turns this off —
    // and should then take the offer out of its away message too, which is
    // why the switch lives next to the message on every client.
    emergency_keyword_enabled: z.boolean().optional(),
    // #460: the words THIS workspace treats as an emergency. Null restores the
    // product list — the same nullable-means-default contract away_message uses,
    // so improving the defaults later still reaches everybody who never opened
    // the setting. Shape mirrors `companies_emergency_keywords_ck` exactly:
    // uppercase, single word, 2-15 chars, because the inbound matcher splits on
    // whitespace and upper-cases before comparing and anything else could never
    // fire. Refusing it here means an owner is told, rather than silently
    // storing a setting that does nothing.
    emergency_keywords: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{2,15}$/, "one word, letters and numbers, 2-15 chars"),
      )
      .min(1)
      .max(10)
      .nullable()
      .optional(),
    // #460: the workspace's own reply to an emergency keyword; null restores the
    // product default. The product's safety sentence is appended at send time
    // and is deliberately NOT stored here, so an owner cannot remove it by
    // editing this field (#414 ask 4).
    emergency_message: z.string().trim().max(1000).nullable().optional(),
    // #228: the language this business works in. NOT nullable - a business
    // always works in one, and a null here would mean "ask again later", which
    // nothing would. Every contact without a language of its own inherits it,
    // so changing this moves the whole customer list.
    locale: z.enum(LOCALES).optional(),
    // #388: the unanswered-lead ladder. Two switches rather than one because
    // they carry different risks — the first reaches only people who were
    // already told once, the second reaches people who were not.
    lead_chase_enabled: z.boolean().optional(),
    lead_chase_crew_enabled: z.boolean().optional(),
    // #430: whether a push may carry words a person typed. Unlike every other
    // notification setting this one is per WORKSPACE, because the content
    // being protected belongs to the customer rather than to the member whose
    // phone it lands on.
    push_include_content: z.boolean().optional(),
    // FEATURE-GAPS voice wave — missed-call text-back (O/A). mctb_message is
    // owner-authored (null clears it). D43: forward_to_cell is DELETED —
    // calls ring the browser, never a cell.
    mctb_enabled: z.boolean().optional(),
    mctb_message: z.string().trim().max(1000).nullable().optional(),
    // D43 Calls v2 (O/A): the voicemail greeting is owner-authored TTS text
    // (null clears back to the honest default); call screening is the carrier
    // verdict routing choice; CNAM is the caller-ID pair — the ≤15-char
    // outbound listing (carrier alphabet rule) and the inbound name dip.
    // #193: cnam_display_name null no longer means "no listing" — it means
    // "default to the company name" (the effective value is resolved
    // server-side and pushed to the carrier side either way).
    voicemail_greeting: z.string().trim().max(500).nullable().optional(),
    /**
     * #309: which RECORDING the workspace's lines play by default.
     *
     * The column has existed since the greetings migration and the call
     * runtime has always read it as the inherit source — but nothing could
     * ever SET it, so it was a fallback permanently stuck on null. Found by
     * reading the runtime for #278; fixed here rather than filed, because a
     * column the product reads and no surface can write is a gap, not a
     * feature. Null is the written words, which is what every line does until
     * somebody chooses otherwise.
     */
    voicemail_greeting_id: z.string().uuid().nullable().optional(),
    /**
     * #278: what an inbound call does outside business hours, workspace-wide.
     *
     * NOT nullable, unlike its per-number twin: this IS the value a line
     * inherits, so there is nothing above it to fall back to.
     */
    after_hours_calls: z
      .enum(["ring_everyone", "on_call_only", "voicemail"])
      .optional(),
    /** #278: the recording played after hours. Null = the ordinary greeting. */
    after_hours_greeting_id: z.string().uuid().nullable().optional(),
    /**
     * #278: whether every eligible phone rings at once, or they join in turn.
     * NOT nullable, like its after-hours sibling: this IS what a line inherits.
     */
    ring_strategy: z.enum(["all", "in_turn"]).optional(),
    /**
     * #278: how long they ring before the caller gets the greeting.
     *
     * The ceiling is the leg-level dial timeout, so this refuses a longer
     * window rather than letting a screen promise ringing that cannot happen.
     */
    ring_seconds: z.number().int().min(RING_SECONDS_MIN).max(RING_SECONDS_MAX).optional(),
    call_screening: z.enum(["off", "flag", "divert"]).optional(),
    cnam_display_name: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 ]{1,15}$/, {
        message:
          "cnam_display_name must be 1-15 letters, digits, or spaces (carrier rule).",
      })
      .nullable()
      .optional(),
    caller_id_lookup: z.boolean().optional(),
    // #393 (O/A): whether a first outbound message to a contact carries
    // `— {Business name}. Reply STOP to opt out`. Default false — D4's 2026-07
    // reversal removed the enforced footer and this does not undo it, so
    // turning it ON is a deliberate owner act. See D4 for the CASL s.6(2)
    // question (L1) that would change the default.
    first_message_identification: z.boolean().optional(),
    // #225 ask 5 (O/A): whether a person STARTING a conversation into a
    // destination inside its local quiet window must confirm first. Default
    // true. This is the confirmation step ONLY — not an automated-send
    // permission, and nothing automated reads it (the column comment and
    // quiet-hours-confirm.test.ts hold that line).
    quiet_hours_confirm_enabled: z.boolean().optional(),
    // #239: owner-only, checked below with the same shape as the overage cap.
    response_stats_per_member: z.boolean().optional(),
    /**
     * #298: whether members may INVENT tags, or only use the set the
     * workspace already has. Default false, and it must stay false —
     * #298's own devil's advocate is that a plumber's categories are not
     * an HVAC company's, so a taxonomy imposed by us would be ignored in
     * favour of the notes field. A crew that has BUILT one and wants it
     * held still is a different case, and this is for them.
     *
     * Admin, not owner-only: it is a housekeeping choice about the shop's
     * own vocabulary, the same class of thing as curating the templates
     * an admin already curates (#461). Nothing about it reaches a
     * customer or names an individual, which is what the owner-only
     * settings above have in common.
     */
    tags_locked: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.timezone !== undefined ||
      body.requested_area_code !== undefined ||
      body.country !== undefined ||
      body.us_texting_enabled !== undefined ||
      "chosen_number_e164" in body ||
      "overage_cap_multiplier" in body ||
      body.business_hours !== undefined ||
      body.business_hours_exceptions !== undefined ||
      body.away_enabled !== undefined ||
      "away_message" in body ||
      body.emergency_keyword_enabled !== undefined ||
      "emergency_keywords" in body ||
      "emergency_message" in body ||
      body.locale !== undefined ||
      body.lead_chase_enabled !== undefined ||
      body.lead_chase_crew_enabled !== undefined ||
      body.push_include_content !== undefined ||
      body.mctb_enabled !== undefined ||
      "mctb_message" in body ||
      "voicemail_greeting" in body ||
      "voicemail_greeting_id" in body ||
      body.after_hours_calls !== undefined ||
      "after_hours_greeting_id" in body ||
      body.ring_strategy !== undefined ||
      body.ring_seconds !== undefined ||
      body.call_screening !== undefined ||
      "cnam_display_name" in body ||
      body.caller_id_lookup !== undefined ||
      body.first_message_identification !== undefined ||
      body.quiet_hours_confirm_enabled !== undefined ||
      body.response_stats_per_member !== undefined ||
      body.tags_locked !== undefined,
    { message: "Provide at least one field to update." },
  );

/**
 * #309/#278 — a greeting id must belong to the workspace selecting it.
 *
 * The foreign key only says the row exists. Without this, a member could point
 * their line at ANOTHER business's recorded voice by pasting an id, and the
 * caller would hear it — which is the one failure a recorded greeting can
 * produce that is worse than the robot it replaced. Lives here and is called
 * from both selection surfaces (this route and the per-number identity route)
 * for the reason `resolveNumberIdentity` exists at all: a rule this small gets
 * re-derived slightly differently in each place until one of them is wrong.
 */
export async function assertOwnGreeting(
  c: { get: (key: "companyId") => string; env: unknown },
  greetingId: string,
): Promise<void> {
  const db = getDb(getEnv(c.env as never));
  const { data, error } = await db
    .from("voicemail_greetings")
    .select("id")
    .eq("company_id", c.get("companyId"))
    .eq("id", greetingId)
    .limit(1);
  if (error) {
    throw new Error(`voicemail_greetings lookup failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new ApiError("validation_failed", "No such greeting.");
  }
}

/** D15: reject anything the runtime's IANA database does not know. */
function assertValidTimezone(timezone: string): void {
  if (!isValidIanaTimezone(timezone)) {
    throw new ApiError(
      "validation_failed",
      `timezone: ${timezone} is not a valid IANA timezone.`,
    );
  }
}

/**
 * Choose-your-number: a picked E.164 must be a geographic NANP number in the
 * company's country — validated against its OWN area code's NDC, NOT the
 * requested area code (a "show nearby" pick legitimately lands on a different
 * area code — e.g. an exhausted 416 → a 647).
 */
function assertChosenNumberCountry(e164: string, country: string): void {
  const ndc = /^\+1(\d{3})\d{7}$/.exec(e164)?.[1];
  const entry = ndc ? NANP_AREA_CODES[ndc] : undefined;
  if (!ndc || !entry || !entry.geographic || entry.country !== country) {
    throw new ApiError(
      "validation_failed",
      `chosen_number_e164: ${e164} is not a ${country} local number.`,
    );
  }
}

export const companiesRoutes = new Hono<AppEnv>();

companiesRoutes.post("/companies", async (c) => {
  const body = await parseJsonBody(c, createSchema);

  const entry = NANP_AREA_CODES[body.requested_area_code];
  if (!entry || !entry.geographic || entry.country !== body.country) {
    throw new ApiError(
      "validation_failed",
      `requested_area_code: ${body.requested_area_code} is not an assigned geographic ${body.country} area code.`,
    );
  }
  if (body.country === "US" && body.us_texting_enabled === false) {
    throw new ApiError(
      "validation_failed",
      "us_texting_enabled: US companies always have US texting enabled.",
    );
  }
  if (body.chosen_number_e164) {
    assertChosenNumberCountry(body.chosen_number_e164, body.country);
  }
  if (body.timezone !== undefined) assertValidTimezone(body.timezone);

  const db = getDb(getEnv(c.env));
  const company = unwrap<Record<string, unknown>>(
    await db.rpc("api_create_company", {
      p_owner_user_id: c.get("userId"),
      p_name: body.name,
      p_country: body.country,
      p_requested_area_code: body.requested_area_code,
      // us_texting_enabled applies to CA (SPEC §4.2); US is always true.
      p_us_texting_enabled:
        body.country === "US" ? true : (body.us_texting_enabled ?? true),
      // Omitted → the SQL default ('America/Toronto', D15) applies.
      ...(body.timezone !== undefined ? { p_timezone: body.timezone } : {}),
    }),
    "company create",
  );
  // #31 abuse cap: api_create_company enforces a per-user owned-company
  // ceiling under an advisory lock (migration 20260707160000) and reports the
  // refusal as an { outcome: 'owner_cap', limit } sentinel instead of the
  // company row — surface it as the SPEC §7 409 `conflict`.
  if (company.outcome === "owner_cap") {
    return errorResponse(
      c,
      "conflict",
      `You already own ${String(company.limit)} workspaces — the most an account can create. Delete one you no longer use first.`,
    );
  }
  // Stage the onboarding pick on the fresh company (the create RPC signature is
  // fixed, so it rides a follow-up update). provisionCompanyNumber drains it
  // onto the ordered number at checkout.
  // #370: stamp the crew size alongside the chosen number, on the same
  // follow-up update path — the create RPC's signature is fixed.
  if (body.crew_size) {
    const { error: crewError } = await db
      .from("companies")
      .update({ crew_size: body.crew_size })
      .eq("id", company.id as string);
    if (crewError) {
      // Never fail the signup over a segmentation field. The workspace is more
      // important than knowing how big its crew is.
      console.error(`crew size persist skipped: ${crewError.message}`);
    }
  }

  /**
   * #303 — screen the name against the categories §4 prohibits outright.
   *
   * The issue asks that we notice a prohibited category at SIGNUP rather than
   * when a complaint arrives against our carrier account, because carrier
   * action lands on the sending pool and not on the offender.
   *
   * It FLAGS and never declines, and never blocks the signup. A business name
   * is weak evidence — "Colt Plumbing" is a plumber — so refusing on a keyword
   * would turn away real customers at the moment they are deciding whether to
   * trust us, with nobody to argue to. A person reads the alert and decides
   * before the number is provisioned, which is the same alert-then-human
   * posture the watch job takes and for the same reason.
   *
   * Best-effort, like the two blocks around it: a workspace that exists must
   * not fail to be created because an alert could not be sent.
   */
  const flags = screenBusinessName(body.name);
  if (flags.length > 0) {
    try {
      await alertProhibitedCategory(getEnv(c.env), {
        companyId: company.id as string,
        name: body.name,
        matches: flags,
      });
    } catch (cause) {
      // Awaited inside a try rather than handed to `executionCtx.waitUntil`.
      // The execution context is not present in every environment this route
      // runs in, and reaching for it turned a working signup into a 500 —
      // which is a far worse bug than the one this screen prevents. The same
      // shape as the referral block below, for the same reason.
      console.error(`aup signup screen alert skipped: ${String(cause)}`);
    }
  }

  // #399: attribute the signup, if it came through somebody's link. Best
  // effort by construction — attributeReferral returns every refusal rather
  // than raising, and this is wrapped besides, because a workspace that exists
  // must not fail to be created over a referral that did not earn itself.
  if (body.referral_code) {
    try {
      await attributeReferral(db, {
        rawCode: body.referral_code,
        refereeCompanyId: company.id as string,
        refereeOwnerUserId: c.get("userId"),
      });
    } catch (cause) {
      console.error(`referral attribution skipped: ${String(cause)}`);
    }
  }

  // #296: attribute the signup to the page that started it. Best effort for
  // the same reason the referral above is — a workspace that exists must not
  // fail to be created over a measurement that did not.
  //
  // Re-sanitised HERE rather than trusted from the browser: these values are
  // attacker-controlled query parameters on a public marketing page, and the
  // web scrubber's allow-list is a privacy boundary, not an input validator.
  if (body.first_touch) {
    try {
      const landing = sanitizeLandingPath(body.first_touch.landing_path);
      const host = sanitizeAttributionValue(body.first_touch.referrer_host ?? null);
      const params: Record<string, string> = {};
      for (const key of ATTRIBUTION_PARAMS) {
        const value = sanitizeAttributionValue(body.first_touch.params?.[key] ?? null);
        if (value !== null) params[key] = value;
      }
      const touch =
        host !== null || Object.keys(params).length > 0
          ? { referrer_host: host, params }
          : null;
      if (landing !== null || touch !== null) {
        await db
          .from("companies")
          .update({
            signup_landing_path: landing,
            signup_first_touch: touch,
          })
          .eq("id", company.id as string);
      }
    } catch (cause) {
      console.error(`signup attribution skipped: ${String(cause)}`);
    }
  }

  if (body.chosen_number_e164) {
    const { error: chosenError } = await db
      .from("companies")
      .update({ chosen_number_e164: body.chosen_number_e164 })
      .eq("id", company.id as string);
    if (chosenError) {
      throw new Error(`chosen number persist failed: ${chosenError.message}`);
    }
  }
  return c.json(company, 201);
});

companiesRoutes.get("/company", requireCapability("workspace.access"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const company = await loadCompanyView(db, c.get("companyId"), env, {
    userId: c.get("userId"),
    role: c.get("role"),
  });
  if (!company) {
    return errorResponse(c, "not_found", "No such company.");
  }
  return c.json(company);
});

// #214: per-company AI enrichment opt-in. Reads are member-visible (the task
// composer needs to know which enrichments are on before calling /tasks/enrich);
// writes are admin-only — it is company config that spends money. Defaults to
// all-off when the company has never set it.
companiesRoutes.get(
  "/company/ai-settings",
  requireCapability("workspace.access"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    // Defaults ON when the company has never set them (founder #214 follow-up).
    return c.json(await loadAiSettings(db, c.get("companyId")));
  },
);

const aiSettingsSchema = z
  .object({
    enrich_task_address: z.boolean(),
    enrich_task_due: z.boolean(),
    suggest_replies: z.boolean(),
    // Absent leaves whatever is stored; an empty string clears it. A toggle
    // save from any client must never wipe the description as a side effect.
    //
    // #420: NULLABLE, because GET returns `business_description: null` for a
    // workspace that never wrote one, and a client that reads the settings and
    // sends them back is doing the obvious thing. Rejecting null here made the
    // API refuse its own output: every Lou toggle on web 400'd with "expected
    // string, received null" until a description existed. Null is the same
    // instruction as absent — the RPC reads it as "leave whatever is stored" —
    // so accepting it costs nothing and closes the round-trip.
    business_description: z.string().max(280).nullable().optional(),
    // Absent means "leave it alone", so a client that predates the toggle
    // cannot turn transcription off just by saving the other switches.
    transcribe_voicemail: z.boolean().optional(),
    // #367: same "absent leaves it alone" rule, and it matters more here than
    // anywhere else on this object — an older client saving the other switches
    // must not be able to change what callers hear as a side effect.
    voicemail_intake: z.boolean().optional(),
    /** #507: dictate a post-call wrap-up rather than typing it. */
    call_wrapup: z.boolean().optional(),
    /** #247: summarise a long or long-forgotten thread on demand. */
    summarize_threads: z.boolean().optional(),
  })
  .strict();

/**
 * #461: the company settings a workspace audit is expected to answer for —
 * "who turned the text-back off", "when did the away hours change". Fixed on
 * purpose: it is the list of what is auditable, and it keeps the prior-value
 * read's `select` constant so a test double can recognise it.
 *
 * Deliberately absent: anything carrying customer-facing WORDS is here only so
 * the diff can report set/cleared/edited (see `textKeys` at the call site) —
 * the words themselves never enter the log.
 */
const AUDITED_COMPANY_SETTINGS = [
  "name",
  "timezone",
  "country",
  "requested_area_code",
  "us_texting_enabled",
  "aup_accepted",
  "away_enabled",
  "away_message",
  "business_hours",
  "mctb_enabled",
  "mctb_message",
  "emergency_message",
  "voicemail_greeting",
  "voicemail_greeting_id",
  // #278: which calls reach a person after hours is exactly the kind of change
  // an incident timeline is made of — "why did nobody's phone ring on Saturday"
  // has one honest answer only if the log says who changed it.
  "after_hours_calls",
  "after_hours_greeting_id",
  // #278: "why did nobody's phone ring" and "why did it only ring twice" are
  // both questions whose answer is a settings change somebody made.
  "ring_strategy",
  "ring_seconds",
  "voicemail_enabled",
  "caller_id_name",
  "caller_id_lookup",
  "cnam_submitted_at",
  "overage_cap_multiplier",
  "billing_alerts_enabled",
  "response_time_per_member",
  "quiet_hours_confirm",
  "chosen_number_e164",
].join(",");

companiesRoutes.patch(
  "/company/ai-settings",
  requireCapability("settings.manage"),
  async (c) => {
    const body = await parseJsonBody(c, aiSettingsSchema);
    const db = getDb(getEnv(c.env));
    // #461: read the switches BEFORE the write so the audit row can say what
    // moved. Without this the log recorded all five on every save, and a
    // reader could not tell which one the person actually touched. One extra
    // SELECT on a settings PATCH is a fair price for a log that answers the
    // question it exists for; a failed read degrades to "no before" rather
    // than failing the save.
    const priorAi = await db
      .from("company_ai_settings")
      .select(
        "enrich_task_address,enrich_task_due,suggest_replies," +
          "transcribe_voicemail,voicemail_intake,call_wrapup,summarize_threads",
      )
      .eq("company_id", c.get("companyId"))
      .maybeSingle();
    const before = (priorAi.data ?? {}) as Record<string, unknown>;
    const { data, error } = await db.rpc("upsert_company_ai_settings", {
      p_company_id: c.get("companyId"),
      p_enrich_task_address: body.enrich_task_address,
      p_enrich_task_due: body.enrich_task_due,
      p_suggest_replies: body.suggest_replies,
      p_business_description: body.business_description ?? null,
      p_transcribe_voicemail: body.transcribe_voicemail ?? true,
      // Null, not false: the RPC reads null as "leave it alone". Defaulting to
      // false would let any older client turn the greeting back off.
      p_voicemail_intake: body.voicemail_intake ?? null,
      // #507: same null-means-leave-it reasoning — a client that predates
      // dictation must not turn it back on for a workspace that switched it off.
      p_call_wrapup: body.call_wrapup ?? null,
      // #247: and again. This is the third toggle added after clients shipped,
      // which is why the RPC defaults every one of them to null rather than to
      // the column default.
      p_summarize_threads: body.summarize_threads ?? null,
    });
    if (error) {
      throw new Error(`upsert_company_ai_settings failed: ${error.message}`);
    }
    const row = data as CompanyAiSettings;
    // #231: settings changes are the "why did we stop getting jobs three weeks
    // ago" class. The switches, never the business description — that is the
    // owner's words, and the log records shape, not content.
    const aiDelta = auditDiff(before, {
      enrich_task_address: row.enrich_task_address,
      enrich_task_due: row.enrich_task_due,
      suggest_replies: row.suggest_replies,
      transcribe_voicemail: row.transcribe_voicemail,
      // #367: the one switch on this object that changes what a CUSTOMER
      // hears, which makes "who turned this on, and when" a question support
      // will actually be asked.
      voicemail_intake: row.voicemail_intake,
      call_wrapup: row.call_wrapup,
      // #247: the switch that decides whether whole threads leave for
      // inference. "Who turned this on" is a question a privacy review asks.
      summarize_threads: row.summarize_threads,
    });
    // The business description is deliberately absent from the diff: it is the
    // owner's own words about their business, and the log records shape, not
    // content (#231).
    if (aiDelta) {
      await recordAuditFromRequest(db, c, {
        companyId: c.get("companyId"),
        action: "settings.changed",
        targetType: "ai_settings",
        before: aiDelta.before,
        after: aiDelta.after,
      });
    }
    return c.json({
      enrich_task_address: row.enrich_task_address,
      enrich_task_due: row.enrich_task_due,
      suggest_replies: row.suggest_replies,
      business_description: row.business_description ?? null,
      transcribe_voicemail: row.transcribe_voicemail,
      voicemail_intake: row.voicemail_intake,
      call_wrapup: row.call_wrapup,
      summarize_threads: row.summarize_threads,
    });
  },
);

companiesRoutes.patch("/company", requireCapability("settings.manage"), async (c) => {
  const body = await parseJsonBody(c, patchSchema);

  // Overage cap raise/remove is owner-only (SPEC §2, §10 matrix).
  if ("overage_cap_multiplier" in body && c.get("role") !== "owner") {
    return errorResponse(
      c,
      "forbidden",
      "Only the owner can change the overage cap.",
    );
  }

  // #239: naming individuals in a performance number is not an admin's call.
  // An admin can already change the shop's hours and its away message; deciding
  // that every tech's median reply time is visible to the whole crew is a
  // different kind of decision, and the issue asks for it to be the owner's.
  if (
    body.response_stats_per_member !== undefined &&
    c.get("role") !== "owner"
  ) {
    return errorResponse(
      c,
      "forbidden",
      "Only the owner can turn per-member response times on or off.",
    );
  }

  // #481: the off-ramp speaks to a departing business's customers using the
  // business's own line. That is the owner's call in the same way transferring
  // ownership or closing the workspace is — an admin deciding what a company's
  // customers are told as it winds down is a decision about the business, not
  // about its settings.
  if (body.offramp_message !== undefined && c.get("role") !== "owner") {
    return errorResponse(
      c,
      "forbidden",
      "Only the owner can set what customers are told after you leave.",
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.offramp_message !== undefined) {
    // The message and the opt-in move together — the CHECK constraint requires
    // it, and so does the meaning: writing the words IS the opt-in, and there
    // is no state where one exists without the other.
    patch.offramp_message = body.offramp_message;
    patch.offramp_opted_in_at =
      body.offramp_message === null ? null : new Date().toISOString();
  }
  if (body.timezone !== undefined) {
    assertValidTimezone(body.timezone);
    patch.timezone = body.timezone;
  }
  if ("overage_cap_multiplier" in body) {
    // #12 Phase 0.3: `null` ("no cap") now resolves to the 10x hard ceiling —
    // the cap can no longer be disabled (companies_overage_cap_range CHECK).
    if (body.overage_cap_multiplier === null) {
      patch.overage_cap_multiplier = 10;
    } else {
      const rounded = Math.round(body.overage_cap_multiplier! * 100) / 100;
      // zod's positive() admits (0, 0.005) values that round to 0 and would
      // trip the DB CHECK (> 0) as a raw 500 — reject them as validation errors.
      if (rounded <= 0) {
        throw new ApiError(
          "validation_failed",
          "overage_cap_multiplier must be at least 0.01.",
        );
      }
      patch.overage_cap_multiplier = rounded;
    }
  }
  // FEATURE-GAPS Step 1: after-hours away settings.
  if (body.business_hours !== undefined) {
    if (!isValidBusinessHours(body.business_hours)) {
      throw new ApiError(
        "validation_failed",
        "business_hours must map weekdays (mon..sun) to { open, close } HH:MM windows.",
      );
    }
    patch.business_hours = body.business_hours;
  }
  // #402: a weekly loop cannot know about Christmas. The owner names the
  // dates, because a built-in calendar would need per-province data forever
  // and would be wrong for the trades that WORK holidays.
  if (body.business_hours_exceptions !== undefined) {
    if (!isValidHoursExceptions(body.business_hours_exceptions)) {
      throw new ApiError(
        "validation_failed",
        "Each closed date needs a from and to date (YYYY-MM-DD, to on or after from) " +
          "and either no hours or an { open, close } HH:MM window.",
      );
    }
    patch.business_hours_exceptions = body.business_hours_exceptions;
  }
  if (body.away_enabled !== undefined) patch.away_enabled = body.away_enabled;
  if ("away_message" in body) {
    // Empty string clears to null (an unauthored message never fires).
    patch.away_message =
      body.away_message && body.away_message.length > 0
        ? body.away_message
        : null;
  }
  if (body.emergency_keyword_enabled !== undefined) {
    patch.emergency_keyword_enabled = body.emergency_keyword_enabled;
  }
  if ("emergency_keywords" in body) {
    // De-duplicated before it is stored, matching the CHECK. Two of the same
    // word is not an error worth refusing an owner over — it is a slip while
    // typing a list — but storing it would report a keyword count nobody typed.
    const words = body.emergency_keywords;
    patch.emergency_keywords =
      words && words.length > 0 ? [...new Set(words)] : null;
  }
  if (body.locale !== undefined) {
    // #228. Only the PRODUCT DEFAULTS follow this: an owner who wrote their own
    // away message or text-back keeps the sentence they wrote, in whatever
    // language they wrote it.
    patch.locale = body.locale;
  }
  if ("emergency_message" in body) {
    // Empty string clears to null, so the product default comes back rather
    // than an emergency reply that is only the safety line.
    patch.emergency_message =
      body.emergency_message && body.emergency_message.length > 0
        ? body.emergency_message
        : null;
  }
  // #388: unanswered-lead chasing.
  if (body.lead_chase_enabled !== undefined) {
    patch.lead_chase_enabled = body.lead_chase_enabled;
  }
  if (body.lead_chase_crew_enabled !== undefined) {
    patch.lead_chase_crew_enabled = body.lead_chase_crew_enabled;
  }
  // #430: whether pushes may carry a person's words.
  if (body.push_include_content !== undefined) {
    patch.push_include_content = body.push_include_content;
  }
  // #393: first-message sender identification (off by default).
  if (body.first_message_identification !== undefined) {
    patch.first_message_identification = body.first_message_identification;
  }
  // #225: the quiet-hours confirmation step (on by default).
  if (body.quiet_hours_confirm_enabled !== undefined) {
    patch.quiet_hours_confirm_enabled = body.quiet_hours_confirm_enabled;
  }
  // #239: per-member response times (owner-only, guarded above).
  if (body.response_stats_per_member !== undefined) {
    patch.response_stats_per_member = body.response_stats_per_member;
  }
  if (body.tags_locked !== undefined) patch.tags_locked = body.tags_locked;
  // FEATURE-GAPS voice wave: missed-call text-back settings.
  if (body.mctb_enabled !== undefined) patch.mctb_enabled = body.mctb_enabled;
  if ("mctb_message" in body) {
    // Empty string clears to null (an unauthored message never fires).
    patch.mctb_message =
      body.mctb_message && body.mctb_message.length > 0
        ? body.mctb_message
        : null;
  }
  // D43 Calls v2 settings. Empty greeting clears to null (the voicemail then
  // speaks the honest default built from the company name).
  if ("voicemail_greeting" in body) {
    patch.voicemail_greeting =
      body.voicemail_greeting && body.voicemail_greeting.length > 0
        ? body.voicemail_greeting
        : null;
  }
  if (body.call_screening !== undefined) {
    patch.call_screening = body.call_screening;
  }
  // #309/#278: the two greeting SELECTIONS and the after-hours routing.
  //
  // Each id is checked against this workspace's own greetings before it is
  // stored. The FK only requires the row to exist, so without this a member
  // could point their line at another business's recorded voice by pasting an
  // id — and the caller would hear it. That is the one failure a recorded
  // greeting can produce that is worse than TTS.
  for (const key of ["voicemail_greeting_id", "after_hours_greeting_id"] as const) {
    if (!(key in body)) continue;
    const id = body[key] ?? null;
    if (id !== null) await assertOwnGreeting(c, id);
    patch[key] = id;
  }
  if (body.after_hours_calls !== undefined) {
    patch.after_hours_calls = body.after_hours_calls;
  }
  if (body.ring_strategy !== undefined) patch.ring_strategy = body.ring_strategy;
  if (body.ring_seconds !== undefined) patch.ring_seconds = body.ring_seconds;
  if ("cnam_display_name" in body) {
    patch.cnam_display_name = body.cnam_display_name ?? null;
    // #193: changing the caller ID is a deliberate act whose carrier-side
    // propagation takes days (and Telnyx reports no status), so the row
    // carries WHEN the change went out — that timestamp is the whole
    // pending state clients can honestly show.
    patch.cnam_submitted_at = new Date().toISOString();
  }
  if (body.caller_id_lookup !== undefined) {
    patch.caller_id_lookup = body.caller_id_lookup;
  }

  const env = getEnv(c.env);
  const db = getDb(env);

  // #134/D42: calling is included on every plan — no module gate. But
  // ENABLING call features still needs a live subscription (review fix): a
  // canceled/pre-checkout workspace saving a forward cell or turning on the
  // text-back would get a success toast for a feature that can never fire
  // (the voice webhook refuses non-active subscriptions) — an honest 402
  // beats a silently dead setting.
  const enablingVoice = body.mctb_enabled === true;
  if (enablingVoice) {
    const rows = unwrap<{ subscription_status: string }[]>(
      await db
        .from("companies")
        .select("subscription_status")
        .eq("id", c.get("companyId"))
        .limit(1),
      "company lookup",
    );
    if (rows[0]?.subscription_status !== "active") {
      throw new ApiError(
        "subscription_inactive",
        "Calling features need an active subscription.",
      );
    }
  }

  // Onboarding "edit until checkout": country, US-texting, and the requested
  // area code are mutable ONLY while the company is still pre-checkout. Once
  // checkout completes the number is provisioned from them and they lock. A
  // country change requires a matching new area code (geographic-NANP rule).
  if (
    body.country !== undefined ||
    body.requested_area_code !== undefined ||
    body.us_texting_enabled !== undefined ||
    "chosen_number_e164" in body
  ) {
    const current = unwrap<{ country: string; subscription_status: string }[]>(
      await db
        .from("companies")
        .select("country, subscription_status")
        .eq("id", c.get("companyId"))
        .is("deleted_at", null),
      "company location precheck",
    );
    const row = current[0];
    if (!row) return errorResponse(c, "not_found", "No such company.");
    if (
      row.subscription_status !== "incomplete" &&
      row.subscription_status !== "incomplete_expired"
    ) {
      throw new ApiError(
        "conflict",
        "Your number has already been ordered, so its country and area code are locked.",
      );
    }
    const nextCountry = body.country ?? row.country;
    if (
      body.country !== undefined &&
      body.country !== row.country &&
      body.requested_area_code === undefined
    ) {
      throw new ApiError(
        "validation_failed",
        "requested_area_code: pick an area code for the new country.",
      );
    }
    if (body.requested_area_code !== undefined) {
      const entry = NANP_AREA_CODES[body.requested_area_code];
      if (!entry || !entry.geographic || entry.country !== nextCountry) {
        throw new ApiError(
          "validation_failed",
          `requested_area_code: ${body.requested_area_code} is not an assigned geographic ${nextCountry} area code.`,
        );
      }
      patch.requested_area_code = body.requested_area_code;
    }
    if (body.country !== undefined) patch.country = body.country;
    // US always texts US; CA honors the toggle.
    if (nextCountry === "US" && body.us_texting_enabled === false) {
      throw new ApiError(
        "validation_failed",
        "us_texting_enabled: US companies always have US texting enabled.",
      );
    }
    if (body.country === "US") {
      patch.us_texting_enabled = true;
    } else if (body.us_texting_enabled !== undefined) {
      patch.us_texting_enabled = body.us_texting_enabled;
    }

    // The staged onboarding pick. An explicit value is validated against the
    // effective country (null clears it); otherwise a country/area-code change
    // invalidates any prior pick (it was for the old region) and clears it.
    const regionChanged =
      (body.country !== undefined && body.country !== row.country) ||
      body.requested_area_code !== undefined;
    if ("chosen_number_e164" in body) {
      if (body.chosen_number_e164) {
        assertChosenNumberCountry(body.chosen_number_e164, nextCountry);
        patch.chosen_number_e164 = body.chosen_number_e164;
      } else {
        patch.chosen_number_e164 = null;
      }
    } else if (regionChanged) {
      patch.chosen_number_e164 = null;
    }
  }

  // #461: the prior values of the auditable settings, so the audit row below
  // can say what MOVED rather than restating the request. A failed read
  // degrades to "no before" rather than failing the save.
  //
  // The column list is FIXED rather than derived from the patch keys, for two
  // reasons: it makes "which settings are auditable" a decision written down
  // in one place, and it keeps this read's `select` constant, which is what
  // lets a test double recognise it (routes-harness.ts narrows its ambient
  // company handlers by select for exactly this reason).
  const patchedColumns = Object.keys(patch);
  const priorSettings = patchedColumns.length
    ? (
        await db
          .from("companies")
          .select(AUDITED_COMPANY_SETTINGS)
          .eq("id", c.get("companyId"))
          .maybeSingle()
      ).data
    : null;

  const rows = unwrap<Record<string, unknown>[]>(
    await db
      .from("companies")
      .update(patch)
      .eq("id", c.get("companyId"))
      .is("deleted_at", null)
      .select(COMPANY_COLUMNS),
    "company update",
  );
  const company = rows[0];
  if (!company) {
    return errorResponse(c, "not_found", "No such company.");
  }

  // #231/#461: the settings an owner asks about after the fact — the caller ID,
  // the missed-call text-back, the away reply. Record only the fields that
  // actually MOVED, with both sides, and nothing at all when a save changed
  // nothing. This used to log the whole requested patch with an empty `before`,
  // so a row said "this is now false" without saying what it was, and a field
  // re-saved at its current value looked like a change.
  //
  // The message text never enters the log — the words are the owner's, and a
  // log that copies them is a second place for customer-facing content to leak
  // from. `textKeys` reports set/cleared/edited instead.
  const settingsDelta = auditDiff(
    (priorSettings ?? {}) as Record<string, unknown>,
    patch,
    {
      // Only the keys this request actually sent, intersected with what we
      // consider auditable at all.
      only: patchedColumns,
      textKeys: [
        "away_message",
        "mctb_message",
        "emergency_message",
        "voicemail_greeting",
      ],
    },
  );
  if (settingsDelta) {
    await recordAuditFromRequest(db, c, {
      companyId: c.get("companyId"),
      action: "settings.changed",
      targetType: "company",
      targetId: c.get("companyId"),
      before: settingsDelta.before,
      after: settingsDelta.after,
    });
  }

  // When the missed-call text-back is turned ON, or a forward cell is set, the
  // company's number(s) must be able to RECEIVE CALLS. Enable voice idempotently
  // (a no-op when already enabled or when no active number exists yet). Only the
  // voice facet is touched — SMS is never affected. Best-effort in the
  // background so the settings write returns immediately; a failure here is
  // logged and the number stays SMS-only until the next enable (settings re-save
  // or a cron), never blocking the settings save.
  const turnedOnVoice = body.mctb_enabled === true;
  if (turnedOnVoice) {
    const enable = enableVoiceForCompany(env, db, c.get("companyId")).catch(
      (cause: unknown) => {
        console.error(
          `voice enable for company ${c.get("companyId")} failed:`,
          cause instanceof Error ? cause.message : String(cause),
        );
      },
    );
    const ctx = executionCtxOf(c);
    if (ctx) ctx.waitUntil(enable);
    else await enable;
  }

  // D43: screening/CNAM changes must reach the numbers themselves (Telnyx
  // per-number settings). Best-effort in the background, same contract as
  // the voice enable above — the companies row is the source of truth and a
  // re-save re-pushes. #193: the caller ID defaults to the COMPANY NAME, so
  // a rename while no explicit display name is set also changes the
  // effective listing and re-pushes it (stamping cnam_submitted_at once the
  // push actually reached a number).
  const renameChangedCallerId =
    body.name !== undefined && company.cnam_display_name == null;
  if (
    body.call_screening !== undefined ||
    body.caller_id_lookup !== undefined ||
    "cnam_display_name" in body ||
    renameChangedCallerId
  ) {
    const companyId = c.get("companyId");
    const sync = (async () => {
      const { pushed } = await syncCallSettingsForCompany(env, db, companyId, {
        ...(body.call_screening !== undefined
          ? { callScreening: body.call_screening }
          : {}),
        ...(body.caller_id_lookup !== undefined
          ? { callerIdLookup: body.caller_id_lookup }
          : {}),
        ...("cnam_display_name" in body || renameChangedCallerId
          ? {
              cnamDisplayName: effectiveCnamDisplayName({
                name: company.name as string | null,
                cnam_display_name: company.cnam_display_name as string | null,
              }),
            }
          : {}),
      });
      // The rename path had no explicit cnam field to stamp in the main
      // update; record the submission here, and only when a listing change
      // really went out to a number.
      if (renameChangedCallerId && !("cnam_display_name" in body) && pushed > 0) {
        const { error } = await db
          .from("companies")
          .update({ cnam_submitted_at: new Date().toISOString() })
          .eq("id", companyId);
        if (error) {
          throw new Error(`cnam_submitted_at stamp failed: ${error.message}`);
        }
      }
    })().catch((cause: unknown) => {
      console.error(
        `call settings sync for company ${companyId} failed:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    });
    const ctx = executionCtxOf(c);
    if (ctx) ctx.waitUntil(sync);
    else await sync;
  }

  // #192/#193: the PATCH echo carries the same derived fields as the GET
  // view (clients merge this straight into their cached company).
  //
  // billing_writes_enabled rides along for the same reason. It is a runtime
  // switch rather than a column, so it is absent from the updated row, and a
  // client merging this echo would fall back to its decode default of true.
  // That silently restores the in-app plan-change and module controls the
  // switch exists to hide, after nothing more than saving a business hour.
  //
  // #515: the echo is a company shape a client merges into its cache, so it
  // obeys the same redaction as the GET view — otherwise the one payload that
  // skips it becomes the way the money columns get back into a member's cached
  // company. A no-op today (this route is settings.manage, and every role
  // holding that also holds billing.manage); it is here so a settings-only
  // preset cannot reopen the hole by existing.
  return c.json({
    ...withBillingRedacted(
      withSeatDerived(
        withCallerIdDerived(
          withEmergencyDerived(
            withMctbDerived(withAwayDerived(withIdentificationDerived(company))),
          ),
        ),
      ),
      c.get("role"),
    ),
    billing_writes_enabled: billingWritesEnabled(env),
  });
});

