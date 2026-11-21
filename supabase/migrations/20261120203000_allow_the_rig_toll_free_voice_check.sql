create or replace function public.rig_gate_outbound_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.rig_destination_refused(new.customer_e164)
     and not (
       coalesce(new.customer_e164 ~ '^\+18(00|33|44|55|66|77|88)[2-9][0-9]{6}$', false)
       and new.customer_e164 is not distinct from current_setting('loonext.rig_qa_toll_free_call', true)
     ) then
    raise exception 'rig_destination_refused: outbound call to a number outside loonext.rig_endpoints'
      using hint = 'Only the partition''s own numbers can be dialed from the rig.';
  end if;
  return new;
end $$;
