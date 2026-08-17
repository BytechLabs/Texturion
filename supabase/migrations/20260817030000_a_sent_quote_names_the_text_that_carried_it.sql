-- #287 — the message that actually carried the quote to the customer.
--
-- ## Why this column exists
--
-- Sending a quote marked the row `sent` and returned two link tokens for "whoever
-- composes the text". Nobody composed it. All three clients called send, got the
-- tokens, and dropped them — so the crew saw "Waiting", the customer received
-- NOTHING, and the outstanding queue filled up with prices that had never left
-- the building.
--
-- The send composes and dispatches the text itself now, through the same
-- pipeline the payment ask uses — gates included, which matters more than the
-- text does: `runPreSendGates` is where the opt-out check lives, and a quote is
-- an outbound message to a customer like any other.
--
-- This column is the receipt. `payment_requests.message_id` exists for the same
-- reason and answers the same question: WHICH text carried this, so the thing
-- the customer received can be found from the row rather than guessed at from a
-- timestamp. That is also the answer to the question #287 opens with — "nobody
-- can answer what did we quote" — because the message is the artefact, not the
-- row.
--
-- Nullable, and it always will be: rows written before today were marked sent
-- without a text ever existing, and inventing a reference for them would be a
-- worse record than an honest null.

alter table public.quotes
  add column if not exists message_id uuid references public.messages(id) on delete set null;

comment on column public.quotes.message_id is
  'The outbound message that carried this quote to the customer (#287). Null '
  'for rows sent before 2026-08-17, when the send returned link tokens and no '
  'client ever composed the text.';

-- Reading "the quote for this message" happens on the thread's own path, so it
-- gets an index for the same reason payment_requests does.
create index if not exists quotes_message_id_idx
  on public.quotes (message_id)
  where message_id is not null;
