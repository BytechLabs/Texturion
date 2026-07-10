import { NANP_AREA_CODES } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import {
  convergeExtraNumberQuantity,
  countNonReleasedNumbers,
  desiredExtraQuantity,
  extraNumberPrice,
  extraNumberPurchasable,
  findExtraNumberItem,
  setExtraNumberQuantity,
  syncPaidExtraCapacity,
} from "../billing/extra-numbers";
import { idempotencyKey } from "../billing/idempotency";
import {
  NUMBER_PROVISION_CHURN_CAP,
  PLAN_LIMITS,
  type PlanId,
} from "../billing/plans";
import { getStripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { parseJsonBody, parseWith, pathUuid } from "./core/http";
import {
  areaCodeOf,
  MAX_PROVISION_ATTEMPTS,
  releaseNumberRow,
  resumeProvisioning,
  type PhoneNumberRow,
} from "../telnyx/provisioning";

/**
 * Numbers routes (SPEC §7 route table, §4.2/§4.3, §10, §12 step 18). Mounted
 * by the integration layer under `/v1/numbers`, behind the /v1 middleware
 * chain. Read = any member; provision = owner/admin; release = owner only.
 */
export const numbersRoutes = new Hono<AppEnv>();

const NUMBER_COLUMNS =
  "id,company_id,status,source,voice_enabled,provisioning_key," +
  "requested_area_code,country," +
  "number_e164,telnyx_phone_number_id,telnyx_order_id,provision_attempts," +
  "last_provision_error,provision_failure_reason,updated_at,created_at," +
  "suspended_at,released_at";

type NumberRowFull = PhoneNumberRow & {
  voice_enabled?: boolean;
} & Record<string, unknown>;

/**
 * Vendor ids and provisioning internals stay server-side. The COARSE
 * failure_reason + provision_attempts + a derived `retrying` flag ARE exposed
 * so the UI can render provision_failed honestly and actionably — but the raw
 * last_provision_error and every telnyx_* id are never sent.
 */
function sanitizeNumber(row: NumberRowFull) {
  return {
    id: row.id,
    status: row.status,
    // Hosted-vs-purchased + voice state (FEATURE-GAPS voice wave): the web
    // renders keep-your-number rows differently from bought inventory.
    source: row.source,
    voice_enabled: row.voice_enabled ?? false,
    number_e164: row.number_e164,
    country: row.country,
    requested_area_code: row.requested_area_code,
    failure_reason: row.provision_failure_reason,
    provision_attempts: row.provision_attempts,
    // Still auto-retrying under the cron budget vs. genuinely stuck (out of
    // attempts) — drives "we're retrying" vs "choose a number" copy.
    retrying:
      row.status === "provision_failed" &&
      row.provision_attempts < MAX_PROVISION_ATTEMPTS,
    created_at: row.created_at ?? null,
    suspended_at: row.suspended_at ?? null,
    released_at: row.released_at ?? null,
  };
}

async function listCompanyNumbers(
  db: SupabaseClient,
  companyId: string,
): Promise<NumberRowFull[]> {
  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  return (data ?? []) as unknown as NumberRowFull[];
}

/** GET /v1/numbers — any member: list numbers with status (SPEC §7). */
numbersRoutes.get("/", async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = await listCompanyNumbers(db, c.get("companyId"));
  // #106: a restricted member must not even see a number hidden from them (the
  // composer's "text from" picker reads this list). Owners/admins and no-rules
  // companies resolve unrestricted and skip the filter.
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const visible =
    access.hiddenNumberIds === null
      ? rows
      : ((hidden) => rows.filter((row) => !hidden.has(row.id)))(
          new Set(access.hiddenNumberIds),
        );
  // A company holds at most 2 numbers (SPEC §2) — the list envelope keeps the
  // §7 shape with no second page ever.
  return c.json({ data: visible.map(sanitizeNumber), next_cursor: null });
});

