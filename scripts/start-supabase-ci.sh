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

# A diagnostic that prints nothing is not a diagnostic.
#
# On 2026-08-14 this ran, printed "host ports in use:" and "docker containers:"
# with NOTHING under either, and the second start still died on "address already
# in use". Read literally that says the port is free and Docker disagrees. Read
# honestly it says the check never happened — an absent `ss`, or a `docker ps`
# that failed into `|| true` — and an empty section is indistinguishable from a
# clean one. That is the same failure this repo has recorded in guards that
# reported "none found" while matching nothing at all.
#
# So every probe below states whether it COULD look, separately from what it
# found.
report_holders() {
  label=$1
  echo "  [$label] host ports in use:"
  if ! command -v ss >/dev/null 2>&1; then
    echo "    (ss is not installed on this runner — host sockets NOT checked)"
  else
    sockets=$(ss -ltnp 2>&1 || true)
    found=""
    for port in $PORTS; do
      holder=$(printf '%s\n' "$sockets" | grep -E ":${port}[[:space:]]" || true)
      if [ -n "$holder" ]; then
        echo "    $port  $holder"
        found="yes"
      fi
    done
    [ -n "$found" ] || echo "    (none of $PORTS has a listening socket)"
  fi

  echo "  [$label] docker containers:"
  if containers=$(docker ps -a --format '{{.Names}}  {{.Status}}  {{.Ports}}' 2>&1); then
    if [ -n "$containers" ]; then
      # Indent EVERY line: `printf '    %s\n' "$multiline"` indents only the
      # first, which reads as one container plus unattributed noise.
      printf '%s\n' "$containers" | while IFS= read -r line; do
        echo "    $line"
      done
    else
      echo "    (docker reports no containers at all)"
    fi
  else
    echo "    (docker ps failed: $containers)"
  fi
}

# What `supabase stop` cannot reach.
#
# It stops the containers THIS project owns. A port held by anything else
# survives it, which is exactly the shape of a retry that fails identically to
# the first attempt — as it did on 2026-08-14.
#
# The case that matters is not obvious: an EXITED container still publishes its
# ports. `docker ps -a --filter publish=54322` finds it, `docker ps` does not,
# and `supabase stop` will not touch it because it belongs to some other
# project. Verified locally against a container that had been dead for 13 days
# and was still holding its port mapping.
#
# The removal is REPORTED either way, because "I found nothing to remove" and
# "I removed the thing that was breaking us" are different facts and the next
# person reading this log needs to know which one happened.
free_ports() {
  for port in $PORTS; do
    ids=$(docker ps -aq --filter "publish=${port}" 2>/dev/null || true)
    for id in $ids; do
      name=$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null || echo "$id")
      echo "  removing container $name, which publishes $port"
      docker rm -f "$id" >/dev/null 2>&1 || echo "    (could not remove $name)"
    done
  done
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
free_ports
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
