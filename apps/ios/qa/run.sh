#!/usr/bin/env bash
set -euo pipefail

scenario=${1:?Pass a scenario or all}
evidence="$RUNNER_TEMP/ios-qa"
products="$RUNNER_TEMP/ios-qa-build/Build/Products"
test_runs=("$products"/*.xctestrun)
if [[ ${#test_runs[@]} != 1 || ! -f "${test_runs[0]}" ]]; then
  echo "Expected one built XCTest run in $products" >&2
  exit 1
fi
ui=LoonextQAUITests/DeviceChecklists
unit=LoonextTests
audit=LoonextUITests/AccessibilityAuditUITests
recorder=
fixture=

stop_processes() {
  local result=0
  if [[ -n "$recorder" ]]; then
    kill -INT "$recorder" 2>/dev/null || true
    for _ in {1..90}; do
      if ! kill -0 "$recorder" 2>/dev/null; then break; fi
      sleep 1
    done
    if kill -0 "$recorder" 2>/dev/null; then
      echo "::error::Simulator recording did not finish after SIGINT"
      kill -KILL "$recorder" 2>/dev/null || true
      result=1
    fi
    wait "$recorder" || true
    recorder=
  fi
  if [[ -n "$fixture" ]]; then
    kill "$fixture" 2>/dev/null || true
    wait "$fixture" 2>/dev/null || true
    fixture=
  fi
  return "$result"
}
trap stop_processes EXIT

run_scenario() {
  local name=$1
  shift
  local output="$evidence/$name"
  local result=0
  local test_timeout=180
  local selection=()
  for test in "$@"; do selection+=("-only-testing:$test"); done
  if [[ "$name" == accessibility ]]; then test_timeout=420; fi

  mkdir -p "$output"
  QA_EVIDENCE="$output" node qa/fixture.cjs > "$output/fixture.log" 2>&1 &
  fixture=$!
  for _ in {1..30}; do
    if curl --silent --fail http://127.0.0.1:8765/__qa/health >/dev/null; then break; fi
    if ! kill -0 "$fixture" 2>/dev/null; then break; fi
    sleep 1
  done
  if ! curl --silent --fail http://127.0.0.1:8765/__qa/health >/dev/null; then
    cat "$output/fixture.log"
    stop_processes
    return 1
  fi

  xcrun simctl io "$QA_SIMULATOR" recordVideo --codec=h264 "$output/screen.mp4" > "$output/recording.log" 2>&1 &
  recorder=$!
  xcodebuild test-without-building -xctestrun "${test_runs[0]}" \
    -destination "id=$QA_SIMULATOR" -parallel-testing-enabled NO \
    -test-timeouts-enabled YES -maximum-test-execution-time-allowance "$test_timeout" \
    -resultBundlePath "$output/tests.xcresult" "${selection[@]}" \
    | tee "$output/xcodebuild.log" || result=$?
  xcrun simctl io "$QA_SIMULATOR" screenshot "$output/final.png" || result=1
  curl --silent --fail http://127.0.0.1:8765/__qa/writes > "$output/writes.json" || result=1
  if [[ "$name" == notification-actions ]]; then
    xcrun simctl spawn "$QA_SIMULATOR" log show --last 20m --style compact \
      --predicate 'subsystem == "com.loonext.ios" AND category == "push" AND eventMessage CONTAINS "notification reply"' \
      > "$output/push.log" 2>&1 || true
  fi
  stop_processes || result=1

  if [[ -d "$output/tests.xcresult" ]]; then
    xcrun xcresulttool export attachments --path "$output/tests.xcresult" \
      --output-path "$output/attachments" || result=1
  fi
  if [[ ! -s "$output/screen.mp4" ]] || grep -qi 'test skipped' "$output/xcodebuild.log"; then
    result=1
  fi
  printf '| %s | %s |\n' "$name" "$([[ $result == 0 ]] && echo Passed || echo Failed)" >> "$GITHUB_STEP_SUMMARY"
  return "$result"
}

printf '| Scenario | Result |\n| --- | --- |\n' >> "$GITHUB_STEP_SUMMARY"
failed=0
case "$scenario" in
  all|foreground-alerts|notification-actions|notification-reply-transport|calls|offline|autosave|copy-and-media|account-state|accessibility) ;;
  *) echo "Unknown scenario: $scenario" >&2; exit 2 ;;
esac
for name in foreground-alerts notification-actions notification-reply-transport calls offline autosave copy-and-media account-state accessibility; do
  [[ "$scenario" == all || "$scenario" == "$name" ]] || continue
  case "$name" in
    foreground-alerts) run_scenario "$name" "$ui/testForegroundAlertForAnotherThread" || failed=1 ;;
    notification-actions) run_scenario "$name" "$ui/testNotificationReply" "$ui/testNotificationTrayClearance" \
      "$unit/NotificationsPushPayloadTests" || failed=1 ;;
    notification-reply-transport) run_scenario "$name" "$unit/NotificationReplyFixtureTests" || failed=1 ;;
    calls) run_scenario "$name" "$audit/testInCallControls" "$audit/testCallLog" \
      "$unit/CallsLogicTests" "$unit/VoipPushPolicyTests" "$unit/TelephonyMappingTests" || failed=1 ;;
    offline) run_scenario "$name" "$ui/testOfflineRelaunchAndOutbox" "$unit/OfflineReadCacheTests" || failed=1 ;;
    autosave) run_scenario "$name" "$ui/testContactNotesSaveOnBack" \
      "$ui/testCallingSettingSavesOnBackground" "$unit/DebouncedTextSaveTests" "$unit/DebouncedTextSaveWireTests" || failed=1 ;;
    copy-and-media) run_scenario "$name" "$ui/testSettingsLabelsAndTaskDeleteCopy" \
      "$ui/testVoicemailPlaybackProgress" "$unit/PermissionStringsTests" "$unit/MediaPlaybackTests" || failed=1 ;;
    account-state) run_scenario "$name" "$ui/testEnrolledMemberGetsAuthenticatorPrompt" \
      "$ui/testScheduledDowngradeOffersKeepPro" || failed=1 ;;
    accessibility) run_scenario "$name" "$audit" || failed=1 ;;
  esac
done
exit "$failed"
