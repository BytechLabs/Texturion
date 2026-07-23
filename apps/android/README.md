# Loonext Android

Native Android client — Kotlin, Jetpack Compose, Material 3 Expressive
(`MaterialExpressiveTheme`, material3 1.5.0-alpha24), Paper & Olive identity
with the double-o brand mark (#206, see `brand/README.md`), Golos Text (OFL).
Full parity surface: inbox/thread/composer, tasks, contacts,
calls (Telnyx softphone + self-managed ConnectionService), notifications
(feed + FCM), settings, auth.

## Requirements

- JDK 17+ (21 recommended), Android SDK **37** (compileSdk/targetSdk; minSdk 28)
- No Android Studio required — the Gradle wrapper drives everything

## Build

```sh
cd apps/android
# local.properties must point at your SDK, e.g. sdk.dir=D:\\Android\\sdk
./gradlew :app:assembleDebug          # APK at app/build/outputs/apk/debug/
./gradlew :app:testDebugUnitTest      # full JVM unit-test suite
```

Windows gotcha: if unit tests die with `Could not find or load main class Code`,
your `PATH` contains a stray `"` (Gradle copies PATH into the test JVM's
`java.library.path`). Strip quotes first: `export PATH="${PATH//\"/}"` (Git
Bash) and re-run.

## Configuration

Public client values (API origin, Supabase URL + publishable key) are compiled
in via `BuildConfig` — see `app/build.gradle.kts`. There are **no secrets** in
this app.

Push is optional and self-disabling: without a `google-services.json` (founder
step — PRODUCTION.md §Firebase) `PushRegistrar.isFirebaseAvailable()` is false,
every push path no-ops with one log line, and the notification-settings card
says push isn't available in this build. Drop the file in `app/` and apply the
`com.google.gms.google-services` plugin to light it up.

## Architecture (one paragraph)

One hand-rolled composition root (`AppGraph` in `LoonextApp.kt`) — no DI
framework. `core/` holds the session store (DataStore), GoTrue REST auth,
`ApiClient` (Bearer + `X-Company-Id`, single-flight refresh with a stale-token
force path, SPEC §7 envelope decoding), the Supabase Realtime phoenix client,
and the full wire-model layer (string enums stay strings — a lagging client
never crashes on new server values). `features/` is one directory per surface,
each self-contained with state-based internal navigation (no NavHost);
`MainActivity` routes deep links and full-screen overlays. Realtime payloads
are ID-only → refetch; signed attachment URLs are minted per view, never
cached; sends carry an `Idempotency-Key` reused on retry.

## Tests

JVM unit tests only (no emulator in CI yet): ~215 tests covering the API
client (MockWebServer), segment/merge-field ports (every vector from
`packages/shared`), task filter semantics, watermark logic, call state
machine, settings logic. `./gradlew :app:testDebugUnitTest`.
