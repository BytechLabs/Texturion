-- #522 — `open_prepayment` tells the caller what the money was.
--
-- The prepaid year was USD-only until now: the Checkout Session was created
-- without a currency, so Stripe billed the price's base currency whatever the
-- workspace's `billing_currency` said. A Canadian workspace read "$290" — and
-- this product prints CAD as the bare "$", deliberately, because the reader is
-- Canadian — while US$290 left their card.
--
-- With the CAD option filed on the year prices, `prepayments.currency` finally
-- varies. The column has existed since 20260801070000 and has always been
-- written from the session; it was simply never published, because there was
-- nothing to distinguish.
--
-- WHY THIS IS NOT COSMETIC. The one consumer of `amount_cents` is the
-- cost-vs-revenue projection, which divides it across the months it bought and
-- compares the result against Telnyx, Cloudflare and Supabase costs — all
-- US-denominated. A CAD amount read as US cents overstates that tenant's
-- revenue by the whole exchange rate, and it does so for the one cohort whose
-- licensed line invoices at $0, which is precisely the cohort the underwater
-- alert exists to keep watching. So the currency has to travel with the amount:
-- `amortisedMonthlyUsdCents` converts, and it can only convert what it is told.

create or replace function public.open_prepayment(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'session_id', p.stripe_session_id,
           'plan', p.plan,
           'amount_cents', p.amount_cents,
           -- #522: the unit of `amount_cents`. Never inferred by the reader.
           'currency', p.currency,
           'months_granted', p.months_granted,
           'granted_at', p.granted_at,
           'granted_through', p.granted_through,
           'discount_id', p.stripe_discount_id)
    from public.prepayments p
   where p.company_id = p_company_id
     and p.granted_at is not null
     and p.revoked_at is null
     and p.granted_through > now()
   order by p.granted_through desc
   limit 1
$$;

revoke execute on function public.open_prepayment(uuid) from public, anon, authenticated;
grant execute on function public.open_prepayment(uuid) to service_role;
