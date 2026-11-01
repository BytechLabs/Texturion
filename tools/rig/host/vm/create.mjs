#!/usr/bin/env node
// Makes the rig's VMware VM, unattended, on the Windows workstation (D142).
//
//   node tools/rig/host/vm/create.mjs --ref <git ref> --yes
//   node tools/rig/host/vm/create.mjs --dry-run
//   node tools/rig/host/vm/create.mjs --sdk-only --yes
//
// Eleven steps, in order. It refuses when a .vmx is
// already under <root>\vm, so it never touches an existing VM, and it
// downloads only from Ubuntu and Google, verifying each file before use.
// --sdk-only repeats step 10 alone, for after the SDK licences are accepted.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { OPENSSH_DIR, VMWARE_DIR, loadContract, loadHostConfig } from "../src/config.mjs";
import { SSH, commandArgs } from "../src/tunnel.mjs";
import { vmControls } from "../src/vmrun.mjs";
import { encode, metaData, userData } from "./cloud-init.mjs";
import { STATE_DISK, SYSTEM_DISK, vmxText, withoutUserdata } from "./vmx.mjs";

const IMAGE_BASE = "https://cloud-images.ubuntu.com/releases/noble/release";
export const IMAGE_NAME = "ubuntu-24.04-server-cloudimg-amd64.vmdk";
/**
 * The UEC Image Automatic Signing Key that signs cloud-images.ubuntu.com's
 * SHA256SUMS, as ubuntu.com/docs/public-images (public-images-how-to/
 * verify-image-checksum) documents it, fetched 2026-11-01.
 */
export const UBUNTU_IMAGE_SIGNER = "D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81";
const KEYSERVER = "hkps://keyserver.ubuntu.com";
/** developer.android.com/studio, "Command line tools only", fetched 2026-11-01. */
export const CMDLINE_TOOLS = {
  url: "https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip",
  sha256: "90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a",
};
const GPG = "C:\\Program Files\\Git\\usr\\bin\\gpg.exe";
const GPGCONF = "C:\\Program Files\\Git\\usr\\bin\\gpgconf.exe";
const TAR = "C:\\Windows\\System32\\tar.exe";
const VDISK = join(VMWARE_DIR, "vmware-vdiskmanager.exe");
const VMCLI = join(VMWARE_DIR, "vmcli.exe");
const SSH_KEYGEN = join(OPENSSH_DIR, "ssh-keygen.exe");
const IMAGE_PKG = (api) => `system-images;android-${api};google_apis_playstore;x86_64`;
const AVD_HARDWARE = { "hw.cpu.ncore": "2", "hw.ramSize": "3072" };

/** The checksum SHA256SUMS lists for a file, or null. */
export function checksumFor(sums, name) {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
}

/**
 * True only when gpg's status output reports a good signature by the pinned
 * key: VALIDSIG names the signing key first and the primary key last.
 */
export function signedBy(status, fingerprint) {
  return status.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "[GNUPG:]" || fields[1] !== "VALIDSIG") return false;
    return fields[2] === fingerprint || fields[fields.length - 1] === fingerprint;
  });
}

/**
 * Takes user-data, which holds the VM's host private key, out of the .vmx and
 * out of any vmware*.log in its folder that quotes it. Returns the logs it
 * changed. A log may hold only the start of the value, so a match on its
 * first 64 characters removes the whole base64 run.
 */
export function scrubUserdata(dir, vmxPath, userdata) {
  if (existsSync(vmxPath)) writeFileSync(vmxPath, withoutUserdata(readFileSync(vmxPath, "utf8")));
  const head = userdata.slice(0, 64);
  const quoted = new RegExp(`${head.replace(/[+/=]/g, (char) => `\\${char}`)}[A-Za-z0-9+/=]*`, "g");
  const changed = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!/^vmware.*\.log$/i.test(name)) continue;
    const path = join(dir, name);
    const text = readFileSync(path, "utf8");
    if (!text.includes(head)) continue;
    writeFileSync(path, text.replace(quoted, "[user-data removed]"));
    changed.push(name);
  }
  return changed;
}

/** key=value lines of an AVD's config.ini, with these keys set. */
export function setIniKeys(text, values) {
  const lines = text.split(/\r?\n/).filter((line) => line !== "" && !Object.hasOwn(values, line.split("=")[0].trim()));
  return `${[...lines, ...Object.entries(values).map(([key, value]) => `${key}=${value}`)].join("\n")}\n`;
}

