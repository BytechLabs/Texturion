import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { CHECKOUT, REPO_URL, SECRETS_MOUNT, encode, metaData, userData } from "../vm/cloud-init.mjs";

const HOST_PRIVATE = "-----BEGIN OPENSSH PRIVATE KEY-----\r\nb3BlbnNzaC1rZXktdjEAAAAA\r\n-----END OPENSSH PRIVATE KEY-----\r\n";
const HOST_PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyForTestsOnly root@loonext-rig";
const CLIENT_PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIClientKeyForTestsOnly loonext-rig-host\n";
const input = { clientPublicKey: CLIENT_PUBLIC, hostPrivateKey: HOST_PRIVATE, hostPublicKey: HOST_PUBLIC, ref: "main" };
const user = userData(input);
const lines = user.split("\n");
/** The JSON-quoted value of `key:` at the given indent. */
const valueOf = (key) => {
  const line = lines.find((entry) => entry.trimStart().startsWith(`${key}: `));
  return line === undefined ? undefined : line.slice(line.indexOf(": ") + 2);
};

test("user-data is cloud-config with the rig account by key alone, its password locked", () => {
  assert.equal(lines[0], "#cloud-config");
  assert.ok(lines.includes("  - name: rig"));
  assert.ok(lines.includes("    lock_passwd: true"));
  assert.ok(lines.includes("ssh_pwauth: false"));
  assert.ok(lines.includes("disable_root: true"));
  const keyAt = lines.indexOf("    ssh_authorized_keys:");
  assert.equal(JSON.parse(lines[keyAt + 1].replace(/^\s*- /, "")), CLIENT_PUBLIC.trim());
  assert.ok(!/passwd: "|plain_text_passwd|hashed_passwd|chpasswd/.test(user));
});

test("the VM's host key is the one the host pinned, and no other is generated", () => {
  assert.equal(JSON.parse(valueOf("ed25519_private")), HOST_PRIVATE.replace(/\r\n/g, "\n"));
  assert.equal(JSON.parse(valueOf("ed25519_public")), HOST_PUBLIC);
  assert.ok(lines.includes("ssh_deletekeys: true"));
  assert.ok(lines.includes("ssh_genkeytypes: []"));
});

test("the state disk is formatted once and mounted at the secrets directory", () => {
  assert.equal(JSON.parse(valueOf("- label")), "rig-secrets");
  assert.ok(lines.includes("    overwrite: false"));
  const mount = JSON.parse(lines[lines.indexOf("mounts:") + 1].replace(/^\s*- /, ""));
  assert.deepEqual(mount.slice(0, 3), ["LABEL=rig-secrets", SECRETS_MOUNT, "ext4"]);
  assert.equal(SECRETS_MOUNT, "/var/lib/loonext-rig/secrets");
  assert.match(mount[3], /nodev,nosuid,noexec/);
});

test("runcmd clones the public repository at the ref and runs bootstrap.sh", () => {
  const runcmd = lines.slice(lines.indexOf("runcmd:") + 1).filter((line) => line.startsWith("  - ")).map((line) => JSON.parse(line.slice(4)));
  assert.deepEqual(runcmd, [
    ["git", "clone", REPO_URL, CHECKOUT],
    ["git", "-C", CHECKOUT, "fetch", "origin", "main"],
    ["git", "-C", CHECKOUT, "checkout", "--detach", "FETCH_HEAD"],
    ["bash", `${CHECKOUT}/tools/rig/box/bootstrap.sh`],
  ]);
  assert.equal(REPO_URL, "https://github.com/BytechLabs/Texturion.git");
  assert.match(userData({ ...input, ref: "v1.2.3" }), /"fetch", "origin", "v1.2.3"/);
});

test("a ref or key that could break out of its line is refused", () => {
  for (const ref of ["--upload-pack=x", "main\nruncmd: x", "a b", ""]) assert.throws(() => userData({ ...input, ref }), /git ref/, ref);
  assert.throws(() => userData({ ...input, clientPublicKey: "ssh-rsa AAAA" }), /client key/);
  assert.throws(() => userData({ ...input, hostPublicKey: `${HOST_PUBLIC}\nruncmd:` }), /host key/);
  assert.throws(() => userData({ ...input, hostPrivateKey: "x" }), /private key/);
});

test("meta-data gives the VM its static address on VMnet8, the gateway as DNS, and blanks user-data after reading", () => {
  const meta = metaData({ instanceId: "loonext-rig-2026-11-01" });
  assert.match(meta, /^instance-id: "loonext-rig-2026-11-01"$/m);
  assert.match(meta, /^local-hostname: loonext-rig$/m);
  assert.match(meta, /^cleanup-guestinfo:\n {2}- userdata$/m);
  assert.match(meta, /^ {2}version: 2$/m);
  assert.match(meta, /^ {6}dhcp4: false$/m);
  assert.match(meta, /^ {8}- "192\.168\.70\.10\/24"$/m);
  assert.match(meta, /^ {10}via: "192\.168\.70\.2"$/m);
  assert.match(meta, /^ {6}nameservers:\n {8}addresses:\n {10}- "192\.168\.70\.2"$/m);
  assert.throws(() => metaData({ instanceId: "x y" }), /instance id/);
});

test("guestinfo carries both documents gzip+base64", () => {
  assert.equal(gunzipSync(Buffer.from(encode(user), "base64")).toString("utf8"), user);
  assert.match(encode(user), /^[A-Za-z0-9+/]+=*$/);
});