const provisionBodySchema = z
  .strictObject({
    // The user must give agency to their number BEFORE we order (issue #75): a
    // specific E.164 (US, and any revealed number) is ordered exactly; a bare
    // area code (masked/CA inventory) assigns a number in that code. One is
    // required — we never auto-pick a number the user hasn't chosen.
    requested_area_code: z
      .string()
      .trim()
      .regex(/^[2-9]\d{2}$/, "must be a 3-digit area code")
      .optional(),
    chosen_number_e164: z
      .string()
      .trim()
      .regex(/^\+1\d{10}$/, "must be an E.164 NANP number")
      .optional(),
  })
  .refine((b) => Boolean(b.chosen_number_e164 || b.requested_area_code), {
    message: "a chosen number or an area code is required",
  });

const idempotencyKeySchema = z.uuid();

interface SlotResult {
  outcome:
    | "created"
    | "exists"
    | "plan_limit"
    | "sole_prop_cap"
    | "provision_cap";
  number: NumberRowFull | null;
}

/**
 * POST /v1/numbers/provision — owner/admin (SPEC §7, §10): Pro's 2nd number.
 * Gate order: role → Idempotency-Key (client UUID, §7) → area-code validation
 * against the shared NANP table (country fixed to the company's) → active
 * subscription (402) → the atomic slot claim (`provision_number_slot` RPC:
 * company-row lock + count-vs-plan + §4.2 sole-prop cap + insert, one
 * transaction) → the §4.3 saga from S2.
 */
