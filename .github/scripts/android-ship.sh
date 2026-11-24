#!/usr/bin/env bash
# Builds (optionally signed) Loonext Android release bundle and uploads it to
# Google Play internal testing track via the Android Publisher v3 API.
# Falls back to unsigned builds / manual handoff notices when signing or Play
# Console credentials are absent or the Play Console app record is not created yet.
set -euo pipefail

has_keystore_secrets() {
  [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] &&
    [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] &&
    [ -n "${ANDROID_KEY_ALIAS:-}" ] &&
    [ -n "${ANDROID_KEY_PASSWORD:-}" ]
}

set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

MODE="${1:-}"
case "$MODE" in
  build)
    WORK=""
    cleanup() {
      if [ -n "$WORK" ]; then
        rm -rf "$WORK"
      fi
    }
    trap cleanup EXIT

    if has_keystore_secrets; then
      WORK=$(mktemp -d "${RUNNER_TEMP:-/tmp}/android-sign.XXXXXX")
      printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$WORK/upload.jks"
      export ANDROID_KEYSTORE_PATH="$WORK/upload.jks"
    else
      echo "::notice::Android keystore secrets are incomplete; building unsigned release bundle."
    fi

    ./gradlew :app:bundleRelease \
      -PloonextVersionCode="$VERSION_CODE" \
      -PloonextPostHogKey="${POSTHOG_PROJECT_KEY:-}"
    ;;

  upload)
    if ! has_keystore_secrets || [ -z "${PLAY_SERVICE_ACCOUNT_JSON:-}" ]; then
      echo "::notice::Android signing or Play Console secrets are incomplete; built bundle attached to this run for manual upload."
      set_output uploaded false
      exit 0
    fi

    AAB=$(find app/build/outputs/bundle/release -maxdepth 1 -name '*.aab' | head -1)
    if [ -z "$AAB" ]; then
      echo "::error::Gradle :app:bundleRelease produced no .aab"
      exit 1
    fi

    export AAB_PATH="$AAB"
    export PLAY_PACKAGE_NAME="com.loonext.android"

    set +e
    node <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs";

const packageName = process.env.PLAY_PACKAGE_NAME;
const aabPath = process.env.AAB_PATH;
const rawSa = process.env.PLAY_SERVICE_ACCOUNT_JSON;
const sa = fs.existsSync(rawSa)
  ? JSON.parse(fs.readFileSync(rawSa, "utf8"))
  : JSON.parse(rawSa);

const b64url = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

const now = Math.floor(Date.now() / 1000);
const header = b64url({ alg: "RS256", typ: "JWT" });
const claim = b64url({
  iss: sa.client_email,
  scope: "https://www.googleapis.com/auth/androidpublisher",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
});
const unsigned = `${header}.${claim}`;
const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
const assertion = `${unsigned}.${sig}`;

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }),
  signal: AbortSignal.timeout(30000),
});
if (!tokenRes.ok) {
  console.error("OAuth token exchange failed:", tokenRes.status, await tokenRes.text());
  process.exit(1);
}
const { access_token: token } = await tokenRes.json();

const apiBase = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;
const uploadBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}`;
const authHeaders = { Authorization: `Bearer ${token}` };

const editRes = await fetch(`${apiBase}/edits`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(30000),
});
if (editRes.status === 404) {
  console.log(`::warning::Google Play app ${packageName} does not exist yet in Play Console; skipping upload while leaving the signed bundle attached to this run.`);
  process.exit(42);
}
if (!editRes.ok) {
  console.error("Play edit creation failed:", editRes.status, await editRes.text());
  process.exit(1);
}
const edit = await editRes.json();

const aabBytes = fs.readFileSync(aabPath);
const uploadRes = await fetch(`${uploadBase}/edits/${edit.id}/bundles?uploadType=media`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/octet-stream" },
  body: aabBytes,
  signal: AbortSignal.timeout(300000),
});
if (!uploadRes.ok) {
  console.error("AAB upload failed:", uploadRes.status, await uploadRes.text());
  process.exit(1);
}
const bundle = await uploadRes.json();

const updateTrack = async (status) =>
  fetch(`${apiBase}/edits/${edit.id}/tracks/internal`, {
    method: "PUT",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      track: "internal",
      releases: [{ versionCodes: [String(bundle.versionCode)], status }],
    }),
    signal: AbortSignal.timeout(30000),
  });

let trackRes = await updateTrack("completed");
if (!trackRes.ok && trackRes.status === 400) {
  const errText = await trackRes.text();
  if (errText.toLowerCase().includes("draft")) {
    trackRes = await updateTrack("draft");
  } else {
    console.error("Play track update failed:", trackRes.status, errText);
    process.exit(1);
  }
}
if (!trackRes.ok) {
  console.error("Play track update failed:", trackRes.status, await trackRes.text());
  process.exit(1);
}

const commitRes = await fetch(`${apiBase}/edits/${edit.id}:commit`, {
  method: "POST",
  headers: authHeaders,
  signal: AbortSignal.timeout(30000),
});
if (!commitRes.ok) {
  console.error("Play edit commit failed:", commitRes.status, await commitRes.text());
  process.exit(1);
}
console.log(`Uploaded ${packageName} versionCode=${bundle.versionCode} to Play Console internal track (edit=${edit.id}).`);
NODE
    STATUS=$?
    set -e

    if [ "$STATUS" -eq 42 ]; then
      set_output uploaded false
      exit 0
    fi
    if [ "$STATUS" -ne 0 ]; then
      exit "$STATUS"
    fi

    set_output uploaded true
    ;;

  *)
    echo "::error::Usage: android-ship.sh <build|upload>"
    exit 1
    ;;
esac
