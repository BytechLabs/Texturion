# Loonext iOS

Native iOS client — Swift 6, SwiftUI, **iOS 26 deployment target** so Liquid
Glass is native everywhere, Paper & Olive identity with the double-o brand
mark (#206, `brand/README.md`). Full parity surface:
inbox/thread/composer, tasks, contacts, calls (Telnyx SDK + CallKit + PushKit),
notifications (feed + APNs via FCM), settings, auth.

## Requirements

- macOS with **Xcode 26+**
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

## Build

```sh
cd apps/ios
xcodegen generate        # produces Loonext.xcodeproj from project.yml
open Loonext.xcodeproj   # build/run the Loonext scheme; tests: LoonextTests
```

SPM resolves TelnyxRTC (4.x) and FirebaseMessaging (12.x) on first open.

> **First-compile note:** this codebase was authored and review-verified on a
> non-mac machine — it has not been through a local Xcode compile yet. The
> per-feature reports on epic #150 list each module's least-confident iOS 26
> API names (all with conservative fallbacks) — expect at most small
> mechanical fixes, in SwiftUI modifier names rather than logic.

## Configuration

Public client values live in `Loonext/Core/AppConfig.swift`. **No secrets.**

- **Alert push** (messages, missed calls): optional — add
  `GoogleService-Info.plist` to the target (founder step, PRODUCTION.md
  §Firebase); absent config keeps the whole push stack a logged no-op.
- **Incoming-call wake**: PushKit VoIP via **Telnyx's push credential** (not
  FCM) — the founder uploads a VoIP Services certificate in the Telnyx portal
  and assigns it to the WebRTC credential connection (PRODUCTION.md §Telnyx).
  Until then calls ring only while the app is open, and the Calls screen says
  so honestly.
- Entitlements: `aps-environment` required once push is enabled;
  `UIBackgroundModes` (audio, voip, remote-notification) are already set in
  `project.yml`.

## Architecture (one paragraph)

Mirrors the Android app one-for-one. `Core/` holds the Keychain session
store, GoTrue REST auth, an `ApiClient` actor (Bearer + `X-Company-Id`,
single-flight refresh with stale-token force), the phoenix Realtime client,
and the full Codable wire contract (snake_case property names ARE the wire
names — no CodingKeys; `@Default` keeps lagging clients decode-proof; server
enums stay strings). `Features/` is one directory per surface; `RootView`
runs the bootstrap state machine (signed-out → needs-workspace → needs-
checkout → ready) with external-Safari hand-offs for anything the app
doesn't sell — workspace creation, checkout, and the billing portal always
open the real browser (store posture: the app sells nothing, no IAP).

## Tests

`LoonextTests` (XCTest): formats, task filter semantics (the frozen-route
port), watermark reducer, model decode audit against `types.ts`, segment and
merge-field vectors, call state machine. Run from Xcode or `xcodebuild test`.
