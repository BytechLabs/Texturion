-- Keep each draft's existing retention deadline.
alter table public.messaging_registrations disable trigger set_updated_at;

update public.messaging_registrations
set data = data - 'ein'
where kind = 'brand' and sole_proprietor and data ? 'ein';

alter table public.messaging_registrations enable trigger set_updated_at;

alter table public.port_requests disable trigger set_updated_at;

update public.port_requests
set ssn_sin_last4 = null
where ssn_sin_last4 is not null;

alter table public.port_requests enable trigger set_updated_at;
