"use client";

import {
  EXTRA_NUMBER_CURRENCY,
  EXTRA_NUMBER_MONTHLY_CENTS,
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
} from '@loonext/shared';
import type { BillingCurrency } from '@loonext/shared';

import { useCountry } from "@/components/marketing/country/country-context";
import type { PlanId } from "@/lib/api/types";

export function usePriceAudience(): BillingCurrency {
  return useCountry().country === "ca" ? "cad" : "usd";
}

export function PlanPrice({ plan }: { plan: PlanId }) {
  return <>{formatMoney(PLAN_PRICE_CENTS.usd[plan], "usd", usePriceAudience())}</>;
}

export function ExtraNumberPrice({ plan }: { plan: PlanId }) {
  const audience = usePriceAudience();
  return <>{formatMoney(EXTRA_NUMBER_MONTHLY_CENTS[plan], EXTRA_NUMBER_CURRENCY, audience)}</>;
}

export function RegistrationFee() {
  return <>{formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd", usePriceAudience())}</>;
}

export function FirstMonthTotal({ plan }: { plan: PlanId }) {
  const total = PLAN_PRICE_CENTS.usd[plan] + US_REGISTRATION_FEE_CENTS.usd;
  return <>{formatMoney(total, "usd", usePriceAudience())}</>;
}