numbersRoutes.post("/provision", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");

  const rawKey = c.req.header("Idempotency-Key");
  const parsedKey = idempotencyKeySchema.safeParse(rawKey);
  if (!parsedKey.success) {
    return errorResponse(
      c,
      "validation_failed",
      "Idempotency-Key header (a client-generated UUID) is required.",
    );
  }
  const body = await parseJsonBody(c, provisionBodySchema);

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select(
      "id,country,subscription_status,plan,us_texting_enabled," +
        "stripe_subscription_id,paid_capacity_epoch",
    )
    .eq("id", companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`companies lookup failed: ${companyError.message}`);
  }
  const company = (companyRows?.[0] ?? null) as unknown as {
    id: string;
    country: "US" | "CA";
    subscription_status: string;
    plan: PlanId | null;
    us_texting_enabled: boolean;
    stripe_subscription_id: string | null;
    /** #110 raise fence — read BEFORE any billing conclusion below. */
    paid_capacity_epoch: number;
  } | null;
  if (!company) throw new ApiError("not_found", "Company not found.");

  // Resolve the request to a concrete area code (fixed to the company's country)
  // and, when the user picked a specific number, the exact E.164 to order. A
  // chosen number is validated against its OWN area code's country (issue #75:
  // pick-then-order, never auto-assign).
  let chosen: string | null = null;
  let areaCode: string;
  if (body.chosen_number_e164) {
    const ndc = areaCodeOf(body.chosen_number_e164);
    const entry = ndc ? NANP_AREA_CODES[ndc] : undefined;
    if (!ndc || !entry || !entry.geographic) {
      throw new ApiError(
        "validation_failed",
        "chosen_number_e164 is not an assigned US/CA geographic number.",
      );
    }
    if (entry.country !== company.country) {
      throw new ApiError(
        "validation_failed",
        `chosen_number_e164 must be a ${company.country} number (the company's country).`,
      );
    }
    chosen = body.chosen_number_e164;
    areaCode = ndc;
  } else {
    const code = body.requested_area_code as string;
    const entry = NANP_AREA_CODES[code];
    if (!entry || !entry.geographic) {
      throw new ApiError(
        "validation_failed",
        "requested_area_code is not an assigned US/CA geographic area code.",
      );
    }
    if (entry.country !== company.country) {
      throw new ApiError(
        "validation_failed",
        `requested_area_code must be a ${company.country} area code (the company's country).`,
      );
    }
    areaCode = code;
  }

  if (company.subscription_status !== "active" || company.plan === null) {
    return errorResponse(
      c,
      "subscription_inactive",
      "An active subscription is required to provision a number.",
    );
  }

  // Idempotent replay FIRST (§7): a retried Idempotency-Key whose original
  // request already created the row must return it — BEFORE the paid-extra
  // branch below, which would otherwise re-derive the world from the NEW count
  // (409ing a Starter retry at the hard max, or replaying the Stripe key with
  // different params). The slot RPC has the same replay check, but the paid
  // branch runs before the RPC, so the route needs its own.
  {
    const { data: replayRows, error: replayError } = await db
      .from("phone_numbers")
      .select(NUMBER_COLUMNS)
      .eq("company_id", companyId)
      .eq("provisioning_key", parsedKey.data)
      .limit(1);
    if (replayError) {
      throw new Error(`replay lookup failed: ${replayError.message}`);
    }
    const replay = (replayRows?.[0] ?? null) as unknown as NumberRowFull | null;
    if (replay) return c.json(sanitizeNumber(replay), 200);
  }

  // #105 (#80): numbers beyond the plan's included count are PAID extras
  // ($5/mo Starter, $4/mo Pro; Starter hard-capped at 2 total; US-enabled
  // companies only). EVERY gate that could refuse the number runs BEFORE the
  // Stripe charge (never charge-then-409): purchasability, the §4.2 sole-prop
  // cap, and the #74 churn cap are all pre-checked here; the RPC re-checks
  // them atomically. The quantity is bumped BEFORE the slot claim with an
  // Idempotency-Key-derived Stripe key, so a retried request never
  // double-charges — and a later order failure never loses the paid capacity
  // (the slot stays open; remediation fills it without a new charge). Within
  // the included count this path is never consulted (no Stripe read).
  const included = PLAN_LIMITS[company.plan].numbers;
  const currentCount = await countNonReleasedNumbers(db, companyId);
  if (currentCount >= included) {
    const purchasable = extraNumberPurchasable({
      plan: company.plan,
      currentCount,
      country: company.country,
      usTextingEnabled: company.us_texting_enabled,
    });
    if (!purchasable.ok) {
      return errorResponse(c, "conflict", purchasable.reason);
    }
    // §4.2 sole-prop cap — mirror the RPC's predicate so the refusal lands
    // before any money moves.
    const { data: soleRows, error: soleError } = await db
      .from("messaging_registrations")
      .select("id")
      .eq("company_id", companyId)
      .eq("kind", "brand")
      .eq("sole_proprietor", true)
      .limit(1);
    if (soleError) {
      throw new Error(`sole-prop lookup failed: ${soleError.message}`);
    }
    if ((soleRows ?? []).length > 0 && currentCount >= 1) {
      return errorResponse(
        c,
        "conflict",
        "Sole Proprietor registration allows 1 phone number.",
      );
    }
    // #74 churn cap — same pre-check, same copy as the RPC outcome.
    const { data: churnRows, error: churnError } = await db
      .from("companies")
      .select("number_provision_count")
      .eq("id", companyId)
      .limit(1);
    if (churnError) {
      throw new Error(`churn count lookup failed: ${churnError.message}`);
    }
    const provisioned = Number(churnRows?.[0]?.number_provision_count ?? 0);
    if (provisioned >= NUMBER_PROVISION_CHURN_CAP) {
      return errorResponse(
        c,
        "conflict",
        "You've set up new numbers many times on this account. Contact support to add another.",
      );
    }
    const price = extraNumberPrice(env, company.plan);
    if (!price || !company.stripe_subscription_id) {
      // Fail CLOSED: no provisioned price (or no subscription id to bill) →
      // extras are not sellable here — never a free extra number.
      return errorResponse(
        c,
        "conflict",
        "Extra numbers aren't available yet. Contact support.",
      );
    }
    const stripe = getStripe(env);
    const subscription = await stripe.subscriptions.retrieve(
      company.stripe_subscription_id,
    );
    if (subscription.schedule) {
      // #18: a pending plan change owns the subscription's items — a quantity
      // bump would be rejected or undone at rollover. Rare; say so plainly.
      return errorResponse(
        c,
        "conflict",
        "A plan change is scheduled on your account. Add the number after it completes at the period end.",
      );
    }
    const quantity = desiredExtraQuantity(currentCount + 1, company.plan);
    try {
      await setExtraNumberQuantity({
        stripe,
        subscription,
        price,
        quantity,
        // The charge lands NOW — the customer pays for the extra as they add
        // it, never a surprise at the next invoice.
        proration: "always_invoice",
        idempotencyKey: idempotencyKey(
          companyId,
          "extra_number_buy",
          parsedKey.data,
        ),
      });
    } catch (cause) {
      // A raced concurrent first-extra buy: the loser's item CREATE hits
      // Stripe's one-item-per-price rule. Clean conflict, not a 500 — the
      // winner's quantity is live, so a retry sees it and updates instead.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/same price|duplicate/i.test(message)) {
        return errorResponse(
          c,
          "conflict",
          "Another number purchase just went through on this account. Try again in a moment.",
        );
      }
      throw cause;
    }
    // #110 VERIFY-AFTER-WRITE: re-read the live item before trusting our own
    // intent. Two ways the write above can be a ghost: (a) Stripe replayed a
    // CACHED create for an item a later converge already deleted (same key
    // within the 24h idempotency window — no new item, no charge); (b) a
    // concurrent converge credited the quantity right after our write. Either
    // way the customer is NOT billed for `quantity` — admitting would mint a
    // free number, so fail closed and ask for a fresh attempt.
    const verified = await stripe.subscriptions.retrieve(
      company.stripe_subscription_id,
    );
    const liveQuantity = findExtraNumberItem(verified, price)?.quantity ?? 0;
    if (liveQuantity < quantity) {
      return errorResponse(
        c,
        "conflict",
        "A billing update just ran on this account and the purchase didn't complete. Try again.",
      );
    }
    // Mirror the bought capacity into companies.paid_extra_numbers — the slot
    // claim below reads it UNDER the company lock. The RAISE is fenced with
    // the epoch read at the top of this request: if any converge claimed a
    // credit since, the raise is refused and we fail closed (a stale
    // conclusion must never resurrect credited capacity).
    const sync = await syncPaidExtraCapacity(
      db,
      companyId,
      quantity,
      company.paid_capacity_epoch,
    );
    if (!sync.applied) {
      return errorResponse(
        c,
        "conflict",
        "A billing update just ran on this account. Try again in a moment.",
      );
    }
  }

  const { data: slotData, error: slotError } = await db.rpc(
    "provision_number_slot",
    {
      p_company_id: companyId,
      p_provisioning_key: parsedKey.data,
      p_requested_area_code: areaCode,
      p_country: company.country,
      // #110: the Worker passes the plan-INCLUDED allowance; the RPC adds the
      // paid capacity from companies.paid_extra_numbers under its row lock.
      p_included_numbers: included,
      p_chosen_number_e164: chosen,
      p_provision_cap: NUMBER_PROVISION_CHURN_CAP,
    },
  );
  if (slotError) {
    throw new Error(`provision_number_slot failed: ${slotError.message}`);
  }
  const slot = parseWith(
    z.object({
      outcome: z.enum([
        "created",
        "exists",
        "plan_limit",
        "sole_prop_cap",
        "provision_cap",
      ]),
      number: z.record(z.string(), z.unknown()).nullable(),
    }),
    slotData,
  ) as SlotResult;

  if (slot.outcome === "plan_limit") {
    // Reachable only via a raced concurrent provision (the paid path already
    // raised the allowance). A bumped-but-unused quantity is credited back by
    // the daily reconcile's convergence, or consumed by the racer's number.
    return errorResponse(
      c,
      "conflict",
      "Another number was just added on this account. Check Settings › Numbers, then try again if you still need one more.",
    );
  }
  if (slot.outcome === "sole_prop_cap") {
    // §4.2: Sole Proprietor registration is capped at 1 number regardless of plan.
    return errorResponse(
      c,
      "conflict",
      "Sole Proprietor registration allows 1 phone number.",
    );
  }
  if (slot.outcome === "provision_cap") {
    // #74 churn cap: too many lifetime provisions on this company. Each buys a
    // fresh Telnyx number, so we stop the cycle and hand off to support (who can
    // reset the counter) rather than keep purchasing.
    return errorResponse(
      c,
      "conflict",
      "You've set up new numbers many times on this account. Contact support to add another.",
    );
  }
  if (!slot.number) throw new Error("provision_number_slot returned no row");

  if (slot.outcome === "exists") {
    // Idempotent replay (§7): the same Idempotency-Key returns the same row.
    return c.json(sanitizeNumber(slot.number as NumberRowFull), 200);
  }

  const provisioned = await resumeProvisioning(
    env,
    slot.number as unknown as PhoneNumberRow,
  );
  return c.json(sanitizeNumber(provisioned as NumberRowFull), 201);
});

