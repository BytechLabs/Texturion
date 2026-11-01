import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checksumFor, scrubUserdata, setIniKeys, signedBy, UBUNTU_SIGNING_KEY } from "../vm/create.mjs";
import { MARKER } from "../src/vmrun.mjs";
import { MARKER_LINE, parseVmx, vmxText, withoutUserdata } from "../vm/vmx.mjs";

const text = vmxText({ userdata: "dXNlcg==", metadata: "bWV0YQ==" });
const entries = parseVmx(text);
const vmx = Object.fromEntries(entries);

test("the hardware: 8 vCPUs, 24 GB, pvscsi, hardware version 21, Ubuntu", () => {
  assert.equal(vmx["virtualHW.version"], "21");
  assert.equal(vmx.guestOS, "ubuntu-64");
  assert.equal(vmx.numvcpus, "8");
  assert.equal(vmx.memsize, "24576");
  assert.equal(vmx["scsi0.virtualDev"], "pvscsi");
  assert.equal(vmx["scsi0:0.fileName"], "loonext-rig.vmdk");
});

test("the state disk sits outside every snapshot", () => {
  assert.equal(vmx["scsi0:1.fileName"], "loonext-rig-state.vmdk");
  assert.equal(vmx["scsi0:1.mode"], "independent-persistent");
  assert.equal(vmx["scsi0:0.mode"], undefined, "the system disk is snapshotted");
});

test("one NAT adapter on vmxnet3", () => {
  assert.equal(vmx["ethernet0.connectionType"], "nat");
  assert.equal(vmx["ethernet0.virtualDev"], "vmxnet3");
  assert.deepEqual(entries.map(([key]) => key).filter((key) => /^ethernet\d+\.present$/.test(key)), ["ethernet0.present"]);
});

test("cloud-init reads guestinfo, gzip+base64", () => {
  assert.equal(vmx["guestinfo.userdata"], "dXNlcg==");
  assert.equal(vmx["guestinfo.userdata.encoding"], "gzip+base64");
  assert.equal(vmx["guestinfo.metadata"], "bWV0YQ==");
  assert.equal(vmx["guestinfo.metadata.encoding"], "gzip+base64");
});

test("isolation: no shared folders, clipboard or drag and drop, and dialogs answer themselves", () => {
  for (const key of ["isolation.tools.hgfs.disable", "isolation.tools.copy.disable", "isolation.tools.paste.disable", "isolation.tools.dnd.disable"]) {
    assert.equal(vmx[key], "TRUE", key);
  }
  assert.equal(vmx["sharedFolder.maxNum"], "0");
  assert.equal(vmx["msg.autoAnswer"], "TRUE");
});

test("no sound, USB or nested virtualisation", () => {
  const devices = entries.filter(([key]) => /^(sound|usb|ehci|usb_xhci|vhv)[.:]/i.test(key));
  assert.ok(devices.length >= 5);
  for (const [key, value] of devices) assert.equal(value, "FALSE", key);
  assert.ok(!entries.some(([key, value]) => /^(sound|usb|ehci|vhv|serial|parallel|sata\d+:\d+)/i.test(key) && value === "TRUE"));
});

test("the marker line is there, and it is what vmrun.mjs accepts", () => {
  assert.equal(vmx["loonext.rig"], "TRUE");
  assert.ok(text.split("\n").includes(MARKER_LINE));
  assert.match(text, MARKER);
});

test("user-data, which holds the host key, comes out after the first boot; the rest stays", () => {
  const after = parseVmx(withoutUserdata(text));
  assert.ok(!after.some(([key]) => key.startsWith("guestinfo.userdata")));
  assert.deepEqual(after.length, entries.length - 2);
  assert.match(withoutUserdata(text), MARKER);
  assert.equal(Object.fromEntries(after)["guestinfo.metadata"], "bWV0YQ==");
});

test("a value with a quote or a newline is refused", () => {
  assert.throws(() => vmxText({ metadata: 'x"\nusb.present = "TRUE' }), /quote or a newline/);
});

test("the image is used only when SHA256SUMS lists it and the pinned key signed SHA256SUMS", () => {
  const sums = `${"a".repeat(64)} *ubuntu-24.04-server-cloudimg-amd64.img\n${"b".repeat(64)} *ubuntu-24.04-server-cloudimg-amd64.vmdk\n`;
  assert.equal(checksumFor(sums, "ubuntu-24.04-server-cloudimg-amd64.vmdk"), "b".repeat(64));
  assert.equal(checksumFor(sums, "ubuntu-24.04-server-cloudimg-amd64.ova"), null);
  assert.equal(UBUNTU_SIGNING_KEY, "D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81");
  const good = `[GNUPG:] GOODSIG 1A5D6C4C7DB87C81 UEC Image Automatic Signing Key\n[GNUPG:] VALIDSIG ${UBUNTU_SIGNING_KEY} 2026-10-17 1792000000 0 4 0 1 10 00 ${UBUNTU_SIGNING_KEY}\n`;
  assert.equal(signedBy(good, UBUNTU_SIGNING_KEY), true);
  assert.equal(signedBy(good.replaceAll(UBUNTU_SIGNING_KEY, "0".repeat(40)), UBUNTU_SIGNING_KEY), false);
  assert.equal(signedBy("[GNUPG:] BADSIG 1A5D6C4C7DB87C81 x\n", UBUNTU_SIGNING_KEY), false);
  assert.equal(signedBy(`gpg: VALIDSIG ${UBUNTU_SIGNING_KEY}\n`, UBUNTU_SIGNING_KEY), false, "only gpg's status lines count");
});

test("an AVD's config takes the rig's cores and memory", () => {
  assert.equal(setIniKeys("hw.ramSize=2048\nhw.lcd.density=420\n", { "hw.cpu.ncore": "2", "hw.ramSize": "3072" }), "hw.lcd.density=420\nhw.cpu.ncore=2\nhw.ramSize=3072\n");
});

test("user-data leaves the .vmx and every log that quotes it, whole or cut short", () => {
  const dir = mkdtempSync(join(tmpdir(), "rig-vm-"));
  const userdata = Buffer.from("-----BEGIN OPENSSH PRIVATE KEY-----\n".repeat(8)).toString("base64");
  const vmxPath = join(dir, "loonext-rig.vmx");
  writeFileSync(vmxPath, vmxText({ userdata, metadata: "bWV0YQ==" }));
  writeFileSync(join(dir, "vmware.log"), `2026-11-01T10:00:00Z In(05) vmx DICT guestinfo.userdata = "${userdata}"\n`);
  writeFileSync(join(dir, "vmware-1.log"), `2026-11-01T10:00:00Z In(05) vmx guestinfo.userdata = "${userdata.slice(0, 80)}"\n`);
  writeFileSync(join(dir, "vmware-2.log"), "nothing here\n");
  assert.deepEqual(scrubUserdata(dir, vmxPath, userdata).sort(), ["vmware-1.log", "vmware.log"]);
  for (const name of ["loonext-rig.vmx", "vmware.log", "vmware-1.log"]) {
    assert.ok(!readFileSync(join(dir, name), "utf8").includes(userdata.slice(0, 64)), name);
  }
  assert.match(readFileSync(join(dir, "vmware.log"), "utf8"), /guestinfo\.userdata = "\[user-data removed\]"/);
  assert.match(readFileSync(vmxPath, "utf8"), /guestinfo\.metadata/);
  assert.deepEqual(scrubUserdata(dir, vmxPath, userdata), [], "a second pass finds nothing");
});
