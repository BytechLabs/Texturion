/**
 * Dev workspace seed for the LOCAL Supabase stack (#114/#101 unblock).
 *
 * Creates two password-login users via the GoTrue admin API and seeds a
 * realistic company (numbers, contacts, conversations across every status,
 * messages incl. internal notes + a failed send, tasks, tags, events, an
 * opt-out) so the authenticated app can be exercised in a dev preview browser.
 *
 * Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING; reruns are no-ops.
 * Local-only by construction — it talks to `supabase status`'s API_URL and
 * the supabase_db_Loonext docker container; it can never touch production.
 *
 * Usage:  node scripts/dev-seed.mjs
 * Login:  dev@loonext.local / loonext-dev-1234   (owner, "Dana Brightside")
 *         sam@loonext.local / loonext-dev-1234   (member, "Sam Rivera")
 */
import { execFileSync } from "node:child_process";

const FALLBACK_SUPABASE_URL = "http://127.0.0.1:54321";
// The supabase CLI's published default local secret key (not a real secret).
const FALLBACK_SECRET_KEY = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
const DB_CONTAINER = "supabase_db_Loonext";

const PASSWORD = "loonext-dev-1234";
const USERS = [
  { email: "dev@loonext.local", displayName: "Dana Brightside" },
  { email: "sam@loonext.local", displayName: "Sam Rivera" },
];

// Fixed ids so reruns hit ON CONFLICT instead of duplicating.
const COMPANY = "11111111-1111-4111-8111-111111111111";
const NUMBER = "22222222-2222-4222-8222-222222222222";
const C = (n) => `a0000000-0000-4000-8000-00000000000${n}`; // contacts
const V = (n) => `b0000000-0000-4000-8000-00000000000${n}`; // conversations
const M = (n) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`; // messages
const T = (n) => `d0000000-0000-4000-8000-00000000000${n}`; // tags
const K = (n) => `e0000000-0000-4000-8000-00000000000${n}`; // tasks
const E = (n) => `f0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`; // events

function resolveSupabase() {
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    });
    const parsed = JSON.parse(out);
    const apiUrl = parsed.API_URL ?? parsed.api_url;
    const secretKey =
      parsed.SECRET_KEY ?? parsed.secret_key ?? parsed.SERVICE_ROLE_KEY;
    if (apiUrl && secretKey) return { apiUrl, secretKey };
  } catch {
    // fall through to the CLI-default literals
  }
  return { apiUrl: FALLBACK_SUPABASE_URL, secretKey: FALLBACK_SECRET_KEY };
}

function sql(text) {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    { input: text, encoding: "utf8" },
  );
}

async function ensureUser(apiUrl, secretKey, { email, displayName }) {
  const existing = sql(
    `select id from auth.users where email = '${email}';`,
  ).trim();
  if (existing) return existing;

  const res = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`admin create ${email} failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.id;
}

const { apiUrl, secretKey } = resolveSupabase();
const [dana, sam] = [
  await ensureUser(apiUrl, secretKey, USERS[0]),
  await ensureUser(apiUrl, secretKey, USERS[1]),
];
console.log(`users: dana=${dana} sam=${sam}`);

