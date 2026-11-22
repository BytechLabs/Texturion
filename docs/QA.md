# QA on the Loonext Rig

**Status: Active runbook.**

Use a branch, tag or commit SHA and record the web deployment and Android APK SHAs separately. Use the rig's seeded workspaces and numbers. Tell anyone sharing the rig before deploying, reseeding or changing an AVD's state. A deploy changes the stack for every lane.

On the VM, run `rig lock <worker>` before deploying or starting a scenario. Use the same worker name with `rig unlock <worker>` after collecting the verdicts. A lock older than 90 minutes can be replaced.

## Connect and check

On the Windows host, run these commands from a checkout of the tooling.

```powershell
node tools/rig/host/hostd.mjs doctor
node tools/rig/host/hostd.mjs devices list
ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=F:/loonext-rig/host/ssh/known_hosts -i F:/loonext-rig/host/ssh/rig rig@192.168.70.10
```

If the supervisor is down, run `node tools/rig/host/hostd.mjs serve` from a dedicated host terminal. It opens the rig-only adb server on 5137, starts the warm Pixel and forwards adb and hostd into the rig VM. If it fails, read `F:/loonext-rig/host/logs/hostd.log` and use the setup and recovery commands in [tools/rig/README.md](../tools/rig/README.md). The supervisor's VM command addresses the marked `loonext-rig.vmx` only.

In the VM, use the CLI from its tooling checkout. Set up this alias or put the same command on the VM's PATH.

```sh
export RIG_HOME=/var/lib/loonext-rig
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
alias rig='node /var/lib/loonext-rig/tooling/tools/rig/bin/rig.mjs'
rig health --only api,web,hostd,adbTunnel
rig lock qa-calls
rig deploy --ref <ref>
cat "$RIG_HOME/state/deployed.json"
```

Use a fresh copy of the tooling for new CLI commands. The checkout that serves the deployed app can be older or newer than the tooling checkout. The [rig design](RIG.md) describes the isolation, lane contracts and recovery paths.

## Web

- Use `https://app.rig.internal` from the VM. For a change in a seeded flow, run the scenario whose name and variants match it in [scenarios.json](../tools/rig/scenarios.json), for example `rig run S21 --run-id qa-775-web` for an inbound text and Web Push. The browser lane uses Chromium for calls and Google Chrome for Push. Reuse its per-member profiles to avoid extra new-device emails.
- Give synthetic Auth users a Resend test address such as `delivered+qa-<nonce>@resend.dev` when the flow can send new-device or invite mail. For inbox delivery, use the tagged robot mailbox through S34. When testing an owner notice, create the synthetic owner in rig Auth before creating the workspace fixture.
- For a custom walk, run a Playwright script in a rig checkout. Use [BrowserLane](../tools/rig/lanes/src/browser/lane.ts) with the origins, browser profiles, credentials callback and fake microphone setup shown in [rigd wiring](../tools/rig/rigd/src/wiring.ts). Open a seeded member with `lane.open("qa-w-technician", "qa-w-technician", "/inbox")` using a surface from [surfaces.ts](../tools/rig/robot/src/audio/surfaces.ts). Pass `{ push: true }` as the fourth argument for Chrome Push. Use the returned `.page` for Playwright locators, assertions, requests and screenshots, and call `lane.closeAll()` in `finally`. Read the seeded credentials in the VM from `$RIG_HOME/secrets/tenants.json` without printing them. For recording with Playwright, use a separate test profile and pass `recordVideo: { dir: evidenceDir }` when creating its browser context. Close the context to finish the video.
- For #775, have a second tab cover the open thread. Assert that the first page really reports `document.visibilityState === "hidden"`; a hidden element or a headless tab that still reports visible cannot verify this path. Send an inbound from an owned robot number, check unread from another session and record that the hidden tab makes zero read requests. Bring it forward and check that it clears unread.

### Authenticated preview

For a self-contained preview with deterministic data and no paid calls, follow the [Theme audit CI job](../.github/workflows/checks.yml). Run it in a dedicated worktree with its own local Supabase stack. `supabase db reset` erases that local project's data. The preview fixtures differ from the rig's seeded tenants.

