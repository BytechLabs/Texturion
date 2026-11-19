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
  const { locale } = useCountry();
  return <>{formatMoney(PLAN_PRICE_CENTS.usd[plan], "usd", usePriceAudience(), locale)}</>;
}

export function ExtraNumberPrice({ plan }: { plan: PlanId }) {
  const audience = usePriceAudience();
  const { locale } = useCountry();
  return <>{formatMoney(EXTRA_NUMBER_MONTHLY_CENTS[plan], EXTRA_NUMBER_CURRENCY, audience, locale)}</>;
}

export function RegistrationFee() {
  const { locale } = useCountry();
  return <>{formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd", usePriceAudience(), locale)}</>;
}

export function FirstMonthTotal({ plan }: { plan: PlanId }) {
  const total = PLAN_PRICE_CENTS.usd[plan] + US_REGISTRATION_FEE_CENTS.usd;
  const { locale } = useCountry();
  return <>{formatMoney(total, "usd", usePriceAudience(), locale)}</>;
}
