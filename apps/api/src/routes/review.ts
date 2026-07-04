/**
 * Review-request link (FEATURE-GAPS Step 2) — the MANUAL one-tap "Ask for a
 * review" action. NOT an automated sequence (§3 non-goal): a member taps it in a
 * conversation thread and JobText sends ONE saved message with {review_link}
 * merged in.
 *
 *   POST /v1/conversations/:id/review-request   M   { body? }
 *     - 409 `conflict` if the company has no google_review_link set (the UI
 *       disables the action with a reason; this is the server backstop).
 *     - one-per-job auto-suppression + opt-out honored ATOMICALLY inside the
 *       claim_review_request RPC (a recent 'review_requested' event on this
 *       thread, OR the customer replied/opened since the last ask, → 409
 *       `conflict` "already requested"; an opted-out contact → 403).
 *     - body defaults to an owner-friendly review ask; a custom body is allowed
 *       (must contain no consent burden — it is reply-exempt when the thread is
 *       warm; the send gates still run).
 *
 * Compliance basis: honors the opt-out mirror (in the RPC) and runs the §7 send
 * gates. The review URL is new emitted content (Gate 2 / 10DLC) — the company's
 * campaign must cover it (Step 0c, an onboarding/registration concern, not this
 * route). The one-tap-only, one-per-job shape is the anti-spam non-goal (§3).
 */
import { estimateSegments } from "@jobtext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError } from "../http/errors";
import { applySendMergeFields } from "../messaging/merge";
import { dispatchOutbound, runPreSendGates } from "../messaging/send";
import type { MessageRow } from "../messaging/types";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

/**
 * One-per-job suppression window: a second ask on the same thread within this
 * window (or after the customer replied since the last ask) is refused. 30 days
 * comfortably spans a job's lifetime — "one per job" in practice.
 */
export const REVIEW_SUPPRESS_SECONDS = 30 * 24 * 60 * 60;

/**
 * The default owner-friendly review ask. Emitted only when the caller does not
 * supply a body. Carries {review_link} (merged server-side) and the business
 * name for 10DLC brand-in-body hygiene.
 */
export const DEFAULT_REVIEW_MESSAGE =
  "Thanks for choosing {business_name}! A quick Google review means a lot: {review_link}";

const reviewSchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
});

interface ReviewSendView {
  id: string;
  contacts: { name: string | null; phone_e164: string };
  phone_numbers: { number_e164: string | null; status: string };
  companies: { name: string; google_review_link: string | null };
}

interface ClaimResult {
  skipped?:
    | "recipient_opted_out"
    | "already_requested"
    | "subscription_inactive"
    | "not_found";
  message?: MessageRow;
}

export const reviewRoutes = new Hono<AppEnv>();

reviewRoutes.post(
  "/conversations/:id/review-request",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const conversationId = pathUuid(c, "id");
    const body = await parseJsonBody(c, reviewSchema);
    const db = getDb(env);

    // Load conversation + contact + number + company (company-scoped, §10).
    const rows = unwrap<ReviewSendView[]>(
      await db
        .from("conversations")
        .select(
          "id,contacts(name,phone_e164),phone_numbers(number_e164,status)," +
            "companies(name,google_review_link)",
        )
        .eq("company_id", companyId)
        .eq("id", conversationId)
        .limit(1),
      "review conversation lookup",
    );
    const view = rows[0];
    if (!view) throw new ApiError("not_found", "No such conversation.");

    const reviewLink = view.companies.google_review_link?.trim();
    if (!reviewLink) {
      throw new ApiError(
        "conflict",
        "Add your Google review link in Settings before asking for a review.",
      );
    }

    const fromNumber = view.phone_numbers.number_e164;
    if (!fromNumber || view.phone_numbers.status !== "active") {
      throw new ApiError(
        "conflict",
        "This conversation's number is not ready to send yet.",
      );
    }

    // §7 send gates: subscription active → US/CA destination → registration.
    await runPreSendGates(env, companyId, view.contacts.phone_e164);

    // Merge {review_link}/{business_name}/{first_name} at send time.
    const merged = applySendMergeFields(body.body ?? DEFAULT_REVIEW_MESSAGE, {
      contactName: view.contacts.name,
      businessName: view.companies.name,
      reviewLink,
    });

    // Atomic claim: opt-out + one-per-job suppression + insert-before-Telnyx.
    const { data, error } = await db.rpc("claim_review_request", {
      p_company_id: companyId,
      p_conversation_id: conversationId,
      p_actor_user_id: userId,
      p_body: merged,
      p_segments_estimate: Math.max(1, estimateSegments(merged).segments),
      p_suppress_seconds: REVIEW_SUPPRESS_SECONDS,
    });
    if (error) throw new Error(`claim_review_request failed: ${error.message}`);

    const result = data as ClaimResult | null;
    if (!result || result.skipped) {
      const skipped = result?.skipped ?? "not_found";
      if (skipped === "recipient_opted_out") {
        throw new ApiError(
          "recipient_opted_out",
          "This recipient has opted out of receiving texts.",
        );
      }
      if (skipped === "subscription_inactive") {
        throw new ApiError(
          "subscription_inactive",
          "Outbound texting requires an active subscription.",
        );
      }
      if (skipped === "already_requested") {
        throw new ApiError(
          "conflict",
          "A review was already requested in this conversation, or the customer has replied since.",
        );
      }
      throw new ApiError("not_found", "No such conversation.");
    }
    if (!result.message?.id) {
      throw new Error("claim_review_request returned no message row");
    }

    const sent = await dispatchOutbound(env, db, result.message, {
      from: fromNumber,
      to: view.contacts.phone_e164,
      text: merged,
      mediaUrls: [],
    });

    const rest = { ...(sent as MessageRow & { body_tsv?: unknown }) };
    delete rest.body_tsv;
    return c.json(rest, 201);
  },
);
