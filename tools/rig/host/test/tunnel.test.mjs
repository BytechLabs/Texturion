import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { test } from "node:test";

import { forwardedPorts, loadContract, rigPaths } from "../src/config.mjs";
import { SSH, backoffMs, commandArgs, createTunnel, digest, syncToken, tunnelArgs } from "../src/tunnel.mjs";

const contract = loadContract();
const paths = rigPaths(join("F:", "loonext-rig"));
const args = tunnelArgs(contract, paths);
const option = (name) => args.filter((arg, i) => args[i - 1] === "-o" && arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));

test("one non-interactive connection with the rig's key, to rig@ the VM", () => {
  assert.deepEqual(args.slice(0, 2), ["-N", "-T"]);
  assert.equal(args[args.indexOf("-i") + 1], paths.sshKey);
  assert.equal(args[args.indexOf("-F") + 1], "none");
  assert.equal(args.at(-1), "rig@192.168.70.10");
  assert.deepEqual(option("ExitOnForwardFailure"), ["yes"]);
  assert.deepEqual(option("ServerAliveInterval"), ["15"]);
  assert.deepEqual(option("ServerAliveCountMax"), ["3"]);
  assert.deepEqual(option("IdentitiesOnly"), ["yes"]);
  assert.deepEqual(option("BatchMode"), ["yes"]);
  assert.equal(SSH, join("C:\\Windows\\System32\\OpenSSH", "ssh.exe"));
});

test("the VM's host key is pinned in the rig's own known_hosts, never learned", () => {
  assert.deepEqual(option("StrictHostKeyChecking"), ["yes"]);
  assert.deepEqual(option("UserKnownHostsFile"), [paths.knownHosts]);
  assert.deepEqual(option("HostKeyAlgorithms"), ["ssh-ed25519"]);
  assert.ok(!args.some((arg) => /accept-new|StrictHostKeyChecking=no|UserKnownHostsFile=\/dev\/null/i.test(arg)));
  const command = commandArgs(contract, paths, "true");
  assert.ok(command.includes("StrictHostKeyChecking=yes") && command.includes(`UserKnownHostsFile=${paths.knownHosts}`));
});

test("every forward binds loopback on both ends, for adb, hostd and each device's console and gRPC", () => {
  const forwards = args.filter((_arg, i) => args[i - 1] === "-R");
  assert.equal(args.filter((arg) => arg === "-L" || arg === "-D").length, 0);
  for (const forward of forwards) assert.match(forward, /^127\.0\.0\.1:\d+:127\.0\.0\.1:\d+$/);
  assert.ok(forwards.includes("127.0.0.1:15037:127.0.0.1:5137"));
  assert.ok(forwards.includes("127.0.0.1:15900:127.0.0.1:15900"));
  for (const device of contract.devices) {
    assert.ok(forwards.includes(`127.0.0.1:${device.console}:127.0.0.1:${device.console}`), device.name);
    assert.ok(forwards.includes(`127.0.0.1:${device.grpc}:127.0.0.1:${device.grpc}`), device.name);
  }
  assert.equal(forwards.length, forwardedPorts(contract).length);
});

test("the token is copied only when the VM's copy differs, over stdin", async () => {
  const token = "a".repeat(64);
  const calls = [];
  const run = (remoteDigest) => async (file, argv, options) => {
    calls.push({ file, argv, options });
    return { code: 0, stdout: argv.at(-1).startsWith("sha256sum") ? `${remoteDigest}  -\n` : "", stderr: "" };
  };
  const readFile = () => token;
  assert.equal(await syncToken({ contract, paths, run: run(digest(token)), readFile }), false);
  assert.equal(calls.length, 1);

  calls.length = 0;
  assert.equal(await syncToken({ contract, paths, run: run(""), readFile }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.input, token);
  assert.match(calls[1].argv.at(-1), /^umask 077 .*secrets\/hostd-token.*chmod 0600 /);
  for (const call of calls) assert.ok(!call.argv.some((arg) => arg.includes(token)), "the token is never an argument");
});

test("the tunnel restarts with a growing backoff that resets after a stable connection", async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(backoffMs), [1000, 2000, 5000, 10_000, 30_000, 60_000, 60_000, 60_000]);
  let clock = 0;
  const slept = [];
  const spawned = [];
  const tunnel = createTunnel({
    contract,
    paths,
    readFile: () => "t",
    run: async (_file, argv) => ({ code: 0, stdout: argv.at(-1).startsWith("sha256sum") ? `${digest("t")}  -` : "" }),
    spawn: (file, argv) => {
      const child = Object.assign(new EventEmitter(), { kill: () => child.emit("exit", null) });
      spawned.push({ file, argv });
      // The third connection holds for two minutes; the others drop at once.
      const held = spawned.length === 3 ? 120_000 : 0;
      setImmediate(() => {
        clock += held;
        child.emit("exit", 255);
      });
      return child;
    },
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      if (slept.length === 4) tunnel.stop();
    },
  });
  await tunnel.start();
  assert.equal(spawned[0].file, SSH);
  assert.deepEqual(spawned[0].argv, tunnelArgs(contract, paths));
  assert.deepEqual(slept, [2000, 5000, 1000, 2000]);
  assert.equal(tunnel.state.up, false);
});
