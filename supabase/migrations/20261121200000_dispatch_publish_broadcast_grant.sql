-- Dispatch publication calls the broadcast helper in the same transaction.
grant execute on function public.broadcast_number_scoped(jsonb, text, uuid, uuid) to service_role;
