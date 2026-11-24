#!/usr/bin/env bash
# Signs and archives Loonext (com.loonext.ios + Share extension) with Apple
# Distribution credentials, exports an App Store IPA, and uploads it to
# App Store Connect via xcrun altool. Falls back to an unsigned archive when
# any signing secret is absent.
set -euo pipefail

has_signing_secrets() {
  [ -n "${APPLE_DISTRIBUTION_P12_BASE64:-}" ] &&
    [ -n "${APPLE_DISTRIBUTION_P12_PASSWORD:-}" ] &&
    [ -n "${IOS_PROVISION_PROFILE_BASE64:-}" ] &&
    [ -n "${IOS_SHARE_PROVISION_PROFILE_BASE64:-}" ] &&
    [ -n "${APP_STORE_CONNECT_API_KEY_ID:-}" ] &&
    [ -n "${APP_STORE_CONNECT_ISSUER_ID:-}" ] &&
    [ -n "${APP_STORE_CONNECT_API_PRIVATE_KEY:-}" ]
}

set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

if ! has_signing_secrets; then
  echo "::notice::iOS signing secrets are incomplete; building unsigned archive."
  xcodebuild archive \
    -project Loonext.xcodeproj \
    -scheme Loonext \
    -archivePath build/Loonext.xcarchive \
    CURRENT_PROJECT_VERSION="$VERSION_CODE" \
    POSTHOG_PROJECT_KEY="${POSTHOG_PROJECT_KEY:-}" \
    CODE_SIGNING_ALLOWED=NO
  set_output uploaded false
  exit 0
fi

WORK=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ios-ship.XXXXXX")
KEYCHAIN="$WORK/build.keychain-db"
ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"

cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$WORK" "$ASC_KEY_PATH"
}
trap cleanup EXIT

install_profile() {
  local b64="$1"
  local tmp="$WORK/$2.mobileprovision"
  local plist="$WORK/$2.plist"
  printf '%s' "$b64" | base64 --decode > "$tmp"
  security cms -D -i "$tmp" > "$plist"
  local uuid team
  uuid=$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$plist")
  team=$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$plist")
  mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
  cp "$tmp" "$HOME/Library/MobileDevice/Provisioning Profiles/${uuid}.mobileprovision"
  printf '%s %s\n' "$uuid" "$team"
}

read -r APP_PROFILE_UUID TEAM_ID < <(install_profile "$IOS_PROVISION_PROFILE_BASE64" app)
read -r SHARE_PROFILE_UUID _ < <(install_profile "$IOS_SHARE_PROVISION_PROFILE_BASE64" share)

KEYCHAIN_PASS=$(openssl rand -hex 24)
security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN"

# Keep existing search keychains while placing the build keychain first.
EXISTING_KEYCHAINS=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#\"}"
  line="${line%\"}"
  [ -n "$line" ] && EXISTING_KEYCHAINS+=("$line")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$KEYCHAIN" "${EXISTING_KEYCHAINS[@]}"

printf '%s' "$APPLE_DISTRIBUTION_P12_BASE64" | base64 --decode > "$WORK/dist.p12"
security import "$WORK/dist.p12" \
  -k "$KEYCHAIN" \
  -P "$APPLE_DISTRIBUTION_P12_PASSWORD" \
  -f pkcs12 \
  -T /usr/bin/codesign \
  -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASS" "$KEYCHAIN"

# Configure manual Release signing on Loonext and LoonextShare only so SwiftPM
# static package targets keep default signing.
plutil -convert json -o "$WORK/project.json" Loonext.xcodeproj/project.pbxproj
python3 - "$WORK/project.json" "$TEAM_ID" "$APP_PROFILE_UUID" "$SHARE_PROFILE_UUID" <<'PY'
import json, sys

path, team_id, app_uuid, share_uuid = sys.argv[1:5]
profiles = {"Loonext": app_uuid, "LoonextShare": share_uuid}
with open(path, "r", encoding="utf-8") as fh:
    proj = json.load(fh)

objs = proj["objects"]
for obj in objs.values():
    if obj.get("isa") == "PBXNativeTarget" and obj.get("name") in profiles:
        specifier = profiles[obj["name"]]
        cfg_list = objs[obj["buildConfigurationList"]]
        for cfg_id in cfg_list["buildConfigurations"]:
            cfg = objs[cfg_id]
            if cfg.get("name") == "Release":
                s = cfg.setdefault("buildSettings", {})
                s["DEVELOPMENT_TEAM"] = team_id
                s["CODE_SIGN_STYLE"] = "Manual"
                s["CODE_SIGN_IDENTITY"] = "Apple Distribution"
                s["PROVISIONING_PROFILE_SPECIFIER"] = specifier

with open(path, "w", encoding="utf-8") as fh:
    json.dump(proj, fh)
PY
plutil -convert xml1 -o Loonext.xcodeproj/project.pbxproj "$WORK/project.json"
plutil -lint Loonext.xcodeproj/project.pbxproj

xcodebuild archive \
  -project Loonext.xcodeproj \
  -scheme Loonext \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath build/Loonext.xcarchive \
  CURRENT_PROJECT_VERSION="$VERSION_CODE" \
  POSTHOG_PROJECT_KEY="${POSTHOG_PROJECT_KEY:-}"

cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.loonext.ios</key>
    <string>${APP_PROFILE_UUID}</string>
    <key>com.loonext.ios.share</key>
    <string>${SHARE_PROFILE_UUID}</string>
  </dict>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath build/Loonext.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist "$WORK/ExportOptions.plist"

IPA=$(find build/export -maxdepth 1 -name '*.ipa' | head -1)
if [ -z "$IPA" ]; then
  echo "::error::xcodebuild -exportArchive produced no .ipa"
  exit 1
fi

mkdir -p "$HOME/.appstoreconnect/private_keys"
printf '%s\n' "$APP_STORE_CONNECT_API_PRIVATE_KEY" > "$ASC_KEY_PATH"
chmod 600 "$ASC_KEY_PATH"

xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
  --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

set_output uploaded true
