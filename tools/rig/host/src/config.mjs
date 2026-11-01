// hostd's fixed facts: the contract it shares with the VM's lanes, and where
// on the workstation the rig's own state lives.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "loonext.rig-host.v1";
export const DEFAULT_ROOT = "F:\\loonext-rig";
export const DEFAULT_SDK = "D:\\Android\\sdk";
export const VMWARE_DIR = "C:\\Program Files (x86)\\VMware\\VMware Workstation";
export const OPENSSH_DIR = "C:\\Windows\\System32\\OpenSSH";
export const VMX_NAME = "loonext-rig.vmx";

const CONTRACT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "contract.json");
const CONFIG_KEYS = new Set(["root", "sdk"]);
const DEVICE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const AVD_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Every rule the VM's lanes and this supervisor both rely on. The emulator's
 * console takes an even port in 5554-5682 and its adb port is the next one up.
 */
export function contractProblems(contract) {
  const problems = [];
  if (contract?.schema !== SCHEMA) problems.push(`schema is not ${SCHEMA}`);
  const { vm, hostd, adb, devices, max_booted: maxBooted } = contract ?? {};
  for (const key of ["address", "host", "gateway"]) {
    if (!/^192\.168\.70\.\d{1,3}$/.test(vm?.[key] ?? "")) problems.push(`vm.${key} is not on VMnet8's 192.168.70.0/24`);
  }
  if (vm?.user !== "rig") problems.push("vm.user is not rig");
  const port = (value, at) => {
    if (!Number.isInteger(value) || value < 1024 || value > 65535) problems.push(`${at} is not a port above 1023`);
  };
  port(hostd?.port, "hostd.port");
  port(adb?.server_port, "adb.server_port");
  port(adb?.vm_port, "adb.vm_port");
  if (adb?.server_port === 5037) problems.push("adb.server_port is the agents' 5037");
  if (!Array.isArray(devices) || devices.length === 0) {
    problems.push("devices is empty");
    return problems;
  }
  if (!Number.isInteger(maxBooted) || maxBooted < 1 || maxBooted > devices.length) {
    problems.push("max_booted is not between 1 and the number of devices");
  }
  const seen = new Map();
  const claim = (value, at) => {
    if (seen.has(value)) problems.push(`${at} repeats ${seen.get(value)}`);
    seen.set(value, at);
  };
  for (const [key, value] of [["hostd.port", hostd?.port], ["adb.server_port", adb?.server_port], ["adb.vm_port", adb?.vm_port]]) {
    claim(`port ${value}`, key);
  }
  devices.forEach((device, index) => {
    const at = `devices[${index}]`;
    if (!DEVICE_NAME.test(device?.name ?? "")) problems.push(`${at}.name is not a device name`);
    if (!AVD_NAME.test(device?.avd ?? "")) problems.push(`${at}.avd is not an AVD name`);
    if (![34, 35, 36].includes(device?.api)) problems.push(`${at}.api is not 34, 35 or 36`);
    const { console: consolePort, grpc } = device ?? {};
    if (!Number.isInteger(consolePort) || consolePort < 5554 || consolePort > 5682 || consolePort % 2 !== 0) {
      problems.push(`${at}.console is not an even port in 5554-5682`);
    }
    if (!Number.isInteger(grpc) || grpc < 8554 || grpc > 8682 || grpc % 2 !== 0) {
      problems.push(`${at}.grpc is not an even port in 8554-8682`);
    }
    claim(`name ${device?.name}`, `${at}.name`);
    claim(`avd ${device?.avd}`, `${at}.avd`);
    claim(`port ${consolePort}`, `${at}.console`);
    claim(`port ${consolePort + 1}`, `${at}.console + 1 (its adb port)`);
    claim(`port ${grpc}`, `${at}.grpc`);
  });
  return problems;
}

export function loadContract(path = CONTRACT_PATH) {
  const contract = JSON.parse(readFileSync(path, "utf8"));
  const problems = contractProblems(contract);
  if (problems.length > 0) throw new Error(`hostd: ${path} is not a valid contract: ${problems.join("; ")}`);
  return contract;
}

export function deviceByName(contract, name) {
  return contract.devices.find((device) => device.name === name) ?? null;
}

/** The emulator's own serial, which adb derives from its console port. */
export function serialOf(device) {
  return `emulator-${device.console}`;
}

/** Every loopback port the tunnel carries into the VM, as [vm port, host port]. */
export function forwardedPorts(contract) {
  return [
    [contract.adb.vm_port, contract.adb.server_port],
    [contract.hostd.port, contract.hostd.port],
    ...contract.devices.flatMap((device) => [
      [device.console, device.console],
      [device.grpc, device.grpc],
    ]),
  ];
}

export function hostRoot(env = process.env) {
  return env.RIG_HOST_ROOT || DEFAULT_ROOT;
}

export function rigPaths(root) {
  const host = join(root, "host");
  const ssh = join(host, "ssh");
  return {
    root,
    vm: join(root, "vm"),
    vmx: join(root, "vm", VMX_NAME),
    dl: join(root, "dl"),
    avd: join(root, "avd"),
    emulatorHome: join(root, "emulator-home"),
    host,
    config: join(host, "hostd.json"),
    token: join(host, "hostd-token"),
    logs: join(host, "logs"),
    ssh,
    sshKey: join(ssh, "rig"),
    knownHosts: join(ssh, "known_hosts"),
  };
}

/**
 * <root>\host\hostd.json, when it exists. It may name the SDK and must agree
 * on the root it was found under; anything else is refused, so a hand edit
 * cannot quietly point hostd at another machine's state.
 */
export function loadHostConfig(env = process.env) {
  const root = hostRoot(env);
  const paths = rigPaths(root);
  let config = {};
  if (existsSync(paths.config)) {
    config = JSON.parse(readFileSync(paths.config, "utf8"));
    const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
    if (unknown.length > 0) throw new Error(`hostd: ${paths.config} has keys hostd does not read: ${unknown.join(", ")}`);
    if (config.root !== undefined && config.root.toLowerCase() !== root.toLowerCase()) {
      throw new Error(`hostd: ${paths.config} names root ${config.root}, but it lives under ${root}`);
    }
  }
  return { root, sdk: config.sdk ?? DEFAULT_SDK, paths };
}
