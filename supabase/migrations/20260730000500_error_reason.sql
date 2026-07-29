-- #241 — the failure reason, in our vocabulary rather than the vendor's.
--
-- `messages.error_code` holds a Telnyx code, and business logic branched on it
-- directly: `send.ts` compared against the literal '40300', and so did all
-- three client apps, each carrying its own copy of that constant to decide
-- whether to offer a retry button.
--
-- That is the vendor's vocabulary leaking to the edge of the product. Adding a
-- second carrier would have meant editing three mobile apps and shipping them
-- — and #339 established what that costs: a store release reaches people over
-- weeks, not hours, and some phones never update at all.
--
-- So the reason is classified ONCE, at the edge, and written here. The raw
-- code stays beside it: it is what support quotes to a carrier, and it is the
-- fallback a client uses for rows written before this column existed.

alter table public.messages
  add column if not exists error_reason text
    check (error_reason is null or error_reason in (
      'opt_out',          -- the customer texted STOP; only they can lift it
      'unreachable',      -- nothing on the other end can receive a text
      'content_blocked',  -- carriers judged the content
      'spam_blocked',     -- judged as spam specifically (#235 territory)
      'rate_limited',     -- too fast; the message is fine, the timing was not
      'expired',          -- it sat too long to still be worth sending
      'not_provisioned',  -- our own setup: registration, number, capability
      'unknown'           -- classified as unclassifiable, never guessed
    ));

comment on column public.messages.error_reason is
  '#241: why a send failed, in OUR taxonomy. Classified from the provider code '
  'at the edge so nothing downstream branches on a vendor value. NULL on rows '
  'written before this column — clients fall back to classifying error_code.';

-- Partial: only failed rows carry one, and reputation work (#235) reads them
-- by reason.
create index if not exists messages_error_reason_idx
  on public.messages (error_reason) where error_reason is not null;
