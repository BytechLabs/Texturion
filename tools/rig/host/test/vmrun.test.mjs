import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  VMRUN,
  guestIpArgs,
  ownVmx,
  parseStatus,
  revertArgs,
  snapshotArgs,
  startArgs,
  stopArgs,
  vmControls,
} from "../src/vmrun.mjs";

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "vmrun.mjs"), "utf8");

function rigRoot() {
  const root = mkdtempSync(join(tmpdir(), "rig-host-"));
  mkdirSync(join(root, "vm"));
  const vmx = join(root, "vm", "loonext-rig.vmx");
  writeFileSync(vmx, 'displayName = "loonext-rig"\nloonext.rig = "TRUE"\n');
  return { root, vmx };
}

test("its own .vmx, under <root>\\vm and marked, is accepted", () => {
  const { root, vmx } = rigRoot();
  assert.equal(ownVmx(vmx, { root }), vmx);
});

test("a foreign VM outside the root is refused, even with the marker", () => {
  const { root } = rigRoot();
  const other = mkdtempSync(join(tmpdir(), "other-vm-"));
  const foreign = join(other, "Windows 11.vmx");
  writeFileSync(foreign, 'loonext.rig = "TRUE"\n');
  assert.throws(() => ownVmx(foreign, { root }), /is not under/);
  assert.throws(() => ownVmx(join(root, "vm", "..", "escape.vmx"), { root }), /is not under/);
  assert.throws(() => ownVmx(join(root, "loonext-rig.vmx"), { root }), /is not under/);
  assert.throws(() => ownVmx(join(root, "vm"), { root }), /is not under/);
});

test("a .vmx under the root without the marker line is refused", () => {
  const { root } = rigRoot();
  const unmarked = join(root, "vm", "copy.vmx");
  for (const text of ['displayName = "x"\n', '# loonext.rig = "TRUE"\n', 'loonext.rig = "FALSE"\n', 'xloonext.rig = "TRUE"\n']) {
    writeFileSync(unmarked, text);
    assert.throws(() => ownVmx(unmarked, { root }), /no loonext\.rig = "TRUE" line/, text);
  }
  assert.throws(() => ownVmx(join(root, "vm", "missing.vmx"), { root }), /cannot read/);
  writeFileSync(join(root, "vm", "notes.txt"), 'loonext.rig = "TRUE"\n');
  assert.throws(() => ownVmx(join(root, "vm", "notes.txt"), { root }), /not a \.vmx/);
});

test("the argv builders", () => {
  assert.deepEqual(startArgs("v.vmx"), ["-T", "ws", "start", "v.vmx", "nogui"]);
  assert.deepEqual(stopArgs("v.vmx"), ["-T", "ws", "stop", "v.vmx", "soft"]);
  assert.deepEqual(revertArgs("v.vmx", "baseline"), ["-T", "ws", "revertToSnapshot", "v.vmx", "baseline"]);
  assert.deepEqual(snapshotArgs("v.vmx", "baseline"), ["-T", "ws", "snapshot", "v.vmx", "baseline"]);
  assert.deepEqual(guestIpArgs("v.vmx"), ["-T", "ws", "getGuestIPAddress", "v.vmx", "-wait"]);
  assert.throws(() => snapshotArgs("v.vmx", "-gu x"), /snapshot name/);
  assert.throws(() => revertArgs("v.vmx", ""), /snapshot name/);
});

test("controls run vmrun only on the checked .vmx, and never on a foreign one", async () => {
  const { root, vmx } = rigRoot();
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, args]);
    return { code: 0, stdout: "192.168.70.10\n", stderr: "" };
  };
  await vmControls({ vmx, root, exec }).start();
  assert.deepEqual(calls, [[VMRUN, startArgs(vmx)]]);

  const foreign = join(mkdtempSync(join(tmpdir(), "other-vm-")), "x.vmx");
  writeFileSync(foreign, 'loonext.rig = "TRUE"\n');
  const controls = vmControls({ vmx: foreign, root, exec });
  for (const action of [controls.start, controls.stop, controls.status, controls.guestIp, () => controls.revert("baseline")]) {
    await assert.rejects(action(), /is not under/);
  }
  assert.equal(calls.length, 1);
});

test("status comes from getGuestIPAddress without -wait", async () => {
  assert.deepEqual(parseStatus({ code: 0, stdout: "192.168.70.10\r\n" }), { state: "running", address: "192.168.70.10" });
  assert.deepEqual(parseStatus({ code: 255, stdout: "Error: The virtual machine is not powered on: F:\\x.vmx\n" }), { state: "off", address: null });
  assert.equal(parseStatus({ code: 255, stdout: "Error: something else" }).state, "unknown");
  const toolsDown = parseStatus({ code: 255, stdout: "Error: The VMware Tools are not running in the virtual machine: F:\\x.vmx\n" });
  assert.equal(toolsDown.state, "running");
  assert.equal(toolsDown.address, null);
  const { root, vmx } = rigRoot();
  const calls = [];
  await vmControls({ vmx, root, exec: async (file, args) => (calls.push(args), { code: 0, stdout: "192.168.70.10" }) }).status();
  assert.deepEqual(calls, [guestIpArgs(vmx, { wait: false })]);
});

test("the module can enumerate no VM and runs no guest operation", () => {
  assert.doesNotMatch(SOURCE, /list/i);
  assert.doesNotMatch(SOURCE, /-g[up]\b/);
});
