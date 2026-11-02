#!/usr/bin/env bash
# Turns a fresh Ubuntu 24.04 cloud image in the loonext-rig VM into the rig
# (docs/RIG.md). cloud-init runs it on the VM's first boot
# (tools/rig/host/vm/cloud-init.mjs).
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

# Only inside the rig's own VMware VM, and only with shared folders off: the
# workstation's drives hold production keys.
if [[ "$(systemd-detect-virt 2>/dev/null || true)" != vmware ]]; then
  echo "bootstrap.sh: this is not the loonext-rig VMware VM" >&2
  exit 1
fi
if [[ -e /mnt/hgfs ]]; then
  echo "bootstrap.sh: /mnt/hgfs exists; the VM must have no shared folders" >&2
  exit 1
fi

BOX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$BOX/../../.." && pwd)"
RIG_USER=rig
RIG_HOME=/var/lib/loonext-rig
NODE_VERSION=22.20.0
# The primary key of "Google Inc. (Linux Packages Signing Authority)", which signs
# dl.google.com's Chrome repository (checked 2026-11-02). A key with any other
# fingerprint is refused.
CHROME_SIGNER_FPR=EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796
# The public repository. The rig clones it as itself and holds no write access.
REPO_URL="${REPO_URL:-https://github.com/BytechLabs/Texturion.git}"
PNPM_VERSION="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' "$REPO/package.json")"

step() { printf '\n== %s\n' "$*"; }

step "clock and packages"
timedatectl set-timezone UTC
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl git gnupg openssl jq unzip xz-utils \
  docker.io caddy dnsmasq nftables openssh-server unattended-upgrades libnss3-tools xvfb

step "firewall and sshd: only the workstation opens connections in"
install -d -m 0755 /etc/loonext-rig
install -m 0644 "$BOX/nftables/loonext-rig.nft" /etc/loonext-rig/nftables.nft
# No `flush ruleset`, unlike the stock file: docker keeps its tables.
printf '#!/usr/sbin/nft -f\ninclude "/etc/loonext-rig/nftables.nft"\n' > /etc/nftables.conf
nft -c -f /etc/nftables.conf
# The stock unit flushes the whole ruleset on stop, docker's tables with it.
install -d /etc/systemd/system/nftables.service.d
printf '[Service]\nExecStop=\nExecStop=/usr/sbin/nft delete table inet loonext_rig\n' \
  > /etc/systemd/system/nftables.service.d/loonext-rig.conf
systemctl daemon-reload
systemctl enable nftables.service
systemctl restart nftables.service
nft list table inet loonext_rig >/dev/null
install -m 0644 "$BOX/ssh/sshd-loonext-rig.conf" /etc/ssh/sshd_config.d/40-loonext-rig.conf
# ssh is socket-activated, so on first boot nothing has made this yet.
install -d -m 0755 /run/sshd
sshd -t
systemctl try-reload-or-restart ssh.service

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

step "google chrome stable, from Google's own package repository"
# Web Push (S21, D08) needs a browser with a push service, which Playwright's
# Chromium does not have. The lane runs Chrome in its own headless mode, so no
# display is needed.
if ! command -v google-chrome-stable >/dev/null; then
  tmp="$(mktemp -d)"
  curl -fsSLo "$tmp/linux_signing_key.pub" https://dl.google.com/linux/linux_signing_key.pub
  if [[ "$(gpg --show-keys --with-colons "$tmp/linux_signing_key.pub" | grep -c '^pub:')" != 1 ]]; then
    echo "bootstrap.sh: Google's signing key file does not hold exactly one key" >&2
    exit 1
  fi
  got="$(gpg --show-keys --with-colons "$tmp/linux_signing_key.pub" | awk -F: '/^fpr:/ { print $10; exit }')"
  if [[ "$got" != "$CHROME_SIGNER_FPR" ]]; then
    echo "bootstrap.sh: Google's signing key is $got, not the pinned $CHROME_SIGNER_FPR" >&2
    exit 1
  fi
  gpg --dearmor < "$tmp/linux_signing_key.pub" > /usr/share/keyrings/google-chrome.gpg
  rm -rf "$tmp"
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  # Keeps the package from trusting its key for every repository; the source it leaves
  # (google-chrome.sources) is signed by the keyring above alone.
  printf 'repo_add_once="false"\nrepo_reenable_on_distupgrade="false"\n' > /etc/default/google-chrome
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y google-chrome-stable
fi
google-chrome-stable --version

