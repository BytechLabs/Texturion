/**
 * The rig's Android devices, as tools/rig/host/contract.json lists them. Every
 * one is an emulator on the Windows host, under WHPX, reached from the VM
 * through hostd's reverse tunnel. lanes.test.ts keeps this equal to the
 * contract.
 *
 * `pixel` is the device lane's AVD, rig-pixel: a Pixel 8 profile on an API 36
 * Google Play image. The name stayed when the physical phone went, so the
 * scenario ids, the `pixel` surface and the store's `pixel-pin` kept theirs.
 */
export interface RigDevice {
  avd: string;
  api: 34 | 35 | 36;
  /** The emulator console's port, tunnelled to the same port on the VM's loopback. */
  console: number;
  /** The emulator's gRPC port, tunnelled likewise. */
  grpc: number;
  /** adb's serial for it, which names its console port. */
  serial: string;
}

function device(avd: string, api: RigDevice["api"], console: number, grpc: number): RigDevice {
  return { avd, api, console, grpc, serial: `emulator-${console}` };
}

export const RIG_DEVICES = {
  pixel: device("rig-pixel", 36, 5560, 8560),
  "emulator-34": device("rig-api34", 34, 5554, 8554),
  "emulator-35": device("rig-api35", 35, 5556, 8556),
  "emulator-36": device("rig-api36", 36, 5558, 8558),
} as const satisfies Record<string, RigDevice>;

export type RigDeviceName = keyof typeof RIG_DEVICES;

export const RIG_DEVICE_NAMES = Object.keys(RIG_DEVICES) as RigDeviceName[];

/** hostd on the Windows host, tunnelled to this port on the VM's loopback. */
export const HOSTD_PORT = 15900;
/** The rig's own adb server (5137 on the host), tunnelled to this port on the VM's loopback. */
export const ADB_VM_PORT = 15037;
/** How many emulators the host runs at once, the device lane's included. */
export const MAX_BOOTED = 3;

export function isRigDevice(name: unknown): name is RigDeviceName {
  return typeof name === "string" && Object.hasOwn(RIG_DEVICES, name);
}
