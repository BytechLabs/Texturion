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
