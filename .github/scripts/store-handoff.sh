#!/usr/bin/env bash
# File (or update) the one to-do that stands between a built artifact and a
# shipped app. Called by ship.yml's `handoff` job. See #443.
#
# In a script rather than inline YAML because it has real branching, and a shell
# heredoc nested inside a YAML block scalar is where release tooling goes to die.
set -euo pipefail

ANDROID_TAG=$(git tag --points-at HEAD | grep '^android-v' | head -1 || true)
IOS_TAG=$(git tag --points-at HEAD | grep '^ios-v' | head -1 || true)

# No mobile tag means no mobile release: a manual dispatch, or a release that
# touched only the API and web. Nothing for a human to upload, so nothing to file.
if [ -z "$ANDROID_TAG" ] && [ -z "$IOS_TAG" ]; then
  echo "::notice::No android-v* or ios-v* tag on this commit — no store handoff needed."
  exit 0
fi

# The artifacts expire, and an unsigned archive that expires is a release that
# cannot be shipped without a rebuild. Recoverable, but the clock should be on the
# to-do rather than implied by upload-artifact's default.
EXPIRES=$(date -u -d "+90 days" +%Y-%m-%d)

VERSIONS=$(printf '%s %s' "${ANDROID_TAG:-}" "${IOS_TAG:-}" | xargs)
TITLE="Upload to the stores: ${VERSIONS}"

/usr/bin/env cat > /tmp/handoff-body.md <<BODY
The artifacts for this release are built and attached to the run. **Signing and
uploading is the manual half**, because the repo holds no distribution
certificate, no App Store Connect key, and no Play service account.

This issue exists so that half is *tracked*. Before it, the only record was a
\`::notice::\` in a run log, while the same push tagged a version, wrote a
changelog, and generated the store's "What's new" text — so a release could look
complete while the app was never submitted (#443).

**Run:** ${RUN_URL}
**Artifacts expire:** ${EXPIRES} (90 days). After that the release needs a rebuild
before it can be shipped.

| Platform | Build | Tag |
|---|---|---|
| Android | \`${ANDROID_RESULT}\` | ${ANDROID_TAG:-none} |
| iOS | \`${IOS_RESULT}\` | ${IOS_TAG:-none} |

### Before uploading either one

- [ ] Work through **\`docs/RELEASING.md\` → "Before submitting to either store"**.
      The store declarations are binding legal statements about data handling, and
      a wrong one does not fail at submission — it gets the app pulled weeks later.

### Android

- [ ] Download \`loonext-android-release\` from the run and upload the \`.aab\` at
      play.google.com/console.
- [ ] Paste the generated release notes as "What's new".

### iOS

- [ ] Download \`loonext-ios-archive\` from the run, sign it, and upload from Xcode.
      The archive is deliberately unsigned: it proves the release configuration
      builds, which is the part that goes wrong.
- [ ] Paste the generated release notes as "What's new".

### After the stores have it

- [ ] A week later, confirm anyone is actually running it:
      \`node scripts/ops/version-distribution.mjs\`. Tagging a version and having
      nobody on it is the failure this last step exists to catch, and it is only
      answerable because #339 shipped the telemetry.
- [ ] Close this issue. It is open precisely because the work is not done.
BODY

EXISTING=$(gh issue list --state open --search "$TITLE in:title" \
  --json number,title --jq ".[] | select(.title == \"$TITLE\") | .number" | head -1)

if [ -n "$EXISTING" ]; then
  # A re-run of the same release. Comment rather than filing a duplicate: two
  # issues for one upload is how a checklist stops being believed.
  gh issue comment "$EXISTING" \
    --body "Re-run of this release: artifacts rebuilt at ${RUN_URL} (expire ${EXPIRES})."
  echo "::notice::Store handoff already tracked in #${EXISTING}; commented."
  exit 0
fi

NUMBER=$(gh issue create --title "$TITLE" --body-file /tmp/handoff-body.md \
  --label P1 | grep -oE '[0-9]+$' || true)
echo "::notice::Store handoff to-do filed: #${NUMBER:-?} — ${TITLE}"

# ---------------------------------------------------------------------------
# Retire the handoffs this release makes unshippable (#498).
#
# The dedupe above only catches a RE-RUN of the same release. An older
# release's handoff stayed open forever, because only the founder can close it
# and nobody submits a build a release behind — so the P1 list grew by one per
# release and every entry after the newest was noise. Noise on a list whose
# whole job is to be believed (#443) is the failure this script exists to
# prevent, arriving by a slower route.
#
# PER-PLATFORM, because the tags advance independently. A release that tags
# Android alone must not close an issue whose iOS half is still genuinely
# waiting to be uploaded — that would silently drop a real to-do, which is
# strictly worse than the noise. So an older issue is closed only when EVERY
# platform it names has been superseded here, and is otherwise commented on so
# the stale half is marked without losing the live one.
# ---------------------------------------------------------------------------

# Is $2 a strictly newer version string than $1? (`sort -V`, so 0.10.0 > 0.9.0.)
newer_than() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ]
}

# The tag this run has for a platform prefix, or empty.
tag_for() {
  case "$1" in
    android) printf '%s' "${ANDROID_TAG:-}" ;;
    ios) printf '%s' "${IOS_TAG:-}" ;;
  esac
}

# Collected before the loop, and tolerant of failure: the new issue is already
# filed by this point, so a GitHub hiccup during cleanup must not fail the step
# and make a green release look broken. The worst case is one stale P1 that the
# next release retires instead.
OPEN_HANDOFFS=$(gh issue list --state open --search 'Upload to the stores in:title' \
  --json number,title --jq '.[] | "\(.number)\t\(.title)"' || true)

while IFS=$'\t' read -r OLD_NUMBER OLD_TITLE; do
  [ -z "$OLD_NUMBER" ] && continue
  [ "$OLD_NUMBER" = "${NUMBER:-}" ] && continue

  STALE=""
  LIVE=""
  for PLATFORM in android ios; do
    OLD_TAG=$(printf '%s' "$OLD_TITLE" | grep -oE "${PLATFORM}-v[0-9]+\.[0-9]+\.[0-9]+" | head -1 || true)
    [ -z "$OLD_TAG" ] && continue
    NEW_TAG=$(tag_for "$PLATFORM")
    if [ -n "$NEW_TAG" ] && newer_than "$OLD_TAG" "$NEW_TAG"; then
      STALE="${STALE}${STALE:+, }${OLD_TAG} (superseded by ${NEW_TAG})"
    else
      LIVE="${LIVE}${LIVE:+, }${OLD_TAG}"
    fi
  done

  [ -z "$STALE" ] && continue

  if [ -n "$LIVE" ]; then
    gh issue comment "$OLD_NUMBER" --body "Partly superseded by #${NUMBER:-?}: \
${STALE}. Still to upload from this issue: ${LIVE}."
    echo "::notice::#${OLD_NUMBER} partly superseded (${STALE}); left open for ${LIVE}."
  else
    gh issue comment "$OLD_NUMBER" --body "Superseded by #${NUMBER:-?}: ${STALE}. \
Closing rather than leaving it open — submitting this build now would put \
customers a release behind, and the newer artifacts are already built. If it \
was never shipped, nothing is lost: the newer release contains it."
    gh issue close "$OLD_NUMBER" --reason "not planned"
    echo "::notice::#${OLD_NUMBER} closed as superseded (${STALE})."
  fi
done <<< "$OPEN_HANDOFFS"
