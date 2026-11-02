/**
 * [#251] The workspace-volume fixture, written once.
 *
 * `scripts/ops/query-load.mjs` times the hot queries inside Postgres and the
 * rig driver (`apps/api/scripts/rig-capacity.ts`) drives the same workspace
 * through the API. Both need the same rows, so the SQL lives here and neither
 * script carries its own copy that could drift into measuring a different
 * workspace.
 *
 * This module only builds SQL strings. It opens no connection, so it cannot be
 * pointed at anything: the caller runs the text through `docker exec` into the
 * local `supabase_db_Loonext` container, which is how both callers are
 * local-only by construction.
 *
 * The caller owns the auth user. `query-load.mjs` inserts a bare `auth.users`
 * row; the rig driver creates a real GoTrue user so it can sign in. The
 * fixture only needs the id to exist.
 */

/**
 * Delete a fixture workspace, children first: nothing cascades from companies
 * by design (#284 found the same thing for calls).
 */
export function volumeCleanupSql({ company }) {
  return `
    delete from public.messages where company_id = '${company}';
    delete from public.conversations where company_id = '${company}';
    delete from public.contacts where company_id = '${company}';
    delete from public.phone_numbers where company_id = '${company}';
    delete from public.company_members where company_id = '${company}';
    delete from public.companies where id = '${company}';
  `;
}

/**
 * One workspace with `conversations` conversations and `messages` messages.
 *
 * Generated in bulk with generate_series rather than row by row: seeding
 * 200k messages one INSERT at a time takes longer than the measurement it
 * exists to support, and nothing about the fixture needs per-row logic.
 */
export function volumeFixtureSql({
  company,
  owner,
  number,
  e164,
  areaCode,
  country,
  conversations,
  messages,
  provisioningKey,
  companyName,
  active = false,
}) {
  const subscription = active
    ? ", subscription_status, plan, current_period_start, current_period_end"
    : "";
  const subscriptionValues = active
    ? ", 'active', 'starter', now(), now() + interval '30 days'"
    : "";
  return `
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at${subscription})
  values ('${company}', '${companyName}', '${owner}', '${country}', '${areaCode}', now()${subscriptionValues});

  insert into public.company_members (company_id, user_id, role)
  values ('${company}', '${owner}', 'owner');

  insert into public.phone_numbers
    (id, company_id, number_e164, status, provisioning_key, country)
  values ('${number}', '${company}', '${e164}', 'active', '${provisioningKey}', '${country}');

  insert into public.contacts (company_id, phone_e164, name)
  select '${company}', '+1415' || lpad(g::text, 7, '0'), 'Customer ' || g
    from generate_series(1, ${conversations}) g;

  -- A realistic status mix, including closed, because the inbox's default
  -- filter EXCLUDES closed and an all-open fixture would measure the wrong
  -- selectivity. closed_at is set with it: conversations_closed_consistency
  -- requires the two to agree, which is the schema refusing exactly the kind
  -- of incoherent fixture that produces a flattering benchmark.
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, closed_at, last_message_at)
  select
    '${company}', picked.id, '${number}', picked.status,
    case when picked.status = 'closed' then now() - (picked.n || ' minutes')::interval end,
    now() - (picked.n || ' minutes')::interval
  from (
    select
      ct.id,
      row_number() over (order by ct.id) as n,
      (array['new','open','waiting','closed'])[
        1 + (row_number() over (order by ct.id) % 4)
      ]::public.conversation_status as status
    from public.contacts ct
    where ct.company_id = '${company}'
  ) picked;

  -- Messages spread across the conversations, so no single thread is
  -- pathological and the per-conversation index is exercised realistically.
  insert into public.messages
    (company_id, conversation_id, direction, status, body, created_at,
     sent_by_user_id)
  with numbered as (
    select id, row_number() over (order by id) as n
      from public.conversations
     where company_id = '${company}'
  )
  select
    '${company}', v.id,
    (case when g % 2 = 0 then 'inbound' else 'outbound' end)::public.message_direction,
    (case when g % 2 = 0 then 'received' else 'delivered' end)::public.message_status,
    'Load fixture message ' || g,
    now() - (g || ' seconds')::interval,
    (case when g % 2 = 0 then null else '${owner}' end)::uuid
  from generate_series(1, ${messages}) g
  -- JOINED ON A NUMBERED SET, not \`offset (g % n) limit 1\`. That first
  -- version was fine at 5k and never finished at 50k: OFFSET scans linearly,
  -- so every one of 200k messages walked an average of 25k conversation rows.
  -- The seeder for a volume benchmark must not itself be the thing that
  -- degrades with volume.
  join numbered v on v.n = 1 + (g % ${conversations});

  analyze public.conversations;
  analyze public.messages;
  analyze public.contacts;
`;
}
