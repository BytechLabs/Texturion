-- Index conversations by (company_id, contact_id).
--
-- Several hot paths filter conversations by company + contact with no
-- phone_number_id and no status: the contacts list activity lookup
-- (contacts.ts, `.eq(company_id).in(contact_id, …)`), the CSV export tag join,
-- and the import latest-conversation resolver. Neither existing index serves
-- them: `conversations_open_uq (company_id, phone_number_id, contact_id)` puts
-- contact_id third (and is partial on closed_at is null), and
-- `conversations_inbox_idx (company_id, status, last_message_at)` never
-- mentions contact_id — so those queries fall back to a company-wide scan that
-- grows with every conversation. A dedicated composite index turns each into an
-- index range scan.
create index if not exists conversations_contact_idx
  on public.conversations (company_id, contact_id);