```sh
sh scripts/start-supabase-ci.sh
supabase db reset
pnpm install --frozen-lockfile
node scripts/dev-seed.mjs
node scripts/ci-dev-vars.mjs
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(supabase status -o json | jq -r '.PUBLISHABLE_KEY')"
export NEXT_PUBLIC_API_URL=http://127.0.0.1:8787
LOONEXT_AUDIT_WEBRTC=1 pnpm --filter @loonext/web build
pnpm exec playwright install chromium
pnpm exec bun scripts/web-journey.mjs
```

For an interactive walk or the authenticated audits, run the following from the same checkout. Keep the first two commands in separate terminals.

```sh
pnpm --filter @loonext/api exec wrangler dev --config wrangler.ci.jsonc --port 8787 --ip 127.0.0.1
pnpm --filter @loonext/web exec next start -p 3100
node scripts/theme-audit.mjs --authed
node scripts/check-app-a11y.mjs --authed
```

Open `http://localhost:3100/login` with the credentials in [dev-seed.mjs](../scripts/dev-seed.mjs). Use the real app and local database to reproduce UI behavior. The journey supplies local test doubles for external providers. Use the rig when the checklist calls for actual Web Push, FCM or Telnyx delivery.

## Android

| hostd device | AVD | API | ADB serial |
| --- | --- | --- | --- |
| `pixel` | `rig-pixel` (Pixel 8 profile, Play image) | 36 | `emulator-5560` |
| `emulator-34` | `rig-api34` | 34 | `emulator-5554` |
| `emulator-35` | `rig-api35` | 35 | `emulator-5556` |
| `emulator-36` | `rig-api36` | 36 | `emulator-5558` |

From Windows, use `node tools/rig/host/hostd.mjs devices boot <device>` and wait for `booted`. The cap is three concurrent AVDs. Stop a rotation AVD you control before booting a fourth. Keep the Pixel available for the device lane.

In the VM, build and install a checked, signed `.nonprod` APK. Fetch the desired branch into the tooling repository if the ref has not reached the VM. Build the older ref first for an upgrade test. `--worktree` and `--debuggable` print their build path instead of replacing `current.apk`; pass that path through `--apk`. Downgrades may require a fresh rotation AVD.

```sh
rig apk --ref <ref>
cat "$RIG_HOME/work/apk/current.json"
rig qa install pixel
export PATH="$HOME/android-sdk/platform-tools:$PATH"
pkg=com.loonext.android.nonprod
serial=emulator-5560
dev() { adb -H 127.0.0.1 -P 15037 -s "$serial" "$@"; }
dev shell am start -n "$pkg/com.loonext.android.MainActivity"
```

Use the member appropriate to the checklist, usually QA-A technician. If installation or repair needs the SDK, FA15 is the one-time license acceptance for each SDK. On Windows run `& D:/Android/sdk/cmdline-tools/latest/bin/sdkmanager.bat --sdk_root=D:/Android/sdk --licenses` and, for missing images, `node tools/rig/host/vm/create.mjs --sdk-only --yes`. In the VM run `bash "$RIG_HOME/tooling/tools/rig/box/android-toolchain.sh" --accept-licences`. The on-demand tools require the workstation to be running.

### Drive and capture

```sh
dev shell uiautomator dump /data/local/tmp/qa-window.xml
dev exec-out cat /data/local/tmp/qa-window.xml
dev shell input tap <x> <y>
dev shell input swipe <x1> <y1> <x2> <y2> <milliseconds>
rig qa screenshot pixel "$PWD/after.png"
rig qa record pixel "$PWD/repro.mp4" --seconds 20
```