sql(`
begin;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   plan, subscription_status, us_texting_enabled, timezone,
   current_period_start, current_period_end)
values
  ('${COMPANY}', 'Brightside Plumbing', '${dana}', 'US', '415', now() - interval '30 days',
   'pro', 'active', true, 'America/Los_Angeles',
   date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')
on conflict (id) do nothing;

insert into public.company_members (company_id, user_id, role) values
  ('${COMPANY}', '${dana}', 'owner'),
  ('${COMPANY}', '${sam}', 'member')
on conflict do nothing;

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, requested_area_code, country,
   number_e164, telnyx_phone_number_id, source)
values
  ('${NUMBER}', '${COMPANY}', 'active', 'dev-seed-primary', '415', 'US',
   '+14155550100', 'dev-tpn-1', 'provisioned')
on conflict (id) do nothing;

-- SPEC §6 starter tags (the API seeds these at company creation; the company
-- here is inserted directly, so the seed mirrors that).
insert into public.tags (id, company_id, name, color) values
  ('${T(1)}', '${COMPANY}', 'Quote sent', '#0E7490'),
  ('${T(2)}', '${COMPANY}', 'Scheduled', '#15803D'),
  ('${T(3)}', '${COMPANY}', 'Won', '#7C3AED'),
  ('${T(4)}', '${COMPANY}', 'Lost', '#B91C1C')
on conflict (id) do nothing;

insert into public.contacts
  (id, company_id, phone_e164, name, address, notes,
   consent_source, consent_at, consent_attested_by)
values
  ('${C(1)}', '${COMPANY}', '+14155550111', 'Maria Alvarez',
   '1214 Cypress Ave, San Rafael, CA',
   'Prefers morning appointments. Gate code 4482. Two labs in the yard - friendly.',
   'attested', now() - interval '3 days', '${sam}'),
  ('${C(2)}', '${COMPANY}', '+14155550122', 'Jake Thompson', null, null,
   'inbound_sms', now() - interval '1 day', null),
  ('${C(3)}', '${COMPANY}', '+14155550133', null, null, null,
   'inbound_sms', now() - interval '20 minutes', null),
  ('${C(4)}', '${COMPANY}', '+14155550144', 'Priya Natarajan',
   '88 Marine View Dr, Mill Valley, CA', 'Repipe estimate sent 6/30. Decision by Friday.',
   'attested', now() - interval '8 days', '${dana}'),
  ('${C(5)}', '${COMPANY}', '+14155550155', 'Leo Martin', null, null,
   'inbound_sms', now() - interval '5 days', null)
on conflict (id) do nothing;

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, assigned_user_id,
   last_message_at, pinned_at, pinned_by_user_id, closed_at)
values
  ('${V(1)}', '${COMPANY}', '${C(1)}', '${NUMBER}', 'open', '${dana}',
   now() - interval '2 hours', null, null, null),
  ('${V(2)}', '${COMPANY}', '${C(1)}', '${NUMBER}', 'closed', null,
   now() - interval '3 months', null, null, now() - interval '3 months'),
  ('${V(3)}', '${COMPANY}', '${C(2)}', '${NUMBER}', 'waiting', null,
   now() - interval '20 hours', null, null, null),
  ('${V(4)}', '${COMPANY}', '${C(3)}', '${NUMBER}', 'new', null,
   now() - interval '20 minutes', null, null, null),
  ('${V(5)}', '${COMPANY}', '${C(4)}', '${NUMBER}', 'open', '${sam}',
   now() - interval '22 hours', now() - interval '1 day', '${dana}', null),
  ('${V(6)}', '${COMPANY}', '${C(5)}', '${NUMBER}', 'closed', null,
   now() - interval '5 days', null, null, now() - interval '5 days')
on conflict (id) do nothing;

insert into public.messages
  (id, company_id, conversation_id, direction, body, status, segments,
   sent_by_user_id, error_code, error_detail, done_at, done_by_user_id, created_at)
values
  -- V1: Maria Alvarez - water heater (the showcase thread)
  ('${M(1)}', '${COMPANY}', '${V(1)}', 'inbound',
   'Hi, I got your number from the Hendersons next door. Our water heater is leaking from the bottom - can someone take a look this week?',
   'received', null, null, null, null, null, null, now() - interval '3 days'),
  ('${M(2)}', '${COMPANY}', '${V(1)}', 'outbound',
   'Hi Maria, Dana from Brightside Plumbing. A leak from the base usually means the tank is going. I can have Sam out Thursday between 9 and 11 - does that work?',
   'delivered', 1, '${dana}', null, null, null, null, now() - interval '3 days' + interval '6 minutes'),
  ('${M(3)}', '${COMPANY}', '${V(1)}', 'inbound',
   'Thursday 9-11 works great. It''s the unit in the garage.',
   'received', null, null, null, null, null, null, now() - interval '3 days' + interval '11 minutes'),
  ('${M(4)}', '${COMPANY}', '${V(1)}', 'note',
   'Quoted $1,850 for a 50-gal Rheem swap incl. haul-away. Pressure regulator reads 90 psi at the hose bib - flag it while we''re there.',
   null, null, '${sam}', null, null, null, null, now() - interval '2 days'),
  ('${M(5)}', '${COMPANY}', '${V(1)}', 'note',
   'Confirm the supply house has the expansion tank in stock before Thursday.',
   null, null, '${dana}', null, null, now() - interval '1 day', '${sam}', now() - interval '2 days' + interval '5 minutes'),
  ('${M(6)}', '${COMPANY}', '${V(1)}', 'outbound',
   'Quick update - the new unit is reserved. See you Thursday at 9!',
   'delivered', 1, '${dana}', null, null, null, null, now() - interval '1 day'),
  ('${M(7)}', '${COMPANY}', '${V(1)}', 'inbound',
   'Sounds good. One more thing - the upstairs bathroom faucet has really low pressure, can Sam look at that too?',
   'received', null, null, null, null, null, null, now() - interval '2 hours'),

  -- V2: Maria, an older closed thread (prior-conversations group)
  ('${M(8)}', '${COMPANY}', '${V(2)}', 'inbound',
   'Do you handle garbage disposal replacements?',
   'received', null, null, null, null, null, null, now() - interval '3 months' - interval '30 minutes'),
  ('${M(9)}', '${COMPANY}', '${V(2)}', 'outbound',
   'We do! Installed and hauled away for $310. Want me to set a time?',
   'delivered', 1, '${dana}', null, null, null, null, now() - interval '3 months'),

  -- V3: Jake Thompson - mainline clog, one failed send then a retry
  ('${M(10)}', '${COMPANY}', '${V(3)}', 'inbound',
   'How much to clear a main line clog? Rented a snake, didn''t work.',
   'received', null, null, null, null, null, null, now() - interval '21 hours'),
  ('${M(11)}', '${COMPANY}', '${V(3)}', 'outbound',
   '$240 flat for a mainline hydro-jet if the cleanout is accessible. Want me to book you in?',
   'failed', 1, '${dana}', '40008', 'Carrier rejected the message', null, null, now() - interval '20 hours' - interval '10 minutes'),
  ('${M(12)}', '${COMPANY}', '${V(3)}', 'outbound',
   '$240 flat for a mainline hydro-jet if the cleanout is accessible. Want me to book you in?',
   'delivered', 1, '${dana}', null, null, null, null, now() - interval '20 hours'),

  -- V4: unnamed prospect (renders as a bare number; unread)
  ('${M(13)}', '${COMPANY}', '${V(4)}', 'inbound',
   'Hey do you guys do tankless installs? Ballpark for a 2 bath house?',
   'received', null, null, null, null, null, null, now() - interval '20 minutes'),

  -- V5: Priya Natarajan - repipe follow-up (pinned, assigned to Sam)
  ('${M(14)}', '${COMPANY}', '${V(5)}', 'outbound',
   'Hi Priya, Sam from Brightside - following up on the repipe estimate. Any questions I can answer?',
   'delivered', 1, '${sam}', null, null, null, null, now() - interval '2 days'),
  ('${M(15)}', '${COMPANY}', '${V(5)}', 'inbound',
   'Thanks Sam. We''re comparing two quotes and will decide by Friday.',
   'received', null, null, null, null, null, null, now() - interval '22 hours'),

  -- V6: Leo Martin - STOP
  ('${M(16)}', '${COMPANY}', '${V(6)}', 'inbound',
   'Please stop texting me.',
   'received', null, null, null, null, null, null, now() - interval '5 days')
on conflict (id) do nothing;

insert into public.opt_outs (company_id, phone_e164, source)
select '${COMPANY}', '+14155550155', 'stop_keyword'
where not exists (
  select 1 from public.opt_outs
  where company_id = '${COMPANY}' and phone_e164 = '+14155550155'
);

insert into public.conversation_tags (conversation_id, tag_id) values
  ('${V(1)}', '${T(2)}'),
  ('${V(5)}', '${T(1)}')
on conflict do nothing;

insert into public.tasks
  (id, company_id, message_id, conversation_id, title, description,
   assigned_user_id, due_at, created_by_user_id)
values
  ('${K(1)}', '${COMPANY}', '${M(4)}', '${V(1)}',
   'Order 50-gal Rheem + expansion tank',
   'Supply house opens at 7. Delivery to the Alvarez job Thursday 8:30 AM.',
   '${sam}', now() + interval '1 day', '${dana}'),
  ('${K(2)}', '${COMPANY}', '${M(5)}', '${V(1)}',
   'Confirm expansion tank stock', '', '${sam}', null, '${dana}')
on conflict (id) do nothing;

insert into public.conversation_events
  (id, company_id, conversation_id, actor_user_id, type, payload, created_at)
values
  ('${E(1)}', '${COMPANY}', '${V(1)}', '${dana}', 'assigned',
   jsonb_build_object('to', '${dana}'), now() - interval '3 days' + interval '4 minutes'),
  ('${E(2)}', '${COMPANY}', '${V(1)}', '${dana}', 'tag_added',
   jsonb_build_object('name', 'Scheduled'), now() - interval '3 days' + interval '12 minutes'),
  ('${E(3)}', '${COMPANY}', '${V(1)}', '${sam}', 'consent_attested',
   '{}'::jsonb, now() - interval '3 days' + interval '2 minutes'),
  ('${E(4)}', '${COMPANY}', '${V(1)}', '${dana}', 'task_created',
   jsonb_build_object('task_id', '${K(1)}'), now() - interval '2 days' + interval '2 minutes'),
  ('${E(5)}', '${COMPANY}', '${V(1)}', '${sam}', 'message_done',
   jsonb_build_object('message_id', '${M(5)}'), now() - interval '1 day'),
  ('${E(6)}', '${COMPANY}', '${V(2)}', '${dana}', 'status_changed',
   jsonb_build_object('from', 'open', 'to', 'closed'), now() - interval '3 months'),
  ('${E(7)}', '${COMPANY}', '${V(5)}', '${sam}', 'tag_added',
   jsonb_build_object('name', 'Quote sent'), now() - interval '2 days' + interval '3 minutes'),
  ('${E(8)}', '${COMPANY}', '${V(6)}', null, 'opted_out',
   '{}'::jsonb, now() - interval '5 days'),
  ('${E(9)}', '${COMPANY}', '${V(6)}', null, 'status_changed',
   jsonb_build_object('from', 'open', 'to', 'closed'), now() - interval '5 days')
on conflict (id) do nothing;

-- Dana has read the older threads; V1's newest message and V4 stay unread.
insert into public.conversation_reads (conversation_id, user_id, last_read_at) values
  ('${V(1)}', '${dana}', now() - interval '12 hours'),
  ('${V(2)}', '${dana}', now() - interval '3 months'),
  ('${V(3)}', '${dana}', now() - interval '19 hours'),
  ('${V(5)}', '${dana}', now() - interval '21 hours'),
  ('${V(6)}', '${dana}', now() - interval '5 days')
on conflict do nothing;

commit;
`);

console.log("seeded: Brightside Plumbing (pro/active) with 6 conversations");
console.log(`log in at /login: ${USERS[0].email} / ${PASSWORD}`);
