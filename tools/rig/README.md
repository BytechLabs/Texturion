# The rig: bootstrap, deploy, seed, configuration

The `rig` CLI, the VM's configuration and the Windows host's supervisor for
the Loonext rig (D142). The design is [docs/RIG.md](../../docs/RIG.md); this
is how to stand one up and run it. Nothing here runs on a timer: the rig is a
dev and QA environment you use on demand, to reproduce, diagnose and verify. Sections 3.2 and 3.3 there are what these
files implement.

## A fresh VM, as commands

The rig is a VMware Workstation VM on the founder's workstation, made only for
it, with the Android emulators on the Windows host (docs/RIG.md 3.2). No
hardware and no setup session: an agent creates it, on Windows.

```sh
node tools/rig/host/vm/create.mjs --dry-run           # prints every step, changes nothing
node tools/rig/host/vm/create.mjs --ref main --yes
node tools/rig/host/vm/create.mjs --sdk-only --yes    # the host SDK and AVDs again, after a licence
```

`create.mjs` refuses to run if a `.vmx` already exists in
`F:\loonext-rig\vm`, and it touches no other VM. It downloads the Ubuntu 24.04
cloud image and verifies it, sizes the system disk and the independent secrets
disk, writes the `.vmx` and the cloud-init user-data and meta-data, boots the
VM headless and waits for cloud-init. cloud-init clones the repository and
runs `bootstrap.sh` inside the VM:

```sh
git clone https://github.com/BytechLabs/Texturion.git ~/texturion
sudo bash ~/texturion/tools/rig/box/bootstrap.sh
```

`bootstrap.sh` sets the clock to UTC; installs Docker, Caddy, dnsmasq, the
Stripe CLI, Node 22.20.0 (checksum-verified) and pnpm; creates the lingering
`rig` account; generates the rig's certificate authority once; installs every
file under `box/`; proves the DNS blocks hold; and enables the user services.
It is safe to run again.

The network is VMware's NAT, VMnet8. The VM is 192.168.70.10, its gateway and
DNS 192.168.70.2, and the Windows host 192.168.70.1. The emulators run on the
host and reach the VM directly at 192.168.70.10, started with `-dns-server
192.168.70.10`, where Caddy and dnsmasq listen. nftables in the VM accepts
ports 22, 443 and 53 from the host only, and drops new outbound connections to
private ranges except the gateway.

Agents reach the VM over SSH from the host:

```sh
ssh -i F:/loonext-rig/host/ssh/rig rig@192.168.70.10
```

Then fill the secret store, as `rig`, and deploy:

```sh
sudo -iu rig
export RIG_HOME=/var/lib/loonext-rig
# sudo leaves this unset, and systemctl --user needs it (deploy sets it too).
export XDG_RUNTIME_DIR=/run/user/$(id -u)
# ...the store, as the table below says...
node $RIG_HOME/tooling/tools/rig/bin/rig.mjs deploy --ref main
node $RIG_HOME/tooling/tools/rig/bin/rig.mjs health
```

The JDK and Android SDK in the VM are only for `rig apk`, which builds the
nonprod APK; the emulators run from the Windows SDK. `bootstrap.sh` runs
`box/android-toolchain.sh`, which installs the Temurin JDK under `~/jdk` and
the command-line tools and packages under `~/android-sdk`, each at the
version and checksum pinned in `box/android-toolchain.json` (moving a pin
means a new licence, FA15). The packages wait for the licences, because
accepting them is the founder's agreement: once it is given, run
`bash tools/rig/box/android-toolchain.sh --accept-licences`. `rig apk` finds
`~/jdk` and `~/android-sdk` itself when its environment names neither.

## The secret store

`$RIG_HOME/secrets/`, mode 0700, one file per secret, never in git. Values
never appear in output; errors name the file.

rigd fills most of it from the secret bundle the `rig` GitHub environment
seals (`/ctl/secrets`): each `BUNDLE__<NAME>` becomes one file, lower case,
`_` as `-`, and a trailing `_JSON` as `.json`. The Bundle column is the
name each file needs there; `rig deploy` stops on the first one missing, and
names it.