/**
 * DELETE /v1/numbers/:id — owner only (SPEC §7, §12 step 18): release a
 * number (type-to-confirm in the UI, needed pre-downgrade, never automatic).
 */
numbersRoutes.delete("/:id", requireRole("owner"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");

  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("id", id)
    .eq("company_id", companyId)
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as NumberRowFull | null;
  if (!row) return errorResponse(c, "not_found", "No such number.");
  if (row.status === "released") {
    return errorResponse(c, "conflict", "This number is already released.");
  }

  const released = await releaseNumberRow(env, row);

  // #105: releasing a PAID extra stops its billing right away — converge the
  // Stripe quantity down to the formula (credit rides the next invoice).
  // Best-effort: a failure here never blocks the release (the number is gone
  // either way) — the daily reconcile converges as the backstop.
  try {
    const { data: companyRows } = await db
      .from("companies")
      .select("plan,stripe_subscription_id")
      .eq("id", companyId)
      .limit(1);
    const company = (companyRows?.[0] ?? null) as {
      plan: PlanId | null;
      stripe_subscription_id: string | null;
    } | null;
    if (company?.plan && company.stripe_subscription_id) {
      await convergeExtraNumberQuantity({
        env,
        db,
        stripe: getStripe(env),
        companyId,
        plan: company.plan,
        stripeSubscriptionId: company.stripe_subscription_id,
        now: new Date(),
      });
    }
  } catch (cause) {
    console.error(
      `extra-number convergence after release failed for ${companyId} (daily reconcile will settle it):`,
      cause instanceof Error ? cause.message : cause,
    );
  }

  return c.json(sanitizeNumber(released as NumberRowFull));
});

