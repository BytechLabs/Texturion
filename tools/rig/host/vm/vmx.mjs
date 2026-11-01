// The rig VM's .vmx. Pure: the caller writes it.
//
// Isolation is part of the file: no shared folders, clipboard or drag and
// drop, no sound, USB or nested virtualisation, and the marker line hostd's
// vmrun wrapper requires before it touches the VM.
export const MARKER_LINE = 'loonext.rig = "TRUE"';
export const SYSTEM_DISK = "loonext-rig.vmdk";
export const STATE_DISK = "loonext-rig-state.vmdk";

const FIXED = [
  [".encoding", "UTF-8"],
  ["config.version", "8"],
  ["virtualHW.version", "21"],
  ["displayName", "loonext-rig"],
  ["guestOS", "ubuntu-64"],
  ["numvcpus", "8"],
  ["memsize", "24576"],
  ["scsi0.present", "TRUE"],
  ["scsi0.virtualDev", "pvscsi"],
  ["scsi0:0.present", "TRUE"],
  ["scsi0:0.fileName", SYSTEM_DISK],
  // Outside every snapshot: a revert never rolls the secrets back.
  ["scsi0:1.present", "TRUE"],
  ["scsi0:1.fileName", STATE_DISK],
  ["scsi0:1.mode", "independent-persistent"],
  ["ethernet0.present", "TRUE"],
  ["ethernet0.connectionType", "nat"],
  ["ethernet0.virtualDev", "vmxnet3"],
  ["ethernet0.addressType", "generated"],
  ["isolation.tools.hgfs.disable", "TRUE"],
  ["sharedFolder.maxNum", "0"],
  ["isolation.tools.copy.disable", "TRUE"],
  ["isolation.tools.paste.disable", "TRUE"],
  ["isolation.tools.dnd.disable", "TRUE"],
  ["isolation.tools.unity.disable", "TRUE"],
  ["msg.autoAnswer", "TRUE"],
  ["sound.present", "FALSE"],
  ["usb.present", "FALSE"],
  ["ehci.present", "FALSE"],
  ["usb_xhci.present", "FALSE"],
  ["vhv.enable", "FALSE"],
  ["floppy0.present", "FALSE"],
  ["tools.syncTime", "TRUE"],
];

const quote = (value) => {
  if (/["\r\n]/.test(value)) throw new Error("vmx: a value cannot hold a quote or a newline");
  return `"${value}"`;
};

/** userdata and metadata are gzip+base64 (vm/cloud-init.mjs encode). */
export function vmxText({ userdata, metadata }) {
  const entries = [...FIXED];
  if (userdata !== undefined) {
    entries.push(["guestinfo.userdata", userdata], ["guestinfo.userdata.encoding", "gzip+base64"]);
  }
  entries.push(["guestinfo.metadata", metadata], ["guestinfo.metadata.encoding", "gzip+base64"]);
  entries.push(["loonext.rig", "TRUE"]);
  return `${entries.map(([key, value]) => `${key} = ${quote(value)}`).join("\n")}\n`;
}

/** A .vmx as key and value pairs, in file order. */
export function parseVmx(text) {
  return text
    .split(/\r?\n/)
    .map((line) => /^\s*([^#=\s][^=]*?)\s*=\s*"(.*)"\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]);
}

/** The file without its user-data, once the first boot has read it. */
export function withoutUserdata(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*guestinfo\.userdata(\.encoding)?\s*=/.test(line))
    .join("\n");
}
