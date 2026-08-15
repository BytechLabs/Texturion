-- ===========================================================================
-- #243 — Zapier, Make, and anything else built on REST hooks.
--
-- #243 names them as the first consumer, and for a reason that is about the
-- customer rather than the vendor: *"that is how a non-technical contractor's
-- 'integration' actually gets built."* Nobody in a truck writes a webhook
-- receiver. They connect two things in a browser, and the tool creates the
-- subscription on their behalf.
--
-- Which is the gap this closes. A REST-hook platform needs to CREATE a webhook
-- when somebody turns a Zap on and DELETE it when they turn it off, using the
-- credential they pasted in. Until now webhook endpoints could only be managed
-- through the first-party settings screen, so every such integration was
-- either impossible or required the customer to hand over their login.
--
-- ## Why the key is recorded, not just the person
--
-- A key acts as its creator, so scoping "which endpoints may this key delete"
-- to that person would let a Zap tear down a webhook the same person had set
-- up by hand in Settings — or one belonging to a different Zap. Neither is
-- something the customer asked for, and both are invisible until the messages
-- stop arriving.
--
-- So an endpoint remembers which key made it, and a key may only remove its
-- own. Endpoints created in the UI have a NULL here and are unreachable from
-- the public API entirely, which is the correct default: the screen is the
-- owner's, and a connector has no business touching what they set up there.
--
-- `on delete set null` rather than cascade: revoking a key must not silently
-- delete a live webhook the workspace is relying on. What should happen is
-- exactly what does — the subscription keeps working, and the owner can see it
-- and decide.
-- ===========================================================================

alter table public.webhook_endpoints
  add column created_by_api_key_id uuid
    references public.api_keys(id) on delete set null;

-- The public DELETE resolves on (id, company_id, created_by_api_key_id), and
-- the list a connector may see is keyed the same way.
create index webhook_endpoints_api_key_idx
  on public.webhook_endpoints (created_by_api_key_id)
  where created_by_api_key_id is not null;

comment on column public.webhook_endpoints.created_by_api_key_id is
  'The API key that created this endpoint, or NULL when a person did it in '
  'Settings. A key may only remove its own; a NULL is unreachable from the '
  'public API by design (#243).';