| File | What | Bundle, or where it comes from |
|---|---|---|
| `edge-origin` | `https://loonext-rig-edge.<acct>.workers.dev` | written once at setup, before rigd can reach the edge |
| `guard-token-rig-api` | The `rig-api` caller token (Telnyx, Resend, FCM and AI through the guard) | `GUARD_TOKEN_RIG_API` |
| `stripe-secret-key` | The existing account's test-mode key (FA5 substitution); anything not `sk_test_` or `rk_test_` is refused before Stripe is contacted | `STRIPE_SECRET_KEY` (FA5) |
| `sentry-dsn-rig` | The existing Sentry project's DSN, for events in environment `rig`; rewritten to rigd's relay | `SENTRY_DSN_RIG` (FA7) |
| `sentry-dsn-synthetic` | The same project's DSN, for scenario and infrastructure events in environment `synthetic` | `SENTRY_DSN_SYNTHETIC` (FA7) |
| `hostd-token` | The bearer token the lanes present to hostd through the tunnel | written by hostd over SSH, never by the bundle |
| `pixel-pin` | The lock PIN every AVD carries; `pixel` names the device-lane emulator `rig-pixel` | written once at setup |
| `robot-mailbox` | The robot mailbox's address, for S34 | written once at setup |
| `telnyx-public-key` | The account's webhook signing key, which the API checks relayed events with | `TELNYX_PUBLIC_KEY` |
| `resend-from` | The From header for API mail, on a domain the Resend team has verified | `RESEND_FROM` |
| `android-nonprod-google-services.json` | The nonprod app's Firebase config; also the project id the dummy service account names | `ANDROID_NONPROD_GOOGLE_SERVICES_JSON` (FA6) |
| `firebase-project-id` | Optional: overrides the project id read from the file above | |
| `stripe-catalog.json` | `{"STRIPE_STARTER_PRICE_ID": ...}` | made by deploy: when an id the template needs is missing, it runs `apps/api/scripts/stripe-setup.ts` (idempotent) against the account's test mode |
| `stripe-webhook-secret` | Optional; otherwise `stripe listen --print-secret` | |
| `standing-numbers.json` | `[{role, e164, telnyx_phone_number_id, messaging_profile_id}]`, which rigd and the robot read | written by deploy and seed from the partition's `standing` |
| `rig-ca.crt` | The CA certificate | copied by bootstrap.sh |
| `android-nonprod.keystore`, `android-nonprod-keystore.json` | The nonprod APK's signing key and its passwords, for `rig apk` only; every later build must carry the same signature to install over the last | made by the first `rig apk` with the JDK's `keytool` (`JAVA_HOME`, else the PATH), before it needs FA6's google-services file: until FA6 has delivered it, `rig apk` stops there and names the certificate's SHA-256 that FA6 registers; never replaced, and half a pair is refused |
| `tenants.json` | Rig-only company ids, members' passwords, the TOTP seed | generated by the first `rig seed` |
| `supabase-signing-keys.json` | The ES256 key local Supabase signs with | generated by the first deploy |
| `vapid.json` | The Web Push pair | generated by the first deploy |
| `hostd-token` | hostd's bearer token | copied into the VM by hostd's tunnel, only when it differs |
| `emulator-audio-proven` | `{"date":"YYYY-MM-DD","flags":[...]}` | written when spike EA1 passes; without it no audio verdict is given |
| `play-services-pins.json` | The Play services versionName each emulator's system image pins, by device name | written when the agent moves a pin |

The retired keys `pixel-bluetooth-mac`, `pixel-hub-location` and
`pixel-hub-port` named hardware the rig no longer has, and nothing reads them.
`pixel-serial` is retired too: every device's serial and ports come from
`tools/rig/host/contract.json`.

## Commands

```
rig deploy --ref <tag|branch|sha>   worktree, install, derive, migrate or reset+reseed, restart
rig deploy --worktree <path>        the same for a checkout in place
rig bootstrap-db                    rig settings on the database, pools restarted, posture proved
rig seed                            tenants, numbers from the guard, ring audiences at rest
rig cron "<expr>" [--time <ms>]     fire one cron on the local API, on demand
rig health                          R00's checks that need no device, on demand
rig apk --ref <ref>                 build the nonprod APK, refuse any other package, and place it as
                                    work/apk/current.apk (the build it replaces becomes previous.apk)
rig serve api|web|stripe            what the user units run
rig stack up                        local Supabase from the derived config
```

`RIG_HOME` (default `/var/lib/loonext-rig`) holds `rig.json` (settings:
`tools/rig/src/layout.mjs`), the store, the worktrees, `current` (the deployed
worktree) and `state/` (`deployed.json`, `health.json`, and what rigd and the
Sentry relay publish there).

### What deploy derives

- `apps/api/wrangler.rig.jsonc` from the ref's `wrangler.jsonc`: no routes,
  crons emptied, rate limiters kept, the `ai` binding replaced by a service
  binding to the AI shim (`ai-shim/`), production KV ids replaced, and all of
  it repeated as `env.rig` under the Worker's own name (`--env rig` would
  otherwise rename it). A key the derivation was never taught is refused, as
  is anything `remote`. `rig serve` runs wrangler with no Cloudflare
  credentials and its own config folder, so it cannot open a remote session.
- `apps/api/.dev.vars.rig` from `templates/api.dev.vars.rig`, which names a
  source for every variable. `RIG_OWNED_E164` is the standing numbers in the
  guard's live listing less STRANGER-1; a number held for one scenario, like
  S28's, is never on it.
- `apps/web/wrangler.rig.jsonc` and the OpenNext build, with Next majors before
  16 built under `--dangerouslyUseUnsupportedNextVersion`.