step "the rig account"
if ! id "$RIG_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$RIG_USER"
fi
usermod -aG docker "$RIG_USER"
# Its user services run with nobody logged in, and survive reboots.
loginctl enable-linger "$RIG_USER"
# rig health lists the firewall table with sudo -n, whatever other sudo the account has.
visudo -cf "$BOX/sudoers/loonext-rig-health"
install -m 0440 "$BOX/sudoers/loonext-rig-health" /etc/sudoers.d/loonext-rig-health
install -d -o "$RIG_USER" -g "$RIG_USER" -m 0750 "$RIG_HOME" "$RIG_HOME/state" "$RIG_HOME/work"
install -d -o "$RIG_USER" -g "$RIG_USER" -m 0700 "$RIG_HOME/secrets"
# The secrets live on the VM's independent-persistent disk, outside every
# snapshot, so a revert never rolls them back.
if ! findmnt --mountpoint "$RIG_HOME/secrets" >/dev/null; then
  echo "bootstrap.sh: $RIG_HOME/secrets is not the state disk's mountpoint" >&2
  exit 1
fi
if [[ "$(stat -c %a "$RIG_HOME/secrets")" != 700 ]]; then
  echo "bootstrap.sh: $RIG_HOME/secrets is not 0700" >&2
  exit 1
fi

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
install -d /etc/systemd/system/caddy.service.d
install -m 0644 "$BOX/systemd/system/caddy-rig.conf" /etc/systemd/system/caddy.service.d/loonext-rig.conf
install -m 0644 "$BOX/caddy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy
# validate opens no listener; this is where a bind would fail.
systemctl is-active --quiet caddy

step "name resolution: production and vendor APIs resolve to nothing"
install -m 0644 "$BOX/dnsmasq/host.conf" /etc/loonext-rig/dnsmasq-host.conf
install -m 0644 "$BOX/dnsmasq/emulators.conf" /etc/loonext-rig/dnsmasq-emulators.conf
install -d /etc/systemd/resolved.conf.d
install -m 0644 "$BOX/systemd/system/resolved-rig.conf" /etc/systemd/resolved.conf.d/loonext-rig.conf
install -m 0644 "$BOX/systemd/system/loonext-rig-dns-host.service" /etc/systemd/system/
install -m 0644 "$BOX/systemd/system/loonext-rig-dns-emulators.service" /etc/systemd/system/
systemctl disable --now dnsmasq.service || true
systemctl restart systemd-resolved
systemctl daemon-reload
systemctl enable --now loonext-rig-dns-host.service
systemctl enable --now loonext-rig-dns-emulators.service
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
# The browser lane (S01-S35's pages) launches Playwright's own Chromium; the
# build number moves with the pinned playwright, so it is fetched here.
(cd "$home/tooling/tools/rig/lanes" && pnpm exec playwright install chromium)
# The JDK and Android SDK for `rig apk`. The SDK packages wait for FA15's
# licence acceptance (android-toolchain.sh --accept-licences).
bash "$home/tooling/tools/rig/box/android-toolchain.sh"
units="$home/tooling/tools/rig/box/systemd/user"
mkdir -p "$HOME/.config/systemd/user"
cp "$units"/*.service "$HOME/.config/systemd/user/"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user daemon-reload
systemctl --user enable loonext-rig-stack.service loonext-rig-api.service loonext-rig-web.service \
  loonext-rig-stripe-listen.service
AS_RIG

# Chromium reads trust from the user's NSS database, not the system store, so the
# browser lane trusts the rig's authority (name-constrained to rig.internal) there.
sudo -u "$RIG_USER" -H bash -s -- "$RIG_HOME" <<'AS_RIG_NSS'
set -euo pipefail
nss="sql:$HOME/.pki/nssdb"
mkdir -p "$HOME/.pki/nssdb"
certutil -d "$nss" -L >/dev/null 2>&1 || certutil -d "$nss" -N --empty-password
certutil -d "$nss" -D -n "Loonext Rig CA" >/dev/null 2>&1 || true
certutil -d "$nss" -A -t "C,," -n "Loonext Rig CA" -i "$1/secrets/rig-ca.crt"
AS_RIG_NSS

# Chromium's shared libraries, which need root.
(cd "$RIG_HOME/tooling/tools/rig/lanes" && pnpm exec playwright install-deps chromium)

echo
echo "bootstrap.sh: done. Next, as $RIG_USER: fill $RIG_HOME/secrets (tools/rig/README.md),"
echo "then, with XDG_RUNTIME_DIR=/run/user/\$(id -u) set: node $RIG_HOME/tooling/tools/rig/bin/rig.mjs deploy --ref main"