Drive the AVD from a second terminal while recording. `screenrecord` captures pixels and has no TalkBack or call audio. Copy reviewed evidence out over SSH with `scp`. When using [Mobile MCP](https://github.com/mobile-next/mobile-mcp/blob/main/llms-install.md), run its Android adb backend on the VM with the SDK tools on PATH and `ADB_SERVER_SOCKET=tcp:127.0.0.1:15037`. Check `mobile_list_available_devices` first and pass the exact contract serial to each call. Use direct adb if the installed MCP backend does not honor the socket or fails to list that serial.

### Device states and delivery

| Goal | Enter and verify | Restore |
| --- | --- | --- |
| Process killed | `dev shell input keyevent KEYCODE_HOME`, then `dev shell am kill "$pkg"`. Check `dev shell pidof "$pkg"` returns no PID. | Launch the activity. |
| Force-stopped | On a rotation AVD, `dev shell am force-stop "$pkg"`. FCM is blocked until relaunch. | Launch the activity. |
| Forced deep Doze | `dev shell dumpsys deviceidle enable all`, `dev shell dumpsys battery unplug`, `dev shell input keyevent KEYCODE_SLEEP`, `dev shell dumpsys deviceidle force-idle`. Verify `dev shell dumpsys deviceidle get deep` returns `IDLE`. Use `D03` for stepping through maintenance. | `dev shell dumpsys deviceidle unforce` and `dev shell dumpsys battery reset`. |
| Locked | `dev shell input keyevent KEYCODE_SLEEP`. Verify keyguard with `dev shell dumpsys window`. Use `KEYCODE_WAKEUP`, then unlock with the rig PIN from the VM secret store. | Wake and unlock. |
| Offline | `dev shell cmd connectivity airplane-mode enable`, `dev shell svc wifi disable` and `dev shell svc data disable`. Confirm the API is unreachable **from the app**. | Disable airplane mode and restore Wi-Fi and mobile data to their previous values. |
| Slow link | Use [EmulatorConsole.shape](../tools/rig/lanes/src/android/emulator-console.ts) from the VM for speed and latency. Record the settings used. | Reset the shape and Wi-Fi. |

Use `rig run D02p` for the guarded ring FCM path without a dial. On API 34 or later, check the nonprod app's full-screen intent access in Android Settings first. The scenario locks the AVD and verifies that the incoming call activity opens over the keyguard. For a message push to QA-A, run this on the VM with the technician signed in to Android. The robot chooses its owned numbers by role.

```sh
ROBOT_ROLE=ROBOT-1 node --input-type=module <<'JS'
import { readFileSync } from "node:fs";
const token = readFileSync(process.env.RIG_HOME + "/secrets/robot-local-token", "utf8").trim();
const response = await fetch("http://127.0.0.1:7311/sms", {
  method: "POST",
  headers: { "content-type": "application/json", "x-robot-token": token },
  body: JSON.stringify({
    from_role: process.env.ROBOT_ROLE,
    to_role: "DEV-A1",
    text: `Rig QA ${Date.now()}`,
    scenario: "S21",
  }),
});
if (!response.ok) throw new Error(`Robot SMS failed with HTTP ${response.status}`);
JS
```

Check FCM acceptance and then the notification shade or Telecom, since accepting a push and showing it are separate observations. Run foreground suppression with that robot's thread open, then repeat with `ROBOT_ROLE=ROBOT-2` as a positive control. Use unique markers and account for the inbound alert cooldown. For shade actions, verify one reply in the receiver's inbox, test refusal paths, then verify the notification is removed when the same thread is read locally and from another session. Keep notification-revoked and force-stop tests on the rotation AVDs.

### TalkBack and Google Phone

- On the Pixel Play image, open `dev shell am start -a android.settings.ACCESSIBILITY_SETTINGS` and enable the preinstalled TalkBack service. Check `dev shell settings get secure enabled_accessibility_services`. Use Explore by Touch, swipe right or left to change focus, and double-tap to activate. Use gRPC `sendTouch` for actual gestures on the headless emulator. The [TalkBack run record](accessibility-runs/2026-11-11-android-talkback-emulator.md) gives the procedure and speech log signature. UIAutomator can pause TalkBack during a dump. Use the speech overlay or the TalkBack speech log alongside the recording and review pronunciation using guest audio. Restore TalkBack, font scale and app locale when done.
- For #819, save a fictional local contact in Google Contacts, run Connected Apps sync on the prior build, then install the fixed build with `rig qa install` and sync again. Use the [emulator console's fake GSM call](../tools/rig/lanes/src/android/emulator-console.ts) from a reserved 555-01xx test number. Check the incoming UI, Recents and details in `com.google.android.dialer`, and Call/Text under Connected Apps in `com.google.android.contacts`. Record the versions of both apps. The injected call exercises Google's UI and the contacts provider. Carrier signaling and a Google account's contact sync require their own evidence.

## Calls and evidence

Run `rig health` and look up the scenario in the [registry](../tools/rig/scenarios.json). Run `rig run S02` for a browser answer, `rig run S04` for voicemail, `rig run D02` for a killed, Dozing, locked Android answer, or `rig run D07` for an Android outbound call. The runner serializes use of the shared call lease and retries after cleanup. If Telnyx refuses a request, record its returned status or error code in the issue. Confirm a dial and check the ring timing and audio before marking either check passed.

For an attended French greeting check, set `RIG_WHISPER_BIN` and `RIG_WHISPER_MODEL` on the robot service to a local whisper.cpp binary and a multilingual model. Set `RIG_ROBOT_RECORDINGS_DIR` to a private rig directory. Request French transcription and set `capture_recording` to true on a receive-only robot call to another rig role. The robot saves the caller's receive track there and removes the Telnyx copy. Keep the run's recording private and remove it after the evidence review.

Log the issue, UTC time, ref, browser or AVD/API, package version, exact checklist items, observed result and scenario run ID. Keep evidence under a separate directory, and review it for tokens, test numbers, contact information and other private details before posting. With a [GitHub CLI version that supports attachments](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli), post `gh issue comment <issue> --body-file result.md --attach after.png --attach repro.mp4`. Close an issue when the applicable web and Android checks pass and the iOS Simulator lane has recorded its coverage or gaps. Keep failures and unverified checks that the lanes can run open.

The rig can verify app UI, Google Phone's emulated modem and contacts behavior, real data and push delivery, software keyguard, forced Doze, network recovery and TalkBack app behavior. The lab has browser lanes, Android emulators and an iOS Simulator lane. Record the following hardware-only gaps in the issue alongside the simulator results. They are accepted limits of the lab.

| Hardware behavior | Why the lab cannot verify it |
| --- | --- |
| Vibration duration and strength | Android exposes notification configuration and timing, while physical vibration depends on a phone's motor. |
| Natural Doze and OEM power management | The rig steps Android through Doze. Motion sensors and OEM firmware control physical entry and background behavior. |
| Receiver proximity and accessory audio | The virtual sensor and audio paths can exercise software state. A receiver, headset or other accessory determines physical routing and sensor behavior. |
| Ordinary SIM-carrier calls | The Play image can inject an incoming GSM event into Google Phone and exercise lookup and call history. Actual carrier signaling needs a radio and subscription. |
| iPhone silent switch and Face ID hardware | The Simulator can exercise app audio policy and simulated biometric outcomes. The switch, the audio route on a physical phone and the Face ID sensor are hardware checks. |
| Physical screen-reader interaction | Use TalkBack and VoiceOver in the respective lanes where available and record what spoke. Device acoustics and physical interaction remain outside the lab. |

## iOS Simulator

Open **Actions → iOS QA → Run workflow** and choose a scenario or `all`. The CLI equivalent is `gh workflow run ios-qa.yml --ref main -f scenario=all`. Pull requests that change the workflow or test harness build the QA app, verify Release endpoints and run `calls` as a smoke test. The workflow installs `com.loonext.ios.qa` on an iPhone Simulator and uses synthetic data on the runner. It needs no Apple account, Firebase configuration, customer credentials, carrier traffic, or founder's phone.

Each scenario records a video, a final screenshot, XCUITest screenshots and results, and its fixture server log. Network scenarios also capture the synthetic request bodies and any injected `.apns` payloads. Open the `ios-qa-*` artifact on the run page. The run summary lists each scenario's result.

The workflow signs in to the loopback fixture with synthetic credentials supplied at launch. This keeps the system Save Password prompt out of the device checklists. The dedicated sign-in accessibility audit still exercises the form.

| Scenario | Issue | Simulator evidence |
| --- | --- | --- |
| `customer-journeys` | | Owner signup and setup states, Canadian number ordering and team invites, technician texts, notes, scheduled sends, Lou draft review and explicit sending, contacts, task calendar, map and planner, and the bookkeeper's billing view. Runs in English and Canadian French in light and dark. The fixture handles external services. |
| `workspace-switch` | #1143 | Switches from a technician workspace to a bookkeeper workspace and back. The test checks that the bookkeeper cannot see the technician inbox. Runs in English and Canadian French in light and dark. |
| `attachment-sources` | #793 | The app's photo library and the Photos and Files share sheets stage fixture photos for a conversation. |
| `attachment-send` | #793 | The app's photo library sends one fixture photo. XCTest checks the destination, caption, media type and size, and idempotency key. |
| `foreground-alerts` | #775 | An inbound broadcast updates the open thread. Simulated alerts exercise foreground suppression for that thread and presentation for another thread. |
| `notification-actions` | #777 | XCTest attempts a Reply from Notification Center and checks card removal on thread open and on a read broadcast for the same user. A separate test submits a synthetic reply action to the app's handler and checks the outgoing request and idempotency key. |
| `calls` | #776, #1103 | The call history and in-call controls undergo accessibility audits. A largest-text check exercises the call filters and verifies that Answer and Decline both fit. Unit tests cover synthetic VoIP payloads, caller privacy, wake policy, and the softphone behavior behind CallKit answer and end actions. |
| `offline` | #778 | The fixture closes API and Realtime connections while Simulator networking stays active. The app reopens cached data after termination, flushes a queued send once after reconnect and returns to sign-in when refresh is refused. This exercises app behavior on transport failure. The iOS reachability strip and real radio transitions need a separate network-loss pass. |
| `autosave` | #780 | UI tests edit contact notes and leave the screen, then edit Calling settings and immediately press Home. The fixture checks one PATCH with the latest value and the tests reopen the UI to confirm it. A debounce regression drives the sub-800 ms window independently of Simulator gesture timing. |
| `copy-and-media` | #805 | UI tests check rendered settings labels, the task-list delete confirmation, and playback progress on synthetic audio. Unit tests check English and Canadian French permission strings, including Face ID, and playback session setup. |
| `quote-amount` | #1088, #1115 | A ready payout account exposes Ask for payment on a new thread. The Canadian French quote and pay-link forms save a decimal comma amount. The fixture records the amounts in cents and XCTest captures the previews and saved amounts. |
| `accessibility` | #238, #1118 | Apple's audits check labels, contrast, hit regions and large-text clipping. Canadian French tests run in both appearances and check that task sorting is visible and changes the selected sort. |

`LoonextQA` uses the `QA` build configuration. Override `LOONEXT_QA_API_URL`, `LOONEXT_QA_WEB_URL`, `LOONEXT_QA_SUPABASE_URL` and `LOONEXT_QA_SUPABASE_PUBLISHABLE_KEY` on `xcodebuild` to use another nonproduction service. Use HTTPS origins or runner loopback HTTP. The defaults use the included loopback fixture because the rig edge's public routes serve webhooks and media. Debug and Release keep the production endpoints. The workflow checks the Release compilation condition, bundle ID and endpoint values.

For interactive tests of throughput and packet loss, Xcode exposes Network Link Conditioner profiles in its Devices and Simulators window. The hosted test controls the fixture's sockets while leaving its control endpoint reachable. [Apple network conditioning guide](https://developer.apple.com/videos/play/tech-talks/111378/)

### Accepted iPhone hardware gaps

`simctl push` injects ordinary alert payloads directly and bypasses FCM and APNs. Apple supports the APNs development sandbox on eligible Simulator hosts with a configured build. [Xcode release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes)

X21 accepts the hardware-only gaps for iOS QA. These include alert sound with the phone locked or unlocked, ring/silent-switch behavior, receiver proximity, real call audio and voicemail audio immediately after a call. End-to-end PushKit wake and locked-device CallKit answer or decline require a provisioned iPhone and a VoIP credential on the relevant Telnyx connection. App Lock's physical Face ID prompt and a spoken VoiceOver pass, including announcement timing and French pronunciation, are also outside this lane.

When the applicable Simulator, Android emulator and web checks pass, close the issue with one line naming its accepted iPhone hardware gap.
