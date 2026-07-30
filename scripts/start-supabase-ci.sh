#!/bin/sh
# Bring up the local Supabase stack in CI, and survive a port that is still held.
#
# WHY THIS EXISTS. Both CI jobs that need a database ran a bare `supabase start`.
# On 2026-07-30 the E2E job died on:
#
#   failed to bind host port for 0.0.0.0:54322: address already in use
#
# `supabase start` then rolled itself back, the job exited 1, and because
# main.yml's `release` job has `needs: gate`, a red gate stops release-please
# refreshing the release pull request — so ONE flaky container start blocks every
# deploy to production, indefinitely, until somebody pushes again. That is far too
# much consequence for an intermittent bind.
#
# WHAT IT DOES NOT DO: pretend to know the cause. The runner is a fresh VM and
# nothing in the job binds 54322 before this step, so the honest position is that
# we do not yet know what held it. Hence the diagnostics BEFORE the first attempt:
# the next occurrence leaves evidence in the log instead of a bare bind error, and
# the retry means it does not also cost a deploy while we find out.
#
# Used by the SQL and E2E jobs both, so the two cannot drift — the same reasoning
# as scripts/check-ignored-secrets.sh being shared by the hook and CI.
set -eu

# Every host port supabase/config.toml asks for. Listed rather than derived so a
# new service in config.toml shows up as a missing diagnostic, not a silent gap.
PORTS="54321 54322 54320 54329 54323 54324"

report_holders() {
  label=$1
  echo "  [$label] host ports in use:"
  for port in $PORTS; do
    # `ss` is on every ubuntu-latest image; -p needs no sudo for our own procs
    # and prints nothing rather than failing for others.
    holder=$(ss -ltnp 2>/dev/null | grep -E ":${port}[[:space:]]" || true)
    if [ -n "$holder" ]; then
      echo "    $port  $holder"
    fi
  done
  echo "  [$label] docker containers:"
  docker ps -a --format '    {{.Names}}  {{.Status}}  {{.Ports}}' 2>/dev/null || true
}

attempt_start() {
  supabase start
}

echo "Starting local Supabase stack"
report_holders "before"

if attempt_start; then
  echo "Supabase started."
  exit 0
fi

# One retry, and a real teardown first. `supabase stop` releases the containers
# this project owns; the sleep gives Docker's proxy time to actually unbind,
# which an immediate retry would race exactly the way the first attempt did.
echo "First start failed. Tearing down and retrying once."
report_holders "after-failure"
supabase stop --no-backup || true
sleep 10
report_holders "after-teardown"

if attempt_start; then
  echo "Supabase started on the second attempt."
  # Deliberately still exit 0. A stack that came up on a retry runs the tests
  # correctly; failing here would trade a flaky job for a guaranteed-red one.
  # The log above is the record that it took two goes.
  exit 0
fi

echo "Supabase failed to start twice. Diagnostics above name what held the ports." >&2
exit 1
