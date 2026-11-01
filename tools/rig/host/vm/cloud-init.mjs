// The VM's first-boot configuration, read by cloud-init from VMware
// guestinfo. Pure: the caller supplies the keys and the ref.
//
// Strings are written as JSON, which YAML reads as double-quoted scalars, so
// no key, path or ref can break out of its line.
import { gzipSync } from "node:zlib";

export const REPO_URL = "https://github.com/BytechLabs/Texturion.git";
export const CHECKOUT = "/opt/loonext-rig-bootstrap";
export const SECRETS_MOUNT = "/var/lib/loonext-rig/secrets";
export const SECRETS_LABEL = "rig-secrets";
// The state disk is scsi0:1 on the VM's pvscsi controller (vm/vmx.mjs).
export const SECRETS_DEVICE = "/dev/sdb";

const REF = /^(?!-)[A-Za-z0-9._/-]{1,100}$/;
const q = (value) => JSON.stringify(String(value));

export function encode(text) {
  return gzipSync(Buffer.from(text, "utf8")).toString("base64");
}

/**
 * user-data. The VM's ed25519 host key is supplied, not generated, so the
 * host's known_hosts pins it before the first connection.
 */
export function userData({ clientPublicKey, hostPrivateKey, hostPublicKey, ref }) {
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$/.test(clientPublicKey?.trim() ?? "")) throw new Error("cloud-init: the client key is not an ed25519 public key");
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$/.test(hostPublicKey?.trim() ?? "")) throw new Error("cloud-init: the host key is not an ed25519 public key");
  if (!/-----BEGIN OPENSSH PRIVATE KEY-----/.test(hostPrivateKey ?? "")) throw new Error("cloud-init: the host private key is not an OpenSSH key");
  if (!REF.test(ref ?? "")) throw new Error("cloud-init: not a git ref");
  const lines = [
    "#cloud-config",
    "hostname: loonext-rig",
    // dnsmasq answers no local names, so sudo resolves the hostname from here.
    "manage_etc_hosts: localhost",
    "users:",
    "  - name: rig",
    "    lock_passwd: true",
    "    shell: /bin/bash",
    // Re-running bootstrap.sh and maintenance over SSH need root; the account
    // has no password, so only the pinned key reaches it.
    `    sudo: ${q("ALL=(ALL) NOPASSWD:ALL")}`,
    "    ssh_authorized_keys:",
    `      - ${q(clientPublicKey.trim())}`,
    "ssh_pwauth: false",
    "disable_root: true",
    "ssh_deletekeys: true",
    // Schema-valid (an empty list is not); a supplied key is never regenerated.
    "ssh_genkeytypes: [ed25519]",
    "ssh_keys:",
    `  ed25519_private: ${q(hostPrivateKey.replace(/\r\n/g, "\n"))}`,
    `  ed25519_public: ${q(hostPublicKey.trim())}`,
    // The state disk is formatted once; overwrite false keeps an existing
    // filesystem, so a second first-boot never wipes the secrets.
    "fs_setup:",
    `  - label: ${q(SECRETS_LABEL)}`,
    "    filesystem: ext4",
    `    device: ${q(SECRETS_DEVICE)}`,
    "    partition: none",
    "    overwrite: false",
    "mounts:",
    `  - [${[`LABEL=${SECRETS_LABEL}`, SECRETS_MOUNT, "ext4", "defaults,nofail,nodev,nosuid,noexec,x-systemd.device-timeout=30s", "0", "2"].map(q).join(", ")}]`,
    "package_update: true",
    "packages:",
    "  - git",
    "runcmd:",
    `  - [${["git", "clone", REPO_URL, CHECKOUT].map(q).join(", ")}]`,
    `  - [${["git", "-C", CHECKOUT, "fetch", "origin", ref].map(q).join(", ")}]`,
    `  - [${["git", "-C", CHECKOUT, "checkout", "--detach", "FETCH_HEAD"].map(q).join(", ")}]`,
    `  - [${["bash", `${CHECKOUT}/tools/rig/box/bootstrap.sh`].map(q).join(", ")}]`,
    "",
  ];
  return lines.join("\n");
}

/**
 * meta-data: the instance, its name and a static address on VMnet8. The
 * cleanup list blanks user-data from guestinfo once cloud-init has read it,
 * since it holds the host's private key.
 */
export function metaData({ instanceId, address = "192.168.70.10", gateway = "192.168.70.2", prefix = 24 }) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(instanceId ?? "")) throw new Error("cloud-init: not an instance id");
  return [
    `instance-id: ${q(instanceId)}`,
    "local-hostname: loonext-rig",
    "cleanup-guestinfo:",
    "  - userdata",
    "network:",
    "  version: 2",
    "  ethernets:",
    "    uplink:",
    "      match:",
    "        driver: vmxnet3",
    "      dhcp4: false",
    "      dhcp6: false",
    "      addresses:",
    `        - ${q(`${address}/${prefix}`)}`,
    "      routes:",
    "        - to: default",
    `          via: ${q(gateway)}`,
    "      nameservers:",
    "        addresses:",
    `          - ${q(gateway)}`,
    "",
  ].join("\n");
}
