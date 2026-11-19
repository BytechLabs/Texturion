update public.public_links as link
   set expires_at = request.expires_at + interval '720 hours'
  from public.payment_requests as request
 where link.id = request.public_link_id
   and link.company_id = request.company_id
   and link.subject_id = request.id
   and link.subject_type = 'payment_request'
   and link.purpose = 'payment'
   and link.revoked_at is null
   and link.expires_at > now()
   and link.expires_at < request.expires_at + interval '720 hours';