/**
 * #106: who can use a number, in the settings model's three shapes. `everyone`
 * clears the rules (the default — full use for the whole team); `role` and
 * `users` restrict to that principal set at ONE level ('text' = full,
 * 'note' = read + internal notes only). Anyone outside the set has no access:
 * the number and its conversations are hidden. Owners/admins always retain
 * full access (enforced in the resolver — no self-lockout).
 */
const accessBodySchema = z.discriminatedUnion("access", [
  z.strictObject({ access: z.literal("everyone") }),
  z.strictObject({
    access: z.literal("role"),
    role: z.enum(["admin", "member"]),
    level: z.enum(["text", "note"]),
  }),
  z.strictObject({
    access: z.literal("users"),
    user_ids: z.array(z.uuid()).min(1).max(50),
    level: z.enum(["text", "note"]),
  }),
]);

/** GET /v1/numbers/:id/access — the number's current access shape (O/A). */
numbersRoutes.get("/:id/access", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");

  const { data: numberRows, error: numberError } = await db
    .from("phone_numbers")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", id)
    .limit(1);
  if (numberError) {
    throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
  }
  if ((numberRows ?? []).length === 0) {
    return errorResponse(c, "not_found", "No such number.");
  }

  const { data, error } = await db
    .from("number_access")
    .select("principal_kind,principal,level")
    .eq("company_id", companyId)
    .eq("phone_number_id", id);
  if (error) throw new Error(`number_access lookup failed: ${error.message}`);
  const rules = (data ?? []) as {
    principal_kind: "all" | "role" | "user";
    principal: string | null;
    level: "text" | "note";
  }[];

  if (rules.length === 0) return c.json({ access: "everyone" });
  const roleRule = rules.find((rule) => rule.principal_kind === "role");
  if (roleRule) {
    return c.json({
      access: "role",
      role: roleRule.principal,
      level: roleRule.level,
    });
  }
  return c.json({
    access: "users",
    user_ids: rules
      .filter((rule) => rule.principal_kind === "user")
      .map((rule) => rule.principal),
    level: rules[0]?.level ?? "text",
  });
});

