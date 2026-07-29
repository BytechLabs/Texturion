-- [#409] Voicemail transcript search — assertion suite for
-- supabase/migrations/20260730002100_search_voicemail_transcripts.sql.
--
-- We pay Workers AI per audio-minute to write these words down. The point of
-- transcription is to make a voicemail USABLE, and the one thing text is
-- uniquely good for is finding it again later.
--
-- The assertion that matters most is the access one. A transcript is customer
-- speech — at least as sensitive as a message — so an arm that forgot the #106
-- deny list would be a way to read around it. That is the trap #368 names: a
-- rule enforced by N independent implementations, where the newest one
-- forgets.
--
-- One transaction, rolled back. Fixtures use a 'ce' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ce000000-0000-4000-8000-00000000000a'::uuid, 'vmsearch@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ce000000-0000-4000-8000-0000000000c1'::uuid, 'Voicemail Co',
   'ce000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- Two numbers: one the member may read, one hidden from them.
insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('ce000000-0000-4000-8000-0000000000b1'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'ce-key-1', 'US',
   '+14155550501'),
  ('ce000000-0000-4000-8000-0000000000b2'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'ce-key-2', 'US',
   '+14155550502');

insert into public.calls
  (id, company_id, phone_number_id, call_session_id, caller_e164, outcome,
   voicemail_transcript, started_at)
values
  -- Readable: the words somebody will go looking for weeks later.
  ('ce000000-0000-4000-8000-0000000000f1'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid,
   'ce000000-0000-4000-8000-0000000000b1'::uuid,
   'ce-session-1', '+16135551111', 'voicemail',
   'Hi, the boiler on Elm Street is making a banging noise again.', now()),
  -- On the HIDDEN number. Same words, must never come back.
  ('ce000000-0000-4000-8000-0000000000f2'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid,
   'ce000000-0000-4000-8000-0000000000b2'::uuid,
   'ce-session-2', '+16135552222', 'voicemail',
   'The boiler on Elm Street needs a service.', now()),
  -- No transcript: over the cap, turned off, or the model failed. The row is
  -- real and simply has no words to match.
  ('ce000000-0000-4000-8000-0000000000f3'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid,
   'ce000000-0000-4000-8000-0000000000b1'::uuid,
   'ce-session-3', '+16135553333', 'voicemail', null, now());

do $$
declare
  v_hits jsonb;
  v_row  jsonb;
begin
  -- ==========================================================================
  -- THE WORDS ARE FINDABLE.
  -- ==========================================================================
  select (public.api_search_v2(
            'ce000000-0000-4000-8000-0000000000c1'::uuid,
            'boiler Elm', 5, 5, 5, 5, 5, null, null, null, 5
          ) -> 'voicemails') into v_hits;
  if jsonb_array_length(coalesce(v_hits, '[]'::jsonb)) <> 2 then
    raise exception 'both readable-and-hidden transcripts should match with no deny list: %', v_hits;
  end if;

  -- ==========================================================================
  -- THE DENY LIST IS ENFORCED. The single most important assertion here.
  -- ==========================================================================
  select (public.api_search_v2(
            'ce000000-0000-4000-8000-0000000000c1'::uuid,
            'boiler Elm', 5, 5, 5, 5, 5, null, null,
            array['ce000000-0000-4000-8000-0000000000b2'::uuid], 5
          ) -> 'voicemails') into v_hits;
  if jsonb_array_length(coalesce(v_hits, '[]'::jsonb)) <> 1 then
    raise exception 'a hidden number''s voicemail must not be searchable: %', v_hits;
  end if;
  v_row := v_hits -> 0;
  if (v_row ->> 'call_session_id') <> 'ce-session-1' then
    raise exception 'the wrong call came back: %', v_row;
  end if;

  -- ==========================================================================
  -- THE RESULT CAN LAND SOMEWHERE (#336).
  --
  -- A hit carries the session id, which is the permalink's key. Without it the
  -- best a result could do is drop somebody on the calls list to scroll, which
  -- is most of the way back to the problem this arm exists to solve.
  -- ==========================================================================
  if (v_row ->> 'call_session_id') is null then
    raise exception 'a voicemail hit must carry its address';
  end if;
  if (v_row ->> 'snippet') is null then
    raise exception 'a voicemail hit must carry the words it matched on';
  end if;

  -- ==========================================================================
  -- A ZERO LIMIT MEANS NO ARM. Cursor pages ride without the palette arms, and
  -- a limit that leaked results onto page two would double-count them.
  -- ==========================================================================
  select (public.api_search_v2(
            'ce000000-0000-4000-8000-0000000000c1'::uuid,
            'boiler Elm', 5, 5, 5, 5, 5, null, null, null, 0
          ) -> 'voicemails') into v_hits;
  if jsonb_array_length(coalesce(v_hits, '[]'::jsonb)) <> 0 then
    raise exception 'a zero limit must return nothing: %', v_hits;
  end if;

  -- ==========================================================================
  -- A CALL WITH NO WORDS IS NOT A RESULT.
  --
  -- Per #401 transcripts are capped, so past the cap a voicemail is stored
  -- without words. Search therefore has holes — but a null transcript must not
  -- match, rather than matching everything.
  -- ==========================================================================
  select (public.api_search_v2(
            'ce000000-0000-4000-8000-0000000000c1'::uuid,
            'anything at all', 5, 5, 5, 5, 5, null, null, null, 5
          ) -> 'voicemails') into v_hits;
  if jsonb_array_length(coalesce(v_hits, '[]'::jsonb)) <> 0 then
    raise exception 'an untranscribed call must not match: %', v_hits;
  end if;

  raise notice 'voicemail search (#409): all assertions passed';
end $$;

rollback;