function step(number, what) {
  console.log(`\n== ${number}. ${what}`);
}

function run(file, args, { env, input, verbatim = false, quiet = false } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, {
      env,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.once("error", fail);
    child.once("close", (code) => done({ code: code ?? -1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
  });
}

async function must(file, args, options) {
  const result = await run(file, args, options);
  if (result.code !== 0) throw new Error(`${file} ${args[0] ?? ""} failed (${result.code})`);
  return result;
}

/** A .bat through cmd.exe, which Node will not start directly. */
function runBat(bat, args, options) {
  const line = [`"${bat}"`, ...args.map((arg) => (/[\s;]/.test(arg) ? `"${arg}"` : arg))].join(" ");
  return must("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...options, verbatim: true });
}

async function download(url, dest) {
  if (existsSync(dest)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${dest}.part`));
  renameSync(`${dest}.part`, dest);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const slashed = (path) => path.replace(/\\/g, "/");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Git's gpg is an MSYS program: it reads a drive path in an argument, but
 * takes GNUPGHOME as relative unless it is in /f/... form.
 */
export function msysPath(path) {
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path);
  return drive ? `/${drive[1].toLowerCase()}/${slashed(drive[2])}` : slashed(path);
}

async function verifyImage(dl) {
  const gnupg = join(dl, "gnupg");
  rmSync(gnupg, { recursive: true, force: true });
  mkdirSync(gnupg, { recursive: true });
  const env = { ...process.env, GNUPGHOME: msysPath(gnupg) };
  let verify;
  try {
    await must(GPG, ["--batch", "--keyserver", KEYSERVER, "--recv-keys", UBUNTU_IMAGE_SIGNER], { env });
    verify = await run(GPG, ["--batch", "--status-fd", "1", "--verify", slashed(join(dl, "SHA256SUMS.gpg")), slashed(join(dl, "SHA256SUMS"))], { env, quiet: true });
  } finally {
    // recv-keys leaves dirmngr and gpg-agent running in the download folder.
    await run(GPGCONF, ["--kill", "all"], { env, quiet: true }).catch(() => {});
  }
  if (verify.code !== 0 || !signedBy(verify.stdout, UBUNTU_IMAGE_SIGNER)) {
    throw new Error(`SHA256SUMS is not signed by ${UBUNTU_IMAGE_SIGNER}`);
  }
  const expected = checksumFor(readFileSync(join(dl, "SHA256SUMS"), "utf8"), IMAGE_NAME);
  if (!expected) throw new Error(`SHA256SUMS does not list ${IMAGE_NAME}`);
  const actual = await sha256File(join(dl, IMAGE_NAME));
  if (actual !== expected) throw new Error(`${IMAGE_NAME} is ${actual}, SHA256SUMS says ${expected}`);
  console.log(`verified ${IMAGE_NAME} ${actual}, signed by ${UBUNTU_IMAGE_SIGNER}`);
}

function assertVmnet8(contract) {
  const addresses = Object.values(networkInterfaces()).flat().map((entry) => entry?.address);
  if (!addresses.includes(contract.vm.host)) {
    throw new Error(`no host adapter has ${contract.vm.host}; VMnet8's NAT subnet is not the contract's 192.168.70.0/24`);
  }
}

/**
 * Polls without -wait: on the first boot `getGuestIPAddress -wait` fails with
 * "not powered on", and the guest's tools may never report an address. SSH
 * is what proves the VM is up.
 */
async function runningUntil(vm, { tries = 90 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const status = await vm.status();
    if (status.state === "running") return status.address ?? "not reported by the guest's tools";
    await sleep(10_000);
  }
  throw new Error("the VM never reported that it is running");
}

async function sshUntil(contract, paths, command, { tries = 90 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const result = await run(SSH, commandArgs(contract, paths, command), { quiet: true });
    if (result.code !== 255) return result;
    await sleep(10_000);
  }
  throw new Error(`ssh ${contract.vm.address} never answered`);
}

async function createVm({ contract, root, paths, ref }) {
  step(1, "refuse an existing VM, then make the rig's folders");
  if (existsSync(paths.vm) && readdirSync(paths.vm).some((name) => name.toLowerCase().endsWith(".vmx"))) {
    throw new Error(`${paths.vm} already holds a .vmx; this makes a new VM only`);
  }
  assertVmnet8(contract);
  for (const dir of [paths.vm, paths.dl, paths.ssh, paths.avd, paths.emulatorHome, paths.logs]) mkdirSync(dir, { recursive: true });

  step(2, "download and verify the Ubuntu 24.04 cloud image");
  for (const name of [IMAGE_NAME, "SHA256SUMS", "SHA256SUMS.gpg"]) await download(`${IMAGE_BASE}/${name}`, join(paths.dl, name));
  await verifyImage(paths.dl);

  step(3, "the client key, and the VM's host key pinned in known_hosts");
  const hostKey = join(paths.ssh, "vm_host_ed25519");
  if (!existsSync(paths.sshKey)) await must(SSH_KEYGEN, ["-q", "-t", "ed25519", "-f", paths.sshKey, "-N", "", "-C", "loonext-rig-host"]);
  rmSync(hostKey, { force: true });
  rmSync(`${hostKey}.pub`, { force: true });
  await must(SSH_KEYGEN, ["-q", "-t", "ed25519", "-f", hostKey, "-N", "", "-C", "root@loonext-rig"]);
  const hostPublicKey = readFileSync(`${hostKey}.pub`, "utf8").trim();
  const hostPrivateKey = readFileSync(hostKey, "utf8");
  writeFileSync(paths.knownHosts, `${contract.vm.address} ${hostPublicKey.split(" ").slice(0, 2).join(" ")}\n`);

  step(4, "the 90 GB system disk and the 4 GB state disk");
  const systemDisk = join(paths.vm, SYSTEM_DISK);
  await must(VDISK, ["-r", join(paths.dl, IMAGE_NAME), "-t", "0", systemDisk]);
  await must(VDISK, ["-x", "90GB", systemDisk]);
  await must(VDISK, ["-c", "-s", "4GB", "-a", "lsilogic", "-t", "0", join(paths.vm, STATE_DISK)]);

  step(5, "cloud-init user-data and meta-data");
  const instanceId = `loonext-rig-${new Date().toISOString().slice(0, 10)}`;
  const user = userData({ clientPublicKey: readFileSync(`${paths.sshKey}.pub`, "utf8"), hostPrivateKey, hostPublicKey, ref });
  const meta = metaData({ instanceId, address: contract.vm.address, gateway: contract.vm.gateway });

  step(6, "the .vmx");
  const userdata = encode(user);
  writeFileSync(paths.vmx, vmxText({ userdata, metadata: encode(meta) }));
  // The VM holds the private half now; the host keeps only the public one.
  rmSync(hostKey, { force: true });

  const vm = vmControls({ vmx: paths.vmx, root, exec: (file, args) => run(file, args) });
  try {
    step(7, "vmcli reads the .vmx");
    await must(VMCLI, [paths.vmx, "ConfigParams", "query"], { quiet: true });

    step(8, "start, with no window");
    await vm.start();

    step(9, "wait for the address, then for cloud-init and bootstrap.sh");
    console.log(`guest address: ${await runningUntil(vm)}`);
    const status = await sshUntil(contract, paths, "cloud-init status --wait --long");
    console.log(status.stdout);
    const cloudId = (await sshUntil(contract, paths, "cloud-id")).stdout.trim();
    const measurements = { measured_at: new Date().toISOString(), VM1: { cloud_id: cloudId, datasource_is_vmware: cloudId === "vmware" } };
    writeFileSync(join(paths.host, "measurements.json"), `${JSON.stringify(measurements, null, 2)}\n`);
    if (status.code === 1) throw new Error("cloud-init reported an error; see the status above and /var/log/cloud-init-output.log in the VM");
  } catch (cause) {
    await powerOffAndScrub(vm, paths, userdata).catch((error) => console.error(`create.mjs: ${error.message}`));
    throw cause;
  }
  return { vm, userdata };
}

async function installSdk({ contract, sdk, paths }) {
  step(10, `the Android SDK in ${sdk} and the contract's AVDs in ${paths.avd}`);
  const sdkmanager = join(sdk, "cmdline-tools", "latest", "bin", "sdkmanager.bat");
  const avdmanager = join(sdk, "cmdline-tools", "latest", "bin", "avdmanager.bat");
  if (!existsSync(sdkmanager)) {
    const zip = join(paths.dl, "commandlinetools-win.zip");
    await download(CMDLINE_TOOLS.url, zip);
    const actual = await sha256File(zip);
    if (actual !== CMDLINE_TOOLS.sha256) throw new Error(`the command-line tools are ${actual}, Google publishes ${CMDLINE_TOOLS.sha256}`);
    // On the SDK's own drive: the rename below cannot cross drives.
    const unpack = join(sdk, "cmdline-tools-unpack");
    rmSync(unpack, { recursive: true, force: true });
    mkdirSync(unpack, { recursive: true });
    await must(TAR, ["-xf", zip, "-C", unpack]);
    mkdirSync(join(sdk, "cmdline-tools"), { recursive: true });
    renameSync(join(unpack, "cmdline-tools"), join(sdk, "cmdline-tools", "latest"));
    rmSync(unpack, { recursive: true, force: true });
  }
  if (!existsSync(join(sdk, "licenses", "android-sdk-license"))) {
    console.log(
      `The SDK licences are not accepted yet (FA15). The owner runs, once:\n  "${sdkmanager}" --sdk_root="${sdk}" --licenses\n` +
        "then: node tools/rig/host/vm/create.mjs --sdk-only --yes",
    );
    return false;
  }
  const apis = [...new Set(contract.devices.map((device) => device.api))];
  await runBat(sdkmanager, [`--sdk_root=${sdk}`, "platform-tools", "emulator", ...apis.map(IMAGE_PKG)]);
  const env = { ...process.env, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: paths.avd };
  delete env.ANDROID_HOME;
  for (const device of contract.devices) {
    if (existsSync(join(paths.avd, `${device.avd}.ini`))) continue;
    await runBat(
      avdmanager,
      ["create", "avd", "-n", device.avd, "-k", IMAGE_PKG(device.api), ...(device.profile ? ["-d", device.profile] : [])],
      { env, input: "no\n" },
    );
    const config = join(paths.avd, `${device.avd}.avd`, "config.ini");
    writeFileSync(config, setIniKeys(readFileSync(config, "utf8"), AVD_HARDWARE));
  }
  return true;
}

/** Powers the VM off, then takes user-data out of the .vmx and its logs, even when the power-off fails. */
async function powerOffAndScrub(vm, paths, userdata) {
  try {
    if ((await vm.status()).state !== "off") await vm.stop();
    for (let attempt = 0; (await vm.status()).state !== "off"; attempt += 1) {
      if (attempt > 60) throw new Error("the VM did not power off");
      await sleep(5000);
    }
  } finally {
    const changed = scrubUserdata(paths.vm, paths.vmx, userdata);
    if (changed.length) console.log(`removed user-data from ${changed.join(", ")}`);
  }
}

async function snapshotBaseline(vm, paths, userdata) {
  step(11, "stop, take the baseline snapshot, start again");
  // cloud-init has read user-data, and it holds the VM's host private key.
  await powerOffAndScrub(vm, paths, userdata);
  await vm.snapshot("baseline");
  await vm.start();
}

async function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => argv[argv.indexOf(name) + 1];
  const contract = loadContract();
  const { root, sdk, paths } = loadHostConfig();
  if (flag("--dry-run")) {
    console.log(`would make ${paths.vmx} from ${IMAGE_BASE}/${IMAGE_NAME}, signed by ${UBUNTU_IMAGE_SIGNER};`);
    console.log(`the SDK in ${sdk} from ${CMDLINE_TOOLS.url}; AVDs ${contract.devices.map((device) => device.avd).join(", ")} in ${paths.avd}`);
    return;
  }
  if (!flag("--yes")) throw new Error("create.mjs makes a VM and installs the SDK on this workstation; pass --yes once the owner has agreed");
  if (flag("--sdk-only")) {
    await installSdk({ contract, sdk, paths });
    return;
  }
  const ref = flag("--ref") ? value("--ref") : undefined;
  if (!ref) throw new Error("create.mjs --ref <git ref> --yes");
  const { vm, userdata } = await createVm({ contract, root, paths, ref });
  let failure;
  await installSdk({ contract, sdk, paths }).catch((cause) => {
    failure = cause;
  });
  await snapshotBaseline(vm, paths, userdata);
  if (failure) throw failure;
  console.log("\ncreate.mjs: done. Measure VM2 (start with nobody logged on) and VM3 (`hostd doctor` with a device booted) next.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(`create.mjs: ${cause.message}`);
    process.exit(1);
  });
}