/** PUT /v1/numbers/:id/access — replace the number's access rules (O/A). */
numbersRoutes.put("/:id/access", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const body = await parseJsonBody(c, accessBodySchema);

  const { data: numberRows, error: numberError } = await db
    .from("phone_numbers")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", id)
    .limit(1);
  if (numberError) {
    throw new Error(`phone_numbers lookup failed: ${numberError.message}`);
  }
  if ((numberRows ?? []).length === 0) {
    return errorResponse(c, "not_found", "No such number.");
  }

  // Dedupe the people list up front: a repeated user id would insert two rows
  // for the same (number, principal) and trip the unique constraint (500). The
  // deduped set is what we validate AND insert below.
  const userIds =
    body.access === "users" ? [...new Set(body.user_ids)] : [];

  if (body.access === "users") {
    // Every listed person must be an ACTIVE member — a rule naming a stranger
    // (or a deactivated seat) would silently mean "nobody".
    const { data: memberRows, error: memberError } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .is("deactivated_at", null)
      .in("user_id", userIds);
    if (memberError) {
      throw new Error(`company_members lookup failed: ${memberError.message}`);
    }
    const active = new Set(
      ((memberRows ?? []) as { user_id: string }[]).map((row) => row.user_id),
    );
    const unknown = userIds.filter((userId) => !active.has(userId));
    if (unknown.length > 0) {
      return errorResponse(
        c,
        "validation_failed",
        "Every person must be an active member of this workspace.",
      );
    }
  }

  // Replace-all: delete then insert. The tiny crash window between the two
  // fails OPEN to "everyone" (today's default) — never a lockout, and the
  // owner simply re-saves. Both writes are company-scoped (§10).
  const { error: deleteError } = await db
    .from("number_access")
    .delete()
    .eq("company_id", companyId)
    .eq("phone_number_id", id);
  if (deleteError) {
    throw new Error(`number_access delete failed: ${deleteError.message}`);
  }

  if (body.access !== "everyone") {
    const rows =
      body.access === "role"
        ? [
            {
              company_id: companyId,
              phone_number_id: id,
              principal_kind: "role",
              principal: body.role,
              level: body.level,
            },
          ]
        : userIds.map((userId) => ({
            company_id: companyId,
            phone_number_id: id,
            principal_kind: "user",
            principal: userId,
            level: body.level,
          }));
    const { error: insertError } = await db.from("number_access").insert(rows);
    if (insertError) {
      throw new Error(`number_access insert failed: ${insertError.message}`);
    }
  }

  return c.json(body);
});

const remediateBodySchema = z.strictObject({
  requested_area_code: z
    .string()
    .trim()
    .regex(/^[2-9]\d{2}$/, "must be a 3-digit area code")
    .optional(),
  chosen_number_e164: z
    .string()
    .trim()
    .regex(/^\+1\d{10}$/, "must be an E.164 NANP number")
    .optional(),
});

