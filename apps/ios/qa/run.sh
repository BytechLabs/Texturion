#!/usr/bin/env bash
set -euo pipefail

scenario=${1:?Pass a scenario or all}
evidence="$RUNNER_TEMP/ios-qa"
ui=LoonextQAUITests/DeviceChecklists
unit=LoonextTests
audit=LoonextUITests/AccessibilityAuditUITests
recorder=
fixture=

stop_processes() {
  if [[ -n "$recorder" ]]; then
    kill -INT "$recorder" 2>/dev/null || true
    wait "$recorder" || true
    recorder=
  fi
  if [[ -n "$fixture" ]]; then
    kill "$fixture" 2>/dev/null || true
    wait "$fixture" 2>/dev/null || true
    fixture=
  fi
}
trap stop_processes EXIT

run_scenario() {
  local name=$1
  shift
  local output="$evidence/$name"
  local result=0
  local selection=()
  for test in "$@"; do selection+=("-only-testing:$test"); done

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
  xcodebuild test-without-building -project Loonext.xcodeproj -scheme LoonextQA \
    -configuration QA -destination "id=$QA_SIMULATOR" \
    -derivedDataPath "$RUNNER_TEMP/ios-qa-build" -parallel-testing-enabled NO \
    -resultBundlePath "$output/tests.xcresult" "${selection[@]}" \
    | tee "$output/xcodebuild.log" || result=$?
  xcrun simctl io "$QA_SIMULATOR" screenshot "$output/final.png" || result=1
  curl --silent --fail http://127.0.0.1:8765/__qa/writes > "$output/writes.json" || result=1
  stop_processes

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
  all|foreground-alerts|notification-actions|calls|offline|autosave|copy-and-media|accessibility) ;;
  *) echo "Unknown scenario: $scenario" >&2; exit 2 ;;
esac
for name in foreground-alerts notification-actions calls offline autosave copy-and-media accessibility; do
  [[ "$scenario" == all || "$scenario" == "$name" ]] || continue
  case "$name" in
    foreground-alerts) run_scenario "$name" "$ui/testForegroundAlertForAnotherThread" || failed=1 ;;
    notification-actions) run_scenario "$name" "$ui/testNotificationReplyAndTrayClearance" || failed=1 ;;
    calls) run_scenario "$name" "$audit/testInCallControls" "$audit/testCallLog" \
      "$unit/CallsLogicTests" "$unit/VoipPushPolicyTests" || failed=1 ;;
    offline) run_scenario "$name" "$ui/testOfflineRelaunchAndOutbox" "$unit/OfflineReadCacheTests" || failed=1 ;;
    autosave) run_scenario "$name" "$ui/testContactNotesSaveOnBack" \
      "$ui/testCallingSettingSavesOnBackground" "$unit/DebouncedTextSaveTests" "$unit/DebouncedTextSaveWireTests" || failed=1 ;;
    copy-and-media) run_scenario "$name" "$ui/testSettingsLabelsAndTaskDeleteCopy" \
      "$ui/testVoicemailPlaybackProgress" "$unit/PermissionStringsTests" "$unit/MediaPlaybackTests" || failed=1 ;;
    accessibility) run_scenario "$name" "$audit" || failed=1 ;;
  esac
done
exit "$failed"
