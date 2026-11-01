import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { contractProblems, forwardedPorts, loadContract, serialOf } from "../src/config.mjs";

const RIG = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const box = (path) => readFileSync(join(RIG, "box", path), "utf8");
const contract = loadContract();
const copy = () => structuredClone(contract);

test("the contract is the v1 schema and passes every rule", () => {
  assert.equal(contract.schema, "loonext.rig-host.v1");
  assert.deepEqual(contractProblems(contract), []);
});

test("every console and gRPC port is even and in the emulator's range, and every name is unique", () => {
  for (const device of contract.devices) {
    assert.equal(device.console % 2, 0, device.name);
    assert.ok(device.console >= 5554 && device.console <= 5682, device.name);
    assert.equal(device.grpc % 2, 0, device.name);
    assert.ok(device.grpc >= 8554 && device.grpc <= 8682, device.name);
  }
  assert.equal(new Set(contract.devices.map((device) => device.name)).size, contract.devices.length);
  assert.equal(new Set(contract.devices.map((device) => device.avd)).size, contract.devices.length);
});

test("the API emulators keep today's AVD names and serials; the technician phone is the warm Pixel profile", () => {
  const byName = Object.fromEntries(contract.devices.map((device) => [device.name, device]));
  assert.deepEqual(
    ["emulator-34", "emulator-35", "emulator-36"].map((name) => [byName[name].avd, serialOf(byName[name])]),
    [["rig-api34", "emulator-5554"], ["rig-api35", "emulator-5556"], ["rig-api36", "emulator-5558"]],
  );
  assert.deepEqual(
    { avd: byName.pixel.avd, api: byName.pixel.api, profile: byName.pixel.profile, warm: byName.pixel.warm },
    { avd: "rig-pixel", api: 36, profile: "pixel_8", warm: true },
  );
});

test("the rules catch a repeated name, an odd console, a port pair clash and the agents' adb port", () => {
  const repeated = copy();
  repeated.devices[1].name = "pixel";
  assert.match(contractProblems(repeated).join("\n"), /devices\[1\]\.name repeats devices\[0\]\.name/);

  const odd = copy();
  odd.devices[0].console = 5561;
  assert.match(contractProblems(odd).join("\n"), /devices\[0\]\.console is not an even port/);

  const clash = copy();
  clash.devices[1].console = 5560;
  assert.match(contractProblems(clash).join("\n"), /repeats/);

  const agents = copy();
  agents.adb.server_port = 5037;
  assert.match(contractProblems(agents).join("\n"), /agents' 5037/);

  const schema = copy();
  schema.schema = "loonext.rig-host.v2";
  assert.match(contractProblems(schema).join("\n"), /schema/);

  const tooMany = copy();
  tooMany.max_booted = contract.devices.length + 1;
  assert.match(contractProblems(tooMany).join("\n"), /max_booted/);
});

test("the VM's sshd lets the tunnel bind exactly the contract's loopback ports, and no others", () => {
  const line = box("ssh/sshd-loonext-rig.conf").split("\n").find((entry) => entry.startsWith("PermitListen "));
  const permitted = line.split(/\s+/).slice(1);
  const tunnelled = forwardedPorts(contract).map(([vmPort]) => `127.0.0.1:${vmPort}`);
  assert.deepEqual([...permitted].sort(), [...tunnelled].sort());
  assert.match(box("ssh/sshd-loonext-rig.conf"), /^GatewayPorts no$/m);
  assert.match(box("ssh/sshd-loonext-rig.conf"), /^AllowTcpForwarding remote$/m);
  assert.match(box("ssh/sshd-loonext-rig.conf"), /^PasswordAuthentication no$/m);
  assert.match(box("ssh/sshd-loonext-rig.conf"), /^AllowUsers rig$/m);
});

test("the VM serves the emulators on the contract's address, and admits only the workstation", () => {
  assert.match(box("caddy/Caddyfile"), new RegExp(`^\\s*bind 127\\.0\\.0\\.1 ${contract.vm.address.replace(/\./g, "\\.")}$`, "m"));
  assert.match(box("dnsmasq/emulators.conf"), new RegExp(`^listen-address=${contract.vm.address}$`, "m"));
  assert.match(box("dnsmasq/emulators.conf"), new RegExp(`^address=/rig\\.internal/${contract.vm.address}$`, "m"));
  assert.doesNotMatch(box("dnsmasq/emulators.conf"), /^dhcp-/m);

  const nft = box("nftables/loonext-rig.nft");
  assert.match(nft, /^table inet loonext_rig \{$/m);
  assert.match(nft, new RegExp(`^define host = ${contract.vm.host}$`, "m"));
  assert.match(nft, new RegExp(`^define gateway = ${contract.vm.gateway}$`, "m"));
  assert.match(nft, /type filter hook input priority filter; policy drop;/);
  assert.match(nft, /ip saddr \$host tcp dport \{ 22, 53, 443 \} accept/);
  assert.match(nft, /ip saddr \$host udp dport 53 accept/);
  assert.doesNotMatch(nft, /flush ruleset/);
});

test("the emulators' DNS refuses every production name the VM's own DNS refuses, and keeps Google's push", () => {
  const locals = (text) => [...text.matchAll(/^local=\/(.+)\/$/gm)].map((match) => match[1]);
  const vendorOnly = new Set(["api.telnyx.com", "api.resend.com", "oauth2.googleapis.com", "fcm.googleapis.com", "posthog.com"]);
  const production = locals(box("dnsmasq/host.conf")).filter((name) => !vendorOnly.has(name));
  assert.ok(production.length >= 4);
  assert.deepEqual(locals(box("dnsmasq/emulators.conf")), production);
  assert.doesNotMatch(box("dnsmasq/emulators.conf"), /googleapis/);
});
