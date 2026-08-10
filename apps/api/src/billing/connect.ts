/**
 * #224 / D133 — the workspace's Stripe Express account, and our mirror of it.
 *
 * ## The shape of the decision, restated where the code is
 *
 * EXPRESS accounts, DIRECT charges, ZERO platform fee.
 *
 * A direct charge is created ON the connected account (`stripeAccount` on the
 * request), which makes the tradesperson the merchant of record. Their business
 * name is on the customer's statement, and a refund, a chargeback and a
 * negative balance all settle against THEIR Stripe balance. That is the answer
 * to the liability question #224 was filed to ask rather than assume, and it is
 * a property of the API call rather than a policy we promise: there is no
 * `application_fee_amount` anywhere in this file, and no `transfer_data`, so
 * their money never routes through us.
 *
 * Express, rather than Standard, because Stripe owns the onboarding flow, the
 * KYC, and — the part that matters after launch — the dashboard where the
 * business issues a refund and answers a dispute. A one-truck plumber gets a
 * real payments back office and we do not have to build one.
 *
 * ## Everything here is a MIRROR
 *
 * Stripe owns the truth about whether an account can take money. This module
 * copies that answer into `stripe_connect_accounts` from two places — the
 * `account.updated` webhook, and an on-demand refresh — and nothing in the
 * product decides anything from a fact we invented. `charges_enabled` is the
 * one field that gates a send, because `details_submitted` can be true while
 * charges are still off pending review, and a request sent in that window takes
 * a customer to a page that cannot accept their card.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  payoutReadiness,
  type PayoutReadiness,
} from "@loonext/shared";

import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { getStripe, type Stripe } from "./stripe";

export interface ConnectAccountRow {
  company_id: string;
  stripe_account_id: string;
  country: string;
  default_currency: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  disabled_reason: string | null;
  requirements_due: string[];
  requirements_deadline: string | null;
}

/** The mirror, or null when this workspace has never started onboarding. */
export async function loadConnectAccount(
  db: SupabaseClient,
  companyId: string,
): Promise<ConnectAccountRow | null> {
  const { data, error } = await db
    .from("stripe_connect_accounts")
    .select(
      "company_id,stripe_account_id,country,default_currency,charges_enabled," +
        "payouts_enabled,details_submitted,disabled_reason,requirements_due," +
        "requirements_deadline",
    )
    .eq("company_id", companyId)
    .limit(1);
  if (error) throw new Error(`connect account lookup failed: ${error.message}`);
  return (data?.[0] as unknown as ConnectAccountRow | undefined) ?? null;
}

/** The mirror for a Stripe account id — the webhook's direction of travel. */
export async function loadConnectAccountByStripeId(
  db: SupabaseClient,
  stripeAccountId: string,
): Promise<ConnectAccountRow | null> {
  const { data, error } = await db
    .from("stripe_connect_accounts")
    .select(
      "company_id,stripe_account_id,country,default_currency,charges_enabled," +
        "payouts_enabled,details_submitted,disabled_reason,requirements_due," +
        "requirements_deadline",
    )
    .eq("stripe_account_id", stripeAccountId)
    .limit(1);
  if (error) throw new Error(`connect account lookup failed: ${error.message}`);
  return (data?.[0] as unknown as ConnectAccountRow | undefined) ?? null;
}

/**
 * Everything Stripe currently says about an account, flattened for the mirror.
 *
 * `currently_due` rather than `eventually_due`: the settings page's job is to
 * say what is stopping payments TODAY. `eventually_due` is a list of things
 * that become due later, and showing them as outstanding turns a working
 * account into a page full of homework.
 */
export function mirrorFrom(account: Stripe.Account): {
  country: string;
  default_currency: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  disabled_reason: string | null;
  requirements_due: string[];
  requirements_deadline: string | null;
} {
  const requirements = account.requirements;
  const deadline = requirements?.current_deadline ?? null;
  return {
    country: account.country ?? "US",
    default_currency: account.default_currency ?? null,
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    details_submitted: account.details_submitted ?? false,
    disabled_reason: requirements?.disabled_reason ?? null,
    requirements_due: requirements?.currently_due ?? [],
    requirements_deadline: deadline ? new Date(deadline * 1000).toISOString() : null,
  };
}

/** Write the mirror. The ONE writer, so every path converges on one shape. */
export async function saveConnectMirror(
  db: SupabaseClient,
  companyId: string,
  stripeAccountId: string,
  account: Stripe.Account,
  createdBy?: string | null,
): Promise<ConnectAccountRow> {
  const mirror = mirrorFrom(account);
  const { data, error } = await db
    .from("stripe_connect_accounts")
    .upsert(
      {
        company_id: companyId,
        stripe_account_id: stripeAccountId,
        ...mirror,
        updated_at: new Date().toISOString(),
        ...(createdBy ? { created_by: createdBy } : {}),
      },
      { onConflict: "company_id" },
    )
    .select(
      "company_id,stripe_account_id,country,default_currency,charges_enabled," +
        "payouts_enabled,details_submitted,disabled_reason,requirements_due," +
        "requirements_deadline",
    );
  if (error) throw new Error(`connect mirror write failed: ${error.message}`);
  const row = data?.[0] as unknown as ConnectAccountRow | undefined;
  if (!row) throw new Error("connect mirror write returned no row");
  return row;
}

