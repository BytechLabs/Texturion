#!/usr/bin/env bash
# Turns a fresh Ubuntu 24.04 install into the rig box (docs/RIG.md).
#
#   sudo bash tools/rig/box/bootstrap.sh
#
# Run from a checkout of the repository. Safe to run again: each step checks
# before it changes anything, and the certificate authority is generated only
# once. No vendor account is made or signed in to anywhere in it.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "bootstrap.sh: run with sudo" >&2
  exit 1
fi

BOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$BOX/../../.." && pwd)"
RIG_USER=rig
RIG_HOME=/var/lib/loonext-rig
NODE_VERSION=22.20.0
# The public repository. The rig clones it as itself and holds no write access.
REPO_URL="${REPO_URL:-https://github.com/BytechLabs/Texturion.git}"
PNPM_VERSION="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' "$REPO/package.json")"

step() { printf '\n== %s\n' "$*"; }

step "clock and packages"
timedatectl set-timezone UTC
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl git gnupg openssl jq xz-utils \
  docker.io caddy dnsmasq unattended-upgrades

step "node $NODE_VERSION and pnpm $PNPM_VERSION"
if [[ "$(/usr/local/bin/node --version 2>/dev/null)" != "v$NODE_VERSION" ]]; then
  tmp="$(mktemp -d)"
  tarball="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSLo "$tmp/$tarball" "https://nodejs.org/dist/v$NODE_VERSION/$tarball"
  curl -fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$tmp/$tarball" -C /usr/local --strip-components=1
  rm -rf "$tmp"
fi
/usr/local/bin/corepack enable --install-directory /usr/local/bin
/usr/local/bin/corepack prepare "pnpm@$PNPM_VERSION" --activate

step "stripe cli, from Stripe's own package repository"
if ! command -v stripe >/dev/null; then
  curl -fsSL https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor -o /usr/share/keyrings/stripe.gpg
  echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" \
    > /etc/apt/sources.list.d/stripe.list
  apt-get update
  apt-get install -y stripe
fi

step "the rig account"
if ! id "$RIG_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$RIG_USER"
fi
usermod -aG docker "$RIG_USER"
# Its user services run with nobody logged in, and survive reboots.
loginctl enable-linger "$RIG_USER"
install -d -o "$RIG_USER" -g "$RIG_USER" -m 0750 "$RIG_HOME" "$RIG_HOME/state" "$RIG_HOME/work"
install -d -o "$RIG_USER" -g "$RIG_USER" -m 0700 "$RIG_HOME/secrets"

step "the rig's certificate authority (once; never leaves the box but for its certificate)"
install -d -m 0750 -o root -g caddy /etc/loonext-rig/ca
if [[ ! -f /etc/loonext-rig/ca/root.crt ]]; then
  # Name-constrained to rig.internal. The API and web Workers trust it through
  # NODE_EXTRA_CA_CERTS, which is process-wide; the constraint is what keeps
  # that trust from reaching any real host.
  openssl req -x509 -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout /etc/loonext-rig/ca/root.key -out /etc/loonext-rig/ca/root.crt -days 3650 \
    -subj "/CN=Loonext Rig CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,permitted;DNS:rig.internal"
  chown root:caddy /etc/loonext-rig/ca/root.key /etc/loonext-rig/ca/root.crt
  chmod 0640 /etc/loonext-rig/ca/root.key
  chmod 0644 /etc/loonext-rig/ca/root.crt
fi
# The certificate (not the key) goes to the rig: the nonprod APK embeds it and
# the Workers trust it.
install -o "$RIG_USER" -g "$RIG_USER" -m 0600 /etc/loonext-rig/ca/root.crt "$RIG_HOME/secrets/rig-ca.crt"
install -m 0644 /etc/loonext-rig/ca/root.crt /usr/local/share/ca-certificates/loonext-rig-ca.crt
update-ca-certificates

step "caddy for *.rig.internal"
install -m 0644 "$BOX/caddy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl restart caddy

step "name resolution: production and vendor APIs resolve to nothing"
install -m 0644 "$BOX/dnsmasq/host.conf" /etc/loonext-rig/dnsmasq-host.conf
install -m 0644 "$BOX/dnsmasq/ap.conf" /etc/loonext-rig/dnsmasq-ap.conf
install -d /etc/systemd/resolved.conf.d
install -m 0644 "$BOX/systemd/system/resolved-rig.conf" /etc/systemd/resolved.conf.d/loonext-rig.conf
install -m 0644 "$BOX/systemd/system/loonext-rig-dns-host.service" /etc/systemd/system/
install -m 0644 "$BOX/systemd/system/loonext-rig-dns-ap.service" /etc/systemd/system/
systemctl disable --now dnsmasq.service || true
systemctl restart systemd-resolved
systemctl daemon-reload
systemctl enable --now loonext-rig-dns-host.service
systemctl enable loonext-rig-dns-ap.service
rm -f /etc/resolv.conf
printf 'nameserver 127.0.0.1\noptions edns0 trust-ad\n' > /etc/resolv.conf
for blocked in api.loonext.com api.telnyx.com fcm.googleapis.com; do
  if getent hosts "$blocked" >/dev/null; then
    echo "bootstrap.sh: $blocked still resolves; the DNS block is not in place" >&2
    exit 1
  fi
done
getent hosts api.rig.internal >/dev/null

step "unattended upgrades, outside the dial window"
install -m 0644 "$BOX/apt/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
install -m 0644 "$BOX/apt/52loonext-rig-unattended-upgrades" /etc/apt/apt.conf.d/52loonext-rig-unattended-upgrades
install -d /etc/systemd/system/apt-daily.timer.d /etc/systemd/system/apt-daily-upgrade.timer.d
install -m 0644 "$BOX/apt/apt-daily.timer.d/loonext-rig.conf" /etc/systemd/system/apt-daily.timer.d/
install -m 0644 "$BOX/apt/apt-daily-upgrade.timer.d/loonext-rig.conf" /etc/systemd/system/apt-daily-upgrade.timer.d/
systemctl daemon-reload
unattended-upgrade --dry-run >/dev/null

step "the rig's own checkout and its user services"
sudo -u "$RIG_USER" -H bash -s -- "$REPO_URL" "$RIG_HOME" <<'AS_RIG'
set -euo pipefail
url="$1"; home="$2"
if [[ ! -d "$home/tooling/.git" ]]; then
  git clone "$url" "$home/tooling"
fi
git -C "$home/tooling" fetch --tags --prune origin
git -C "$home/tooling" checkout --detach origin/main
(cd "$home/tooling" && pnpm install --frozen-lockfile)
units="$home/tooling/tools/rig/box/systemd/user"
mkdir -p "$HOME/.config/systemd/user"
cp "$units"/*.service "$units"/*.timer "$HOME/.config/systemd/user/"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user daemon-reload
systemctl --user enable loonext-rig-stack.service loonext-rig-api.service loonext-rig-web.service \
  loonext-rig-stripe-listen.service loonext-rig-health.timer
AS_RIG

echo
echo "bootstrap.sh: done. Next, as $RIG_USER: fill $RIG_HOME/secrets (tools/rig/README.md),"
echo "then: node $RIG_HOME/tooling/tools/rig/bin/rig.mjs deploy --ref main"
