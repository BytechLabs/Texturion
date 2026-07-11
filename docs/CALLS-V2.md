# Calls v2 (D43, #135) — the browser is the phone

Founder directives (2026-07-11): voicemail; Telnyx inbound screening with a
per-workspace toggle and scam labels in the UI; **no cell forwarding
whatsoever — delete all of it**; caller ID both directions with a
workspace-chosen outbound name; full live-call handling (in-call notes,
hold, member-to-member transfer, call waiting). Builds on the D41 WebRTC
research; supersedes the D38 cell-bridge. Every Telnyx fact below was
verified against the live OpenAPI spec + docs on 2026-07-11 (research runs
wf_34e04fd4-60b, wf_4bc8f4b5-515, wf_e03fec8c-7f2 in the session transcript).

## The product

**Inbound:** a call to the business number hits our Call Control webhook.
Screening verdict (below) → either straight to voicemail (flagged + screening
on) or we answer and simultaneous-ring every ONLINE member's browser (one
Dial per member to their `sip:gencredXXX@sip.telnyx.com` credential URI with
`link_to` + `bridge_on_answer`; first answer wins, losing legs cancelled).
Nobody online / nobody answers (≈25s) → voicemail: greeting (workspace-set
text via TTS, cached as media) → beep → record (mp3, max 120s, trim
silence) → `call.recording.saved` → copy to our storage (Telnyx presigned
URLs live 10 min; their custom-storage doesn't support R2, so we
fetch-and-copy, then DELETE the Telnyx copy — 1-year retention is theirs,
not ours) → optional transcription → the voicemail lands in /calls + the
thread with a player, and the missed-call text-back still fires (it's
texting, not forwarding).

**Outbound:** the Call button places the call IN the browser (mic
permission, @telnyx/webrtc, login via 24h JWTs minted server-side per
member) from the business number. The D38 cell bridge, `call_cell_e164`,
and the D40 cell verification are DELETED — the browser replaced the cell
as the endpoint. (`forward_to_cell` and the ForwardCard die with them.)

**Caller ID:** outbound — per-number CNAM listing (`cnam_listing_details`,
≤15 alphanumeric chars, free, 12–72h US propagation; Canada rides SIP
headers), set from settings ("What customers see: BYTECH LABS"). Inbound —
per-number CNAM dip (`caller_id_name_enabled`, $0.40/number/month flat,
unlimited dips) so ringing UI, /calls, and threads show who's calling;
known contacts always win over the dip name.

**Screening:** per-workspace toggle mapped to per-number
`inbound_call_screening`: `flag_calls` (default ON — calls still ring,
flagged ones show "Likely spam" and can be set to divert to voicemail) or
`disabled`. The verdict comes free on `call.initiated`
(`call_screening_result`, `shaken_stir_attestation` A/B/C/Invalid); we
store it per call and label honestly ("Likely spam — flagged by carrier
reputation", "Failed verification"). `reject_calls` mode is deliberately
NOT exposed v1 (false-positive risk with zero visibility).

**The line model (founder-set, binding):**
- **One live call per phone NUMBER.** A number is a single line, like a real
  phone line. A held call still OCCUPIES its number. A second inbound call
  to an occupied number goes STRAIGHT to voicemail (logged "Line busy →
  voicemail"); outbound on an occupied number is refused with an honest
  error. Capacity = numbers (Starter 1 line, Pro 2) — a deliberate,
  simple truth, not a Telnyx limit.
- **No conferencing, ever.** Every construct is a two-party bridge or a
  parked leg: hold = unbridge with `park_after_unbridge: self` + a hold-audio
  playback loop on the parked customer leg; resume = re-bridge. Announce
  transfer = the consult happens as its OWN two-party call between the two
  members (the customer stays parked on their number's single call), then
  `bridge` steals the customer leg over to the new member. Telnyx conference
  objects are never created.

**Live call handling (the A→B→C scenario, with the line model):**
- Number A's inbound call is answered by member B; B's in-call surface = the
  call bar + the customer's conversation thread; notes typed during the call
  are ordinary thread notes (timestamped, visible to the next member on
  transfer).
- B transfers to C. C is live on a DIFFERENT call that came in on number B.
  C holds that call (number B stays occupied by it), answers the transfer —
  number A's single call moves B→C. A transfer always moves the SAME call on
  the SAME number, so it never needs a second line.
- Transfer picker shows live presence (Available / On a call / Offline from
  our own leg-state tracking + app heartbeat — Telnyx has no
  register/unregister webhooks). Blind = `transfer` on the customer leg with
  `target_leg_client_state` correlation; decline/timeout
  (`call_rejected`/`user_busy`/`timeout` on the target leg) auto-recovers:
  customer parks and snaps back to the sender or diverts to voicemail.
- Call waiting is per MEMBER (a member can hold one call and answer another,
  as in the scenario — the two calls live on different numbers); one ACTIVE
  call per member at a time, flip freely. Reject → bounces to the sender.
- The whole journey writes system lines on the thread ("Answered by B ·
  transferred to C · 4m 12s"); billing stays exact because only the customer
  leg's talk time meters (one pool, D36) — held time included, honestly, as
  the customer remains connected.

## Honest tradeoffs (stated, accepted)
- No forwarding = a closed browser can't ring. Push notifications
  (Android/desktop; iOS PWA unreliable) + voicemail + text-back are the
  nets. This is the "browser is the phone" bet, per founder.
- Voicemail recording/transcription add per-minute Telnyx costs (recording
  ~free storage, transcription per-minute) — bounded per call (120s max)
  and counted into the same cost telemetry.
- CNAM dip is $0.40/number/month — flat, predictable, cheap vs plan price.

## Build phases
1. **Foundation:** credential connection + per-member credentials + token
   endpoint; browser softphone (call bar, outbound calls); delete
   forwarding/bridge/cell-verification (API, web, settings, docs, marketing).
2. **Inbound:** simultaneous browser ring + presence heartbeat; voicemail
   pipeline (greeting settings, record, store, play, transcribe); screening
   toggle + labels; missed-call text-back unchanged.
3. **Live-call:** hold, transfer (blind + announce), call waiting, in-call
   thread panel, journey system lines.
4. Each phase: tests, adversarial review, dev-shots both themes, deploy.