/**
 * Re-read the account from Stripe and refresh the mirror.
 *
 * Called when the settings page is opened and before a payment request is
 * sent — NOT only from the webhook. A business that has just finished
 * onboarding in a Stripe tab comes straight back to ours, and "wait for a
 * webhook" is the difference between the feature working and the feature
 * looking broken on the one occasion it gets a first impression.
 */
export async function refreshConnectAccount(
  env: Env,
  db: SupabaseClient,
  row: ConnectAccountRow,
): Promise<ConnectAccountRow> {
  const account = await getStripe(env).accounts.retrieve(row.stripe_account_id);
  return saveConnectMirror(db, row.company_id, row.stripe_account_id, account);
}

/**
 * The country an Express account is created in, from the workspace's own.
 *
 * Fixed at creation by Stripe and never editable afterwards, which is why it is
 * derived from the workspace rather than asked for: a business that picks the
 * wrong one here has to delete the account and start again, and the workspace
 * already knows which country it operates in because its phone number and its
 * subscription currency both came from it.
 */
export function connectCountryFor(companyCountry: string | null | undefined): "US" | "CA" {
  return (companyCountry ?? "").toUpperCase() === "CA" ? "CA" : "US";
}

/**
 * Create the Express account.
 *
 * `capabilities.card_payments` + `transfers` is the minimum for a direct charge
 * that pays out. No `business_type` and no prefilled profile: Stripe's own
 * onboarding asks better questions than a form we would write, and guessing
 * wrong (sole trader vs incorporated) is a correction the business then has to
 * make inside Stripe.
 *
 * The idempotency key is the company id, so a double-tap on "Set up payments"
 * — or a retry after a timeout — cannot leave a workspace with two connected
 * accounts, which is a state Stripe will happily create and nobody can merge.
 */
export async function createConnectAccount(
  env: Env,
  db: SupabaseClient,
  args: { companyId: string; country: "US" | "CA"; email: string | null; userId: string },
): Promise<ConnectAccountRow> {
  const stripe = getStripe(env);
  const account = await stripe.accounts.create(
    {
      type: "express",
      country: args.country,
      ...(args.email ? { email: args.email } : {}),
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { company_id: args.companyId },
    },
    { idempotencyKey: `connect-account:${args.companyId}` },
  );
  return saveConnectMirror(db, args.companyId, account.id, account, args.userId);
}

/**
 * A one-time onboarding URL.
 *
 * Account links expire in minutes and are single-use by design — Stripe's, not
 * ours — so this is minted per click and never stored. `refresh_url` is where
 * Stripe sends somebody whose link went stale; pointing it back at our own
 * settings page means the answer to an expired link is one more tap rather than
 * a dead end.
 */
export async function createOnboardingLink(
  env: Env,
  stripeAccountId: string,
  appOrigin: string,
): Promise<string> {
  const settings = `${appOrigin.replace(/\/$/, "")}/settings/payments`;
  const link = await getStripe(env).accountLinks.create({
    account: stripeAccountId,
    type: "account_onboarding",
    refresh_url: `${settings}?stripe=refresh`,
    return_url: `${settings}?stripe=return`,
    collection_options: { fields: "currently_due" },
  });
  return link.url;
}

/**
 * A login link to the business's own Express dashboard.
 *
 * THIS IS THE REFUND AND DISPUTE PATH, and it is deliberately not a surface we
 * build. Refunds, partial refunds, dispute evidence and payout history all live
 * in a back office Stripe already runs, keeps compliant, and updates. Building
 * a thin copy of it would mean owning the correctness of money movement we
 * chose not to be in the path of — see docs/TEXT-TO-PAY.md.
 */
export async function createDashboardLink(
  env: Env,
  stripeAccountId: string,
): Promise<string> {
  const link = await getStripe(env).accounts.createLoginLink(stripeAccountId);
  return link.url;
}

/**
 * The gate a send passes. Throws the sentence the crew should read.
 *
 * Every refusal names what is outstanding, because the alternative — "payments
 * are not available" — is the message that produces a support email instead of
 * a finished setup.
 */
export function assertCanCharge(readiness: PayoutReadiness): void {
  if (readiness === "ready") return;
  if (readiness === "not_connected") {
    throw new ApiError(
      "conflict",
      "Set up payments in Settings before asking a customer to pay. It takes a " +
        "couple of minutes and the money goes straight to your bank account.",
    );
  }
  if (readiness === "onboarding_incomplete") {
    throw new ApiError(
      "conflict",
      "Stripe still needs a few details about your business before it can take " +
        "a payment. Finish setting up in Settings → Payments.",
    );
  }
  if (readiness === "restricted") {
    throw new ApiError(
      "conflict",
      "Stripe has paused payments on your account. Open your Stripe dashboard " +
        "from Settings → Payments to see what it needs.",
    );
  }
  throw new ApiError(
    "conflict",
    "Stripe is still checking your details. We will switch payment requests on " +
      "as soon as it clears — there is nothing for you to do.",
  );
}

/** Readiness from the mirror, in one call, for every caller that needs it. */
export function readinessOf(row: ConnectAccountRow | null): PayoutReadiness {
  return payoutReadiness(
    row
      ? {
          connected: true,
          charges_enabled: row.charges_enabled,
          details_submitted: row.details_submitted,
          disabled_reason: row.disabled_reason,
          requirements_due: row.requirements_due,
        }
      : null,
  );
}
