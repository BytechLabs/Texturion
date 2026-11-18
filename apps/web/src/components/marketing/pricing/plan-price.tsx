"use client";

import { formatMoney, PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from '@loonext/shared';
import type { BillingCurrency } from '@loonext/shared';

import { useCountry } from "@/components/marketing/country/country-context";
import type { PlanId } from "@/lib/api/types";

export function usePriceAudience(): BillingCurrency {
  return useCountry().country === "ca" ? "cad" : "usd";
}

export function PlanPrice({ plan }: { plan: PlanId }) {
  return <>{formatMoney(PLAN_PRICE_CENTS.usd[plan], "usd", usePriceAudience())}</>;
}

export function RegistrationFee() {
  return <>{formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd", usePriceAudience())}</>;
}

export function FirstMonthTotal({ plan }: { plan: PlanId }) {
  const total = PLAN_PRICE_CENTS.usd[plan] + US_REGISTRATION_FEE_CENTS.usd;
  return <>{formatMoney(total, "usd", usePriceAudience())}</>;
}