/**
 * POST /v1/numbers/:id/remediate — owner/admin: finish a provision_failed number
 * WITHOUT a new charge. Re-arms the EXISTING paid row (resets the attempt budget,
 * status → provisioning) and re-runs the saga via resumeProvisioning — it NEVER
 * calls provision_number_slot (the paid slot claim) and NEVER touches Stripe.
 * The user can change the area code and/or pick a specific number; a chosen
 * number is validated against its OWN area code's country (never the old
 * requested code — that would reject the exhausted-416 → pick-a-647 remedy).
 */
numbersRoutes.post("/:id/remediate", requireRole("admin"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, remediateBodySchema);

  const { data, error } = await db
    .from("phone_numbers")
    .select(NUMBER_COLUMNS)
    .eq("id", id)
    .eq("company_id", companyId)
    .limit(1);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as NumberRowFull | null;
  if (!row) return errorResponse(c, "not_found", "No such number.");
  // Only a failed BUY-saga row is remediable: a ported/hosted number has no
  // inventory to search, and an active/released one is nothing to fix.
  if (row.source !== "provisioned") {
    return errorResponse(c, "conflict", "This number can't be set up this way.");
  }
  if (row.status !== "provision_failed") {
    return errorResponse(c, "conflict", "This number isn't waiting to be set up.");
  }

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select("country")
    .eq("id", companyId)
    .limit(1);
  if (companyError) throw new Error(`company lookup failed: ${companyError.message}`);
  const country = (companyRows?.[0] as { country?: string } | undefined)?.country;
  if (country !== "US" && country !== "CA") {
    return errorResponse(c, "not_found", "No such company.");
  }

  let chosen: string | null = null;
  let areaCode: string | null = null;
  if (body.chosen_number_e164) {
    const ndc = areaCodeOf(body.chosen_number_e164);
    const entry = ndc ? NANP_AREA_CODES[ndc] : undefined;
    if (!ndc || !entry || !entry.geographic || entry.country !== country) {
      return errorResponse(
        c,
        "validation_failed",
        `That number isn't a ${country} local number.`,
      );
    }
    // A live order for the auto-searched number would pre-empt the pick (and
    // clearing it blindly risks a double-buy). Require a clean order slate; the
    // common no-inventory remedy always has a null order id anyway.
    if (row.telnyx_order_id) {
      return errorResponse(
        c,
        "conflict",
        "We're finishing an earlier order. Try choosing again in a minute.",
      );
    }
    chosen = body.chosen_number_e164;
    areaCode = ndc;
  } else if (body.requested_area_code) {
    const entry = NANP_AREA_CODES[body.requested_area_code];
    if (!entry || !entry.geographic || entry.country !== country) {
      return errorResponse(
        c,
        "validation_failed",
        `Area code ${body.requested_area_code} isn't a ${country} area code.`,
      );
    }
    areaCode = body.requested_area_code;
  }

  // Atomic re-arm on the existing PAID row. The `status = 'provision_failed'`
  // guard is also the concurrency lock: a double-clicked retry updates 0 rows.
  const { data: armedRows, error: armError } = await db
    .from("phone_numbers")
    .update({
      status: "provisioning",
      provision_attempts: 0,
      last_provision_error: null,
      provision_failure_reason: null,
      chosen_number_e164: chosen,
      ...(areaCode ? { requested_area_code: areaCode } : {}),
    })
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("status", "provision_failed")
    .select(NUMBER_COLUMNS);
  if (armError) throw new Error(`remediate update failed: ${armError.message}`);
  const armed = (armedRows?.[0] ?? null) as unknown as PhoneNumberRow | null;
  if (!armed) {
    return errorResponse(c, "conflict", "A retry is already in progress.");
  }

  const result = await resumeProvisioning(env, armed);
  return c.json(sanitizeNumber(result as NumberRowFull));
});
