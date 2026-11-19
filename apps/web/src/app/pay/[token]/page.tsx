import type { Metadata } from "next";

import type { PaymentRequestState } from "@loonext/shared";

import { PaymentPage } from "@/components/public/payment-page";
import { publicPageLoader, publicPageMetadata } from "@/lib/public-page";

interface Props {
  params: Promise<{ token: string }>;
}

const loadPayment = publicPageLoader<{
  locale?: string;
  business_name: string;
  amount: string;
  description: string;
  state: PaymentRequestState;
  pay_url: string | null;
}>("pay");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const payment = await loadPayment((await params).token);
  return publicPageMetadata(payment?.locale, "payments.customerPageTitle");
}

export default async function Page({ params }: Props) {
  const payment = await loadPayment((await params).token);
  if (!payment) return <PaymentPage notAvailable />;
  return (
    <PaymentPage
      locale={payment.locale}
      businessName={payment.business_name}
      amount={payment.amount}
      description={payment.description}
      state={payment.state}
      payUrl={payment.pay_url}
    />
  );
}