- `$RIG_HOME/work/supabase/`: a working folder for the CLI with a derived
  `config.toml` (`signing_keys_path`, the issuer, TOTP), the ES256 key, and
  links to the ref's migrations, seed and templates. The committed config is
  never touched.
- No timers. Crons are not installed: the derived config has none, and an
  agent fires any of them on demand with `rig cron`. `crons.json` still
  classifies each one for R00 and rigd's Sentry relay, and `rig health` fails
  while a cron of the ref is unclassified. The edge's and the guard's crons
  are skips, because they run on Cloudflare.
- After the services restart, rigd's own units, which rigd writes itself from
  this checkout: the rigd and robotd services. Scenarios are started by hand
  (`rig run`, or `node tools/rig/rigd/src/cli.ts run <scenario>`), never by a
  unit. A failure there fails the deploy, with the new SHA already serving.

Everything that can refuse (an untaught config key, a missing or live
secret, the cron registry, a rigd that cannot load from this checkout) is
checked before the database or a service changes. When the schema changes,
the scenario runs in progress (which release their leases' undos as they
stop) and the services are stopped first, so a failed migration leaves
nothing running against it. Before it stops them the deploy writes
`state/deploy-hold.json`, and a scenario started while that file is there
records `skipped` without running; the deploy removes it once the services
serve the new ref, so after a failure the hold stays until a deploy
succeeds, and `rig health` fails on a hold over an hour old. A
seed runs on a reset, on `--reseed`, and whenever the database lacks a
company, membership or number row the seed writes, as the partition has it
now.
`state/deployed.json` names what the units start; each `rig serve` writes
`state/serving-<service>.json` with the SHA it actually serves, and
`rig health` fails while the two differ.

Derived files in a worktree are kept out of git through the repository's
`info/exclude`, because old refs predate any `.gitignore` line for them.

## Host side

`tools/rig/host/hostd.mjs` is the rig's supervisor on the Windows workstation:
plain Node 22, no dependencies. Its state lives under `RIG_HOST_ROOT`
(default `F:\loonext-rig`), and it addresses only the `.vmx` that carries the
rig's marker line.

```
hostd serve                                    the supervisor: VM, emulators, adb, tunnel, the token API
hostd vm status|start|stop|revert <snapshot>   the rig's own VM; revert restarts it
hostd devices list|boot <name> [--cold] [--wipe]|kill <name> [--hard]
hostd doctor                                   the VM, keys, SDK, AVDs, WHPX, the host's power facts and each emulator's audio mute
hostd install-startup --yes                    a Startup-folder entry that runs serve at logon
```

`tools/rig/host/contract.json` is the one list of ports and devices, read by
hostd and by the VM's lanes:

| What | Port | Where |
|---|---|---|
| hostd's token API | 15900 | host loopback; the same port in the VM through the tunnel |
| The rig-only adb server | 5137 | host loopback; the VM reaches it at 15037 |
| `pixel` (`rig-pixel`, API 36, Pixel 8 profile, kept warm) | console 5560, gRPC 8560 | host loopback, and the VM through the tunnel |
| `emulator-34` (`rig-api34`) | console 5554, gRPC 8554 | the same |
| `emulator-35` (`rig-api35`) | console 5556, gRPC 8556 | the same |
| `emulator-36` (`rig-api36`) | console 5558, gRPC 8558 | the same |

At most 3 emulators are booted at once. The tunnel is one SSH connection the
host opens to `rig@192.168.70.10` with `F:\loonext-rig\host\ssh\rig`, pinning
the host key cloud-init pre-seeded; each port above is one `-R` bind on the
VM's loopback, which the VM's sshd `PermitListen` allows and nothing else.
hostd writes `hostd-token` into the VM's store over that connection. The
emulators run under WHPX with `-accel on`, from the Windows SDK, with their
AVD and emulator homes under `F:\loonext-rig`. FA16, an elevated ONSTART task,
would start `serve` at boot instead of at logon.

## Workstation spikes (Phase 2, spikes 3-5)

They run on Windows with Docker Desktop; take the shared Supabase lock first.
`test/support/stub-guard.mjs` stands in for the edge and guard with fictional
numbers.

```sh
node tools/rig/test/support/stub-guard.mjs 8899 &
export RIG_HOME=<scratch>   # rig.json: {"supabaseUrl": "http://127.0.0.1:54321", "systemd": false}
node tools/rig/bin/rig.mjs deploy --worktree . --skip-web
node tools/rig/bin/rig.mjs serve api &
node tools/rig/bin/rig.mjs health --only api,database,signIn,tz
node tools/rig/bin/rig.mjs cron "*/5 * * * *" --time 1793404800000
```

`--time` is milliseconds. `/cdn-cgi/handler/scheduled` passes it to the job as
`scheduledTime`; the `/__scheduled` fallback ignores it, and `rig cron` says so.

## Tests

```sh
node --test "tools/rig/test/*.test.mjs"
```
