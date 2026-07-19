# Calls client v2 — the Android calling client on Android's Telecom framework (#171)

Founder mandate (verbatim, GitHub #171): *"I don't want patches, I want
architecture where this isn't even possible."*

This document is the binding design for the **Android calling-client
rearchitecture**. It is **overwhelmingly a client-side APK change**, but the
first review corrected the original "client-only, zero server change" framing
as false on two counts, both folded in here:

1. **One small, additive, backward-compatible server change is IN SCOPE**
   (B1/§3.2): the server must stamp the `call_session_id` as a **custom SIP
   header (`X-Loonext-Session`) on every member ring dial — the initial ring
   fan-out AND the ring-me re-dial** — so the client can correlate each
   incoming leg to its authoritative server session *deterministically*,
   never by a caller/time heuristic. This is a two-line addition to the two
   `POST /v2/calls` bodies (`inbound-ring.ts` today; the `CallSessionDO`
   T1d/T4 dials under CALLS-V3). It is header-additive, changes no existing
   behavior, and an older server that omits it degrades to the client's
   by-leg fallback (§3.2) — so it ships independently, with no coordinated
   migration.
2. **OS-call teardown depends on the client having registered the
   `caps:['call_end']` push capability** (CALLS-V3 §9.2 / I2): the server's
   `call_end` revocation push is what disconnects the Telecom handle when the
   session ends server-side. The v3 Android client already writes that cap at
   token registration (CALLS-V3 §10.2) — so it is a dependency to *state*,
   not new work, but the "no server dependency" claim was wrong.

Everything else — presentation, audio, the six competing surfaces, the
hand-rolled `AudioManager` focus/mode code, the half-built self-managed
`ConnectionService` — is a client rewrite. This supersedes the client half of
#155/#167/#168/#171.

The property the founder wants — **answer-from-anywhere (lock screen /
notification shade / Bluetooth / Android Auto) with TWO-WAY AUDIO and NO forced
unlock** — is not something we can keep hand-rolling correctly across OEMs and
API levels. It is a property the **platform already guarantees** for any app
that registers its calls with the Telecom framework. This design makes the OS
the single owner of the ringing session, the audio mode, the microphone, and
the audio route. The app becomes a thin bridge between two engines it does not
own: **Android Telecom** (presentation + audio) and **Telnyx WebRTC** (media).

Phase-1 evidence: the four-agent forensic audit of the split-brain client
(archived on #171). Every deletion below cites the defect it removes.

---

## 1. Why the current client cannot be patched

The audit found **SIX competing presentation surfaces for one ringing session,
with no single owner**:

1. `IncomingCallActivity` — the dedicated full-screen ring, over-keyguard via
   `showWhenLocked`/`turnScreenOn`, self-declaring ownership through two static
   `@Volatile` flags (`presenting`/`presentingSession`).
2. `CallNotifier` `CallStyle.forIncomingCall` — posted from **two** independent
   triggers (push-immediate `showIncomingFromPush` and INVITE-driven
   `showIncoming`), deduped only by tag equality on `call:<session>`.
3. In-app `IncomingCallBanner` — a foreground-only `Popup`.
4. `Ringer` — looped ringtone + vibration, force-stopped unless
   `appInForeground` so the notification channel "owns" audio when backgrounded.
5. `LoonextConnectionService` / `LoonextConnection` — a **half-used**
   self-managed `ConnectionService`; best-effort, never authoritative, its UI
   disclaimed ("self-managed connections never show the system in-call
   screen").
6. `InCallScreen` — the post-answer dialog.

Coordination is a scatter: two static flags, notification-tag equality, and a
single `appInForeground` boolean flipping the ring/notification/audio owner in
`onForegroundChanged`. **All three depend on the session being knowable at
present-time.** A foreground live-socket INVITE with no wake hint is untaggable
(`sessionHintFor` returns null), so its notification and the push's
notification cannot collapse — two rings, the double-ring the founder heard.
`syncPlatform` fans **the same snapshot** out to telecom, ringer,
notifications, and focus in four independent `runCatching` blocks; each surface
is driven separately rather than through one presenter.

The three founder failures — *can't answer from the notification*, *forced to
unlock*, *caller can't hear me* — are not three bugs. They are the same
architectural property: **the app is trying to be its own telephony stack, and
it is losing the race against itself.** The AOSP-verified `CallStyle`
precondition crash (#168A: `CallStyle.forOngoingCall` without an FGS/full-screen
intent throws `IllegalArgumentException` at `build()`) is the tombstone — we
are one API-level change away from the next self-inflicted outage every time we
touch this code.

One construct removes the whole class: **register every call with Android's
Telecom framework via Jetpack `androidx.core.telecom`, and let the OS own the
ringing session, the audio mode, the mic, and the route.** There is then no
"our presentation surface" to keep consistent with "their presentation
surface," because there is only one, and it is the platform's.

---

## 2. Design decision: Jetpack Telecom (`androidx.core.telecom`) — and why not raw `ConnectionService`

**Decision: adopt Jetpack Telecom (`androidx.core.telecom.CallsManager.addCall`
+ `CallControlScope`). Retire the raw `android.telecom.ConnectionService`
(`LoonextConnectionService`).**

### 2.1 The two candidates

| | Raw `android.telecom.ConnectionService` (what we half-built) | Jetpack Telecom `androidx.core.telecom` (recommended) |
|---|---|---|
| We manage the foreground service | Yes — we own an FGS, its type, its 5s notification, its lifecycle | **No** — `CallsManager` manages the call-scoped foreground service for us |
| We manage `AudioManager` mode / focus | Yes — hand-rolled `MODE_IN_COMMUNICATION`, `AudioFocusRequest` (the `acquireFocusFallback` code) | **No** — the framework sets the in-call audio mode + focus for the duration of the `addCall` scope |
| We manage audio-device routing | Yes — `CallAudioState` + mirror into Telnyx | **No** — `CallControlScope.currentCallEndpoint` / `availableEndpoints` / `requestEndpointChange` own routing |
| Boilerplate | High — `Connection` subclass, service, `PhoneAccount`, per-state setters, two connection-created failure paths | Low — one `addCall` suspend call with four callbacks + a scope block |
| API model | Callback object with ~12 overridable methods, state pushed via setters | **Coroutine-scoped**: the call *is* a `suspend` block; answer/active/inactive/disconnect are `suspend` functions with `CallControlResult` returns |
| Backport | We write per-API-level branches | The library backports to **minSdk 26**; on API 34+ it uses the platform `ConnectionService` under the hood, on 26–33 it uses a backported implementation — **transparently** |
| Maturity | Stable since forever, but every OEM quirk is ours | Google's **recommended** VoIP integration API; the quirks are Google's to fix |

### 2.2 Is there a Telnyx-SDK blocker? No.

The mandate says "recommend Jetpack Telecom **unless the audit shows a
Telnyx-SDK blocker**." Verified against `TelnyxSdkClient.kt` and the Telnyx
`telnyx-webrtc-android` SDK (v3.5.0, `com.github.team-telnyx:telnyx-webrtc-android`):

- Telnyx is a **pure WebRTC media engine**. It exposes `TelnyxClient(context)`,
  `connect(...)`, `socketResponseFlow` (emitting `SocketMethod.INVITE`),
  `acceptCall(callId, callerIdNumber)`, `endCall(callId)`, `Call.callStateFlow`,
  `getActiveCalls()`, and `setAudioOutputDevice(AudioDevice)`. **None of this
  touches `android.telecom`.** Telnyx does not register a `PhoneAccount`, does
  not require a `ConnectionService`, and does not care who owns the audio mode.
- Therefore Telecom (presentation + audio ownership) and Telnyx (media) compose
  cleanly: Telecom's `onAnswer` → we call `telnyxClient.acceptCall(...)`;
  Telecom's `onDisconnect` → `telnyxClient.endCall(...)`.
- **The one real integration seam** (not a blocker, a device-verification
  risk — §7): Telnyx's `setAudioOutputDevice()` and Telecom's
  `requestEndpointChange()` are two routers for one audio path. The Android
  guidance is explicit: **do not call `AudioManager.setCommunicationDevice` or
  `startBluetoothSco` while using Telecom.** Telnyx's `setAudioOutputDevice`
  likely does exactly that internally. Resolution (§4.2): **Telecom is the
  authoritative router.** We stop calling `setAudioOutputDevice` for
  user/route decisions; we observe `currentCallEndpoint` and only mirror the
  *resulting* device into Telnyx if the SDK needs to know which mic/speaker to
  bind — verified on-device.

**Conclusion: no blocker. Adopt Jetpack Telecom.**

### 2.3 Dependency, versions, minSdk

```toml
# gradle/libs.versions.toml
[versions]
androidx-core-telecom = "1.0.0"   # VERIFY latest stable at implementation time (see note)

[libraries]
androidx-core-telecom = { group = "androidx.core", name = "core-telecom", version.ref = "androidx-core-telecom" }
```
```kotlin
// app/build.gradle.kts
implementation(libs.androidx.core.telecom)
```

- **Version honesty:** `androidx.core:core-telecom` reached **stable `1.0.0`**
  (the library graduated from the 2023-11 alpha line documented on the Android
  Developers blog). Google Maven / mvnrepository were not machine-readable
  during authoring (403 / artifact not surfaced on the aggregate release-notes
  page), so **the implementer MUST pin the current latest stable
  `androidx.core:core-telecom`** from
  `https://dl.google.com/android/maven2/androidx/core/core-telecom/` (or Android
  Studio's dependency picker) at implementation time. `1.0.0` is the verified
  floor; a newer `1.x` stable (which adds e.g. the `registerAppWithTelecom`
  `backwardsCompatSdkLevel` parameter and call extensions) is preferred if
  available. **Do not ship an alpha/beta** — this is the ring path.
- **minSdk:** the project is **minSdk 28** (`app/build.gradle.kts`);
  core-telecom backports to **minSdk 26**. No minSdk change, no new floor,
  fully covered. `compileSdk`/`targetSdk` are 37 — well above the API-34 line
  where the library switches to the platform `ConnectionService` internally.

---

## 3. Call lifecycle via Telecom

**Invariant: exactly ONE Telecom call per `call_session_id`, from whichever
trigger arrives first (FCM wake OR live-socket INVITE), deduped in one
process-wide registry.** The OS owns everything the user sees and hears; the
app connects/disconnects the Telnyx leg from the OS callbacks.

```
                        ┌───────────────────────────────────────────────┐
                        │            TWO triggers, ONE registration       │
                        └───────────────────────────────────────────────┘

  (A) FCM data push kind:'call'                 (B) Telnyx live-socket INVITE
      LoonextMessagingService                       TelnyxSdkClient.onMessage
      content.callSessionId = S                     SocketMethod.INVITE, leg L
              │                                              │
              │                                              │ read S off L's custom
              │                                              │ SIP header X-Loonext-Session
              │                                              │ (deterministic — §3.2)
              ▼                                              ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  TelecomCallRegistry.ensureCall(session = S)                  │
        │  ── idempotent: keyed on call_session_id ──                   │
        │  if S already registered → return existing handle (NO 2nd)    │
        │  else → CallsManager.addCall(incomingAttributes(S)) { … }     │
        └─────────────────────────────────────────────────────────────┘
              │
              ▼
    ┌───────────────────────────────────────────────────────────────────┐
    │  OS shows the incoming-call UI it chooses:                          │
    │   • locked        → full-screen system incoming-call UI (no unlock) │
    │   • unlocked       → heads-up incoming-call notification            │
    │   • Bluetooth/Auto → in-car / headset ring + hardware answer button │
    │  Answer/Reject happen in the OS. We post a call notification        │
    │  within 5s to keep foreground priority (CallsManager requirement).  │
    └───────────────────────────────────────────────────────────────────┘
         │ user answers (any surface)              │ user rejects (any surface)
         ▼                                         ▼
   onAnswer(callType) suspend:              onDisconnect(cause) suspend:
     1. setActive() IMMEDIATELY (holds        1. telnyx.endCall(L)  (if bound)
        the OS call inside the 5s budget;     2. server decline-mine (member
        far audio stays muted-until-bound)       scope) + optional per-session
     2. if L already bound → acceptCall;      3. (scope ends → OS tears down
        else await bind up to the                 audio mode/focus/FGS)
        ANSWER_BIND_DEADLINE (§3.3)
     3. on acceptCall success → unmute;
        caller hears you. On bind-deadline
        miss → disconnect(ERROR), honest
         │
         ▼
   in-call: CallControlScope owns audio mode + mic + route for the call's life
     • hold      → onSetInactive / setInactive()   ↔ telnyx.onHoldUnholdPressed
     • resume    → onSetActive   / setActive()     ↔ telnyx.onHoldUnholdPressed
     • route     → currentCallEndpoint (BT/speaker/earpiece), OS-driven
     • hang up   → disconnect(LOCAL)               ↔ telnyx.endCall(L)
         │
         ▼
   Telnyx CallState.DONE/ERROR  OR  server call_end push  OR  OS onDisconnect
     → disconnect(cause); the addCall scope completes; OS releases audio+FGS.
```

### 3.1 The registration flow (exact API)

```kotlin
// One process-wide singleton, built in Application.onCreate alongside the graph.
val callsManager = CallsManager(appContext)

// Once, at startup (idempotent):
callsManager.registerAppWithTelecom(
    capabilities = CallsManager.CAPABILITY_BASELINE  // implies MANAGE_OWN_CALLS
    // OR-in CAPABILITY_SUPPORTS_CALL_STREAMING later if we want Auto streaming
)

// Per incoming session S (from TelecomCallRegistry.ensureCall):
val attributes = CallAttributesCompat(
    displayName = callerName,
    address     = Uri.fromParts("tel", callerNumber.ifBlank { "anonymous" }, null),
    direction   = CallAttributesCompat.DIRECTION_INCOMING,
    callType    = CallAttributesCompat.CALL_TYPE_AUDIO_CALL,
    callCapabilities = /* supportsSetInactive = true (hold) */,
)

scope.launch {
    try {
        callsManager.addCall(
            attributes,
            onAnswer      = { callType -> onTelecomAnswer(S) },      // remote surface answered
            onDisconnect  = { cause    -> onTelecomDisconnect(S, cause) },
            onSetActive   = { onTelecomResume(S) },
            onSetInactive = { onTelecomHold(S) },
        ) {
            // CallControlScope — the call is RINGING here.
            registry.bind(S, this)              // store the scope for this session
            postCallNotificationWithin5s(S)     // keep foreground priority
            observeEndpoints(this, S)           // route/mute mirroring (§4.2)
            awaitTerminal(S)                    // suspend until this session ends
        }
    } catch (e: Exception) {
        // addCall refused (e.g. an emergency call in progress) — decline OUR
        // leg so the answer race resolves on a teammate's phone. NEVER crash.
        registry.onAddCallFailed(S, e)
    }
}
```

Notes bound to verified API facts:
- `addCall` is a **suspend** function; the trailing block is
  `suspend CallControlScope.() -> Unit` and runs once the call is admitted
  (state RINGING for an incoming call). The block **must not return** until the
  call is terminal — returning ends the call.
- The four callbacks fire when a **remote surface** (lock screen, shade,
  Bluetooth, Auto, Wear) drives the call. Each must complete its action
  **within 5 seconds** or the framework treats it as a failure and may tear the
  call down. Our handlers are non-blocking (they kick the Telnyx op and
  return); `onAnswer` in particular **must not block on the Telnyx leg
  binding** — it `setActive()`s immediately and binds media asynchronously
  (§3.3).
- `CallControlScope` exposes `answer(callType)`, `setActive()`, `setInactive()`,
  `disconnect(DisconnectCause)`, each returning `CallControlResult.Success|Error`;
  plus `currentCallEndpoint: Flow`, `availableEndpoints: Flow`,
  `isMuted: Flow`, `requestEndpointChange(endpoint)`.

---

### 3.2 Deterministic session correlation — the custom SIP header (the centerpiece)

**The invariant of §3 — exactly ONE Telecom call per `call_session_id` —
requires that `S` be knowable the instant an INVITE arrives. It is not
knowable from the media leg itself:** verified, the Telnyx Android SDK
(v3.5.0) returns `getTelnyxCallControlId() == null` on an inbound `Call`, and
`SoftphoneCore` already documents that "the Android SDK's INVITE carries no
`client_state`." The original draft papered over this with a wake-hint /
caller-number / time-window heuristic (`sessionHintFor`) — **the exact
heuristic this rearchitecture exists to delete.** The first review proved it
cross-wires a multi-number crew: two anonymous callers hitting two numbers
inside the hint window bind the wrong leg to the wrong OS call, and a pure
foreground INVITE (no wake hint) is untaggable and forces a second visible
ring. **Every "correlate by caller" path is removed.**

**The mechanism (deterministic, no heuristic):** the server stamps the
session id as a **custom SIP header on the member ring INVITE**, and the
client reads it back off the SDK's inbound-call callback.

- **Header name:** `X-Loonext-Session`, value = `call_session_id` (`S`).
- **Server side (the §Intro server change — IN SCOPE):** the ring dial is a
  Telnyx Call Control `POST /v2/calls`, which supports `custom_headers`
  (verified in `telnyx-spec3.json`). The server adds
  `custom_headers: [{ name: "X-Loonext-Session", value: S }]` to **BOTH**
  member-leg dials:
  - the **initial ring fan-out** — `ringMembersOrVoicemail` /
    `inbound-ring.ts:256–273` today (the `CallSessionDO` **T1d** dial under
    CALLS-V3);
  - the **ring-me re-dial** — `ringMemberBrowser` / `inbound-ring.ts:360–375`
    today (the DO **T4** dial under CALLS-V3).

  Both already build the `brm|<session>|…` `client_state` from `S`; the
  header carries the SAME `S` on the wire where the SDK can read it. This is
  the whole server change — additive, no behavior change, no migration.
- **Client side (SDK exposure — VERIFIED against SDK source):** the inbound
  `InviteResponse` (verto `SocketMethod.INVITE` result) has a first-class
  field `@SerializedName("custom_headers") val customHeaders:
  ArrayList<CustomHeaders>` (confirmed in the SDK's
  `verto/receive/ReceivedResult.kt`, v3.5.0); each `CustomHeaders` is
  `{ name, value }`. In the INVITE handler the client scans
  `inviteResponse.customHeaders` for `name == "X-Loonext-Session"` → that value
  IS the authoritative server session id for this leg. It then calls
  `TelecomCallRegistry.ensureCall(S)` **before `addCall`**, keyed on that `S`.
  - **`X-` prefix is MANDATORY** — Telnyx WebRTC only passes custom headers
    whose name starts with `X-`; `X-Loonext-Session` satisfies this. The server
    MUST use exactly this name.
  - **The one residual to confirm on-device (gate note, §11 rung):** that a
    Call Control **Dial** `custom_headers` lands on the **inbound** verto
    INVITE the callee reads (the spec's field description says "SIP INVITE
    response"; the SDK field + Telnyx's documented WebRTC custom-header
    passthrough say inbound). If it did NOT, EVERY call falls to the by-leg
    fallback below — so this is the highest-value verification rung, gating
    promotion, not merge.
- **Push-registered call binds to the INVITE by MATCHING the header, not the
  caller:** when an FCM `kind:'call'` push already registered `addCall(S)`
  (pre-INVITE), the arriving INVITE whose `X-Loonext-Session == S` binds to
  the existing scope. A push for `S1` and an INVITE carrying `S2` are
  *different sessions* by construction — they can never merge or cross-wire.
- **There is no untaggable case anymore.** A foreground live-socket INVITE
  (no wake hint) now ALSO carries `X-Loonext-Session`, because the server put
  it on the dial regardless of whether a push preceded it. `sessionHintFor`'s
  caller/time correlation is **deleted from the ring path** (its residual
  use, if any, is not on the Telecom correlation path).

**Fallback — header somehow absent (older server that hasn't shipped the
two-line change, or a stripped header):** the client does NOT fall back to
caller matching. In order:

1. Read `getTelnyxLegId()` off the inbound `Call` (this DOES exist on inbound,
   unlike the call-control-id). Resolve the session server-side with a by-leg
   lookup (`GET /v1/calls/live/by-leg/:legId`, the ledger-backed resolver —
   CALLS-V3 §8.4; the member leg is ledgered by the DO at dial). A 200
   yields `{ call_session_id: S }` → proceed exactly as the header path.
2. If the by-leg lookup 404s or the network is unavailable within a bounded
   deadline (`LEG_RESOLVE_DEADLINE_MS = 4_000`, matching the client's
   existing by-leg backoff budget), the leg is **uncorrelatable** →
   **honest teardown**: do NOT present a mystery call and do NOT answer into
   an unknown session. `telnyx.endCall(L)`; if an `addCall(S)` from a push is
   waiting on this bind, let its §3.3 bind deadline disconnect it with an
   honest cause. Never guess the session.

Because the header is present on every server that has shipped the change,
the fallback is a transitional safety net, not a steady-state path.

---

### 3.3 The onAnswer 5-second budget — one strategy, stated concretely

`onAnswer` fires when a remote surface (lock screen, shade, Bluetooth) answers.
The framework gives the callback a **hard 5-second budget**; exceeding it is a
transaction failure that may tear the call down. On a cold FCM wake the Telnyx
leg may not be bound yet (the INVITE is still in flight after ring-me over a
cold socket in Doze). The first review caught two contradictory strategies in
the draft; this is the **single committed strategy** (the "await the bound leg
in onAnswer" language of the old §3/§5 is DELETED):

1. **`setActive()` IMMEDIATELY** — the first thing `onAnswer` does, well
   inside the 5s budget. This holds the OS call: the framework starts the
   `phoneCall` FGS + `MODE_IN_COMMUNICATION`, and the OS considers the call
   answered. The callback then returns (non-blocking); it never waits on
   Telnyx.
2. **Muted-until-bound.** Until the Telnyx leg binds and `acceptCall`
   succeeds, no media crosses: the Telnyx leg is simply **not accepted yet**,
   so there is no far-audio path to leak — that IS the mute. (The caller is
   not in dead air meanwhile: the server holds carrier ringback until the
   member leg's `call.answered` fires, which only happens on `acceptCall`.)
   Concretely the registry sets a `pendingAnswer=true` flag on the session; a
   leg-bind observer (the same one that reads `X-Loonext-Session`, §3.2) runs
   `telnyx.acceptCall(L, number)` the instant `L` binds, then clears the flag.
   If the SDK's own mode grab (§4.3) exposes a mic before accept, the client
   additionally holds `telnyx.setMute(true)` until `acceptCall` returns and
   releases it — belt-and-suspenders so nothing is broadcast to a half-open
   leg.
3. **Bounded bind deadline.** An `ANSWER_BIND_DEADLINE_MS` timer arms when
   `onAnswer` runs. If `acceptCall` has not succeeded by the deadline (the leg
   never bound — ring-me failed, the socket never delivered the INVITE), the
   registry `disconnect()`s the Telecom call with an **honest
   `DisconnectCause(ERROR)`** (user-visible "Call couldn't connect"), tears
   down any half-bound Telnyx leg, and issues server decline-mine. **The OS
   call can never ring answerable into permanent dead air** (§3.4/B3).
   - **The failure is ALWAYS honest** — the OS call disconnects with a visible
     cause; it never rings into silence. That is the invariant this deadline
     guarantees, independent of the exact value.
   - **The value is a measured constant, not a guess (gate note).** A bind that
     WOULD have succeeded at t>deadline IS cut off — so the deadline must be
     tuned from the real answer-tap→leg-bind P99 measured under Doze on the
     device ladder (§11 rung 5). It is defined as a single tunable constant
     (start ~10 000 ms; raise toward — never to — the 45 s ring window if the
     measured cold-wake P99 demands it). Do NOT hardcode a value the ladder
     hasn't validated.

---

### 3.4 Register-from-push but the leg never binds — no dead-air ghost

The failure the first review isolated (B3): a killed app is FCM-woken →
`addCall(S)` shows the OS incoming UI → the woken process calls ring-me, **but
ring-me throws** (transient network / socket not ready over the lock) → no
INVITE ever arrives. Without handling, the OS call rings the full 45s and, if
answered, `onAnswer` waits on a leg that never binds. Two bounded mechanisms
close it:

- **ring-me failure retry (bounded).** A ring-me call that throws or returns
  `rang:false` with a retryable reason (`dial_failed`, or `recent_leg` with no
  INVITE within ~4s per CALLS-V3 §10.2) is retried with backoff, **up to
  `RING_ME_MAX_ATTEMPTS = 3` within the ring window**. This is the client's
  own resilience; it does not change the server contract (CALLS-V3 §10.2
  already licenses the single retry — this bounds it to 3 and adds the
  throw case).
- **the §3.3 onAnswer bind deadline.** If the user answers and the leg still
  never binds, `ANSWER_BIND_DEADLINE_MS` disconnects the OS call with an
  honest cause rather than parking the user in silence.

If the process is never woken far enough to retry successfully, the OS call is
still torn down cleanly by the server's `call_end` revocation push at ring-out
(voicemail/missed) — which disconnects the Telecom handle (§5, and I2: this
depends on the `call_end` cap being registered, which the v3 client does).
There is no path where the OS call rings answerable into permanent dead air.

---

## 4. Audio — why one-way audio and forced-unlock become structurally impossible

### 4.1 What Telecom owns (and we therefore delete)

When a call lives inside an `addCall` scope, the framework — **not our code** —
does all of the following for the call's entire lifetime:

- sets **`MODE_IN_COMMUNICATION`** on the audio system (note: the Telnyx SDK
  *also* sets this mode internally on `acceptCall` — they coexist because both
  want the same value; we do NOT try to make Telecom the exclusive mode owner
  — §4.3),
- **holds audio focus** (and yields it to / reclaims it from a cellular call;
  the Telnyx SDK grabs focus internally too — again coexisting, §4.3),
- runs the **call-scoped foreground service** with
  `FOREGROUND_SERVICE_TYPE_PHONE_CALL`, which is what grants the process the
  right to **capture the microphone while backgrounded / over the keyguard**,
- owns **audio-device routing** (earpiece / speaker / wired / Bluetooth) and
  exposes it as `currentCallEndpoint` / `availableEndpoints` /
  `requestEndpointChange`.

**Why "caller can't hear me" becomes impossible:** the mic is only capturable
because a `phoneCall`-type foreground service is running, and Telecom starts
that service *as part of `setActive()`* — the same call that connects the audio.
There is no code path where the leg is answered but the mic FGS is absent,
because they are the same OS transaction. The old client had them separate: the
Telnyx ANSWER went on the wire in one place and our FGS/focus/mode was set up
in *four independent `runCatching` blocks* elsewhere in `syncPlatform` — any one
failing (or the #168A `build()` throw firing first) left audio half-wired.

**Why "forced to unlock" becomes impossible:** the OS renders its own
incoming-call UI over the keyguard and its own in-call controls; answering does
not route through any Activity of ours, so there is no `showWhenLocked` Activity
to get wrong and no `MainActivity` tab-shell bounce. The lock-screen answer is a
platform affordance.

### 4.2 The Telnyx routing seam (the one thing we must get right)

Telecom is the **authoritative router**. Concretely:

- **Delete** all direct, app-initiated `AudioManager` mode/focus code (§6).
- **Stop** using `telnyx.setAudioOutputDevice()` as the *user's* route control.
  Route changes come from the OS: the user taps speaker on the system in-call
  UI, or connects a Bluetooth headset, and that surfaces as a new
  `currentCallEndpoint`.
- We **observe** `currentCallEndpoint` and, **only if on-device verification
  shows Telnyx needs to be told**, mirror the endpoint into the SDK by mapping
  `CallEndpointCompat.type` → `AudioDevice` and calling `setAudioOutputDevice`
  as a *follower*, never a leader. The existing `AudioRoute`↔`AudioDevice`
  mapping in `TelnyxSdkClient.setAudioRoute` is reused for this mirror.
- We **never** call `AudioManager.setCommunicationDevice` or
  `startBluetoothSco` (Android's explicit "do not" when using Telecom).

This seam is the **single most important device-verification item** (§7): on
some devices Telnyx's WebRTC audio unit and Telecom's routing agree out of the
box; on others the SDK grabs `setCommunicationDevice` and fights Telecom. The
design makes Telecom the authoritative *router*; the verification confirms
Telnyx follows.

### 4.3 The Telnyx internal audio grab — honest coexistence, not exclusive ownership

The first review corrected an over-claim (I1): demoting `setAudioOutputDevice`
to a follower does NOT make Telecom the sole owner of the audio **mode and
focus**. Verified against the SDK: **the Telnyx WebRTC audio-device module
sets `AudioManager.MODE_IN_COMMUNICATION` and grabs audio focus internally on
`connect`/`acceptCall`, and the SDK exposes NO documented off-switch** for its
internal audio management. So on `acceptCall` there are two engines touching
the mode/focus, not one. The design's response is honest coexistence, with
four binding rules:

- **(a) Do NOT try to make Telecom set the mode/focus, and do NOT fight
  Telnyx for it.** We write **zero** `AudioManager.mode` / `AudioFocusRequest`
  code — neither to "help" Telecom nor to override Telnyx. Both engines want
  `MODE_IN_COMMUNICATION`; because the desired value is identical, the two
  sets are benign and idempotent-in-effect. Telecom owns the FGS + the system
  call UI + device **routing**; Telnyx owns the WebRTC audio unit + (de facto)
  the mode/focus. We stop asserting "Telecom is the exclusive mode/focus
  owner" — the guarantee is narrowed to routing.
- **(b) Route changes flow through Telecom, and Telnyx follows.** The user's
  route choice (speaker / earpiece / Bluetooth) comes from the OS in-call UI
  and surfaces as a new `currentCallEndpoint` on the `CallControlScope`. We
  observe it and mirror the resulting device into Telnyx via
  `setAudioOutputDevice` **as a follower only** (never as the leader, never
  the user's control surface).
- **(c) The client NEVER calls `AudioManager.setCommunicationDevice` or
  `startBluetoothSco`** (Android's explicit "do not" under Telecom). Route is
  Telecom's; the Telnyx follower-mirror is the only other audio-device call
  we make.
- **(d) The coexistence itself is a top device-verification rung** (§7/§11):
  that Telnyx's internal mode/focus grab and Telecom's FGS/UI do not
  deadlock or mute each other, and specifically that **the caller hears the
  answerer over Bluetooth** (SCO negotiated by whichever engine, audio
  actually two-way). This is the real mechanism behind the historical
  one-way-audio / BT-SCO-fight symptoms — not endpoint mirroring alone — so
  the Bluetooth acceptance rung targets THIS, not just `currentCallEndpoint`
  reflection.

---

## 5. Wake path — push-first ring, idempotent to the INVITE

The CALLS-V3 server sends an FCM **`kind:'call'`** data push carrying
`call_session_id = S` *before* the WebRTC INVITE, and expects the client to
call **ring-me** to summon the media leg. The v2 client keeps that contract and
makes the Telecom registration the thing that dedupes:

```
FCM kind:'call' (session S)                 Live-socket INVITE (leg L)
   │                                            │
   │ 1. ensureCallWakePath() (cold process)     │ 1. read S off L's custom SIP
   │ 2. TelecomCallRegistry.ensureCall(S) ──────┼──────► header X-Loonext-Session
   │      → addCall NOW; OS shows incoming UI    │        (deterministic — §3.2;
   │        from the push, pre-INVITE            │         fallback: by-leg lookup)
   │ 3. ring-me(S, noLocalLeg=true) ────────────┼──────► same registry, keyed on S
   │      → server dials this member (WITH the   │      → if S present: reuse handle,
   │        X-Loonext-Session header); INVITE    │        bind leg L (NO 2nd addCall,
   │        arrives as leg L, header == S        │        NO 2nd ring, NO 2nd ring-me)
   │      → retry bounded on throw (§3.4)        │
   ▼
OS incoming UI is already up. User can answer from the lock screen before the
INVITE even lands: onAnswer(S) does NOT block — it setActive()s immediately
(§3.3) and binds media when L arrives (matched by header), or disconnects with
an honest cause if the bind deadline passes (§3.3/§3.4).
```

Idempotency, stated precisely (the founder's "this isn't even possible"):

- **One Telecom call per session.** `TelecomCallRegistry` is keyed on
  `call_session_id`, which is **known deterministically at every trigger**:
  from the FCM payload (`content.callSessionId`) on the push, and from the
  `X-Loonext-Session` header (§3.2) on every INVITE. `ensureCall(S)` is a
  compare-and-set: first caller does `addCall`, every later caller (the INVITE
  after the push, a duplicate push, the foreground INVITE) gets the existing
  handle. There is no "push notification" and "INVITE notification" that can
  fail to collapse — there is one OS call object.
- **One ring-me per session.** ring-me is issued at most once per `S` before an
  INVITE binds (guarded in the registry, not scattered across the messaging
  service and the core), `noLocalLeg=true`, with the bounded throw/retry of
  §3.4 — matching CALLS-V3 §10.2's retry contract.
- **No untaggable case, no synthetic key.** Because the server stamps
  `X-Loonext-Session` on **every** member dial (initial fan-out AND ring-me —
  §3.2), a pure foreground live-socket INVITE with no preceding push now
  carries `S` too. The old "register under a synthetic per-leg key and re-key
  later" path — the one place today's tag collapse fails into a second visible
  ring — **is deleted**: there is nothing to re-key, because `S` is on the
  INVITE from the start. (`addCall` cannot be un-rung, so the correctness here
  rests on never registering under the wrong/unknown key in the first place —
  which the header guarantees.)
- **call_end** (CALLS-V3 §9.2 revocation push): resolve the session's Telecom
  handle and `disconnect(DisconnectCause(REJECTED|LOCAL))`; the OS removes its
  UI. No `NotificationManagerCompat.cancel` gymnastics. **This teardown
  depends on the client having registered `caps:['call_end']`** (CALLS-V3
  §9.2, and I2): the server sends `call_end` ONLY to token rows declaring the
  cap, so an OS call whose client never wrote the cap would ghost-ring to the
  45s server voicemail instead of disconnecting on server-resolve. The v3
  Android client already writes that cap at token registration (CALLS-V3
  §10.2) — so this is a dependency to honor, not new work; until the cap
  write lands, teardown falls back only to the 45s alarm.

---

## 6. What is DELETED

Precisely, with the defect each deletion removes:

| Deleted | File(s) | Why it can go |
|---|---|---|
| **`IncomingCallActivity`** | `features/calls/IncomingCallActivity.kt` (+ manifest `<activity>` with `showWhenLocked`/`turnScreenOn`) | The OS renders the over-keyguard incoming UI. No app Activity presents the ring. Removes the two static ownership flags and the caller-number correlation hack. |
| **`IncomingCallPresentation`** | `telephony/IncomingCallPresentation.kt` (+ its test) | Its whole job was routing notification actions and `matchLocalRing` by caller number — subsumed by Telecom callbacks keyed on the session. |
| **`CallNotifier` incoming `CallStyle` ring** | the incoming half of `telephony/CallNotifications.kt`: `showIncoming`, `showIncomingFromPush`, `postRing`, `incomingTag`, `cancelIncomingForSession`, `CallActionReceiver` ANSWER/DECLINE, the `INCOMING_CALLS` channel as a *ring* surface | The OS owns the incoming ring + its answer/decline actions. Removes the #168A `CallStyle`-precondition minefield and the tag-collapse dedup entirely. |
| **`Ringer` + `RingerPolicy`** | `telephony/Ringer.kt`, `telephony/RingerPolicy.kt` (+ `RingerPolicyTest`) | The OS plays the ringtone/vibration for a registered incoming call, honoring ringer mode, Do-Not-Disturb, and route. The `appInForeground` double-ring problem disappears with the second owner. |
| **Custom `AudioManager` focus/mode code** | `SoftphoneManager`: `acquireFocusFallback`, `releaseFocusFallback`, `focusRequest`, `currentRingMode`, the `sync-focus` block in `syncPlatform`, `onForegroundChanged`'s ring re-eval | We write ZERO `AudioManager` mode/focus code (§4.3): Telecom manages the FGS/mode and Telnyx sets `MODE_IN_COMMUNICATION` + focus internally on `acceptCall` — the two coexist (same desired value). OUR hand-rolled focus is exactly what fought the framework; deleting it removes a THIRD writer, it does not make Telecom the sole owner (§4.3 states the honest coexistence). |
| **Self-managed `ConnectionService`** | `telephony/LoonextConnectionService.kt` (whole file: `LoonextConnectionService`, `LoonextConnection`, `TelecomBridge`) + manifest `<service>` with `BIND_TELECOM_CONNECTION_SERVICE` | Subsumed by Jetpack Telecom, which registers the PhoneAccount and manages the ConnectionService internally on API 34+. We stop hand-maintaining a `Connection` subclass. |
| **`reportIncomingToTelecom` / `reportOutgoingToTelecom` / `registerPhoneAccount` / `attachConnection` / `phoneAccountHandle`** | `SoftphoneManager` telecom-bridge methods | Replaced by `CallsManager.registerAppWithTelecom` + `addCall`. |
| **`syncPlatform` telecom + ring + focus fan-out** | `SoftphoneManager.syncPlatform` (the `sync-telecom`, `sync-ring`, `sync-focus` `runCatching` blocks) | The snapshot no longer drives presentation. Telecom callbacks drive it. `syncPlatform` shrinks to the ongoing-notification mirror and the #168D call-in-flight marker (kept, §8). |

### 6.1 The in-app banner: DELETE it

Recommendation: **delete `IncomingCallBanner`** (`features/calls/IncomingCallBanner.kt`,
its `CallsOverlay` mount, `bannerRingingCall` in `CallsLogic`, and
`BannerPresentationTest`). Rationale: the founder mandate is "one presentation
per session," and the whole double-ring / two-owner class of bug came from the
app having its *own* ring surface that had to be kept consistent with the OS's.
The OS incoming-call UI is shown foreground **and** background **and** locked —
even when the app is open, Android surfaces a heads-up incoming-call
notification. Keeping an in-app banner re-introduces exactly the "which owner is
presenting right now" coordination this rearchitecture exists to delete. If
product later wants an in-app affordance, it must be a **read-only reflection**
of the Telecom call state (observing the registry) whose buttons call
`CallControlScope.answer()/disconnect()` — it must never present or ring
independently. Ship without it; add it back only behind that constraint.

`InCallScreen` **stays** (§8) — it is post-answer, not a ring surface, and it
already renders from the softphone snapshot.

---

## 7. What STAYS

- **`TelnyxSdkClient` (media engine)** — unchanged as the WebRTC leg: `connect`,
  `socketResponseFlow`/`INVITE`, `acceptCall`, `endCall`, `callStateFlow`,
  hold/mute/DTMF. Only its **routing** role is demoted to follower (§4.2).
- **`SoftphoneCore`** — the pure, unit-tested leg state machine (registration,
  multi-call state, recovery/watchdog, `answer`, `ringMe`). It remains the
  source of truth for *leg* state; Telecom is the source of truth for
  *presentation + audio*. The bridge (§8) wires them. **Note:** its
  caller/time `sessionHintFor` heuristic is NO LONGER the Telecom-correlation
  path — session correlation is now the deterministic `X-Loonext-Session`
  header (§3.2). `sessionHintFor` is retained only if a non-correlation
  consumer still needs it; the ring/registration path must not call it.
- **The CALLS-V3 server contract** — ring-me, decline-mine, `/state`,
  `call_end`, the `CallSessionDO` state machine. **Zero server changes.**
- **`CrashDiagnostics` / `PostCrashHonesty` / the #168D call-in-flight marker**
  — the hardening that makes a mid-call crash observable and honest stays; if
  anything it matters more, since a Telecom-scope crash must still leave a clean
  "call was interrupted" trail.
- **`InCallScreen`** and the ongoing-call **notification** (`showOngoing`, the
  plain non-`CallStyle` one) — post-answer surfaces, unchanged.
- **The outbound path** — outbound calls also register with Telecom
  (`DIRECTION_OUTGOING`) so they get the same audio ownership. Presentation was
  never the outbound problem, but "leave outbound unchanged" would leave it
  **half-migrated** (Telecom owning the FGS/mode while legacy outbound code
  still calls `setAudioOutputDevice` + hand-rolled focus — the exact
  double-ownership §6 deletes for inbound, per I3). So outbound reuses the
  SAME bridge: **follower-routing** (§4.2/§4.3 — no user-facing
  `setAudioOutputDevice`, no `AudioManager` focus/mode, no
  `setCommunicationDevice`/`startBluetoothSco`) and **scope-driven
  active/disconnect**, keyed on the outbound leg's own session id (no header
  needed — the client originates the outbound leg and owns its id from
  `POST /v1/calls/browser`, so correlation is trivial). The
  Telnyx-`CallState`→`CallControlScope` mapping (from `callStateFlow`):

  | Telnyx outbound `CallState` | Telecom scope action |
  |---|---|
  | `NEW` / `CONNECTING` / `RINGING` | call registered `DIRECTION_OUTGOING`, dialing/ringing; no `setActive` yet |
  | `ACTIVE` | `setActive()` — far party answered, audio live |
  | `HELD` | `setInactive()` |
  | `DONE` (local hangup) | `disconnect(DisconnectCause(LOCAL))` |
  | `DONE` (remote hangup) | `disconnect(DisconnectCause(REMOTE))` |
  | `ERROR` | `disconnect(DisconnectCause(ERROR))` |

  User hang-up flows OS→app the same way inbound does
  (`onDisconnect` → `telnyx.endCall`). Do not redesign the dial trigger or the
  outbound UI — only the audio/scope bridge is shared.

---

## 8. The bridge: two engines, one adapter

`SoftphoneManager` stops being a presenter and becomes a **bridge** between the
Telnyx leg state (`SoftphoneCore`) and the Telecom call scope
(`CallControlScope`), via a new `TelecomCallRegistry`:

```
SoftphoneCore (leg state)                 TelecomCallRegistry (session ⇄ scope)
   CoreEvent.IncomingRinging(L,S) ─────►  ensureCall(S): addCall(...) or reuse
     (S from X-Loonext-Session, §3.2)      (S deterministic — never by caller)
   leg L → ACTIVE/HELD/ENDED       ─────►  drive scope: setActive/setInactive/disconnect
                                   ◄─────  onAnswer(S):  setActive() NOW, then bind:
                                   ◄─────                acceptCall on L-bind (§3.3),
                                   ◄─────                disconnect on bind-deadline
                                   ◄─────  onDisconnect: core.hangup(L)/declineMine
                                   ◄─────  onSetInactive/onSetActive: core.hold(L, …)
                                   ◄─────  currentCallEndpoint: mirror route → telnyx (follower)
```

The inbound leg→scope mapping above is the same shape the outbound path reuses
(§7, I3): one `Telnyx CallState → CallControlScope` mirror for both directions,
differing only in how the session is keyed (inbound: the `X-Loonext-Session`
header; outbound: the client-owned outbound session id).

Directional rules:
- **OS → app** (user acted on a remote surface): the four `addCall` callbacks
  translate to Telnyx ops. Complete within 5s, never block.
- **App → OS** (the Telnyx leg changed on its own — remote answered, remote
  hung up, recovery landed): the leg-state observer calls the matching
  `CallControlScope` op (`setActive`, `disconnect`) so the OS UI follows the
  media. This replaces the `syncPlatform` telecom block.
- **De-dup and lifecycle** live in `TelecomCallRegistry`, keyed on
  `call_session_id` — the one place that guarantees one call, one ring-me, one
  scope per session.

`syncPlatform` shrinks to: the **ongoing-call notification** mirror and the
**#168D call-in-flight marker**. Everything else it did is now the OS's job.

---

## 9. Manifest / permissions

### 9.1 Keep
```xml
<uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />          <!-- required by CallsManager -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />             <!-- the mic -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" /> <!-- the call FGS type Telecom uses -->
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />        <!-- BT route enumeration -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />       <!-- the 5s call notification + ongoing -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```
`CallsManager.registerAppWithTelecom(CAPABILITY_BASELINE)` is what actually
registers the self-managed `PhoneAccount` — **no manual
`telecom.registerPhoneAccount(...)` call remains**.

### 9.2 Remove
```xml
<!-- DELETE: the app no longer owns a lock-screen ring Activity -->
<activity android:name=".features.calls.IncomingCallActivity"
          android:showWhenLocked="true" android:turnScreenOn="true" .../>

<!-- DELETE: Jetpack Telecom registers/binds the ConnectionService itself -->
<service android:name=".telephony.LoonextConnectionService"
         android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE">
  <intent-filter><action android:name="android.telecom.ConnectionService" /></intent-filter>
</service>

<!-- DELETE the CallActionReceiver <receiver> once the incoming CallStyle actions are gone -->
```
- **`USE_FULL_SCREEN_INTENT`**: removable — we no longer post our own
  full-screen-intent ring (the OS does). Keep only if a residual full-screen
  need is found on-device; default to removing it (it is an increasingly
  policy-restricted permission on Android 14+).
- **`FOREGROUND_SERVICE_MICROPHONE`**: the call FGS Telecom runs is of type
  `phoneCall`, not `microphone`; keep `FOREGROUND_SERVICE_MICROPHONE` only if
  another feature needs it — the calling path does not. Confirm on-device that
  mic capture works under the `phoneCall` FGS (it does — that is the type's
  purpose) and drop the microphone type from the calling path.
- **`VIBRATE`**: removable from the calling path (OS owns ring vibration);
  keep only if used elsewhere.

---

## 10. Migration + risk

### 10.1 Rollout
- **Almost client-only, plus one additive server header.** The CALLS-V3
  state machine (ring-me / decline-mine / state / call_end, the
  `CallSessionDO`) is untouched in behavior. The ONE server change is the
  additive `X-Loonext-Session` custom SIP header on the two member-leg dials
  (§3.2/Intro). Because it is header-additive with no behavior change, and the
  client has a by-leg fallback for a server that hasn't shipped it yet (§3.2),
  **there is no migration ordering**: the header can ship before, with, or
  after the APK. Ship it with (or just before) the APK so the deterministic
  path is live on day one and the fallback stays a safety net. The APK itself
  is a clean cut (below).
- **Teardown dependency (I2):** the OS-call `call_end` teardown depends on the
  client's `caps:['call_end']` token write (CALLS-V3 §9.2), which the v3
  client already performs — state it, verify the token row carries the cap on
  the founder device before promotion.
- **No per-call fallback.** Telecom is **all-or-nothing per call** — a call is
  either registered with the framework (and the OS owns it) or it is not. You
  cannot half-adopt within one call. So there is **no runtime feature flag that
  keeps the old ring path alive alongside the new one**; that would rebuild the
  two-owner bug we are deleting. The migration is a clean cut: the new client
  registers every inbound and outbound call with Telecom.
- **Gate: founder device-acceptance (§11 ladder).** Because there is no
  fallback, the gate is on-device verification on the founder's phone(s) before
  wide release — not a percentage rollout. Ship to the founder track first;
  promote to all devices only after the three scenarios pass on real hardware
  across at least one locked and one Bluetooth case.

### 10.2 What the platform now GUARANTEES vs what still needs a device

Honest split — the whole point is to move items from the left column to the
right:

**Guaranteed by construction (no longer hand-rolled, cannot regress in our code):**
- The incoming UI appears **locked, unlocked, and on Bluetooth/Auto** without an
  app Activity — it is the OS's UI.
- Answering **never forces an unlock** and never routes through our tab shell.
- The **audio mode (`MODE_IN_COMMUNICATION`), focus, and mic FGS** are wired by
  the same OS transaction that makes the call active — no path answers without
  them.
- **One presentation, one ring-me, one call object** per `call_session_id`.
- Cellular-call interop (our call holds/yields correctly) is the framework's.

**Still needs on-device verification (platform-owned but hardware/OEM-variable):**
- The **Telnyx internal audio grab** (§4.3): that Telnyx setting
  `MODE_IN_COMMUNICATION` + grabbing focus internally COEXISTS with Telecom's
  FGS/UI without deadlock or mutual muting, and that WebRTC audio follows
  `currentCallEndpoint` on real earpiece/speaker/BT transitions without the SDK
  grabbing `setCommunicationDevice` behind Telecom's back. **Highest-risk
  item** — it is the real mechanism behind the historical one-way-audio symptom.
- **Two-way audio on real Bluetooth** (SCO negotiation timing) and on speaker —
  the "**caller hears you over Bluetooth**" rung (§4.3d) is the single most
  likely place a device surprises us.
- OEM incoming-UI quirks (some skins render self-managed calls differently) and
  DND/ringer-mode behavior.
- **`onAnswer` 5-second budget under a cold-process FCM wake** — verify the
  committed §3.3 strategy on device: `onAnswer` `setActive()`s immediately
  (never blocks on the leg), stays muted-until-bound, `acceptCall`s the instant
  the header-matched INVITE binds, and `disconnect()`s with an honest cause if
  `ANSWER_BIND_DEADLINE_MS` passes.
- **The SECOND 5-second budget: post the call notification within 5s of
  `addCall` on a cold FCM wake in Doze** (I4). This is a distinct framework
  requirement (`postCallNotificationWithin5s`, §3.1): a cold isolate must build
  the channel + notification within 5s of `addCall` or lose foreground priority
  — and thus the `phoneCall` mic FGS that §4.1 says makes "caller can't hear me"
  impossible. Verify it holds under Doze, not just warm-process.

---

## 11. Test plan

### 11.1 Unit-testable (JVM, pure — the bulk of the safety net)
Push the decision logic into a pure reducer (`TelecomCallReducer`) the same way
`SoftphoneCore`/`RingerPolicy` were pure, so the platform classes stay a thin
shell:

- **State → registration:** given a leg/session snapshot, assert exactly one
  `addCall` intent is produced per `call_session_id`, and none for a session
  already registered.
- **Header correlation (§3.2 — the centerpiece):** an INVITE carrying
  `X-Loonext-Session=S` keys `ensureCall(S)` regardless of caller/time; two
  INVITEs from two anonymous callers carrying `S1` and `S2` bind to their OWN
  sessions (the multi-number cross-wire the review found is impossible); an
  INVITE with a MISSING header falls back to a by-leg lookup on
  `getTelnyxLegId()`; a by-leg 404/timeout → honest teardown (`endCall`, no
  guess). Assert NO code path keys a session by caller.
- **Wake dedup:** FCM(S) then INVITE(S, header=S) → one registration, one
  ring-me; INVITE(S) then FCM(S) → same; duplicate FCM(S) → no-op; a pure
  foreground INVITE (no push) still carries the header → single registration,
  no synthetic key, no second ring.
- **Connect-on-answer (§3.3 committed strategy):** `onAnswer(S)` `setActive()`s
  FIRST unconditionally; with the leg already bound → `acceptCall` then unmute;
  with only the push arrived → stays muted-until-bound, `acceptCall`s on
  header-matched bind; leg never binds by `ANSWER_BIND_DEADLINE_MS` →
  `disconnect(ERROR)` (no permanent dead air); `onDisconnect` → `endCall` +
  `declineMine`.
- **ring-me retry (§3.4/B3):** ring-me throw → bounded retry up to
  `RING_ME_MAX_ATTEMPTS`; `rang:false/recent_leg` with no INVITE in ~4s → one
  retry; exhausted retries never leave the OS call answerable into dead air
  (the bind deadline still fires).
- **call_end:** revocation for S → `disconnect(S)` exactly once; unknown S →
  no-op.
- **Leg→scope mirror (inbound AND outbound, §7/§8):** Telnyx `ACTIVE`→
  `setActive`, `HELD`→`setInactive`, `DONE`(local)→`disconnect(LOCAL)`,
  `DONE`(remote)→`disconnect(REMOTE)`, `ERROR`→`disconnect(ERROR)`; idempotent
  under repeated identical snapshots.

### 11.2 Device-only (the acceptance ladder — the founder scenarios)
The three founder scenarios are the acceptance gate, in order:

1. **Answer from the notification** (unlocked): call arrives → OS heads-up
   incoming UI → tap Answer → **two-way audio**, no app screen required.
2. **Answer from locked**: phone locked → OS full-screen incoming UI over the
   keyguard → Answer → **two-way audio with the device still locked** (no PIN).
3. **Caller hears you**: on both (1) and (2), the **caller confirms they hear
   the answerer** — the mic is live. Then repeat over **Bluetooth** (answer from
   a headset button, audio on the headset) as the §4.3 mode-grab + routing-seam
   proof — the "caller hears you over Bluetooth" rung is the single most likely
   place a device surprises us.

Two cold-wake timing budgets ride alongside these rungs, both under **Doze**
(app killed, real FCM wake), not just warm-process:

4. **`addCall` → notification within 5s** (I4): on a cold FCM wake the woken
   process must build the channel + call notification within 5s of `addCall`
   or lose foreground priority (and the mic FGS). Measure the real gap on
   device; it must hold at the P99 of a cold isolate in Doze.
5. **Answer within the `onAnswer` 5s budget** (§3.3/B2): tap Answer on a
   cold-woken locked phone; confirm `onAnswer` `setActive()`s immediately (OS
   call held), media binds on the header-matched INVITE, and — in the induced
   failure case (ring-me forced to fail) — the call `disconnect()`s with the
   honest cause at `ANSWER_BIND_DEADLINE_MS` rather than sitting in silence.

Each rung must pass on the founder's real hardware before promotion.

---

## 12. Summary of the shape

- **One owner:** Android Telecom owns the ringing session, the audio mode, the
  mic FGS, and the route. The app owns media (Telnyx) and post-answer in-call UI.
- **One object per session, keyed deterministically:** `TelecomCallRegistry`
  keyed on `call_session_id` guarantees one `addCall`, one ring-me, one scope.
  The session is known at every trigger — the FCM payload on the push, the
  **`X-Loonext-Session` custom SIP header** on every INVITE (§3.2) — so the
  correlation never uses a caller/time heuristic. That is what makes the
  founder's "not even possible" real rather than aspirational.
- **Deleted:** `IncomingCallActivity`, `IncomingCallPresentation`, the incoming
  `CallStyle` ring + its receiver, `Ringer`/`RingerPolicy`, the hand-rolled
  `AudioManager` focus/mode code, the self-managed `LoonextConnectionService`,
  and the in-app ring banner.
- **Kept:** `TelnyxSdkClient` (media, routing demoted to follower),
  `SoftphoneCore` (leg state), `InCallScreen` + ongoing notification, the
  CALLS-V3 server contract (untouched), the #168 crash hardening.
- **Ships as:** an APK rewrite plus ONE additive, backward-compatible server
  header (`X-Loonext-Session` on the two member-leg dials — §3.2/Intro; no
  migration ordering, client has a by-leg fallback). Gated on the founder
  device-acceptance ladder because Telecom is all-or-nothing per call. The
  `call_end` OS-teardown depends on the client's `caps:['call_end']` token
  write (I2), which the v3 client already performs.
