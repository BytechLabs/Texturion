# Loonext Rig: an on-demand dev and QA environment inside the accounts Loonext already has

**Status: CURRENT DIRECTION (D142).** The design and runbook for the rig. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Prepared 2026-10-30, revision 2. Brought in line with what was built on 2026-10-31 (D142's update of that date), and with D142's updates of 2026-11-01: no Telnyx ticket and no new hardware, and the rig runs nothing on a timer.

**What the rig is for.** The rig is a full dev and QA environment, used on demand. Any ref of Loonext runs there for real: the API, the web app, the database, the Android app on emulators, and real Telnyx through the guard. Nothing on it runs on a timer. An agent uses it to reproduce, diagnose and verify a reported issue (a PostHog error, or a customer report such as dropped calls) and for any ad-hoc work:
- place a call or a text between any two surfaces;
- drive the web app or the Android app;
- inspect the database and the logs;
- try an unreleased branch before it ships (`rig deploy --ref <branch>`);
- reproduce a reported issue's exact steps.

The scenarios in section 4.2 are optional shortcuts for the same work: each is a prepared, machine-judged run that an agent starts by hand. Regression testing is not the rig's job. It stays in CI (the hermetic suite, H01). Section 8 lists the entry points, and section 9 walks a customer report through them.

This replaces the separate-accounts design, which was rejected only because it needed new vendor accounts. Everything from that design that did not depend on a new account is kept:
- the Phase 0 safety work;
- coded-burst audio verdicts;
- the robot and the run lease;
- the expiry table;
- the test matrix and repro workflow;
- the CI guards and the triage method.

Two independent reviews scored three no-new-account designs, and both chose this one. A second review then found 3 blockers and 15 major gaps in the first draft. Section 13.2 says where each one is closed.

> **Amendment, 2026-10-30 (binding; it overrides anything below that disagrees).** The founder's standing directives are "don't ask me" and "the entire thing must be human free", and agents were given production credentials on purpose. So:
> - **FA1 and FA2 are optional hardening, not prerequisites.** No phase waits on them. Production writes do not move behind approvals, and agents keep the access they have today.
> - **What that means for the guard.** While agents act under the founder's GitHub identity, an approval gate on the `guard` environment cannot stop an agent. Agents already hold production keys with more reach than the guard's key, so the guard does not widen the trust boundary. What it does is narrow what *test code* can do. Its protection therefore rests on its own code: policy unit tests, the two-way registry check, start-up refusals and the CI guards. `guard.yml` deploys from `main` after those tests pass, the same way `ship.yml` ships production.
> - **Not adopted:** the decision-record rule that agents run only in a Windows user without production write keys, and the do-not-build row "production write keys in an agent's reach". Both stay available if the founder later chooses FA1 and FA2.
> - **FA13 and FA14 become agent actions:** the one ops write and the guard deployments.
> - **Why this is the right trade, and not merely an allowed one.** A tap per production write is the recurring human act the human-free directive rules out. The FA1 findings are still true and worth knowing: agents run as the founder, can drive the founder's Chrome through Claude in Chrome, and can read production keys in settings and in `apps/api/.dev.vars`.

**How to read this:**
- **Prices.** Every vendor price names its source and the date it was checked. "Estimate" means no primary source was fetched; budget plus or minus 30%.
- **"Verify"** marks an unconfirmed fact. The step that depends on it stays blocked until a dated primary source, or a first real run, confirms it. The checklist lives in `docs/RIG.md`.
- **Public repo.** There are no secrets, phone numbers or resource ids here. `<acct>` stands for the Cloudflare account's workers.dev subdomain. Numbers are named by role (ROBOT-1, DEV-W1), never by digits.

---

## 1. The recommendation in three sentences

1. Run one dedicated VMware Workstation VM on your workstation, **the rig**, with its Android emulators on the Windows host. It is on while the workstation is on. It runs all of Loonext locally at any version: local Supabase, the API and web Workers under wrangler, browsers with fake microphones, Android emulators (one with a Pixel 8 profile standing in for the technician's phone), and a robot that is the far end of every call. An agent drives it and works inside it completely, like an EDR developer's repro VM.
2. The rig reaches real Telnyx only through **`loonext-telnyx-guard`**, a policy-enforcing Worker in the existing Cloudflare account.
   - It holds the one extra Telnyx key.
   - It lets calls and texts flow only between numbers in a dedicated partition of the existing Telnyx account.
   - Production is changed first, through release-please, so that its account-wide number sweep acts only on numbers it positively owns.
   - Test attempts are serialized. Telnyx applies the limits of the shared account.
3. Nothing on the rig runs on a timer. An agent starts a run when there is something to reproduce, diagnose or verify; each scenario run is judged by machine, and a failure that survives its retry is reported to PostHog under environment `synthetic`, where an agent can triage it on request.
   - Cost: about **$13/month** fixed, plus what the runs and ad-hoc calls spend (a judged call costs about $0.02-0.03). Add an estimated $2-6 of workstation power and about **$8 one-time**. Hardware is $0.
   - No new vendor account anywhere.
   - No recurring founder act in operating it.

### Your part

There is no Telnyx ticket and no hardware to buy (D142, update of 2026-11-01). The rig is a new VMware VM that an agent creates, plus Android emulators on the Windows host. Four one-time acts are still yours, because each needs a console or an agreement no agent may make (section 10):
- **FA15, open:** accept the Android SDK licences once on the Windows SDK, before `create.mjs` can install the emulators, and once on the VM's Linux SDK, before `rig apk` can build. Each is one `sdkmanager --licenses` that the agent prints.
- **PostHog (D146):** the rig sends its API exceptions to the production project under environment `rig`, and its own scenario failures under `synthetic`; no PostHog alert reads either. The rig's secret store needs `posthog-api-key`, `posthog-personal-api-key` (a personal key that can run queries) and `posthog-project-id`; the `rig` environment's `POSTHOG_RIG_READ_KEY` secret is that personal key, and without it R00 fails (section 11, FA7).
- **FA4 step 2's `guard-attest-read` token, open:** without it the attestation of the guard's deployment cannot run.
- **FA4 step 3, Email Routing on loonext.com, created 2026-11-01, not verified:** an agent cannot read it (see the 2026-11-02 check under FA4). S34 is the test of it; it was redesigned on 2026-11-02 so that its invite does travel this route, and has not run since.

What is left beyond those is optional:
- **FA1:** agents move to their own Windows user, and production keys leave every file they can read.
- **FA2:** that user's GitHub login becomes a token that cannot approve deployments or change settings.
- **FA16:** an elevated ONSTART task that starts the rig at boot, with your password stored. Without it the rig starts when you log on.
- **Workstation availability.** Runs need the workstation and VM online. An update or reboot can interrupt a run.

**What FA1 and FA2 would close.** Today every agent runs as you, so it can:
- drive your real Chrome, including your vendor console sessions, through Claude in Chrome;
- read your Windows credential store;
- read production keys in `~/.claude/settings.json` and in commented lines of `apps/api/.dev.vars`. Checked by key name on 2026-10-30: the commented lines include the production Telnyx key, the live Stripe key, the Supabase secret key, database password and access token, and the production VAPID pair.

Any one of those would bypass an approval gate, which is why the amendment does not rely on one.

**One time, already done or substituted (section 10).**
- Done: the guard's Telnyx key (FA3), the Firebase app and service account (FA6), the rig GitHub App (FA9) and the `agent_diag` login (FA13).
- Substituted with what already exists: the existing Cloudflare Workers token (FA4, except the two open steps above), the existing Stripe account's test mode (FA5), the existing PostHog project with environments `rig` and `synthetic` (FA7), and the existing send-only Resend key (FA8).
- Dropped: the Claude cloud environment (FA10; triage runs from host agents) and signing in to Claude on the rig (FA12; host agents drive the VM over SSH).
- Withdrawn: the Telnyx ticket (FA0) and the hardware (FA11).
- No guard approval: agents deploy it, per the amendment.

**Recurring while the rig operates: none.** The system detects each of these first, and only then might it reach you:
- a Telnyx fraud notice (the paid lanes have already latched off, section 3.5);
- the workstation being off or rebooting during a paid run (reported as infrastructure);
- about once a year, accepting a new Android SDK licence when the agent upgrades the pinned SDK (FA15).

**Outside the rig.** Nothing changes. Under the amendment, agents keep making production writes as they do today, and guard deployments need no tap.

---

## 2. What changed because there are no new accounts

### 2.1 Everything created, and the existing account it lives in

| Existing account | What is created inside it |
|---|---|
| **Telnyx** (the production account) | **Key:** one API key, `nonprod-guard`, held only by the guard. **Billing group:** `loonext-nonprod`. **Voice:** two outbound voice profiles; two Call Control apps; two credential connections (`nonprod-webrtc`, with no outbound voice profile, and `nonprod-sentinel`, which has one credential, no numbers and is used only by test G02). **Messaging:** one robot messaging profile, plus five tenant profiles that the guard's setup routine creates, one each for QA-W, QA-A, QA-C, QA-E and QA-G. **Numbers:** eight Canadian local numbers, plus one bought and released each month. **Other:** one notification channel and its settings; telephony credentials created and deleted at runtime. |
| **Cloudflare** (the production account) | **Workers:** `loonext-rig-edge`, on workers.dev, and `loonext-telnyx-guard`, with no public URL and reached only through the edge. Each has its own Durable Object. **Rate-limit namespace ids:** 3001-3009. **Tokens:** none new. The existing Workers token, held only in the `main`-only environments `guard` and `rig-cloud`, deploys the guard and the edge (FA4 substitution). The five scoped tokens (`rig-deploy`, `guard-deploy`, `guard-attest-read`, `production-deploy` and `agent-logs-read`) are optional hardening; `guard-attest-read` is still wanted for attestation. **Email:** one Email Routing address on loonext.com that delivers to the edge. **Not created:** KV, D1, tunnels, Access apps, DNS records. |
| **Supabase** | Nothing. The rig runs a local Supabase stack. |
| **Stripe** | Nothing. The rig uses the existing account's test mode: its test-mode key and test prices (FA5 substitution). Test clocks are created per run. Every customer and subscription the rig creates carries `metadata[loonext_rig]=1`, and every test clock a name starting `loonext_rig `, because Stripe keeps no metadata on a clock. Before a delete or a clock advance the object is read, and the change is refused unless it carries the tag, so the rig never changes what a developer made. The customer and subscription from the app's own Checkout carry no metadata, so rigd tags each only after the rig's database shows that S32's own sign-up address owns the workspace that names it, and S32 deletes both at its end (4.2). |
| **Firebase / Google Cloud** (the existing project) | Android app `com.loonext.android.nonprod`. Service account `fcm-rig-sender`, with the messaging role only, and one key. |
| **PostHog** (the existing project) | No new project. The rig's API exceptions carry environment `rig` and rigd's own events `synthetic`; the alerts read `production` only (D146, FA7). A personal key that can run queries lets rigd read the `rig` exceptions back. |
| **Resend** (the existing team) | Nothing. The guard reuses the existing send-only key, and its recipient rules confine it (FA8 substitution). |
| **GitHub** (BytechLabs org, Texturion repo, your user account) | **App:** `loonext-rig`. **Environments:** `guard`, `rig-cloud`, `rig`, `production` and `production-ops`. **Ruleset:** one, on `main`. **Workflows:** `guard.yml`, `rig-cloud.yml`, `rig-secrets.yml` and `ops.yml`. **Label:** `synthetic`. **Token:** a fine-grained token in your account, used only by the agent Windows user. |
| **Claude** (your existing plan) | Nothing new. Triage runs from host agents (FA10 dropped), and host agents reach the rig over SSH (FA12 dropped). |
| **Your PC** (not a vendor account) | The VMware Workstation VM `loonext-rig`, the Android emulators and their SDK, and `hostd` (section 3.2). Optionally (FA1), a standard local Windows user, `loonext-agents`, which needs no Microsoft account. |

**Not created anywhere:**
- any vendor account, sub-account, managed account, organisation, tenant, seat or mailbox;
- any SIM or carrier plan;
- any domain;
- any Apple enrollment;
- any Gmail, Outlook or Entra test user;
- any device-farm subscription;
- any hosted nonprod database or hosted copy of the Loonext Workers.

### 2.2 What sharing accounts now risks for production, and what contains it

| Shared thing | Risk to production | What contains it |
|---|---|---|
| **Your workstation identity.** Agents run as you. | An agent drives your Chrome into a vendor console; reads your credential store; or reads production keys from settings or env files. Any of these bypasses every control below. | Accepted under the amendment (section 12, risk 4). The reach audit lists every credential an agent session can reach, and the secret scanner stops a push while any file git would stage holds a live key (section 3.1). FA1 and FA2 stay optional: with them, agents run only under a separate Windows user with no console sessions, no Claude in Chrome and no production keys, and its GitHub token cannot approve deployments. |
| **Telnyx concurrency.** The account has shared call capacity. | Telnyx can reject a call on either lane while channels are occupied. | The rig serializes its runs and reports any Telnyx refusal. Connections, numbers and SIP targets remain isolated. |
| **Telnyx surcharges.** Telnyx bills account usage and may add surcharges. | Test traffic can increase the total. | Test call costs are recorded on the rig. |
| **Telnyx fraud holds.** Telnyx can restrict the account. | A provider hold can affect production. | The rig reports corroborated Telnyx notices and forwards only owned traffic. |
| **Telnyx prepaid balance.** Usage is billed on the shared account. | Test traffic uses the same balance. | Telnyx sends its Low Available Credit notice and enforces its own balance rules. |
| **Production's account-wide number sweep.** `reconcileNumbers` runs every 15 minutes, lists every number and can DELETE. | Production flags or releases test numbers, or the rig's copy of the code releases production numbers. | Positive ownership: production acts only on numbers with no billing group, and the rig only on its own group. The group is set in the order body. The guard orders nothing until production's `/health` reports the rule. It checks the first order actually carries the group, and releases the number at once if not. Production raises an alert if a number it would own shows up with a group. |
| **API keys with full account power.** Telnyx keys cannot be scoped (developers.telnyx.com authentication docs, checked 2026-10-30). | Any second key can release production numbers or text anyone. | Only the guard holds one. It has no public URL. It deploys only from `main`, after its policy tests pass (no approval, per the amendment). Attestation runs hourly and a key inventory runs weekly. **Residual, accepted:** a merged but faulty guard can reach production. |
| **One webhook signing key for the whole account.** | A signature cannot tell test events from production events. | The edge decides ownership by resource: connection for call events, messaging profile for text events. Production's handler is deliberately left unchanged. |
| **Internal SIP calling.** Production's WebRTC connection accepts SIP calls from any connection on the account. | A test could ring a real member's device. | The guard dials a SIP address only if its username is on the rig's own connection. Calls that the apps' SDK places itself bypass the guard, so test G02 checks, when it is run, whether a rig credential can ring a sentinel credential. If it can, that residual is named (X25). |
| **Cloudflare account and tokens.** | A test token redeploys production or the guard. | The existing Workers token deploys the guard and the edge, and sits only in the `guard` and `rig-cloud` environments, which take deployments from `main` only, so what it deploys is merged code (FA4 substitution). The VM never holds it. Scoping each automation token to named Workers (granular Worker permissions, Cloudflare changelog 2026-09-15) stays optional hardening. |
| **Cloudflare rate-limit namespaces.** Counters are shared per id across the account (developers.cloudflare.com rate-limit binding docs, updated 2026-10-21). | Test traffic spends production's limiters. | The local stack's limiters are emulated on the rig. The cloud Workers use ids 3001-3009, and CI forbids 1001-1013 and 2001. |
| **Workers AI pool.** Rig AI calls share the vendor account. | Local development calls use the shared allocation. | The guard checks the model allowlist and records usage. |
| **Cloudflare account standing.** | A Trust and Safety action against a test page hits the production account. | The edge serves no HTML and sets no cookies. The guard has no public URL. The Loonext app on the rig is never public. |
| **Firebase project.** One FCM credential reaches every app in the project. | A leaked key could push to production iOS or Android devices. | The key is held only in the guard. The guard sends Android-only messages to the nonprod package: it moves any top-level notification into the Android block, drops the iOS and web blocks, and forces the package name. The rig never holds a production device token. |
| **PostHog quota.** | Test events crowd out production's errors, or a rig event fires a production alert. | Rig events carry environment `rig` and rigd's `synthetic`, and every PostHog alert reads `environment = 'production'` only. The rig sends no product funnel events. A scenario failure is sent only after its retry fails, so volume follows failures, not runs. |
| **Resend domain reputation and quota.** | A bounce or complaint can affect the shared account and production password resets. | Default recipients are Resend's test addresses, which do not affect reputation (resend.com/docs, send-test-emails, checked 2026-10-30). The robot mailbox is used only by the S34 test, and only while the edge's mail heartbeat is fresh. The edge's mail handler never rejects. |
| **GitHub approval gate.** | Agents approve their own guard or ops run. | Under the amendment there is no gate to approve: guard and ops runs need no approval. Both environments take deployments from `main` only, so what runs is merged code (FA9). |
| **Claude plan limits.** | Rig sessions compete with your other sessions. | Triage runs only when an agent is asked to triage failures. |

### 2.3 What was lost against the separate-accounts design

| Lost | Status |
|---|---|
| A separate Telnyx balance behind a bank-card limit that no code could lift | **Rebuilt** with Telnyx daily limits sized to the cap, the guard ledger and the balance floor. Inbound is not vendor-capped, so it is bounded by stranger rejection and auto-detach. There is no bank-level backstop. |
| Separate Telnyx fraud scoring, call limits, API buckets and surcharge ratios | Account limits and billing stay shared. Telnyx applies them. |
| A Telnyx key that physically could not touch production | **Rebuilt** as the guard's policy. This is weaker: a guard bug now reaches production. |
| A separate webhook signing key | **Rebuilt** as ownership checks by resource. |
| Separate Cloudflare accounts for the test app and the guard | **Rebuilt** with scoped tokens, disjoint ids and a guard with no public URL. Your own dashboard login still sits above everything. |
| A hosted, always-on nonprod: real Workers runtime, hosted Supabase auth settings, and cloud lanes that survive a home outage | **Accepted.** Hosted behaviour is defect X23, partly covered by production's own events in PostHog. The rig is a single point of failure, and it is off whenever the workstation is; nothing watches it, because nothing on it is scheduled. |
| A carrier SIM handset (K00-K05): real carrier calls both ways, carrier texts, STIR/SHAKEN, caller-name display, a STOP sent from a real phone | **Accepted** as defects X5, X10, X17 and X20. Production's ring events in PostHog measure real customers' rings passively, but with one production number today there are few of them. K01 could prove outbound carrier egress, but by default it never runs (Phase 4, optional). |
| Physical iPhone wake, audio and sensors | **Accepted** as defect X21. GitHub Actions runs the [iOS Simulator QA lane](QA.md#ios-simulator) with nonproduction endpoints and injected ordinary notification payloads. Provisioned iPhone hardware is outside the rig's scope. |
| Calendar test accounts | **Accepted** as defect X22. A Google partial path that needs no new account is offered in Phase 4. |
| A separate path to Telnyx's Verified level | **Accepted.** The shared account's level governs both production and the rig. |
| Separate Supabase, Resend, PostHog and Firebase tenancy | **Supabase:** replaced by the local stack, which is better isolated but less faithful. **PostHog and Resend:** scoped to the rig's environment and approved recipients. **Firebase:** mitigated by package pinning. |
| Agents with production write keys in their shell | **Not changed** (the amendment). Agents keep the production keys they hold today, and production writes need no tap. FA1 and FA2 would remove them (section 12, risk 4). |

**Gained in exchange:**
- no public Loonext test page anywhere;
- no hosted test database;
- crons run only on the rig;
- the public sign-up form becomes testable;
- about $24 a month instead of $96;
- zero new sign-ups.

---

## 3. The pieces and how they connect

### 3.1 The agent boundary on your workstation

From FA1 onward, agents run only under a standard (non-admin) local Windows user, `loonext-agents`.
- It is a user on this PC, not a vendor account.
- It has its own clone of the repo and its own Claude sign-in, using your existing Claude account.
- It has no browser signed into any vendor console, no Claude in Chrome and no desktop control.
- Windows keeps your profile folder private from it.

You keep using claude.ai/code or the Claude app as now. A scheduled task in the agent user starts Claude's Remote Control server, so the sessions run inside that user while you watch and steer them from your own (verify that Remote Control runs from a scheduled task on this PC; if it does not, you switch Windows user to work with agents).

**Production keys** leave every file an agent can read:
- `~/.claude/settings.json`;
- the commented lines in `apps/api/.dev.vars`;
- the old checkout at `D:\projects\JobText`, whose drive grants other local users read access by default.

They live in your password manager and in two GitHub environments:
- **`production`** holds the deploy secrets;
- **`production-ops`** holds the keys for `ops.yml`. That workflow runs one named `scripts/ops/*` command from `main`: `set-flag`, a global flag or kill switch, as a dry run unless `apply` is ticked. Under the amendment it needs no tap. The `agent_diag` password is not set there (FA13).

**Read access stays prompt-free** for the agent user, because none of these can change anything:
- the PostHog personal key that reads the `rig` exceptions;
- `agent_diag`, which reads only non-personal views;
- `agent-logs-read`, read-only Workers logs for `loonext-api` and `loonext-web`;
- the guard's redacted `diag` class.

**Its GitHub login** is a fine-grained token without Administration, Deployments, Environments, Secrets or Variables permission (FA2). It therefore cannot approve a deployment or loosen a gate. Under the amendment, guard and ops runs need no approval, so nothing waits on you.

**Two checks keep this true:**
- `scripts/check-local-secrets.mjs` refuses if any file git would stage matches a live-secret shape: `sk_live_`, `rk_live_`, a Telnyx v2 key, `sb_secret_`, or a pooler URL with a password. It reads each file as written, with its escapes undone, and as UTF-16, and prints only the file and the shape. `--all` adds the gitignored files. It runs before every push, from the `pre-push` hook in `.githooks` that the root `prepare` script enables, and again in CI's checks, because a hook can be skipped. It is also meant to run at every agent session start. That hook is not installed: it is persistent agent configuration, which waits for your yes.
- `scripts/ops/audit-agent-reach.mjs` lists every credential an agent session can reach, by name and never by value: environment variables, the Claude settings files, every env file in its clones (commented lines included) and `~/.loonext/`. It places each as production-write, production-read, nonprod or none. Without FA1 it reports and passes. With FA1 chosen (`LOONEXT_FA1=1`, or `"fa1": true` in `~/.loonext/hardening.json`), any production-write or unclassified credential fails it. A run that read nothing fails either way. It does not read the Windows credential store, browser sessions or a GitHub token's scopes yet, and says so on every run. Still planned: a weekly run from the agent user, probes of GitHub endpoints that need Administration, Environments or Secrets permission (each must answer 403), and an `ops:agent-reach` notice in production PostHog on any finding.

**Local defaults.** In the agent user's clone, `apps/api/.dev.vars` carries a fake Telnyx key, with `TELNYX_API_BASE` pointing at the e2e fake. Plain `wrangler dev` on the workstation therefore cannot reach real Telnyx.

**Reaching the rig.** Host agents drive the rig VM over SSH with the rig's own key (section 8), and nothing is signed in to Claude inside the VM (FA12 is dropped). The boundary runs one way: the host reaches into the VM, and the VM holds no host credential and cannot reach the host's drives (section 6, guarantee 18). So an agent session on the host keeps its production reach, and the rig does not gain it.

### 3.2 The rig VM

No hardware is bought (D142, update of 2026-11-01). The rig's Linux half is a new VMware Workstation VM on your workstation, made only for it, and its Android emulators run on the Windows host beside it.

**The VM.**
- `loonext-rig`, in `F:\loonext-rig\vm`, booted from the Ubuntu 24.04 cloud image (release 20261017, checksum- and signature-verified) with cloud-init read from guestinfo. An agent creates it unattended (`tools/rig/README.md`, "A fresh VM"). The server ISO was not used, because it would need remastering.
- 8 vCPU, 24 GB of RAM and a 90 GB disk, plus a 4 GB independent-persistent disk for `$RIG_HOME/secrets`, so a snapshot revert never rolls secrets back.
- Docker Engine (open source, no Docker account), Caddy, dnsmasq, nftables and the rig's services, as `bootstrap.sh` installs them.
- No shared folders, clipboard, drag and drop, USB, sound or `vhv`.
- A marker line in its `.vmx` identifies it. hostd addresses only that file and never runs `vmrun list`. The 12 VMs already in VMware's inventory, WSL2 Ubuntu and docker-desktop are never used or touched.
- Snapshots are taken powered off. The VM is never suspended, because Host VBS mode re-checks CPU features on resume.
- Unattended upgrades or a Windows Update reboot can interrupt a run. Start it again once the VM comes back.

**Why the emulators are not inside it.** Hyper-V stays on, so Workstation runs every VM in Host VBS mode, which gives the guest no nested virtualisation, and Google says an accelerated emulator cannot run inside another VM (developer.android.com/studio/run/emulator-acceleration). So they run on Windows under WHPX, which is already enabled.

**Why not WSL2.** A WSL distro mounts the Windows drives, which hold production keys in `apps/api/.dev.vars`, and shares one kernel with every other distro. The VM sees none of the host's drives.

**The Windows side: `hostd`.** `tools/rig/host/hostd.mjs` is a dependency-free Node supervisor.
It reads its ports, devices and emulator limit from `tools/rig/host/contract.json` at startup.

- starts the VM with `vmrun ... nogui`, addressing only the marked `.vmx`;
- starts the emulators under WHPX with `-accel on`, so a missing hypervisor fails loudly instead of falling back to software, with private AVD and emulator homes on F:;
- runs a rig-only adb server on port 5137, so the agents' own adb on 5037 is untouched;
- keeps one SSH reverse tunnel into the VM, started by the host, carrying adb (the VM's 15037 to the host's 5137), hostd's own port (15900) and each emulator's console and gRPC ports;
- listens on loopback only. The VM's sshd `PermitListen` limits the reverse binds to those loopback ports, and its host keys are pre-seeded through cloud-init, so the host pins them on first connection instead of trusting them.

It starts from the Startup folder when you log on. An elevated ONSTART task with your password stored would start it at boot with nobody logged on (FA16, optional; spike VM2 checks that emulators start that way).

**Network.**
- **NAT on VMnet8.** The VM has the static address 192.168.70.10, with gateway and DNS 192.168.70.2, and the host is 192.168.70.1. Host-only networking has no internet, and bridged would put the VM on your home LAN.
- **nftables in the VM.** Input from 192.168.70.1 is accepted only on ports 22, 443 and 53. New outbound connections to private address ranges are dropped, except to the gateway 192.168.70.2. So the VM cannot open a connection to your other machines, or to the host.
- **Emulators reach the VM directly** at 192.168.70.10, started with `-dns-server 192.168.70.10`. Caddy and dnsmasq listen there.
- **What the host check accepts.** `check-rig-hosts` takes exactly 192.168.70.10 and 192.168.70.1 as rig hosts. The gateway 192.168.70.2 passes only as `contract.json`'s `vm.gateway` and as the firewall file's `define gateway`, and the firewall's private blocks are read as ranges, not hosts.

**Pinned downloads** (fetched 2026-11-01):
- The cloud image is verified against Ubuntu's cloud-images signing key, fingerprint `D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81` (ubuntu.com/docs/public-images/public-images-how-to/verify-image-checksum/).
- The Android command-line tools are `commandlinetools-win-15859902_latest.zip`, sha256 `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a` (developer.android.com/studio).

**Name resolution.** This makes "cannot touch production" a property of the network:
- `api.rig.internal`, `app.rig.internal` and `db.rig.internal` resolve to the rig. `.internal` is reserved for private use.
- For the rig and the emulators, `loonext.com`, `supabase.co`, `pooler.supabase.com` and `api.supabase.com` resolve to nothing.
- Inside the VM only, `api.telnyx.com`, `api.resend.com`, `oauth2.googleapis.com` and `fcm.googleapis.com` also resolve to nothing. PostHog stays reachable, because the rig sends its exceptions to it and reads them back (D146). Any code that skips the guard therefore fails closed, including old releases that predate the seams. The emulators keep their own route to Google's push service.

**TLS.** Caddy serves the `.rig.internal` names on 192.168.70.10 with a certificate authority generated in the VM and never committed. The nonprod build trusts it for `*.rig.internal` only. Caddy restarts on failure.

**Recovery.** hostd restarts a stuck emulator by killing its process and cold-booting it (`-no-snapshot-load`), which is what D11 tests. A stuck VM is reverted to its powered-off baseline snapshot; the secrets disk is independent, so it survives the revert.

**Boot order inside the VM.** Docker brings the Supabase containers back by itself when the VM boots, and `supabase start` refuses them until the database is healthy. `rig stack up` therefore waits for the stack's containers (3 minutes at most, and it names the database when it gives up) before it starts anything. The stack unit retries a failed start up to five times in an hour. The API and web units want the stack unit and run `rig stack wait` first, which waits through the retries and fails with a reason once the stack unit has given up; `Requires=` would have failed them for good on the stack's first failed start. `rig deploy` copies these three units from the tooling checkout when they differ.

**What running on the workstation costs.** Measured read-only on 2026-10-31:
- **Workstation power.** The rig VM and Android emulators are available when the workstation is running.
- **Update restarts.** Windows Update can interrupt a run. Hostd restores the Android lane at logon or at boot with FA16.
- **It is busy.** CPU is 44-68% busy with about 20 Claude processes running; 90 of 128 GB of RAM is free.
- **Disks.** C (NVMe) has only 34 GB free, D is a hard drive, and F (NVMe) has 128 GB free, so the VM and the AVDs live on F.

Dark time costs nothing and alerts nobody: the rig is used on demand, so an agent who needs it starts it (section 8), and nothing on it is waiting for a scheduled run.

### 3.3 Loonext in rig mode

**Deploying a version.** `rig deploy --ref <tag|branch|sha>`:
1. creates a git worktree and installs dependencies;
2. migrates the local database, resetting and reseeding it if the ref's schema is older;
3. derives the configuration;
4. restarts the services.

A schema change stops the services before anything migrates, and before it stops them `rig deploy` leaves `state/deploy-hold.json` in the rig's home. Scenario runs already going, whether an agent started them or a triage rerun, are stopped first, while the API still serves: a stopped run releases its lease's undos before it exits. A run started while that file is there records `skipped` without running. The deploy removes it only once the services serve the new ref, so a deploy that fails leaves the hold in place until one succeeds. No timer exists to stop or restart. `rig health` fails on a hold over an hour old, naming the file.

Every verdict records the SHA it ran against.

**API.** `wrangler dev` runs with a gitignored `wrangler.rig.jsonc`, derived from that ref's `wrangler.jsonc`:
- no routes;
- crons emptied, because the rig fires them itself;
- the rate limiters kept, since they are emulated locally;
- the `ai` binding replaced by a local shim that forwards to the guard's capped AI path.

**Web.** The OpenNext build runs under wrangler, so it has the same shape as production. `next dev` is used for interactive debugging. `NEXT_PUBLIC_APP_ORIGIN` is unset, so every route stays on one origin.

**Local sign-in.** The production API accepts ES256 tokens only (`apps/api/src/auth/jwt.ts`). The pinned Supabase CLI (2.109.1) already signs ES256 with no key file, but with a private key built into the CLI. That key is the same on every install, so anyone with the CLI could mint a token the rig's API accepts (checked 2026-10-31: one key id across fresh starts, and no key on disk). `supabase/config.toml` leaves `signing_keys_path` commented out.
- The first deploy generates the rig's own ES256 key into the secret store, so a redeploy signs nobody out. A derived `config.toml` in a working folder points at it. The committed config is untouched.
- R00 checks that local auth signs ES256 and that a seeded user's `/v1/me` call returns 200.

**Crons.** No timer fires a cron. An agent fires one on demand with `rig cron <expr>`, or by a job name from the registry (`rig cron job:lead-chase` fires the cron that lists that job), through `/cdn-cgi/handler/scheduled?cron=<expr>&time=<ms>`. Scenarios that need a cron fire it themselves. That route is present in the repo's pinned wrangler 4.106.0 (checked 2026-10-29), with `/__scheduled` as the fallback. `time` is in milliseconds and reaches the job as its scheduled time. The fallback ignores `time`, so the job runs at the wall clock, and `rig cron` says so (both checked 2026-10-31). An agent can replay any cron at a chosen instant.

A cron registry, `tools/rig/crons.json`, classifies every cron in every tracked Worker config, keyed by config and cron. An API cron also lists its jobs, which must equal `CRON_JOBS` in `apps/api/src/index.ts`, so a job added to a cron forces someone to classify it again. Each cron is one of:
- **run**: the rig can fire it on demand;
- **run, expecting a refusal**, with what that refusal makes PostHog receive suppressed (for example 10DLC polls and porting reconciles: in rig mode the app refuses every 10DLC, porting, hosted-messaging and documents request itself, with `rig_endpoint_refused`, before it reaches the guard, which refuses them too). Each refusal says whether the job lets it out, so its liveness alert follows, or catches it and reports its own event;
- **skip**, with a reason. The edge's and the guard's crons are skips: they fire on Cloudflare, never on the rig, and they suppress nothing, because the API's own alert for the same expression must stay visible. A skipped API cron lists the liveness keys it silences, and rigd expects those.

`rig deploy` refuses without the registry and installs no cron timer. CI checks the registry against each ref's Worker configs (`scripts/check-rig-crons.mjs`). R00 requires zero unexplained API exceptions over 24 hours. `rig health` reads `$exception` events with environment `rig` from PostHog and fails if the read fails.

For a deliberately failed Stripe TEST Connect lookup or a recording download reset, record the exact PostHog event UUID and the issue with the probe evidence in `$RIG_HOME/state/rigd/expected-probe-exceptions.json`. Each record is `{"event_id":"<event UUID>","probe":"voicemail-download-reset","evidence":"#785"}`. The Stripe probe name is `stripe-test-connect-invalid-account`. Record a voicemail probe after verifying that the same call recovered. The health report lists verified probe events and their evidence. A matching fingerprint from a different event still fails R00.

A cron's failure is explained only when its AggregateError is the outermost exception and every other exception that is not an AggregateError is a refusal listed for that cron. A job that collects its failures adds an AggregateError of its own in between. PostHog lists the chain of one error, never an AggregateError's `errors`, so each failure a job collected is its own exception, and the registry reads each. An event whose only exception is an AggregateError stays unexplained: it may hold a real failure.

**Stripe and auth mail.**
- `stripe listen --api-key <test-mode key> --forward-to https://api.rig.internal/webhooks/stripe`. It never uses `stripe login`, whose pairing expires after 90 days. R00 checks the listener is alive and that its signing secret matches.
- Supabase Auth mail goes to a local Mailpit.

**PostHog.** The rig's API Worker sends with the project key (`POSTHOG_API_KEY`, from the store's `posthog-api-key`), environment `rig`, and no funnel events. rigd sends its own events with the same key under `synthetic`. Neither has a cap of ours: PostHog's free plan stops ingesting at its limit, and a failure is sent only after its retry fails.

**Settings.** `apps/api/.dev.vars.rig` is gitignored and holds:
- `DEPLOY_ENV=rig`;
- the local Supabase URL and its JWKS URL;
- `APP_ORIGIN` set to `app.rig.internal`;
- `API_ORIGIN` set to the edge. This is what vendors see.
- `TELNYX_API_BASE` set to the edge's `/g/telnyx`;
- `TELNYX_API_KEY` set to a guard caller token. Boot refuses anything shaped like a raw Telnyx key.
- `TELNYX_WEBHOOK_URL` set to the edge's messaging path;
- `TELNYX_BILLING_GROUP_ID` set to the nonprod group;
- the nonprod connection ids;
- `TELNYX_MEDIA_PUBLIC_BASE` set to the edge's media path;
- `RESEND_API_BASE`, `FCM_API_BASE` and `FCM_OAUTH_TOKEN_URL` set to the edge's `/g/*` paths. `FCM_SERVICE_ACCOUNT_JSON` is a well-formed dummy, and a test asserts rig mode never contacts Google's token endpoint.
- the existing Stripe account's test-mode key (FA5 substitution);
- the production PostHog project's key, for environment `rig`, and a personal key and project id to read them back (FA7);
- `RIG_OWNED_E164`, the standing numbers in the guard's live listing less STRANGER-1, never committed. A number held for one scenario, such as S28's, is never on it.
- `RIG_ROBOT_WEBHOOK_ORIGIN`, the robot's webhook sink: customer webhooks and their test pings go there or nowhere. It must be a public https name, because the webhook URL rule refuses `*.internal` hosts when an endpoint is created and when it is pinged. It is the edge's origin. S04 and S20 create the endpoint at `/w/<secret>/...` through `/v1/webhooks`, and the edge queues each delivery for the robot (section 3.4).
- Turnstile test keys.

**Old versions.**
- **Web:** refs from before the Next 16 move cannot pass OpenNext's support-date check. The rig builds them with `--dangerouslyUseUnsupportedNextVersion`. That flag stays rejected for production, but the rig is never customer-facing.
- **Server:** refs older than Phase 0b run in `--pre-seam` mode. Telephony still goes through the guard, because old code already honours `TELNYX_API_BASE`. Email and push fail closed on the DNS block. Scenarios that need email or push are marked not runnable on those refs.

**Seed.**
- `scripts/rig/seed.mjs` targets only the database that `supabase status` reports.
- It creates the tenants with fixed rig-only company ids. These are random, generated once and kept in the rig's secret store; never the fixed id in `scripts/dev-seed.mjs`.
- It re-attaches the standing numbers and their messaging profiles by reading them from the guard.
- It sets each number's **ring audience** to the fewest surfaces the scenarios need. Scenarios that need more surfaces add them under the run lease, and the lease's undo removes them.

**Tenants.** All numbers use Ontario area codes, which avoids the 2026 Alberta time-zone rule change; R00 compares the tz versions of Node and Postgres.

| Tenant | Members and surfaces | Numbers and who they ring | Used for |
|---|---|---|---|
| QA-W | Owner and technician (Chromium in the rig VM). A note-level member and a two-factor member (API only, never ring). | DEV-W1 rings the owner only. DEV-W2 rings the owner and technician. | Browser calling, transfers, texting |
| QA-A | Technician (the device-lane emulator, AVD `rig-pixel`). Dispatcher (rig Chrome; rings only when a scenario's lease adds it). Owner (API only). | DEV-A1 rings the device-lane emulator by default. Inbound caller-name lookup is on. | Device lane |
| QA-C | Owner (Chromium); a member used for sign-out tests | DEV-C1 rings the owner. | Calls between workspaces, caps, pause |
| QA-G | Owner (Chromium) | No standing number. It has its own messaging profile, `nonprod-qa-g`, because DEV-C1's belongs to QA-C. | S28 buys, rings and releases a number. S29 checks the day-30 grace notice. |
| QA-E | Emulator member | DEV-E1, on its own messaging profile | Emulator lane, STOP and START |
| Robot | none | ROBOT-1, ROBOT-2, STRANGER-1 | Far end of everything. Only ROBOT-2 ever sends STOP. STRANGER-1 is owned but kept off the app's allowlist so G01 can prove the stranger gate. |

### 3.4 The edge relay, `loonext-rig-edge` (Cloudflare Worker on workers.dev)

The internet can reach only these paths; everything else returns an empty 404:
- **`/t/v`, `/t/v2` (failover), `/t/w`, `/t/m`, `/t/r`.** Telnyx webhooks for the nonprod voice app, the WebRTC connection, the messaging profiles and the robot.
- **`/t/n/<secret>`.** Account notifications. These may be unsigned, so the path carries a secret segment. Before halting anything, the edge corroborates a notice: a balance notice by reading the balance through the guard; any notice when Telnyx refuses the account's reads; any other notice only when it carries a valid Telnyx signature and names a notification type enabled on the account. The notification-event list names types, not occurrences, so it never corroborates on its own. An unsigned notice the edge cannot corroborate halts nothing and goes to PostHog's `synthetic` environment as `synthetic-infra:telnyx-notice`.
- **`/w/<secret>/...`.** Customer webhooks from the rig's API to the robot. The app refuses `*.internal` webhook hosts, so the robot's endpoint is here. The secret segment stays at the edge, which queues each delivery (at most 256 KB) for the robot with the rest of the path.
- **`/m/...`.** Telnyx fetches of MMS and greeting media. Only Supabase-signed URLs, only for those two buckets, at most 5 MB.
- **An `email()` handler** for the robot's address on loonext.com (named in the rig's private config, never in git) and its `+tag` sub-addresses. It never rejects mail. It stores it; if storage fails it still accepts and counts. It keeps a mail heartbeat, refreshed by the edge's own Cloudflare cron (not a rig timer), because the guard's Resend gate reads it before it lets a test mail go to the robot mailbox.
- **`/g/*`.** Authenticated callers forwarded to the guard over a service binding, along with their caller class.
- **`/ctl/uplink`, `/ctl/rpc` and `/ctl/secrets`.** The rig's own outbound WebSocket, `rig` commands and encrypted secret delivery. Each needs a bearer token.

**Handling a Telnyx webhook, in order:**
1. Verify the Ed25519 signature against the account key, within a 5-minute window.
2. Decide ownership by event type:
   - call events by connection id, which must be one of the nonprod connections;
   - message events by messaging profile, which must be a nonprod profile from the guard's live list.

   Anything else is acknowledged, dropped and counted.
3. **Strangers.**
   - A call from any number outside the nonprod group: the edge asks the guard to reject it and never relays it.
   - A text from such a number: dropped. Only a count and a hash are kept.

   Stranger content (bodies, media links, caller names) therefore never reaches the rig or any agent. Per-number stranger counts drive the guard's automatic detach.
4. Remove duplicates by event id.
5. Register the call id with the guard.
6. Deliver:
   - **Call events** are relayed to the rig synchronously over a hibernating Durable Object WebSocket. The edge returns the rig's own status code within the app's 10-second webhook timeout, so Telnyx's retries and failover stay real. One 9-second deadline, counted from arrival, covers the partition read, the leg registration and the relay. A retry of an event still in flight gets 503, and a 2xx that arrives after the edge gave up still marks the event seen, so it is not relayed twice.
   - **Text events** are acknowledged as soon as they are durably queued in the edge's Durable Object, because Telnyx expects a 2xx within 2 seconds. The edge then delivers them to the rig with its own retry while Telnyx's signature is valid. The rig's API accepts a signature for 5 minutes, so a text the rig has not taken by then is offered once more, recorded by `rigd` as lost to the delay, and dropped. Robot webhooks and robot mail carry no Telnyx signature and are retried for up to 24 hours.

If the rig is offline, call events get a 503 and Telnyx retries.

**Hardening.**
- No path serves HTML or sets a cookie.
- Responses carry a sandbox CSP and `nosniff`.
- The edge refuses to serve on any loonext.com hostname.

**No dead-man.** The edge has no check on whether the rig, a suite or triage has run lately. The rig runs nothing on a schedule, so there is nothing to miss, and a rig that is off alerts nobody. The edge's one cron refreshes the mail heartbeat and tidies the uplink's tables.

**SSH.** Optional, Phase 4. Host agents already get a full shell on the rig over SSH on the workstation (section 8). A raw SSH relay is added only if a tool needs one.

### 3.5 The guard, `loonext-telnyx-guard` (Cloudflare Worker, no public URL)

**What it holds:**
- the Telnyx key;
- the Resend sending key;
- the FCM send key;
- the production PostHog project key, which is public;
- an AI binding.

**Reachability.** workers.dev is off. The guard is reached only through the edge's service binding.
- A spike checks that the edge's scoped token can deploy that binding.
- If it cannot, the guard goes on workers.dev and every request must also carry an HMAC signature with a timestamp and a single-use nonce.

**Deploys** come from `main` through `guard.yml` after the policy tests pass. After the deploy, apply changes to Telnyx profile settings with `gh workflow run guard.yml --ref main -f routine=setup -f deploy=false`. Check the workflow output before running live scenarios.

**Callers** present tokens to the edge, never the key:
- `rig-api` (the local Loonext API);
- `robot`;
- `diag` (workstation agents);
- `admin` (the setup routine; its token lives only in the `guard` environment).

**Telnyx policy, by class.** Most product changes need no guard redeploy.
- **Read class.**
  - Any GET whose answer passes the nonprod filter: list calls get forced filters, and every answer is filtered again before it is returned.
  - A fixed list of account-wide reads is refused: 10DLC, porting, API keys, managed accounts, unfiltered opt-out lists. The balance is returned as a number only.
- **Leg-command class.** Any command on a call id in the guard's leg registry. The registry is filled by the guard's own dials and by the edge, and entries expire after 6 hours.
- **Dial, transfer, bridge.**
  - The connection must be `nonprod-voice` or `nonprod-robot`.
  - `from` must be an owned number.
  - `to` must be an owned number (live listing by billing group, cached at most 5 minutes) or a SIP username on `nonprod-webrtc`.
  - A live run lease is required. Test code names the lease in its header; the app's own legs (`rig-api`) run under the live lease. A header that names any other lease is refused.
- **Messages.** `from` and `to` must both be owned, and the profile must be a nonprod profile.
- **Provisioning (an explicit list):**
  - telephony credentials only on `nonprod-webrtc` and `nonprod-sentinel`;
  - number search under a live S28 or S32 lease. S32 runs the onboarding picker.
  - number orders only under the S28 lease. S32 orders are refused as `provisioning.order_needs_lease`;
  - Orders carry the nonprod group, messaging profile and connection. The guard reads back the first order to verify ownership.
  - PATCH or DELETE only on owned numbers that are not standing numbers. One exception, **detach**: it clears a standing number's connection and messaging profile when strangers flood it.
  - Messaging profiles require a US/CA whitelist and an edge webhook. A messaging profile has no billing group field (Telnyx's API reference, checked 2026-10-31), so the guard knows the partition's profiles by id: the ones its setup routine created and the ones the app created through it.
- **Refused outright:**
  - 10DLC, porting, verification codes and hosted SMS;
  - managed accounts, API keys and auto-recharge;
  - any write to profiles, apps, connections or notification settings outside the setup routine.

**Keeping the policy in step with the code.** The policy is generated from a Telnyx endpoint registry. CI fails any product PR that introduces a Telnyx endpoint outside the existing classes, so a needed guard change rides the same release.

**`diag` class.** Workstation only. GET-only production reads:
- call events by leg id;
- detail records;
- webhook deliveries;
- session analysis;
- resource settings.

Phone numbers are cut to their last four digits, and message bodies and recording URLs are removed.

**Other vendors.**
- **Resend:** recipients must be `*@resend.dev`. `rig-robot+<tag>@loonext.com` is allowed only during S34 and only while the edge's mail heartbeat is fresh.
- **FCM:** data plus Android only. Any top-level notification block moves into the Android block, iOS and web blocks are dropped, and `restricted_package_name` is forced to `com.loonext.android.nonprod`. Production's sender puts a top-level notification and an iOS block on every alert (`apps/api/src/notifications/fcm.ts`), which is why the guard rewrites instead of refusing.
- **AI:** a model allowlist with usage recorded.

**Vendor refusals.** The guard forwards a request once it verifies caller, resource and destination ownership. It relays Telnyx's status and error codes. The runner releases the lease and undoes the attempt before it retries. Requests that can create a number are reconciled before repeating an ambiguous order. See [D176](DECISIONS.md#d176---rig-qa-runs-on-demand).

**Run lease.** One paid scenario runs at a time across the system. Scenarios register undo actions with `rigd`, the rig's service daemon. If the lease is not released within 15 minutes, `rigd` runs the undo itself.

The guard counts every Telnyx request that reaches it while a lease is live, refusals included, on that lease's record by caller, endpoint and outcome. `GET /g/lease/<id>/activity` reads the record back until the next lease is acquired. It names endpoints and rule names, never ids or numbers. G01 reads it to prove the app's refused send and dial never reached the guard. S09, S12 and S14 read it to prove a refused dial or send made no request, S28 to prove that the area-code or regional search led to one order, and S32 to prove its picker searched and nothing that buys, binds or releases a number was forwarded. A run under a local lease has no record. While no lease is live, the guard refuses every app dial, which is what keeps D02p at zero dials.

A run with no dials holds a local lease, except S29, S32 and S34. S29 uses the guard lease to share QA-G with S28. The guard allows S32 to search inventory and S34 to mail the robot mailbox. Each asks for it with `dials: false`, and the guard admits no dial under such a lease, the app's included, so S34 never makes a dial the app reaches for admissible. When another scenario holds the lease, S34 waits for it as a paid run does, at any hour.

A run that prepares before its lease holds its lane for the whole attempt (no runner prepares today: D03's stepped Doze takes seconds), in a file under `state/rigd/holds`. Another run on that lane waits for it as it would for a busy lease, then is skipped. A hold lapses by itself, so a run that died cannot keep the lane. If no run follows a finished prepare (no lease, or the window closed), the runner puts back what the prepare changed.

**Safety checks.**
- **At start-up**, the guard refuses to serve if any nonprod resource points at `api.loonext.com`, if any nonprod id overlaps a production id, or if any nonprod number is bound to a production connection.
- **Ordering** waits only on production's `/health` listing `telnyx-partition-v1` and on the first-order check. All eight standing roles are ordered at once (ROBOT-1, ROBOT-2, STRANGER-1, DEV-W1, DEV-W2, DEV-A1, DEV-C1 and DEV-E1), whether or not paid dials are open. While paid dials are refused, no standing number is ordered with a voice connection; each is ordered with its messaging profile alone, so the text roles keep theirs and the calls roles take no inbound call and hold no channel. A number bound to a connection takes inbound calls, which hold account channels, so binding waits for paid dials: order-standing then binds each held standing number that has no connection and is not detached, and until then S28's order and any PATCH setting a `connection_id` are refused as `provisioning.voice_closed`, and `reattach` restores only the messaging profile. Eight numbers at about $1.10 a month fit the ten-number cap and the $35 monthly cap, which are unchanged.
  - **The first order's read-back.** The order's phone-number line carries an id of its own, which Telnyx does not say is the number's `/v2/phone_numbers` id, and it is not (2026-11-01, risk 21). So the guard never reads by it. Once the order reports `success`: (1) it reads the order and requires it to list exactly one number, the E.164 that was requested; (2) it lists `/v2/phone_numbers` with `filter[billing_group_id]` set to the partition's group and finds the E.164 itself, because Telnyx's spec says `filter[phone_number]` returns nothing for a non-numerical character and an E.164 starts with `+`; (3) it requires exactly one listed number with that E.164, whose `billing_group_id` is the partition's, and whose messaging profile and voice connection are the ones the order asked for; (4) it records that result's id as the number's id, and any later release goes by that verified id only. A number is identified by phone number and a complete order and the partition's group together, never by phone number alone. A pending order waits, and a 429, a 5xx or a failed call is asked again on the next upkeep. Telnyx can list a new number late, so a complete order whose number the group does not list yet waits too, for 30 minutes from the first miss, and then stops as `number_missing`; a number listed with no billing group, in production's partition, stops ordering at once as `group_not_kept`. Anything else stops ordering for good and alerts production, with a reason code in `/health`'s `ordering.stopped_reason`: `order_ambiguous`, `order_status_unknown`, `order_unreadable`, `order_id_missing`, `number_unreadable`, `number_missing`, `number_ambiguous`, `group_not_kept` or `binding_mismatch`. None of them deletes anything: a number the guard cannot pin down is left for a person, and while it sits outside the group bound to the partition's resources the start-up checks read the partition as unsafe. Only the first order is read back; Telnyx's honouring of `billing_group_id` is the thing it measures. A first order that Telnyx reports as `failure` bought nothing, so its standing role is ordered again.
  - **An order Telnyx does not confirm.** A standing role is held before its order is sent, so a second caller or a retry never orders it again. A 4xx gives the role back. Any other answer, a 5xx or no answer, may have bought the number: the role stays held, the run fails red as `Order unconfirmed`, and a person checks the partition before dispatching again. A search passes over a number already held for another role, and a held role whose number the group does not list is named in the run's last lines.
  - **Resuming.** `number_unreadable` is the one stop a person may lift, with the `resume-ordering` admin routine (`guard.yml`, dispatched from `main`; its input `resume_reason` is required). The guard records who (`github.triggering_actor`, the login that started the attempt, a re-run included), why and which stop was cleared, in the Durable Object, and then runs the current read-back on the pending first order, so the number already held is adopted by it and is not ordered again; if the read-back fails, ordering stops again and the run fails. Any other stop, and a call when ordering is not stopped, is refused as `provisioning.resume_refused`.
- **Version attestation.** R00 runs it whenever `rig health` runs, and nothing runs it on a timer (`tools/rig/rigd/src/guard-attest.ts`). It reads the guard's deployment list with `guard-attest-read`: Cloudflare's `GET /accounts/<id>/workers/scripts/loonext-telnyx-guard/deployments`, whose first entry is the one serving traffic. It compares the live deployment with every Deploy step `guard.yml` ran on `main`, ordered by when each step started, from the newest down to the newest that succeeded. Those runs are read through the rig's GitHub App with a token that can only read Actions, pushes and dispatches only, because a workflow run that is not a push or a dispatch never deploys. Failed, cancelled and running steps count, because they may have deployed, so re-running an older run is a rollback, not a mismatch. The deployment matches when it serves one version, its message is `guard.yml <sha>` for one of those steps (`guard.yml` deploys with `--message "guard.yml <sha>"`, which wrangler also puts on the deployment), and Cloudflare made it during that step, with two minutes of clock slack. A secret change (FA3, FA6 and FA8 paste keys this way) redeploys the live code with no message, so the attestation reads through it to the deployment it replaced. A mismatch fails R00 with its reason. A side it cannot read fails R00 too, never a pass, and so does a missing store file: `cf-guard-attest-token`, `cloudflare-account-id`, `rig-app-id` or `rig-app-key`. Nothing is kept and nothing is sent: the agent running R00 sees the failure. **Residual, accepted:** Cloudflare takes the secret-change label from whoever creates a deployment, and `guard-attest-read` cannot read a version's code, so a holder of the guard's deploy rights could put other code under one.
- **API keys.** The guard keeps no inventory of the account's keys. Telnyx's own "API Key Creation" and "API Keys Expiration" notifications cover them, and the portal's Auth page lists them on demand. Both are email notifications; on 2026-11-07 neither was enabled, and the account's only notification channel was the edge's webhook, so until a founder enables them with an email channel the Auth page is the only check.
- **Negative probes** run in G01, when an agent starts it.

**Account signals.** Verified Telnyx account notices generate a production monitoring event and are deduplicated by notice ID. Telnyx applies any account-level restriction and returns its decision on the affected request.

### 3.6 The Telnyx partition (inside the existing account)

The guard's setup routine creates everything from a committed spec, `tools/guard/telnyx-spec.json`, which holds names and values only, never ids.

| Resource | Settings |
|---|---|
| Billing group `loonext-nonprod` | The ownership marker on every rig number. Messaging profiles have no billing group, so the guard keeps their ids instead. |
| Outbound voice profile `nonprod-voice-ovp` | Dedicated rig billing group and US/CA destinations |
| Outbound voice profile `nonprod-robot-ovp` | Dedicated rig billing group and US/CA destinations |

| Call Control app `nonprod-voice` | Webhook `/t/v`, failover `/t/v2`, webhook timeout 10 s, RTCP capture on if offered, `call_cost_in_webhooks` on |
| Call Control app `nonprod-robot` | Webhook `/t/r`; `call_cost_in_webhooks` on; channel limit 1 |
| Credential connection `nonprod-webrtc` | SIP URI calling set to internal. Webhook `/t/w`. **No outbound voice profile**, so an app credential cannot call a phone number. No push credential. |
| Credential connection `nonprod-sentinel` | One credential, no numbers, no outbound voice profile. Used only by G02. |
| Messaging profiles | `nonprod-robot` at $0.06 a day, with webhook `/t/r`, plus five tenant profiles (`nonprod-qa-w`, `-qa-a`, `-qa-c`, `-qa-e`, `-qa-g`) at $0.03 a day each, with webhook `/t/m` (Telnyx refuses sends above the limit with HTTP 429 code 40333). US/CA whitelist. At most seven profiles. |
| Numbers | Eight Canadian local numbers with Ontario area codes: ROBOT-1, ROBOT-2, STRANGER-1, DEV-W1, DEV-W2, DEV-A1, DEV-C1, DEV-E1. S28 buys and releases one additional number during its run. Each is ordered with the group, connection and profile in the order body. A standing number also carries a customer reference naming its role (`rig-standing-<role>`), so the role lives on Telnyx itself and no number is ever written into git to say which is which. |



**Why Canadian numbers.** Production's only number is Canadian, and Canadian inventory was reservable on 2026-10-29. The app needs no registration for Canada-bound texts, and every test text stays on-net anyway.

**Fallbacks.**
- **If Canadian ordering is refused,** US numbers are used. QA-W then gets a seeded "approved registration" row, which is named in `docs/RIG.md`. The guard still keeps every text on-net.
- **If billing groups are not honoured on orders,** ordering stops. A fallback ownership marker (the nonprod messaging profile and connection pair, both set in the order body) ships to production first.

**10DLC and STOP.**
- No 10DLC brand or campaign is ever created. Production has no brand to reuse, and a customer's campaign would send under that customer's name.
- Opt-out blocks apply per messaging profile (developers.telnyx.com advanced opt-in/out, checked 2026-10-29). DEV-E1 therefore has its own profile, and a STOP is lifted only by ROBOT-2, the side we control, sending START.

### 3.7 Production changes (through release-please)

**Phase 0a: a small release, first.**
1. **Ownership rule.** `apps/api/src/telnyx/ownership.ts` provides `ownsTelnyxNumber(env, number)`.
   - With `TELNYX_BILLING_GROUP_ID` set, an environment owns only numbers in that group. With it unset, as in production, it owns only numbers with no group.
   - It is checked before both the warning and the DELETE in `reconcileNumbers`, in `adoptOrphanNumber`, and as a GET-then-check before `releaseNumberRow` deletes anything.
   - Foreign numbers are counted, never flagged and never deleted.
   - A foreign number whose customer reference names a production company raises `['ops','telnyx-ownership-mismatch']`, so a production number that ever gains a group is caught instead of silently orphaned.
   - Number orders carry `billing_group_id` when the variable is set.
   - `docs/deploy/04-telnyx.md` gains a rule: production numbers never carry a billing group.
2. **Capability flag.** `/health` returns `capabilities: ['telnyx-partition-v1']` beside `ok: true`. Before Phase 0a it returned only `{ ok: true }` (`apps/api/src/index.ts`, checked 2026-10-30).
3. **Inbound-canary fix.** `observability/inbound-canary.ts` filters on `.eq("e164", ...)`, but the column is `number_e164`, so once configured it would never send. Fix the filter and drop the file's private base-URL constant.

Already shipped in release 0.18.0: `0fd3583c` (2026-10-30). It stops `scripts/dev-seed.ts` and `scripts/dev-activate-number.ts` from targeting a non-local Supabase, and makes `stripe-setup.ts` refuse a live key without `--live`.

`ship.yml`'s backend job deploys the API before the web Worker. A red web build therefore does not hold back 0a.

**Phase 0b: everything else.**
1. **Seams.**
   - `TELNYX_WEBHOOK_URL`, `TELNYX_MEDIA_PUBLIC_BASE`, `RESEND_API_BASE`, `FCM_API_BASE`, and `FCM_OAUTH_TOKEN_URL` (`fcm.ts` hard-codes Google's token endpoint today).
   - In rig mode, FCM sends the guard caller token instead of minting a Google token.
   - Messaging-profile limits and the whitelist come from the environments module; production is unchanged.
   - `telnyx/text-enablement.ts` honours `TELNYX_API_BASE`.
   - Importing the Telnyx base-URL constant outside `client.ts` is banned.
2. **`DEPLOY_ENV`.**
   - `ship.yml` stamps `DEPLOY_ENV=production` beside `GIT_SHA`. Unset means `local`, and `scripts/ci-dev-vars.mjs` and `.dev.vars.example` say so explicitly. The e2e harness therefore runs as `local`, and a test proves it.
   - Only `src/environments/` may read the variable (`scripts/check-deploy-env-branches.mjs`), and it may only add restrictions. In rig mode it adds:
     - an outbound destination gate, plus a call-site test that fails if any send or dial site skips it, or if it finds zero sites;
     - an inbound gate that rejects any non-allowlisted caller or texter before ring, voicemail, transcription or text-back;
     - refusal of live Stripe keys and live events;
     - refusal of any Supabase host outside `*.rig.internal` or loopback;
     - customer webhooks delivered to the robot only.
   - The one rig-only route is `POST /v1/rig/simulate-incoming`, for D02p. Its synthetic sessions refuse ring-me before Telnyx, so D02p never dials. A test proves production's route table lacks it, and another asserts zero guard dials per D02p run.
   - Production refuses to start with any vendor seam set (`TELNYX_API_BASE`, `TELNYX_WEBHOOK_URL`, `TELNYX_MEDIA_PUBLIC_BASE`, `STRIPE_API_BASE`, `RESEND_API_BASE`, `FCM_API_BASE`, `FCM_OAUTH_TOKEN_URL`). This goes further than the design's original `TELNYX_API_BASE` alone: each of the others would send a vendor credential or customer traffic to the host it names. PostHog's `environment` comes from `DEPLOY_ENV`.
3. **SQL destination gate.** `gate_outbound_send`, `api_claim_outbound_line` and the greeting-capture claim refuse non-endpoint destinations when the database setting `loonext.deploy_env` is `rig`. That setting exists only on the rig's local database. A SQL test proves production is unchanged.
   - The setting fails open: `supabase db reset` drops it, and a pooled connection opened before it was set never sees it. So the rig's API asks `rig_database_posture()` before it serves, and answers every request 503, and runs no cron, until the database reports `rig` with at least one endpoint. The rig bootstrap therefore runs `alter database postgres set loonext.deploy_env = 'rig'` and sets `loonext.rig_endpoints` to the `RIG_OWNED_E164` list after every reset, then restarts PostgREST and the pooler.
4. **Repro evidence.**
   - A `push_attempt` event in PostHog for each push: provider response class, priority and latency, under the workspace's id, nothing personal.
   - Ring beacons from the web, Android and iOS apps (the iOS code compiles in CI), which the API relays as `ring_beacon` events in PostHog: stage events plus app, OS, permission and standby state, nothing personal.
   - `ops_diag` views, including hourly call counts and ring-audience sizes.
   - The `agent_diag` role, with an SQL test proving it cannot read messages, contacts, numbers or payloads.
   - SQL on the `ops_diag` views as `agent_diag`, for a call's sessions and legs.
5. **Hermetic call journeys.** The fake Telnyx gains dialing and telephony credentials, and `CALL_SESSIONS` is bound. Inbound, outbound, voicemail and transfer journeys run on every push. They also emit each scenario's dial count and peak concurrent legs, which feed the scenario catalogue check in section 4.1. A trace-to-fixture tool renumbers real traces into the fictional 555-01xx range.
6. **Android `nonprod` build type**, created with `initWith(release)`:
   - minified, with the `.nonprod` suffix, and signed with a stable key held on the rig, which the first `rig apk` makes with the JDK's `keytool` and never replaces (half a pair is refused);
   - values read from Gradle properties, and disabled when they are absent;
   - a debuggable twin for deep dives;
   - production literals in `CaptchaSheet`, `PasskeyEnrolment`, `PushPayload`, `SettingsLogic` and `MainActivity` moved to BuildConfig, with production defaults;
   - manifest placeholders, with the app-link host set to the inert `nonprod.invalid`;
   - a network-security config that trusts the rig's certificate authority for `*.rig.internal` only;
   - stable `testTag`s.
7. **CI guards:**
   - the Telnyx endpoint registry check, in both directions;
   - `check-rig-no-e164`;
   - `check-production-host-literals`;
   - `check-rig-hosts`;
   - `check-rig-ratelimit-band`;
   - the cron registry check;
   - the scenario registry and its per-run dial costs;
   - the test-id contract.
8. **Workstation tools:** `check-local-secrets.mjs`, `audit-agent-reach.mjs` and `ops.yml`.
9. **Deploy secrets.** `ship.yml` moves to the `production` environment, which uses the scoped `production-deploy` token. It reads repo-level secrets today.
10. **Docs** (section 14).

**Deliberately not changed: production's webhook handler.** A connection-id filter there would drop production's text, 10DLC and porting events, which carry a profile id or no id. Rig resources never point at production; the guard refuses at start-up if one does.

### 3.8 The robot, and how audio is judged

**What the robot is.** `robotd` runs on the rig and owns ROBOT-1, ROBOT-2 and STRANGER-1 through `nonprod-robot`. Every command it sends goes through the guard, and its events arrive through the edge.

**On each call it:**
1. dials or answers;
2. plays its code from an HMAC-signed probe URL;
3. records only what it hears: inbound-track recording (verify; the fallback is dual-channel, keeping the inbound channel);
4. uses beep detection to know when to speak into voicemail;
5. collects keypad digits;
6. speaks fixed phrases by text-to-speech.

It stores the session and leg ids and its own RTP statistics at test time, because Telnyx's own evidence expires quickly. After hang-up it judges the recording locally, then deletes the Telnyx copy. On a pass it keeps no audio; on a failure it keeps per-frame numbers only (D112).

**Codes.** Noise suppression removes steady tones within seconds. Each surface therefore sends 160 ms bursts at its own frequency, in a fixed on/off pattern:

| Surface | Frequency |
|---|---|
| Robot | 1,100 Hz |
| QA-W owner | 1,300 Hz |
| QA-A dispatcher | 1,500 Hz |
| QA-W technician | 1,700 Hz |
| QA-C | 1,900 Hz |
| Device-lane emulator (`pixel`: AVD `rig-pixel`, Pixel 8 profile) | 2,300 Hz |
| Emulator (E01's rotating AVDs) | 2,750 Hz |

All of these avoid keypad tones, call-progress tones and 2,600 Hz.

**Verdicts.**
- **Heard** means the pattern correlates in at least 3 cycles, 2-12 seconds after answer, above a per-surface margin set by a calibration call on day one.
- **Silent** means no cycle is found.
- The pattern also identifies which surface answered.

**Quality checks.**
- **Echo:** the robot's own code coming back.
- **Dropouts:** missing bursts.
- **Speech:** transcribed locally with whisper.cpp (free); word error must be 0.25 or lower.

**Call length.** Calls carry 20-50 seconds of talk, so none counts as short. If Telnyx plays its automated-call announcement, verdict windows start after it ends.

### 3.9 Browser and emulator lanes

**Browsers** (in the rig VM).
- Chromium runs the call lanes. Google Chrome stable, installed by bootstrap.sh from Google's apt repository under a pinned signing-key fingerprint, runs Web Push (S21, D08). A page asks for it with `push: true`. It runs in Chrome's own headless mode, which needs no display and, checked 2026-11-02 in the VM, gets a push subscription from `fcm.googleapis.com`; headed under Xvfb gets one too. Chromium cannot.
- Each member has its own browser profile, kept between runs. The app calls a session it has not seen before a "new device" and sends the account holder a security email. A profile keeps its session, so a member's page signs in once. Chrome's profile is a folder of its own (`<member>.chrome`), so a member who needs push signs in once more there. rigd's probe and `rig health` keep their sign-ins too (`state/rigd/member-sessions.json`) and refresh them, which keeps the session id; a reseeded database clears the file. A password sign-in is left only where a run tests signing in (S33) or out (S16), and the sign-ups of S32 and S35, each a new account.
- The fake microphone plays the member's code: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture` (chromium `media_switches.cc`, checked 2026-10-29).
- A test-only script attaches the remote stream to a muted audio element and judges it in the page. Without that, Chrome hands analysis code silence (crbug 933677).
- `getStats` supplies audio level, energy and concealed samples.
- `--host-resolver-rules` blocks `*.loonext.com` and `*.supabase.co`.

**Android emulators** (on the Windows host, section 3.2). No phone is bought, so every Android lane is an emulator. The technician's phone is the AVD `rig-pixel`, an API 36 Google Play image with the Pixel 8 device profile. Surface, scenario and store ids that say `pixel` keep it, and now name this emulator. `tools/rig/host/contract.json` lists the AVDs:

| Device | AVD | API | Console port | gRPC port | Role |
|---|---|---|---|---|---|
| `pixel` | `rig-pixel` (Pixel 8 profile) | 36 | 5560 | 8560 | The device lane (QA-A's technician); kept warm |
| `emulator-34` | `rig-api34` | 34 | 5554 | 8554 | E01's rotation |
| `emulator-35` | `rig-api35` | 35 | 5556 | 8556 | E01's rotation |
| `emulator-36` | `rig-api36` | 36 | 5558 | 8558 | E01's rotation |

- **Acceleration.** WHPX on Windows, with `-accel on`, so a missing hypervisor fails instead of falling back to software. At most 3 are booted at once.
- **Control.** adb through hostd's rig-only server on port 5137, reached from the VM over the tunnel (section 3.2), plus UIAutomator and mobile-mcp. The emulator console and gRPC ports cross the same tunnel. Nothing goes over USB, but adb itself does not enforce that: the rig's server lists any authorised USB device and any emulator on local ports 5555-5585, and its host services can open TCP connections through the host, so `hostd doctor` fails when `adb -P 5137 devices` lists a serial outside `contract.json`. A filter in hostd that passes only the contract's serials is not built yet.
- **App.** Each runs the `.nonprod` release-style build, built in the VM from any ref. `rigd` refuses any APK whose package is not `.nonprod`.
- **FCM** works without a signed-in account (firebase.google.com Android client docs, checked 2026-10-29). Google Play services are pinned by the system-image revision, so they change only when the agent moves the pin (section 5).
- **Doze.** Emulators ship with Doze off (AOSP's `config_enableAutoPowerModes` defaults to false), so `dumpsys deviceidle force-idle` alone changes nothing. The lane runs `dumpsys deviceidle enable all` after every boot. An emulator has no significant-motion sensor, so it never enters deep Doze by itself: D03 steps it there, and natural entry is defect X6.
- **States the agent can create:**
  - killed with `am kill` (force-stop is a separate case, because FCM drops messages to force-stopped apps);
  - Doze, stepped to IDLE;
  - standby buckets, and battery saver after unplugging in software (Android ignores battery saver while powered);
  - locked, with the PIN in `pixel-pin`, which every AVD carries;
  - cold-booted with `-no-snapshot-load`, for before-first-unlock and D11.
- **Bad network.** The emulator console's `network delay` and `network speed` shape the link. `svc wifi disable` drops Wi-Fi, and `gsm data unregistered` with Wi-Fi off makes a full outage. The console has no packet-loss control, so loss on the device's path is defect X27.
- **Variants that must not ring** (notifications revoked, force-stopped) run on E01's AVDs only, never on `rig-pixel`, because they could teach FCM to deprioritise pushes to the device lane.
- **Play Protect.** Its scanning of adb installs is off at baseline, so developer verification in 2027 does not block the lane's installs.
- **Where they run.** hostd starts and keeps them, never a scenario run. A lane boots an emulator only when adb finds none booted on its port, so D11 and E01 never start a second one.

**Call audio.** Android forbids software capture of voice-call audio (developer.android.com, AudioAttributes, checked 2026-10-29), and no phone or radio is bought, so the rig uses the emulator's own gRPC audio service:
- `injectAudio` plays the device's 2,300 Hz code (48 kHz, 16-bit mono) into the emulator's virtual microphone, starting only after the guest opens it, and stops before hang-up;
- `streamAudio` records what the device plays, at 48 kHz;
- the existing detector judges both, unchanged.

The emulators play guest audio through the workstation's speakers, and `-no-audio` would break `injectAudio`, so hostd leaves the audio backend on and mutes each emulator's own Windows audio session instead (`emulator-audio.ps1`, Core Audio's `ISimpleAudioVolume`; no system volume, device or setting changes). A session exists only once the guest first plays sound, so hostd keeps one PowerShell helper running that mutes the emulator's session the moment it is created, and re-sweeps every few seconds. `streamAudio` reads the emulator's samples before the session, so it is unaffected (checked 2026-11-01: real samples, rms about 0.1, while the session read muted). `/v1/health` reports `audio_silenced` and each device's `audio` state (`muted`, `waiting` for a session, `unmuted`, `error`), and `hostd doctor` fails an emulator whose session reads unmuted.

This is gated by spike EA1 (section 10). **Until EA1 passes, every device-lane audio verdict is the infrastructure result `emulator-audio-unproven`, never a pass.** Wake verdicts do not depend on it. If EA1 fails, the fallback (`-allow-host-audio`) would need a third-party virtual audio cable and would share one input across every emulator, so audio verdicts stay infrastructure results instead.

**Where the lanes find their devices.** rigd reads each device's serial, console and gRPC ports from `tools/rig/host/contract.json`, the lock PIN from the store's `pixel-pin`, and the robot mailbox's address from `robot-mailbox`. The retired store keys `pixel-serial`, `pixel-bluetooth-mac`, `pixel-hub-location` and `pixel-hub-port` are gone: no store key moves a device off the contract.

The store also holds `hostd-token`, hostd's bearer token, which hostd copies into the VM only when it differs; `emulator-audio-proven`, `{"date":"YYYY-MM-DD","flags":[...]}`, written when EA1 passes, without which no audio verdict is given; and `play-services-pins.json`, the Play services versionName each emulator's system image pins, by device name.

The VM's environment names:
- `RIG_HOSTD_ORIGIN` (default `http://127.0.0.1:15900`) and `RIG_ADB_SERVER` (default `127.0.0.1:15037`), the tunnel's two ends, both refused off loopback;
- `RIG_WHISPER_BIN` and `RIG_WHISPER_MODEL`, for whisper.cpp (ffmpeg converts audio that is not WAV);
- `RIG_CHROME_BIN`, Google Chrome for Web Push (S21, D08); it defaults to `/usr/bin/google-chrome-stable` when that exists;
- `RIG_MAILPIT_URL`.

No lane runs anything through `sudo`: shaping goes through the emulator console, and restarts through hostd. `rig health` alone uses it, for `nft list table inet loonext_rig`, through a sudoers entry that allows that one command.

**What the Android lanes report.** Failure classes: `whpx_unusable`, `hostd_tunnel_down`, `pixel_deep_idle_disabled`, `emulator_deep_idle_disabled`, `pixel_audio_link_down`, `push_token_mismatch` and `no_device_push_token`, plus `health_hostd`, `health_adb_tunnel` and `health_nftables` from `rig health`. Infrastructure results: `hostd`, `emulator-audio-unproven`, `play-services-pin` and `app-probe`. D11's list of what failed to come back names `pixel-audio-link`. The lane installs `$RIG_HOME/work/apk/current.apk` and `previous.apk`, which `rig apk --ref` places there. `previous.apk` is the build of the commit placed before `current.apk`, not necessarily the release before it, so release builds are placed oldest first: D12 installs `current.apk` over it, and adb refuses a downgrade. A `--worktree` or `--debuggable` build is not placed.

R00 compares Play services with the minimum the installed nonprod build declares. play-services-basement merges `com.google.android.gms.version` into the app's manifest, and the lane reads it with aapt2 from the APK installed on `rig-pixel`.

**iOS Simulator.** Run [iOS QA](QA.md#ios-simulator) on a GitHub-hosted macOS runner. The Simulator uses a runner-local service with synthetic data and records its own evidence.

### 3.10 Running scenarios on demand, reporting, triage

**Running scenarios on demand.** Nothing on the rig runs on a timer: no scenario timer, no cron timer, no health timer, and no unit that starts a run. An agent starts a scenario with `rig run <scenario>[-<variant>]` (a thin wrapper over rigd's `node tools/rig/rigd/src/cli.ts run`; a variant is a numbered run from the registry, such as `S25-2`), and rigd's `scenario.run` and triage's `triage.rerun` start one the same way. A run still takes the guard's lease, is judged by machine, and records its verdict, evidence and the SHA, whoever started it.
- Run calls, texts and push checks on demand. Shared test resources are serialized by the lease.
- The registry (`tools/rig/scenarios.json`) is the catalogue of what can be run, with each scenario?s dial count. It holds no schedule.
- A scenario rigd cannot run yet is listed with its reason (`NOT_RUNNABLE_YET` in `tools/rig/rigd/src/scenarios/index.ts`), and `rig run` refuses it. Today these are G02 and S26. A test keeps every scenario in the registry either runnable or listed.
- A runner can read its own earlier attempts and their evidence from the verdict store, which is how E01 judges emulator audio across the runs an agent has made.

**Reporting.**
- A failing scenario is retried once after cleanup.
- If it fails again, one `$exception` goes to PostHog's `synthetic` environment with the project key, fingerprinted `synthetic:<scenario>:<failure_class>`.
- Infrastructure faults use `synthetic-infra:<component>`, so one dead phone is one issue.
- Events are sent when a run fails twice, or fails critically, never because a run did not happen. PostHog groups a repeated fingerprint into one issue.
- The only credential on the rig that can read PostHog is the query-only personal key; none can change PostHog.
- **One project, three environments (FA7 substitution).** Rig and synthetic events go to the production project with the environments `rig` and `synthetic`. Every PostHog alert reads `environment = 'production'`, so neither can fire one (docs/MONITORING.md).
- The rig VM sends nothing to production's environment. A guard whose live deployment is not `guard.yml`'s from `main` fails R00 (section 3.5); it is not sent anywhere.

**What rigd runs.** rigd keeps the edge uplink (it writes `state/uplink.json` at least every minute, which R00 reads), the lease watchdog, which runs a lease's undo once it is 15 minutes old, a refresh of the store from the edge's sealed bundle every 6 hours, and the rpc commands. It judges nothing on a timer. R00 reads the local API's exceptions from PostHog when `rig health` runs (the last 24 hours, explained by `tools/rig/crons.json` and by G01's attempts, `tools/rig/rigd/src/api-exceptions.ts`), and attests the guard's version then too.

**Triage.** Nothing schedules triage. When an agent is asked to triage, or a PostHog issue arrives, it drives the rig over SSH, through the `rig` CLI (FA10 is dropped, so there is no Claude cloud environment):
1. reads unresolved failures from the rig's verdict store;
2. re-runs the scenario;
3. attaches evidence;
4. reports what it found to whoever asked, in its answer.

The rig files no GitHub issues. A failure that survives its retry is in PostHog under environment `synthetic`, and a person who wants a tracked issue opens one from that PostHog issue. Triage can only run while the workstation is on, which is also when the rig runs.

**Rig-authored code.** The rig App can open branches and pull requests; a ruleset keeps it off `main`. Workstation agents never auto-merge a rig-authored PR. They review the diff as untrusted input and re-run the checks themselves first.

**No dead-man (D142, update of 2026-11-01).** The edge's dead-man is gone, with the rig, suite and triage heartbeats, the stale-heartbeat events `['synthetic-infra', component]` and the dark alert `['ops','synthetic-dark']`. A rig that is off, or a suite nobody ran, is not a fault. What stays on the edge: the mail heartbeat (the guard's Resend gate reads it). The edge sends to PostHog only for a Telnyx notice: one it cannot corroborate goes to `synthetic`, and a corroborated one the guard did not take goes to production. Each is sent once per notice, with no throttle or daily cap of the edge's own; PostHog groups repeats into one issue and applies its own rate limits.

**What reaches you.** You hear about the test system only when:
- isolation is at risk (G01, G02, a guard version R00 cannot attest, Telnyx's key notices, agent reach);
- the Telnyx account or balance needs attention.

Product regressions go to agents as GitHub issues.

### 3.11 Production watches

There are none on the rig or in production's crons any more (D146), and none of our own anywhere. Ring success is read from the events production sends to PostHog, `ring_push_sent` and `ring_beacon` per platform and app version, with PostHog's own alert on rings shown under 80% of pushes. Production's webhook wiring is watched by Cloudflare's monitor of webhook refusals in Workers Logs and by the vendors' own notices (Stripe's failing-endpoint emails, Telnyx's messaging-profile notifications). `docs/MONITORING.md` lists what is sent and what alerts on it.

### 3.12 One call, end to end (S02)

1. The robot asks the guard, through the edge, to dial DEV-W1 from ROBOT-1. The guard checks the lease and ownership, then dials.
2. Telnyx sends `call.initiated` for `nonprod-voice` to the edge's `/t/v`. The edge verifies the signature, sees a nonprod connection and an owned caller, registers the call and relays the event to the rig.
3. The local API's Durable Object claims the line and asks the guard to dial one ring leg, to the QA-W owner's SIP username on `nonprod-webrtc`.
4. The owner's Chromium page rings and Playwright answers. Media flows through Telnyx.
5. After hang-up:
   - the robot judges its recording for the owner's 1,300 Hz code;
   - the page has already judged the robot's 1,100 Hz code;
   - the rig checks the call row and the Stripe test-mode meter.
6. The verdict is stored with the SHA. A second failure is reported to PostHog, and an agent triages it when asked.

---

## 4. Test matrix

### 4.1 Running the matrix

Run a scenario directly with `rig run <scenario>`. Add its variant number where needed, such as `S07-2`. The registry records estimated or measured dial counts for evidence. The runner serializes attempts through the lease and retries a failed or infrastructure attempt after cleanup. Read the verdict for Telnyx's actual HTTP status or SIP cause when a call is refused.

`scripts/check-rig-scenarios.mjs` compares the registry with this matrix and the measured hermetic journeys.

### 4.2 Scenarios

"Pages" means the browser pages on the rig. **Pass** lists every condition the agent checks with no human. The last column is the dials one run spends (Loonext's legs plus the far end's). Every row is run on demand; none has a cadence. A row that runs in CI or in production says so in its text.

| ID | Scenario | Far end | How the agent verifies it, with no human | Dials per run |
|---|---|---|---|---|
| R00 | Rig health | none | **Pass:** services answer; local sign-in returns 200; the device-lane emulator is booted, reachable over the tunnel, unlocked and Doze-enabled, and its Play services version meets the minimum the installed nonprod build declares; the other emulators are up (booting them is D11's job); the guard is healthy; the edge uplink is up; the nonprod apps point at the edge; the Stripe listener is alive; tz versions match; zero unexplained API exceptions in 24 h, read from PostHog when the check runs (a failed read fails the check); the guard's live deployment is one `guard.yml` made from `main` (an attestation that cannot be read fails the check). **Critical:** the guard's start-up checks report the partition unsafe. **Also publishes:** the current room and the scenarios it blocks. While D03 holds the device lane for its stepped idle, the device-lane emulator's lock state is not judged. Run on demand with `rig health`. | 0 |
| H01 | Hermetic suite, including the call journeys | Fake Telnyx and Stripe | **Pass:** the CI status. CI runs it on every push; the rig does not run it, because regression testing stays in CI. | 0 |
| G01 | Isolation self-test | A fictional 555-01xx number; STRANGER-1 | **Pass:** the app refuses a send and a dial to 555-01xx before Telnyx, by rig mode's destination gate. The database gate is reached first and raises `rig_destination_refused`, so each route answers 500 and the API's own error report for that route names the gate. A text that the Worker's gate refuses instead is filed as failed with that code. The guard's lease record holds no app request it refused for an unowned destination. STRANGER-1's call to DEV-W1 is rejected before any ring leg, row or voicemail, and its text is not threaded. The guard returns 403 to a dial on production's connection, a text from a number outside the group, and a dial to a non-owned number, each under its own rule. rigd's report of the API's exceptions counts the two error reports of a G01 attempt as expected. **Any success:** a critical result, sent at once to PostHog's `synthetic` environment. A production alert for it is not built yet. | 1 |
| G02 | Calls the apps' SDK places itself | The sentinel credential, held by a test page on the rig | **Pass:** the browser SDK and the device-lane emulator's SDK, both signed in on `nonprod-webrtc`, each try a direct call to the sentinel; both are refused and the sentinel never rings. **If it rings:** alert, and residual X25 applies. Not runnable yet: the Android half needs the nonprod build to place an SDK call to a SIP address, and the app has no entry point for one. | 1 |
| S01 | Browser calls a phone number (on-net) | ROBOT-1 answers after 4 s | **Pass:** ringback energy before answer. The browser hears the 1,100 Hz reference during the connected talk window after playback begins, and the robot hears 1,300 Hz. Caller ID is DEV-W1, the one-time token is used once, the row is answered, and a voice-seconds meter event lands in Stripe test mode. | 2 |
| S02 | Phone number calls Loonext, answered in the browser | ROBOT-1 dials DEV-W1 | **Pass:** ring dialog and SDK ringing within 6 s; both codes heard; row answered; billed seconds equal the meter. | 2 |
| S03 | Loonext calls Loonext across workspaces | QA-C page dials DEV-W1 | **Pass:** the QA-W owner rings and answers; each side hears the other's code; two rows with distinct session keys, each billed to its own workspace; no text-back. **Recorded, not judged:** how Telnyx routed and billed the call, for the rig's billing measurement. | 3 |
| S04 | Unanswered call: voicemail, transcript, intake, webhook, text-back | ROBOT-1 speaks after the beep | **Variants:** decline. **Pass:** voicemail stored locally, and the Telnyx copy returns 404. Transcript word error is 0.25 or lower, intake is present, the robot sink receives a signed `voicemail.received`, and ROBOT-1 receives a text-back within 60 s. Web decline sends the caller to voicemail within 6 s. | 2 |
| S05 | Caller hangs up while ringing | ROBOT-1 hangs up at 8 s | **Setup:** under the lease, QA-W is closed on the destination clock, automatic-text cooldown is 30 minutes, and the owner is on call for DEV-W1. On retry, the rig uses ROBOT-2 so the prior attempt's cooldown does not suppress the text-back. **Pass:** the call is missed; the text-back arrives within 60 s; a ring push is recorded; an escalation opens, and widens when the rig fires the minute cron 10.5 minutes later. | 2 |
| S06 | Hold, mute, keypad | ROBOT-1 | **Pass:** the member's code is absent from the robot's recording during hold and mute and returns within 2 s; digits 1-2-3-# arrive in order. | 2 |
| S07 | Blind transfer, decline and timeout | ROBOT-1 to DEV-W2 | QA-W rings in turn so the owner takes the original call. The robot hears the owner at 1,300 Hz while the target rings. After the transfer, it hears the technician at 1,700 Hz and the ledger records the answered transfer leg. **Variants:** decline and timeout. In both, the robot continues to hear the owner on the original connection. | 4 |
| S08 | Consult transfer, inbound and outbound | ROBOT-1 | The owner selects Talk first. During the consult the robot hears no member and the pages hear each other. After Hand over, the robot hears the target and the sender's leg ends. **Variants:** outbound. That direction uses four Loonext dials. | 5 |
| S09 | Busy line, second caller, self-dial | ROBOT-1, ROBOT-2 | **Pass:** the second caller reaches voicemail within 8 s; while the line is busy, the owner's dial shows "This line is on another call" and the guard's lease record shows no new app dial; after hang-up, a self-dial reaches voicemail. | 5 |
| S10 | Number X calls number Y in one workspace; call waiting | DEV-W1 to DEV-W2 | **Pass:** the technician and the owner ring (DEV-W2's audience includes the owner); the owner's page shows call waiting; the pages hear each other; DEV-W1's inbound row is answered. | 4 |
| S11 | After-hours, on-call, in-turn, ring length | ROBOT-1 | **Setup:** under the lease, today's hours are set two hours from now, so the shop is closed; after-hours calls are `on_call_only`, ringing is in turn with a 20 s ring, and the technician is on call for DEV-W2. **Pass:** only the on-call page rings, and the owner's stays idle for 15 s; voicemail answers at 20 s, plus or minus 2 s. | 2 |
| S12 | Voice and dial-count caps (QA-C) | ROBOT-1 | **Setup:** call records seeded, already reported, to production's own cap values, never lowered: the dial ceiling first, on its own, then the minute cap. Both gates read `call_records`, not usage rows. **Pass:** at the dial ceiling, outbound gets 402 `usage_cap_reached` and the guard's lease record shows no dial; over the minute cap, inbound ends busy and the text-back still arrives. | 1 |
| S13 | Paused, suspended or released number receives a call | ROBOT-1 | **Pass:** a run tests two of the three states, each put back as soon as its call ends: no ring legs; the "line is down" notice is transcribed (75% of its words), or the call rings out when the row says the notice was not spoken; a released number is dropped within 5 s. | 2 |
| S14 | Kill switches (local flags only) | ROBOT-1 | **Pass:** `kill:calls` refuses a new call with 503 while a live call's codes continue; `kill:outbound-send` refuses with 503 before the guard, and nothing reaches the robot; `kill:ai` stops Lou's drafts (the same `runAiFeature` gate also covers transcripts); every flag is reset afterwards. | 2 |
| S15 | Greeting-capture call | ROBOT-2, seeded as the owner's mobile | **Pass:** the robot hears the prompt (75% of the capture prompt's words, leaving out the business name) and speaks 16 s after answer; the new greeting's audio transcribes within 0.25 word error of what it said. | 1 |
| S16 | Note-level member; signing a device out revokes voice for the person (D130) | ROBOT-1 | **Pass:** the note-level member gets no ring leg and no push while the owner rings, and its dial attempt gets 403. After the seed's sign-out member signs its session out, token minting gets 401, as for any revoked session. **Afterwards:** a fresh sign-in mints again. | 2 |
| S17 | Webhook failover and duplicate delivery | The edge returns 503 once | **Pass:** webhook deliveries (read through the guard) show the 503, then a 2xx on the failover; the event is recorded once and processed. rigd's webhook forwarder answers the next call event with the fault S17 arms. | 3 |
| S20 | Outbound text | ROBOT-1 | **Pass:** exact body within 30 s; status goes sent, then delivered; usage row and test-mode meter event; `message.sent` webhook at the sink. | 0 |
| S21 | Inbound text | ROBOT-1 to DEV-W1 | Passes when a text threads once within 15 s, appears in realtime in the page, and shows in a browser Web Push notification. A fenced or unreachable browser push provider produces an infrastructure verdict. | 0 |
| S22 | Picture messages both ways | ROBOT-1 | **Outbound pass:** the exact body and picture reach ROBOT-1 from DEV-W1, and the hash Telnyx reports equals the stored file's, so Telnyx fetched it through the edge. **Inbound pass:** threaded with an attachment and stored as a JPEG with GPS EXIF stripped, not quarantined. | 0 |
| S23 | Loonext texts Loonext | DEV-W1 and DEV-E1 | **Pass:** both thread; no 40007 loop error. | 0 |
| S24 | STOP, START, HELP, ARRET, AIDE, plain-English opt-out | ROBOT-2 to DEV-E1 only | **Pass:** the opt-out is recorded; the next send is refused before the guard; a call to ROBOT-2 still connects (D38); the plain-English request is only flagged. **Cleanup:** the undo has ROBOT-2 send START. A STOP left in place after cleanup is critical. | 2 |
| S25 | Automated texts and quiet hours | ROBOT-1 | The runner fires the minute cron at a past or current instant in Toronto. **Pass:** the late scheduled send and the reminder for a customer-linked appointment arrive in the daytime run (variant 1) and are held for quiet hours in the night run (variant 2). ROBOT-1 sends an ordinary text to a workspace marked closed that day and a separate emergency keyword. Both replies must arrive in either variant. The undo restores the hours and emergency timestamps and removes the fixture appointment and any new reminder rule. The help reply answers AIDE, which S24 sends. | 0 |
| S26 | Messaging caps and budgets | Seeded rows, at most 2 real sends | **Pass:** each refusal carries its own gate's error: 402 `usage_cap_reached` at the monthly segment cap (seeded usage rows), and 429 `rate_limited` at the hourly limit (a seeded outbound message, which the carrier's daily count also includes); the 80% carrier-ceiling alert lands in PostHog's `rig` environment. Not runnable yet: the API raises that warning by email only, never as an API exception. | 0 |
| S27 | Website widget code | ROBOT-1 | **Pass:** a start with no Turnstile token is refused and the always-pass key passes; the code reaches ROBOT-1 from DEV-W1 within 60 s; verify succeeds; the verification count goes up. The always-block key is not checked, because the rig's Turnstile secret accepts every token. | 0 |
| S28 | Number buy, bind, call, release | ROBOT-1 calls the new number | **Pass:** one area-code search, a regional fallback if needed and one order through the guard with the rig group, profile and connection. The normal provisioning cron reconciles a pending order until the app binds the number. The QA-G owner waits for the browser phone to register on `/calls` before ROBOT-1 dials. The number rings and the app's grace cron releases it before the run passes. The app row reads `released` and a guarded Telnyx read returns 404. No standing number changes. **Undo:** registered before purchase. If the run ends early, it deletes unreleased QA-G numbers through the guard, including an order whose number ID the app did not record. It finds such an order by QA-G's exact customer reference in the rig billing group. | 2 |
| S29 | Cancel, grace, release, billing | Stripe test mode (shared) | **Setup:** a guard lease with `dials: false` keeps S28 and S29 from changing QA-G at the same time. S29 backdates cancellation to day 31 and fires grace. **Pass:** the day-30 notice is ledgered without older warnings, no live campaign remains, and no standing number changes. Separately, a test-clock renewal invoice matches Starter's base price and recorded SMS overage. **Undo:** restore QA-G's subscription and delete the Stripe test clock. | 0 |
| S31 | Lou reply drafts and AI caps | A synthetic thread | **Pass:** a draft comes back through the guard and the guard's AI neuron count rises; the `suggest_reply` usage row counts it; a request seeded at the 1,500 cap answers `over_cap`. | 0 |
| S32 | Sign-up, Checkout and the portal | Stripe test mode (shared) | **Setup:** under a guard lease of its own (`dials: false`), so the guard lets the number picker search; the run holds it for about 4 to 8 minutes, which blocks paid runs. **Pass:** before signing up, a test-mode preflight finds Stripe Tax active; sign-up is confirmed through Mailpit and lands signed in on the wizard's name step; the name step moves on to the number step; there the new owner picks Canada and the first of 416, 647, 437, 905 and 289 with numbers, as a customer moves on from a dry area code, and a number in it (the masked area-code choice, or the first listed number; Refresh at most twice when the list could not load), answers Canadian customers only, and Continue creates the workspace and reaches the plan step. rigd then gives the unpaid workspace a fixture number row (`app.release-signup-number` registered first): active, `source` provisioned, no Telnyx id, a fictional `+1 <area code> 555-01xx` number, label `Rig S32 fixture`, keyed `rig-signup-s32-run.<run-id>.<nonce>`. An unreleased fixture is reported with its creating run ID, or its row ID for legacy keys. Continue to checkout opens Stripe's hosted Checkout, which is paid with the 4242 test card, the sign-up address and a Toronto postal code, and sends the owner back to the app; the workspace names a subscription that Stripe holds as active, and rigd tags it and its customer as the rig's. The paid webhook finishes (its `webhook_events` row is processed), and the workspace's only unreleased number row is the fixture, with no row keyed by the Checkout session: provisioning found a number and bought none. Setting-up offers Open your inbox and the inbox opens. The lease's guard record shows at least one number search answered 200 and no forwarded `POST /v2/number_orders`, `POST /v2/messaging_profiles`, or PATCH or DELETE of `/v2/phone_numbers/:id`; refused attempts are recorded, not judged, because other crons share the window. Before the portal, S32 checks the configured owner portal in Stripe test mode, or the default when the rig has no owner configuration. Then billing's Manage payment & invoices opens `billing.stripe.com`. After the lease's undos, no fixture row is left unreleased and no sign-up workspace holds a row the rig did not assign. **Critical:** a forwarded number write, a row the paid webhook made, or a leaked row. **Undo:** the subscription and the customer are deleted from test mode at the run's end (also registered as `stripe.delete` undos); the fixture row is released in the database; the sign-up is deleted (its workspace soft-deleted, and its owner soft-deleted in auth, because the workspace's rows keep the owner by a restricting foreign key), and refuses, naming the row, when its workspace holds a number the rig did not assign. The sign-up's address is suppressed for the app's mail from before the sign-up until then, so neither the new-device notice nor the day-1 grace notice the cancellation sends spends a Resend send. **Infra, never fail:** `guard` (search allowance not deployed) when the guard refused the search as `provisioning.search_needs_lease`; `stripe-tax` from the preflight; `stripe-portal-config` when everything before the portal passed and the selected test-mode owner portal is inactive or missing; `stripe-checkout` (challenged) when Stripe showed a challenge, which the rig never answers. **Not covered:** the US branch (US texting, its $29 registration fee line, the business step after payment, 10DLC) and the number purchase itself (covered in S28). | 0 |
| S33 | Two-factor login | none | **Pass:** with a TOTP code from the rig's store, the session reaches the second assurance level and the API accepts it. | 0 |
| S34 | Emails | Robot mailbox (Resend, Email Routing, edge); Mailpit | **Setup:** a confirmed local-auth account is created at the robot mailbox's `+s34-acct-<nonce>` sub-address (removed by the undo), to exercise the direct accept link for an existing account. **Pass:** that invite, sent as QA-W's owner under S34's own guard lease, is mailed by the app (`email_sent` true; nothing for the address in Mailpit), goes through Resend and Email Routing to the edge, and arrives at the robot mailbox at its `+tag` sub-address within 10 minutes, as the invite (its subject, a link to this invite's accept page, its rig links return 2xx or 3xx); auth mail (a password reset) is read from Mailpit within 2 minutes and its link works. A pass proves the route and not the receiver-side reputation checks (FA4 step 3 says exactly what). A missed-call alert is push-only since D45, so no mail is checked for one. | 0 |
| S35 | Public sign-up form | Mailpit | **Pass:** sign up, confirm by email, reach the app. | 0 |
| D01 | Inbound call rings every rig surface; the answering surface rotates | ROBOT-1 to DEV-A1, dispatcher added under the lease | **Pass:** within 8 s the page dialog shows, and the device-lane emulator shows Telecom RINGING plus the full-screen notification. The robot identifies the answerer by code; the other clears within 3 s; one database winner. | 4 |
| D02 | Android wake: app killed, forced Doze, locked with a PIN | ROBOT-1 to DEV-A1 | **Pass:** FCM accepted the push at high priority; the nonprod app's beacon stages arrive, each after the stage that causes it; Telecom shows RINGING within 12 s; UIAutomator answers; the rig hears 1,100 Hz through `streamAudio` and the robot hears 2,300 Hz through `injectAudio` (until spike EA1 passes, the audio half is `emulator-audio-unproven`). **Recorded, not judged:** the lock state at ring time, since adb can read an occluded keyguard as unlocked. | 3 |
| D02p | Android wake with no call | none | **Pass:** a real FCM call push for a synthetic session is accepted, received, reported to Telecom, and shown ringing within 12 s, in either order of the last two beacons (the ring is the app's own notification and may show a few hundred ms before Telecom reports the call); no ring-me beacon follows within 15 s, because the app stops at the session's 404 before it asks to be rung. Zero dials: D02p runs under a local lease, and the guard refuses every app dial while no lease is live. | 0 |
| D03 | Stepped Doze | ROBOT-1 | **Setup:** `dumpsys deviceidle enable all`, screen off, battery unplugged in software; then step deep idle to IDLE through one maintenance cycle, holding the device lane so no other run uses the device-lane emulator meanwhile. If the run cannot start after that, the battery goes back in and the emulator is unlocked. D03 holds the device lane, so it is started when no other paid device-lane run is going. **Then:** as D02. Not reaching IDLE is an infrastructure result. Natural deep-Doze entry is not tested, because an emulator never enters it by itself (X6). | 3 |
| D04 | Android variants: standby buckets, battery saver, secure lock, before first unlock, app hibernation | ROBOT-1 | **Pass:** one variant per run. Its state is read back before the ring and judged against the runner's expectations table; the first runs confirm each row. A device that stays quiet counts only when FCM accepted the push. | 3 |
| D07 | Android app calls out | ROBOT-1 answers | **Pass:** the device-lane emulator's call connects; codes heard both ways (the device's half through gRPC audio, `emulator-audio-unproven` until EA1 passes); caller ID is DEV-A1. **Variants:** speaks only, and listens only; each opens one of the emulator's two gRPC audio calls (`injectAudio` to speak, `streamAudio` to listen) and judges that half alone, so an emulator fault during a live call can be put on one of them. A one-sided pass is not D07's pass: the verdict store keeps each run's result apart. | 2 |
| D08 | Background tab and Web Push | ROBOT-1, dispatcher-only audience under the lease | **Pass:** the app's service worker shows the ring notification within 10 s, and the same notification carries the outcome within 30 s of hang-up. Chrome's own notification centre is not read. | 2 |
| D09 | First-answer race | ROBOT-1 | **Pass:** the device-lane emulator and a page answer within 300 ms of each other; the robot hears exactly one code; the database has one winner, the one heard; the loser holds no call within 5 s. Neither app shows "answered elsewhere": both drop a lost ring silently. | 3 |
| D10, D12 | Fresh install; upgrade from the previous release | ROBOT-1 | **Pass:** after install, or after an upgrade from the signed-in previous build, the app has a push target, then D02p and D02 pass. A stale row from the earlier install also counts as a push target, so D02p's beacons are what prove the new install works. | 3 |
| D11 | Unattended recovery | none | **Setup:** hard-kill the device-lane emulator's process, restart the other emulators, and cold-boot it with `-no-snapshot-load`. **Pass:** within 10 min, every `rig health` result is green, every emulator is booted, and the device-lane emulator is back, unlocked with its PIN and Doze-enabled; then D02p passes. | 0 |
| D13 | Bad network and a mid-call Wi-Fi drop | ROBOT-1 | **Setup:** the emulator console sets 80 ms of delay and a reduced network speed; 15 s after answer, `svc wifi disable` drops Wi-Fi, and `gsm data unregistered` with Wi-Fi off makes a 3 s outage. **Pass:** the call survives; the device's code is heard before the outage and again from 5 s after it. No loss is judged, because the console has no loss control (X27); Telnyx's RTP statistics are recorded. The device's own concealment is not measured. | 2 |
| D14 | In-app voicemail and MMS playback | none | **Setup:** under a local lease, S04's newest voicemail (its audio and transcript) is copied into a QA-A call row on DEV-A1, marked as already transcribed; the undo removes the row and the audio. **Pass:** the device-lane emulator's app lists the call with its "Play voicemail" control, and the rig's transcript of its media audio, heard through `streamAudio`, is within 0.25 word error of S04's phrase (`emulator-audio-unproven` until EA1 passes). Until S04 has left a voicemail, it is an infrastructure result. | 0 |
| E01 | Emulator wake, rotating through API 34, 35 and 36 | ROBOT-1 to DEV-E1 | **Pass:** as D02, except the emulator hearing the robot: only the device lane has the gRPC audio link (section 3.9), so E01 records no emulator's audio and a pass says that half was not judged. Across a week of E01 runs, at least one API level must also pass the audio verdict, or the lane raises "emulator-audio-degraded". **Variants:** notifications revoked, and force-stopped; both must NOT ring. | 3 |
| K01 | Outbound carrier egress (optional, Phase 4) | A public echo-test line | By default it never runs: Phase 4 is optional. **Pass:** the robot hears its own code echoed back with a 0.1-1.5 s delay. **Any other answer:** hang up within 3 s, and the line is removed permanently. | 1 |

**How your original examples map:**
- **Loonext to Loonext:** S03, S10, S23.
- **Loonext to phones:** S01, D07 (K01 later).
- **Phones to Loonext:** S02, D01, D02, E01.
- **"An app didn't ring":** D02, D02p, D03, D04, D10-D12, E01, and production's ring events in PostHog.

### 4.3 Named defects (not covered human-free, and why)

| ID | Gap | Why a machine cannot do it within the rules | What would close it |
|---|---|---|---|
| X5 | Texts to and from real handsets on carriers, including US 10DLC and a STOP from a real phone | Needs a SIM (forbidden), and a registered campaign for US traffic | A SIM, if the rule is ever lifted |
| X20 | A real carrier call into Loonext: ringback, early media, STIR/SHAKEN | All inbound calls come from the robot, on-net | The same. Production's ring events in PostHog measure it passively once production has volume. |
| X10 | Outbound caller-name display on a recipient handset | No carrier handset | The same |
| X17 | Wi-Fi to cellular handover; a cellular call interrupting a Loonext call | The emulators have no real radio; the console's `gsm call` simulates one and no lane runs it yet | None (no SIMs); a data SIM only if the rule is ever lifted |
| X21 | PushKit wake, locked-device CallKit answer and decline, call audio and receiver proximity | Simulator alert injection bypasses APNs and cannot reproduce a Telnyx VoIP push waking a locked or terminated app. Simulator audio lacks the iPhone's receiver, proximity sensor and ring/silent switch. | **Accepted.** The [iOS QA workflow](QA.md#ios-simulator) covers simulated alerts, app flows and accessibility audits. Its call tests exercise synthetic VoIP payloads and the softphone logic behind CallKit actions. The hardware gap is recorded on the issue when the applicable automated checks pass. |
| X22 | Calendar consent, refresh revocation, and all of Microsoft | No test identities can be created | Phase 4 offers a Google partial: a service account in the existing project owns its own calendar, and a token-URL seam lets the guard hand the app service-account tokens. That covers the Google API, the sync worker and push channels (verify the push-channel domain rule). |
| X23 | Hosted behaviour: Durable Object eviction under load, CPU limits, hosted Supabase auth settings, Realtime at scale, OpenNext on real Workers | The rig is local | Partly covered by production's events in PostHog and the hermetic workerd Durable Object test |
| X24 | Supabase Auth mail over Resend SMTP; Resend bounce and complaint webhooks | Auth mail stays in Mailpit. Resend webhooks are team-wide and would carry production events. | Stays hermetic |
| X25 | A rig credential's SDK ringing another internal credential directly | Only if G02 shows the SDK path is open | Accepted residual if G02 rings; `sip_uri_calling_preference` governs only inbound calls, so no connection setting closes it. Production SIP usernames are never in any rig context. |
| X26 | Telnyx portal-only tools: SIP call flow, PCAP, QoS graphs, push debugging | No API exists for them | The robot's own RTP statistics, plus session analysis and call events read through the guard, substitute |
| X1 | A genuine Telnyx "flagged" screening verdict | Telnyx decides it | Recorded payloads cover our handling |
| X2 | Real port-in and port-out | Needs a legal signature; port-out loses the number | Not recommended |
| X3 | Hosted-SMS text-enablement; the sole-proprietor code | Needs a number elsewhere, plus paperwork each time | None |
| X4 | Live 10DLC reviews | No sandbox for them (D31) | Hermetic golden-us |
| X6 | Wake, Doze and call audio on a physical Android phone | No new hardware: every Android lane is an emulator with a Pixel profile, so it misses OEM power management, natural deep-Doze entry, a real radio, Bluetooth and a vendor audio stack | None. Production's ring events in PostHog measure wake on customers' phones; nothing in production measures call audio. |
| X7 | Firefox Web Push quota | Not automated | None |
| X8 | A third incoming call auto-declining | Needs a third QA-W number | One more number, $1.10/month |
| X9 | A text stuck "queued" for 15 minutes | Fault injection | Stays hermetic |
| X12 | Safari softphone | No Safari on Linux | A Mac (out of scope) |
| X13 | Google and Apple sign-in | Consent screens and bot checks | Stays hermetic |
| X14 | Passkey enrolment | Real authenticator; the relying-party id is app.loonext.com | A virtual authenticator, web only |
| X15 | Real Turnstile | Blocks automation by design | Test keys, kept honest by the always-block check |
| X16 | Speaker and earpiece audio routes | The rig hears only the emulator's one virtual input and output | None |
| X27 | Packet loss on the Android device's network path | The emulator console sets delay and speed but has no loss control | None. Production's ring events cover wake only. |

---

## 5. Everything that expires, and what renews it

| Credential or device state | Lifetime | Automatic renewal or check |
|---|---|---|
| Telnyx key `nonprod-guard` | No expiry | Guard health in R00, when it is run; Telnyx's API key notifications, once enabled (section 3.5) |
| The existing Cloudflare Workers token in `guard` and `rig-cloud` (FA4); `guard-attest-read`, and the optional scoped tokens, once made | No expiry | Deploy health; attestation (in R00, when it is run); the reach audit |
| GitHub App key | No expiry | Installation tokens last 1 hour and are minted per use |
| Fine-grained token for the agent Windows user (FA2, optional) | No expiry, unless the org forces one | If forced, renewing it is a 5-minute act once a year; the reach audit warns 14 days ahead. This affects development, not rig operation. |
| The Stripe test-mode key (FA5); the existing Resend send-only key (FA8); the PostHog keys (FA7); `agent_diag` password | No expiry | Used whenever the rig is; failures surface in R00 or the reach audit |
| FCM service-account key | No expiry, unless an org policy sets one | Checked at FA6; a dry-run send detects failure |
| Edge, guard and robot caller tokens; rig certificate authority (10 years); rig ES256 signing key; VAPID keys; Android nonprod keystore (25 years) | No practical expiry | Rotated only after an incident |
| `stripe listen` | Uses the test-mode key directly; no 90-day login | R00 checks it |
| The VM's SSH key pair and its pre-seeded host keys | No expiry | hostd's tunnel refuses a host key that does not match the pinned one; R00 checks the tunnel |
| hostd on the host | Per logon from the Startup folder, or per boot with FA16 | Nothing notices a rig that is off: it is used on demand, and an agent who needs it starts it |
| Telnyx balance and rentals | Usage and monthly rentals | Telnyx applies account billing rules and sends its own Low Available Credit notice. |
| Telnyx evidence windows (call status 10 minutes after hang-up; call events 24 hours; SIP flow tool 3 days) | Short | The robot stores ids and RTP statistics at test time |
| Stripe test clocks | Per run | Created and deleted by each run |
| Local Supabase | Never pauses | none needed |
| Rig disk | Fills | Nightly purge of synthetic media, plus webhook rows older than 7 days; alert at 70% |
| adb authorisation | 7 days by default | "Disable adb authorization timeout" set once on each AVD; the rig-only adb server's key lives in hostd's private home on F: |
| Android auto-revoke of permissions | Months | Set to ignore at baseline; D04 tests hibernation on purpose |
| Play Protect checks of adb installs; developer verification | Ongoing; changes due 2027 | Play Protect's adb scanning is off at baseline, so the lanes' installs are not scanned |
| Android system images (each AVD's revision) | Fixed by the pinned revision | Each AVD's system-image revision is pinned; the agent moves a pin, re-creates that AVD and re-applies settings. R00 names the revision in force. |
| Google Play services on the AVDs | Fixed by the image revision; ages without a Google account | A watch flags a new Play services `versionName` for the pinned images; R00 compares the version with the app's minimum |
| FCM deprioritisation | Builds up over 7 days | Risky variants run on emulators only; a falling D02p receive rate raises an infrastructure alert |
| Emulator cold boot | Any time: D11, before-first-unlock runs, a host restart | The lane re-enters the PIN from `pixel-pin`, runs `dumpsys deviceidle enable all` and re-applies settings |
| App sign-in on an emulator | Can be lost | The local stack uses Turnstile test keys, so `rigd` signs in again with no human |
| Android SDK packages, on Windows and in the VM | Pinned | Upgrading means accepting a new licence: a named founder act, about once a year (FA15) |
| The emulator hypervisor | AEHD, the older driver, is sunset on 2026-12-31 | Nothing to do: the rig runs on WHPX |
| FCM v1 message priority | No deprecation date announced | A watch records the first dated notice that FCM v1 changes how high priority is delivered; D02 already fails when FCM did not accept the push at high priority |
| The VM's OS | Weekly updates; built from the Ubuntu 24.04 cloud image release 20261017 | Unattended upgrades, rebooting the VM outside the window. A rebuilt VM verifies the newer image's checksums and signature. |
| Windows on the host | Monthly updates | A restart can interrupt the rig. Hostd brings the VM and emulators back at logon, or at boot with FA16. |

---

## 6. Isolation guarantees and the mechanism behind each

1. **Agents and the gates (amended).** Under the amendment, agents keep the production access they have today, and guard and ops runs need no approval, so there is no gate for an agent to approve (section 12, risk 4). What still holds:
   - guard and ops runs take only `main`, through each environment's deployment-branch rule (FA9);
   - the reach audit lists every credential an agent session can reach. Its recurring run and its GitHub probes are still planned (section 3.1);
   - with FA1 and FA2, which stay optional, agents would run in a separate Windows user with no console sessions, no Claude in Chrome and no production keys, under a GitHub token that lacks Deployments, Administration, Environments, Secrets and Variables.
2. **No real person is called or texted.**
   - The guard holds the only usable Telnyx key. It requires an owned `from` and an owned `to` (live by billing group) or a SIP username on the rig's own connection.
   - The app's destination gate covers every send and dial site, with a census test that fails on a skipped site or on zero sites.
   - The SQL gate inside the send and dial functions refuses non-endpoint destinations on the rig's database.
   - The rig's credential connection has no outbound voice profile.
   - The rig's database holds synthetic data only.
   - G01 proves this each time it is run.

   The only non-owned destination is the optional echo line. Email goes only to Resend test addresses, or to the robot during S34. Pushes reach only the nonprod Android package.
3. **Strangers cannot drive the rig, or put words in an agent's input.**
   - The edge rejects strangers' calls through the guard and drops their texts, so their content never reaches the rig or any agent.
   - The app also rejects owned-but-unlisted numbers, and G01 proves that each time it is run, with STRANGER-1.
   - Rig-authored pull requests are never auto-merged.
4. **No real card is charged.**
   - The rig holds only the existing account's Stripe test-mode key (FA5), and refuses anything not `sk_test_` or `rk_test_`.
   - The app refuses live keys and live events outside production.
   - `stripe-setup.ts` refuses a live key without `--live`.
5. **No production customer data is touched or copied.**
   - No production database credential exists on the rig, the edge or the guard.
   - DNS blocks production API and database hosts for the rig and the emulators.
   - The VM cannot read the host's drives, where `apps/api/.dev.vars` holds production keys (guarantee 18).
   - The app refuses any Supabase host outside `*.rig.internal`.
   - Guard reads are filtered to nonprod resources.
   - Repro reads production only from the agent Windows user, through non-personal views and redacted reads.
6. **Production's sweeps never touch rig numbers, and the reverse.**
   - Ownership is positive, by billing group, set in the order body and read back on the first order: the E.164, found in the group's listing.
   - Nothing is ordered before `/health` reports the rule.
   - An ownership-mismatch alert covers the silent case.
   - 10DLC writes are refused.
   - S28 verifies this with a live guarded order and releases the number in the same run.
7. **The account's call capacity is shared.** The runner serializes test attempts. Telnyx can refuse a call when the account reaches its own limits.
8. **The rig cannot command production calls or ring production devices through the guard.**
   - Commands work only on registered legs, SIP targets are limited to the rig's own credentials, and connections are pinned.
   - The SDK's direct-call path is checked by G02 when it is run, and named as X25 if open.
9. **Webhook ownership is decided by resource, never by signature.** The edge checks the connection for calls and the profile for texts. Production's handler is untouched.
10. **Vendor usage follows the applicable account and product policies.** The rig uses dedicated nonprod resources and permits only eligible callers and destinations.
11. **The dangerous keys sit in one place.**
    - The Telnyx, Resend and FCM keys live only in the guard, which has no public URL.
    - It deploys only from `main`, after its policy tests pass.
    - R00 attests the guard's version whenever it runs, and Telnyx's own notifications cover the account's keys (section 3.5).
12. **No token on the rig can redeploy production or the guard.**
    - The existing Workers token that deploys the guard and the edge lives only in the `guard` and `rig-cloud` environments, which take deployments from `main` only, so it deploys merged code (FA4 substitution). The VM never holds it.
    - The production deploy token lives in the `production` environment, limited to `main` and release tags.
    - Scoping each token to named Workers is optional hardening. Until then a token in those environments could deploy any Worker in the account, which only merged code running from `main` can make it do.
13. **Cloudflare counters and bindings cannot collide.** The rig's limiters are local; the cloud Workers use ids 3001-3009 (CI-checked); nothing binds a production KV, D1 or Durable Object.
14. **Production's login cookie is never exposed.**
    - The production cookie is host-only on app.loonext.com: `{ secure: true }` in `apps/web/src/lib/supabase/cookie-options.ts`, checked 2026-10-29.
    - The rig's app lives only at `app.rig.internal` on a private network.
    - The edge is on workers.dev, which is on the Public Suffix List (version 2026-10-28), so it is cross-site to loonext.com. It serves no HTML and sets no cookies.
15. **Production's safety rails stay on.**
    - The same code, gates, caps and limiter values run on the rig.
    - Rig mode can only add restrictions; the single rig-only route is proven absent from production.
    - Cap scenarios seed usage up to production's values and never lower a cap.
    - The only substitution is Turnstile test keys, kept honest by the always-block check.
16. **A wrong flag fails closed.**
    - Production identity needs `DEPLOY_ENV=production`, which only `ship.yml` stamps.
    - The app refuses production identity when its database is on the rig.
    - DNS blocks production and vendor hosts on the rig.
    - `rigd` refuses any APK that is not `.nonprod`.
17. **Production alerts stay clean.**
    - Rig and synthetic events carry the environments `rig` and `synthetic` in the shared PostHog project, which no alert reads (D146).
    - Only isolation, guard, agent-reach, account, balance and account signals reach production on purpose.
    - Production's email reputation is protected by the mail rules in section 3.5.
18. **The rig cannot reach your other machines, or your workstation's files.** It rests on the VM:
    - no shared folders (hgfs), clipboard or drag and drop, so the VM cannot read `D:\` or anything else on the host;
    - NAT plus nftables: input from the host, 192.168.70.1, is accepted only on ports 22, 443 and 53, and new outbound connections to private ranges are dropped, except to the gateway 192.168.70.2;
    - connections go from the host to the VM only;
    - the VM holds no host credential;
    - hostd listens on loopback only, and the VM's sshd `PermitListen` limits the tunnel's reverse binds to the loopback ports hostd names.
19. **The public repo stays clean.** Derived configs, env files, Firebase files, the certificate authority and all ids are gitignored or kept as secrets. `check-rig-no-e164`, `check-production-host-literals` and `check-local-secrets` enforce it.

---

## 7. Cost

**Telnyx rates** (telnyx.com/pricing/call-control, /pricing/elastic-sip, /pricing/numbers, /pricing/messaging and the rate sheet telnyx.com/pricing.md, all checked 2026-10-29):

| Item | Rate |
|---|---|
| Outbound leg | $0.005/min plus the $0.002 Voice API fee |
| Canadian inbound | $0.004/min plus $0.002 |
| WebRTC and SIP-URI legs | $0.002/min plus $0.002 |
| Recording | $0.002/min |
| Answering-machine detection | $0.002 per call |
| Canadian SMS | $0.0025 per part, each way |
| Transfer | $0.10 per invocation ("Call transfer" on the call-control page, "SIP Refer" on the rate sheet, both fetched 2026-10-31).  |
| Billing increment | 60 seconds |

A judged call costs about $0.02-0.03.

**Unknowns, budgeted at the costlier answer** (D142, update of 2026-11-01):
- Canadian carrier fees on texts: assumed on both ends, at the highest published $0.008845 a part (Rogers and Fido).
- On-net calls: assumed billed at full off-net rates on both legs.
- Per-dial charges: none is published for Call Control or WebRTC.
- Surcharges: $0.01 per short call above 15% of the account's calls and $0.005 per abandoned call above 20%, with cancelled ring legs assumed to count as abandoned.
- A number with no connection: assumed still billed for inbound calls and texts.

`call_cost_in_webhooks` is on, so `call.cost` events record what each call actually cost, in the rig's database.

| Cost center | Monthly estimate | One-time | Billing | Source |
|---|---|---|---|---|
| Eight Telnyx standing numbers and caller-name lookup | About $9.20 | About $8 | Telnyx billing | Rates above, 2026-10-29 |
| Telnyx calls and messaging | Varies with use | None | Telnyx billing | Rates above, 2026-10-29 |
| Cloudflare Workers, Durable Objects and Workers AI | Varies with use | None | Cloudflare billing | Cloudflare pricing, 2026-10-29 |
| Supabase | $0 | None | Local stack | |
| Stripe test mode, FCM, Resend, PostHog, GitHub Actions and Claude | Varies by provider plan and use | None | Provider plans | Rates above |

| Electricity | Estimated $2?$6 | None | Workstation power | |
| Hardware | $0 | $0 | VM and emulators | |
| **Total** | Fixed number rental, provider usage and workstation power | About $8 | | |

**Conditional and optional:**

| Item | Monthly | One-time | When | Source |
|---|---|---|---|---|
| Echo-test probe K01 | about $0.05 | none | Phase 4, optional; run on demand | Rates above |

**Telnyx Managed Accounts, for comparison.** They would give real isolation, but need the Starter commit plan at a $1,000 monthly minimum, with Telnyx approval (support.telnyx.com/en/articles/4951492, checked 2026-10-29). The production account returned 403 on that API.

---

## 8. How an agent gets in, and what it can see and drive

This section is the main way to use the rig. Everything below is started by an agent, by hand. Nothing starts on its own, and the scenarios of section 4.2 are only one of the things an agent can do here.

### Ways in

- **SSH from the host.** Host agents reach the VM with `ssh rig@192.168.70.10`, using the key `F:\loonext-rig\host\ssh\rig`, and the host key the VM was created with is pinned.
  - It is a full shell on the rig, which is the "SSH in and diagnose everything" of the EDR analogy.
  - Each repro or fix gets its own worktree, so the agent patches, re-runs and verifies in one place.
  - `vmrun` guest operations are a rescue path only: they need a guest password on the command line, which puts it in the process list.
  - Nothing is signed in to Claude in the VM, and there is no Remote Control session there (FA12 is dropped).
- **The `rig` CLI**, on the rig over SSH. Built today (`tools/rig/src/cli.mjs`):
  - `rig deploy --ref <tag|branch|sha>` (or `--worktree <path>`) puts any ref on the rig, so an unreleased branch can be tried before it ships; `rig apk --ref <ref>` builds the matching nonprod app; `rig seed` and `rig stack up` prepare the database and the stack;
  - `rig health` is R00 on demand;
  - `rig cron <expr|job:name> [--time]` fires one app cron on demand;
  - `rig run <scenario>[-<variant>] [--run-id <id>]` starts one scenario, a thin wrapper over rigd's `node tools/rig/rigd/src/cli.ts run`. It takes the guard's lease, judges, and records its verdict and evidence as always. rigd's `verdicts [--unresolved]`, `secrets` and `calibrate` commands are in the same CLI;
  - robotd (`tools/rig/robot`) serves the robot over loopback HTTP, with its own token: `POST /calls/dial`, `POST /calls/expect`, `GET /calls/<id>`, `POST /sms`, `GET /inbox` and `GET /sink`. That is how an agent places a call or a text from a robot number today;
  - hostd (`tools/rig/host`, on the Windows host) boots, kills and lists the emulators and the VM: `hostd devices list|boot|kill`, `hostd vm status|start|stop|revert`, `hostd doctor`.
- **Designed, not built yet:** a single front for the rest, which the design lists as `rig run <scenario> [--recipe] [--repeat N] [--build <ref>]`, `rig suite release`, `rig repro <issue>`, `rig seed --recipe`, `rig device pixel|emu34|emu35|emu36 install|kill|forcestop|doze|standby|saver|lock|unlock|coldboot|network|screenshot|logcat|callflow|bugreport`, `rig robot dial|answer|dtmf|sms|mms|verdict|inbox|mail`, and `rig lease` and `rig evidence <run>`. Until they exist, the same things are done through the lanes, hostd and robotd above, adb, and plain SQL. None of them is a schedule: a `rig suite` would run a chosen set once, when an agent asks.
- **Through the edge,** `/ctl/rpc` reaches rigd with the triage token: `rig.status`, `scenario.run` and the `triage.*` methods, which list unresolved failures, re-run a scenario, and fetch evidence.
- **Triage on request** (section 3.10), over the same SSH path. Nothing schedules it, and FA10 is dropped, so there is no cloud triage task.
- **Workstation agents**, for production reads only, from the host and never from the VM:
  - SQL on the `ops_diag` views as `agent_diag`;
  - Workers logs through `agent-logs-read`;
  - the guard's `diag` class;
  - production PostHog (error tracking, through the query-only key).
- **Optional (Phase 4):** a raw SSH relay through the edge, for reaching the rig from outside the workstation.

### Tokens

**On the rig:**
- guard caller tokens (`rig-api`, `robot`);
- the edge uplink token;
- the Stripe test-mode key, and no other Stripe key (FA5);
- the GitHub App key (`main` is blocked by the ruleset);
- the PostHog project key (public);
- the nonprod Firebase config;
- the nonprod keystore;
- test passwords and the TOTP seed.

**On the host** (in the agent Windows user, if FA1 is chosen): the read-tier tokens listed above, the VM's SSH key, and the fine-grained GitHub token (FA2).

**Never on the rig or in the agent user.** This holds on the rig because the VM cannot read `D:\` (guarantee 18), where `apps/api/.dev.vars` keeps production keys:
- a Telnyx key;
- a Cloudflare token that can deploy;
- a Supabase platform token;
- a live Stripe key;
- the Resend or FCM key;
- a production database password with write rights.

### MCP servers on the rig

- mobile-mcp (adb);
- Playwright MCP;
- a Postgres MCP pointed only at the local database;
- `loonext-rig`, which wraps the rig commands, robot verdicts, the inbox and the guard's nonprod reads (designed; no MCP server is built in `tools/rig` yet).

There is no Telnyx, Cloudflare or PostHog MCP there.

### What the agent can see

- **Server side:** unsampled API and web logs; the whole local database (calls, legs, sessions, the webhook ledger, messages, opt-outs, usage); the local API's push attempts and beacons in PostHog, under environment `rig`; Durable Object state.
- **Telnyx, through the guard:** call events, detail records, webhook deliveries, session analysis, recordings and the cost ledger, for nonprod ids only.
- **Robot and edge:** robot verdicts with per-frame numbers and RTP statistics; edge relay logs.
- **Android:** logcat; `dumpsys` telecom, notification, deviceidle, power and usagestats; the debug variant's call-flow log; screenshots; bug reports.
- **Elsewhere on the rig:** Chrome traces and `getStats`; the Stripe listener log; Mailpit; `rig health` results (`state/health.json`); the recorded call costs.
- **Production, from the host:** `ops_diag` views, Workers logs (3-7 days), PostHog and redacted Telnyx reads.

**Not visible:** Telnyx's portal-only tools (X26).

### What the agent can drive

- **Calls:** place a call from the robot, any page, or any emulator. Answer or decline anywhere. Send keypad digits, hold, mute, transfer and consult.
- **Texts:** send texts and pictures.
- **Device states:** put emulators into killed, force-stopped, Doze, standby, battery-saver, locked, cold-booted or bad-network states.
- **Pushes:** trigger them by calling, or with D02p at no cost.
- **Data:** seed tenants, audiences and usage; fire any cron at any time; flip local kill switches; move Stripe clocks.
- **Builds and devices:** deploy any ref; build and install any `.nonprod` APK; cold-boot an emulator, or revert the VM to its baseline snapshot.

---

## 9. Reproducing a reported issue

Example: "A customer's Android phone didn't ring yesterday." A PostHog error follows the same path, from step 2 with the event's stack and breadcrumbs in place of the call trace. Every step is started by an agent when a report arrives; nothing repeats on its own, and what the rig proves afterwards (steps 7 and 10) is proved by runs the agent starts. Regression coverage of the fix belongs in a CI test (step 9), not in a recurring rig run.

Commands marked "designed" in section 8 are not built yet; the text says what to use until they are.

1. **Intake.** Open a GitHub issue holding only a hash of the workspace id, the platform and the time window. The issue number stays out of commit trailers until the work is done.
2. **Read production without copying it** (agent Windows user). Query `ops_diag.call_sessions` and `ops_diag.call_legs` as `agent_diag` for the workspace and window, and PostHog's SQL for its `push_attempt` and `ring_beacon` events by `call_session_id`. The login comes from `AGENT_DIAG_DATABASE_URL`, or from the same name in `~/.loonext/agent-diag.env`, which FA13 writes (the pooler login `agent_diag.<project ref>`). The role is the safety: it reads only `ops_diag`, its transactions are read-only and its statements time out at 15 seconds, and the views name a workspace, number or member only by `ops_diag.ref()`'s hash, so a query filters on `company_ref` and never sends the id. For the window that shows:
   - sessions and legs per device;
   - each push attempt, with response class, priority and latency;
   - ring-beacon stages;
   - app version, OS, permissions and standby bucket.

   Add Workers logs for those requests, Telnyx call events through the guard's `diag` class, and production PostHog. Only codes, timings and versions go into the issue.
3. **Classify the stage:**
   - (a) no push was sent;
   - (b) accepted by the provider, never received;
   - (c) received, no ring shown;
   - (d) rang, but answering or audio failed.

   If the customer's app predates the beacon, (b) and (c) cannot be separated, so reproduce both. Android and iOS send all six stages (`push_received`, `os_reported`, `ring_me_sent`, `ringing_shown`, `answered`, `declined`); the web sends the last three it can see. Every client keys a beacon on the INVITE's `X-Loonext-Session`, and `apps/api/src/routes/ring-beacons.test.ts` fails if a client stops sending a stage it is listed for.
4. **Write a recipe.** `tools/synthetic/recipes/<issue>.yml` holds settings only: app version, Android level, phone state, ring strategy, member levels, network. `check-rig-no-e164` checks it in CI.
5. **Hand it to the rig.** Designed: `rig repro <issue>` in the VM over SSH. Until it is built, the agent runs steps 6 and 7 by hand over SSH.
6. **Rebuild what the customer ran.**
   - `rig deploy --ref <server release tag>`. Old web refs use the rig-only unsupported-Next flag; pre-seam server refs run in `--pre-seam` mode.
   - `rig apk --ref <app tag>` (the design calls it `rig apk build`). Tags older than the `nonprod` build type get a build-config overlay.
   - `rig seed` today; `rig seed --recipe <issue>` is designed.
7. **Reproduce at a rate, for free.** Run D02p 20 times on the device-lane emulator and on an emulator at the customer's API level (`rig run D02p`, once per run today; `--recipe <issue> --repeat 20` is designed). Stage (d), or a confirmation, uses the paid D02: keep it to about 5 runs, because each is real dials under the guard's caps, and it runs only inside the guard's window.
8. **If it does not reproduce, sweep.** Change one variable at a time: standby bucket, battery saver, each permission, lock and before-first-unlock states, network loss, app version. Record each negative result. If the cause looks specific to a physical phone (OEM power management, the radio, the audio stack), record it as X6.
9. **Fix test-first, in a rig worktree.**
   1. Write a failing test that pins the cause: Robolectric with `@Config(sdk = [34])`, or an API, SQL or workerd test.
   2. Fix it.
   3. Run lint, `pnpm -r typecheck` and `pnpm -r test`, plus the Android suite if shared code changed.
10. **Verify before merge.**
    - Deploy the branch on the rig and build the APK from it.
    - Require 20 of 20 D02p passes, 5 of 5 D02 passes, and a run of the scenarios that touch the area with no new failures.
    - The rig App posts a `synthetic/repro` status and opens the PR.
    - A workstation agent reviews the diff as untrusted input, re-runs the checks, and merges it.
11. **Release and confirm.**
    - Production changes only when the release-please PR merges.
    - An agent reruns the recipe against the released tag.
    - The issue stays open, labelled `awaiting-production-evidence`, until production's ring events in PostHog show at least 30 rings for that platform and version, at least 80% of them shown; the agent that reads them closes it. With today's volume that can take a long time, and the label says so.
    - The recipe is kept as the way to repeat the repro on demand, and its trace becomes a hermetic fixture under `apps/api/e2e/` through `node scripts/trace-to-fixture.mjs <trace> --out <fixture>`, which renumbers every number into 555-0100..0199 and writes nothing if any number survives.

At no step does any customer number, name, message, recording or database row leave production.

---

## 10. Build phases

| Phase | What gets built | Agent can build it | What needs you |
|---|---|---|---|
| **0a. The small production release** | Ownership rule, `/health` capability, ownership-mismatch alert, inbound-canary fix. Ships with `0fd3583c`, already on main. | Yes, now | Nothing beyond the normal release merge |
| **0b. Seams, evidence, guards, workstation tools** | Everything else in section 3.7, and the docs in section 14 | Yes, now | FA4 and FA9 to move `ship.yml`. |
| **1. Cloud pieces in existing accounts** | Edge and guard; the Telnyx partition created by the guard's setup routine; the notification channel; attestation; `rig-cloud.yml`, `guard.yml`, `rig-secrets.yml`. Number orders wait for 0a in production and the first-order check; paid dials wait for 0a and the ladder. Texts may start sooner. | Yes | Open: FA4's `guard-attest-read` token and Email Routing, and FA7 steps 3-5. FA3, FA6 and FA9 are done, FA5 and FA8 are substituted, and FA10 is dropped. |
| **2. The rig** | **Spikes first:** (2) code calibration; (3) local ES256 sign-in; (4) the cron route; (5) the AI shim; (6) FCM rewrite and package pinning; (7) robot inbound recording; (8) emulators under WHPX, started by hostd; (9) the edge-to-guard service binding; **EA1** gRPC call audio, in two steps: with no Telnyx cost, an AVD booted with `-grpc` and `-no-snapshot-load` (with and without `-no-audio`) whose in-guest page plays its microphone back, with a Node client injecting the 2,300 Hz code and streaming the output, passing when the detector hears both codes at 48 kHz, and measuring injection before and after the microphone opens; then one robot dial under the lease, passing when each side hears the other's code in at least 3 cycles with calibration's 10 dB of separation and no emulator crash; **VM1** cloud-init's datasource detection on Workstation, unproven until the first boot; **VM2** emulators started with nobody logged on; **VM3** the tunnel and the 5137 adb server, including whether the emulators honour `ANDROID_ADB_SERVER_PORT`. Spike (1), the Bluetooth purchase gate, is gone with the hardware. **Then:** VM creation, bootstrap, network, rig mode, seed, robot, `rigd`, lanes. | Yes | Open: FA15's first licence acceptance, on the Windows SDK and on the VM's SDK. VM creation replaces FA11 and is an agent action; FA12 is dropped. FA16 is optional. |
| **3. On-demand runs, reporting, triage, production watches** | Running scenarios by hand under the guard's caps; triage on request; G01, G02. No timers and no dead-man (D142, second update of 2026-11-01). The guard's own cap is final (section 4.1). | Yes | Nothing |
| **4. Optional** | K01 echo probe (by default it never runs); the Google calendar partial (X22); raw SSH relay | Yes | For calendar: enable the Calendar API and create one service account in the existing Google Cloud project (10 minutes). |

### Founder actions, with click paths

Labels are as of 2026-10-29; vendor screens change.

**FA0. Withdrawn (2026-10-31).** No ticket goes to Telnyx, and nothing waits on a reply. Each question it asked is answered by a dated public doc, a read-only API read or the rig's own measurement; where none settles it, the rig takes the costlier or safer answer (D142, update of 2026-11-01):

| Question | How it is answered now |
|---|---|
| 1. Telnyx account limits | Run the requested scenario and record any Telnyx refusal in the verdict. |
| 2. Per-dial charges; transfer pricing | None is published. A transfer is $0.10 ("Call transfer $0.10 per invocation"); the guard keeps $0.13, one leg more. `call_cost_in_webhooks` is on, so the rig records actual cost; the ledger is not yet checked against it. |
| 3. Routing and billing between our numbers; Canadian carrier fees | Assumed billed at full off-net rates on both legs, and the Canadian carrier fee assumed on both ends, at the highest published $0.008845 a part. |
| 4. Whether cancelled ring legs count as abandoned | Assumed to count. The short-call surcharge is $0.01 a call. |
| 5. Fraud-hold scope | Assumed account-wide and, for the rig, permanent: the rig never contacts Telnyx, and lifting a hold on production is a founder act outside it. So the first fraud-type notice latches the paid lanes off (section 3.5). |
| 6. Ordering both countries; `billing_group_id` on orders | Measured by the first-order read-back, which finds the E.164 in the partition's group listing and releases nothing. |
| 7. An active-call count | Measured: `GET /v2/connections/{id}/active_calls`, per connection. An unknown answer refuses. |
| 8. Disabling outbound SIP URI calls per connection | `sip_uri_calling_preference` governs only inbound calls, so X25 stays an accepted residual, measured by G02 when it is run. |
| 9. Whether notification webhooks are signed | Probably signed, not proven. The edge's corroboration (section 3.4) is unchanged. |
| 10. Billing on a number with no connection | Assumed billed; the $1.50 monthly set-aside covers it (section 7). |

**FA1. Give agents their own Windows user and remove production keys from their reach (about 45 minutes, optional).**
1. Settings > Accounts > Other users > Add account > "I don't have this person's sign-in information" > "Add a user without a Microsoft account". Name it `loonext-agents`, with a password stored in your password manager. Leave it a Standard user.
2. Switch to it (Start > your picture > `loonext-agents`).
   - Install Claude from claude.ai/download and sign in with your existing Claude account.
   - Run the agent's setup command. It clones the repo, writes local-only env files with fake vendor keys, installs the session-start secret check, and schedules Remote Control at boot.
   - Approve the one Windows admin prompt that adds this user to `docker-users`.
   - Do not install Claude in Chrome, desktop control, or any browser sign-in to a vendor console here.
3. Back in your own user:
   1. Copy into your password manager any production values you will need in FA9.
   2. Approve the agent's change that removes production keys from `~/.claude/settings.json`.
   3. Run the agent's one-line command that copies your Claude memory and CLAUDE.md into the new user.
   4. Once the agent confirms everything is pushed, delete `D:\projects\JobText` (or move it into your profile folder). Its `apps/api/.dev.vars` holds production keys in commented lines, and other local users can read that drive.
4. From now on, start agent sessions only in `loonext-agents`, or through Remote Control into it.

**FA2. The agent user's GitHub login (15 minutes, optional).**
1. In your own browser: github.com > avatar > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   - Name `workstation-agents`, resource owner BytechLabs, repository access: the repositories agents work on.
   - Permissions:
     - Read and write: Actions, Contents, Issues, Pull requests, Commit statuses, Workflows.
     - Read: Checks, Metadata.
     - Leave at No access: Administration, Deployments, Environments, Secrets, Variables.
   - Expiration: the longest your org allows.
2. If the org requires approval, approve it at github.com/organizations/BytechLabs/settings/personal-access-token-requests.
3. In the `loonext-agents` user's terminal: `gh auth login --with-token`, paste the token, then `gh auth setup-git`.

Agents can still merge as before, because merging is Contents and Pull requests. Verify on the next merge.

**FA3. Done.** The guard's Telnyx key, `nonprod-guard`, with no expiry, is the guard's secret `TELNYX_API_KEY`, and is pasted nowhere else.

**FA4. Cloudflare (substituted; the scoped tokens are optional hardening).** The existing Workers token is `CF_API_TOKEN` in the `main`-only environments `guard` and `rig-cloud`, and deploys the guard and the edge. Still wanted from step 2, and open: `guard-attest-read`, for the attestation. The other four tokens in step 2 are optional hardening. Step 1 is unchanged; step 3, Email Routing, is open and agents cannot do it, having no access to the zone.
1. Workers & Pages > Create > Start with Hello World, twice:
   - `loonext-rig-edge`: Settings > Domains & Routes > workers.dev > Enable.
   - `loonext-telnyx-guard`: Settings > Domains & Routes > workers.dev > Disable.
2. Manage Account > Account API Tokens > Create Token > Custom token, five times:
   - **`rig-deploy`:** Workers Scripts, Specified Workers `loonext-rig-edge`, role Editor. Paste into GitHub environment `rig-cloud` as `CF_API_TOKEN`.
   - **`guard-deploy`:** the same for `loonext-telnyx-guard`. Paste into environment `guard` as `CF_API_TOKEN`.
   - **`guard-attest-read`:** `loonext-telnyx-guard`, role Metadata Read-only. Paste into environment `rig` as `CF_GUARD_ATTEST_TOKEN`.
   - **`production-deploy`:** Specified Workers `loonext-api` and `loonext-web`, role Editor. Plus, on zone loonext.com: Workers Routes Edit, DNS Edit, Cache Purge. Paste into environment `production` as `CLOUDFLARE_API_TOKEN`.
   - **`agent-logs-read`:** Workers Tail Read and the Workers logs or observability read permission, on `loonext-api` and `loonext-web` if the page lets you pick Workers. Paste it when the agent's setup prompts in the `loonext-agents` user.
3. loonext.com > Email > Email Routing:
   - Settings > Subaddressing > enable.
   - Routing rules > Custom addresses > Create address `rig-robot`, action "Send to a Worker", Worker `loonext-rig-edge` > Save.

   Checked 2026-11-02, read-only. Whether subaddressing is on and whether the route's action is "Send to a Worker" `loonext-rig-edge` could **not** be read: both Cloudflare tokens an agent holds list the zone but answer 403 `10000 Authentication error` to `/zones/<id>/email/routing`, `/rules`, `/dns` and `/address` and to the account's `/email/routing/addresses`, and to the zone's DNS records. Public DNS shows the zone's MX records on `route1.mx.cloudflare.net`, `route2` and `route3` and an SPF record that includes `_spf.mx.cloudflare.net`, so Email Routing is on for the zone. The edge's mail heartbeat is fresh and the guard's mail is not halted with nothing pending. A direct SMTP probe was not possible: port 25 timed out from the workstation and from the VM. What S34 saw (two attempts, 11:09 to 11:29 UTC): the invite answered 201, the password reset answered 200, and no invite mail reached the robot mailbox within 10 minutes. **That is not evidence about Email Routing,** because that S34 invited a new address, and the invite to a new address is Supabase Auth's `inviteUserByEmail`, which on the rig is local GoTrue's own SMTP, so it lands in Mailpit ("You're invited to Loonext"; confirmed 2026-11-02 for an invite to a `resend.dev` address) and never reaches Resend, the guard or the zone. Only the invite to an address that already has a Loonext account goes through Resend (`sendExistingAccountInvite`, `apps/api/src/routes/team.ts`).

   **S34 since 2026-11-02.** It first creates a confirmed local-auth account at `rig-robot+s34-acct-<nonce>@loonext.com` (a sub-address of the robot mailbox), then invites that address as QA-W's owner, so the app's own `email_exists` branch sends the invite over Resend. The mail then goes app, guard, Resend, loonext.com's MX, Email Routing, `loonext-rig-edge`, rigd's mailbox. The earlier bring-up attempts did not reach Resend. The next run can exercise live delivery on demand.

   **What a pass proves:** the app's existing-account invite is accepted by Resend through the guard (`email_sent` true, and local auth mailed nothing to that address); Resend delivers to loonext.com's MX; Email Routing accepts `rig-robot+<tag>@loonext.com`, so subaddressing is on and some route reaches `loonext-rig-edge`'s `email()` handler with the `+tag` kept; the edge stores the mail and rigd reads it within 10 minutes; the subject is the invite's, its accept link names this invite, and its rig links answer 2xx or 3xx. The reset email's public homepage footer stays outside this check. **What it does not prove:** where Resend's mail would be filed at a customer's own provider, or SPF, DKIM and DMARC alignment as a receiver judges them (Email Routing is the receiver here and is lenient); that the route's action is the Worker rather than some other path that also reaches it (the zone cannot be read); or that the accept page finishes an acceptance (its link is fetched, not followed signed in). **What the failures say:** `invite_sent_by_auth` means the account was not there and local auth mailed it, so the test proved nothing; `invite_mail_untagged` means mail reached the mailbox without the `+tag` kept, which says subaddressing is off or the route strips it; `invite_mail_missing` with a fresh heartbeat means Email Routing, the MX or Resend dropped it, and the guard's pending count shows whether Resend accepted it. The password-reset half is unchanged and reads Mailpit.

**FA5. Substituted: the existing account's test mode.** No sandbox is created. The existing Stripe account's test-mode key and test prices, from `apps/api/.dev.vars`, are the `rig` environment's `STRIPE_SECRET_KEY`. The rig refuses anything not `sk_test_` or `rk_test_` before Stripe is contacted. `rig deploy` runs `apps/api/scripts/stripe-setup.ts`, which is idempotent, only when a price id the template needs is missing.

**FA6. Firebase and Google Cloud (done).**
1. console.firebase.google.com > the existing project > Project settings > General > Add app > Android.
   - Package `com.loonext.android.nonprod`, plus the SHA-256 the agent gives you (the first `rig apk` makes the signing key, then stops and prints that SHA-256 until this file is in the rig's store).
   - Register, download `google-services.json`, and put it into environment `rig` as `ANDROID_NONPROD_GOOGLE_SERVICES_JSON`.
2. console.cloud.google.com > same project > IAM & Admin > Service Accounts > Create `fcm-rig-sender`, role Firebase Cloud Messaging API Admin > Done. Open it > Keys > Add key > Create new key > JSON.
3. The key must show no expiry. If creation is blocked or an expiry shows: IAM & Admin > Organization policies > `iam.disableServiceAccountKeyCreation` or `iam.serviceAccountKeyExpiryHours` > Manage policy > override for this project only, then create the key again.
4. Paste the JSON into the guard as secret `FCM_SERVICE_ACCOUNT_JSON` (same path as FA3 step 2), then delete the download.

**FA7. Substituted: the existing PostHog project (D146).** No project is created.
1. The project's public key goes into environment `rig` as `NEXT_PUBLIC_POSTHOG_KEY` (the API Worker's `POSTHOG_API_KEY` on the rig and rigd's sends), and into `rig-cloud` and `guard` as the same secret (the edge's and the guard's `POSTHOG_PROJECT_KEY`). A personal API key that can run queries goes into `rig` as `POSTHOG_RIG_READ_KEY`, and `POSTHOG_PROJECT_ID` beside it: rigd reads the `rig` exceptions back with them.
2. Nothing else is needed: the alerts read `environment = 'production'`, so a rig or synthetic event cannot fire one.
3. Without `POSTHOG_RIG_READ_KEY` and `POSTHOG_PROJECT_ID`, rigd cannot read the API's exceptions and R00 fails, saying so.
4. Open: Organization Settings > Spike Protection: turn it on for all projects.
5. Open: Settings > Developer Settings > Custom Integrations > Create New Integration > Internal Integration `agent-read`, with Organization, Project and Issue & Event Read.

**FA8. Substituted: the existing send-only Resend key.** No key is created. The existing send-only key is the guard's secret `RESEND_API_KEY`, and the guard's recipient rules (section 3.5) still confine it.

**FA9. GitHub (the App is done).**
1. Done: github.com/organizations/BytechLabs/settings/apps/new > `loonext-rig`.
   - Webhook: untick Active.
   - Repository permissions: Contents, Pull requests, Issues and Commit statuses read and write; Actions and Metadata read.
   - Only on this account > Create > Generate a private key > Install App on Texturion only.
   - Put the key into environment `rig` as `RIG_APP_KEY`, and the App id as a variable.
2. Texturion > Settings > Environments > New environment, five times:
   - **`guard`:** Deployment branches: `main` only. No required reviewers: under the amendment the guard's tests are its gate, and agents act under your GitHub identity, so a reviewer could not stop one anyway.
   - **`production-ops`:** Deployment branches: `main` only. That rule is the real control for `ops.yml`, because a dispatch from another branch runs that branch's copy of the file. No required reviewers, per the amendment. Add secrets `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, production's values, from your password manager. Without them, `ops.yml` fails and changes nothing.
   - **`rig-cloud`** and **`rig`:** `main` only.
   - **`production`:** `main` and the release tag pattern the agent gives you, plus the secrets the agent lists.
3. Settings > Rules > Rulesets > New branch ruleset. Target: default branch. Rule: Restrict updates. Bypass: Repository admin. The rig App is not an admin, so it can never write to `main`.
4. **Cutover order.**
   1. The agent lists every workflow's secrets. Today `ship.yml` uses repo-level secrets.
   2. It moves each consumer into the `production` environment.
   3. It proves `production-deploy` by redeploying the current release.
   4. After two green releases, delete the repo-level copies under Settings > Secrets and variables > Actions, and only those copies.

**What each GitHub environment holds.** An agent sets everything below except the vendor values your founder actions name, `production-ops`' pair included (step 2). Each token and secret path it generates is 256 random bits.

| Environment | Secrets | Variables | Read by |
|---|---|---|---|
| `guard` | `CF_API_TOKEN` (the existing Workers token, FA4 substitution), `CLOUDFLARE_ACCOUNT_ID`, `EDGE_ORIGIN`, `NEXT_PUBLIC_POSTHOG_KEY` (FA7), `ROBOT_MAILBOX`, `NOTIFICATION_PATH_SECRET`, `GUARD_ADMIN_TOKEN`, and `AGENT_DIAG_DATABASE_URL` once FA13 has run | None. The account id and the edge's origin are secrets too, because Actions prints a step's environment in its public log and masks only secrets. | `guard.yml` |
| `rig-cloud` | `CF_API_TOKEN` (the existing Workers token, FA4 substitution), `TOKEN_SHA256_RIG_API`, `TOKEN_SHA256_ROBOT`, `TOKEN_SHA256_DIAG`, `TOKEN_SHA256_ADMIN`, `TOKEN_SHA256_RIG`, `TOKEN_SHA256_TRIAGE`, `ROBOT_WEBHOOK_SECRET_SHA256`, `NOTIFICATIONS_SECRET_SHA256` and `NEXT_PUBLIC_POSTHOG_KEY` (FA7) | `CLOUDFLARE_ACCOUNT_ID`, `TELNYX_PUBLIC_KEY` (the account's webhook key), `ROBOT_MAIL_ADDRESS` | `rig-cloud.yml`, and the store job of `rig-secrets.yml` |
| `rig` | `STRIPE_SECRET_KEY` (FA5), `ANDROID_NONPROD_GOOGLE_SERVICES_JSON` (FA6), `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_RIG_READ_KEY` and `POSTHOG_PROJECT_ID` (FA7), `RIG_APP_KEY` (FA9), `CF_GUARD_ATTEST_TOKEN` (FA4), `CLOUDFLARE_ACCOUNT_ID` (the same value as in `guard`, for rigd's attestation), `RIG_TOKEN_UPLINK`, `RIG_TOKEN_RIG_API`, `RIG_TOKEN_ROBOT`, `ROBOT_WEBHOOK_SECRET` | `RIG_BUNDLE_PUBLIC_KEY`, `RIG_APP_ID` (FA9), `TELNYX_PUBLIC_KEY` (the same value as in `rig-cloud`), `RESEND_FROM` | The seal job of `rig-secrets.yml`, which delivers them to the rig's secret store |
| `production-ops` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | None | `ops.yml` |
| `production` | What `ship.yml` reads as repository secrets today, once step 4 moves them | Likewise, once moved | `ship.yml` |

Each `TOKEN_SHA256_*` and `*_SECRET_SHA256` is the lowercase hex SHA-256 of a value held somewhere else, so the edge never holds a usable token:
- `TOKEN_SHA256_RIG_API`, `TOKEN_SHA256_ROBOT` and `TOKEN_SHA256_RIG` hash the `rig` environment's `RIG_TOKEN_RIG_API`, `RIG_TOKEN_ROBOT` and `RIG_TOKEN_UPLINK`;
- `TOKEN_SHA256_ADMIN` hashes the `guard` environment's `GUARD_ADMIN_TOKEN`;
- `TOKEN_SHA256_DIAG` hashes the workstation agents' `diag` token, and `TOKEN_SHA256_TRIAGE` the triage token, which nothing presents while triage runs on the host (FA10 is dropped);
- `ROBOT_WEBHOOK_SECRET_SHA256` hashes `ROBOT_WEBHOOK_SECRET`, and `NOTIFICATIONS_SECRET_SHA256` hashes the guard's `NOTIFICATION_PATH_SECRET`.

`rig-secrets.yml`'s seal step delivers `ROBOT_WEBHOOK_SECRET` as `BUNDLE__ROBOT_WEBHOOK_SECRET`, which the rig's store keeps as `robot-webhook-secret`. Until the `rig` environment has that secret, S04 and S20 cannot create the robot's webhook endpoint.

`rig-secrets.yml` also delivers `CLOUDFLARE_ACCOUNT_ID`, as `cloudflare-account-id`, which the guard attestation needs to read the guard's deployments. It is a secret, as in `guard`. Until the `rig` environment has its own copy, it falls back to the repository secret of that name, which names the same account. Step 4 deletes that copy, so an agent sets the `rig` one before then.

A secret an environment lacks falls back to a repository secret of the same name, and those are production's. `rig-secrets.yml` therefore refuses any value shaped like a production credential.

**FA10. Dropped.** Triage runs on the host (section 3.10), so there is no Claude cloud environment.

**FA11. Withdrawn (2026-11-01), replaced by VM creation, an agent action.** No hardware is bought. An agent creates the VM `loonext-rig` unattended with `node tools/rig/host/vm/create.mjs` on Windows, which downloads and verifies the Ubuntu cloud image from Ubuntu, sizes the disks, writes the `.vmx` and cloud-init, boots the VM, waits for cloud-init to run `bootstrap.sh`, and takes the powered-off baseline snapshot. The steps are in `tools/rig/host/vm` and `tools/rig/README.md`. It refuses to run if a `.vmx` already exists in `F:\loonext-rig\vm`, and it never touches another VM.

**FA12. Dropped.** Host agents drive the VM over SSH (section 8), so nothing signs in to Claude in the VM.

**FA13. The `agent_diag` password (an agent action, no approval; done 2026-11-01).** It waits for the release that carries migration `20261031100000`, which hardens `agent_diag`. An agent then runs these from a checkout that can read production's admin login (`apps/api/.dev.vars`, which the script also finds from a worktree):

```
node scripts/ops/set-agent-diag-password.mjs --target production --dry-run
node scripts/ops/set-agent-diag-password.mjs --target production --check
node scripts/ops/set-agent-diag-password.mjs --target production
node scripts/ops/agent-diag.mjs --self-check
```

- `--dry-run` connects to nothing. `--check` is read-only, and refuses until the migration is live.
- The script generates the password, sends the database only its SCRAM-SHA-256 verifier, and writes the login to `~/.loonext/agent-diag.env`, readable by that user only. Nobody sees the password, and no CI job creates or sets it. Running it again rotates it.
- If `agent-diag.mjs --self-check` ever refuses the login as unsafe, withdraw it: `node scripts/ops/set-agent-diag-password.mjs --target production --withdraw`.
- An agent then copies the same login into environment `guard` as `AGENT_DIAG_DATABASE_URL`, for the guard's daily measurements run (section 3.5), without printing it: `gh secret set --env guard -f ~/.loonext/agent-diag.env`. That run is the one CI job that receives the login.
- After every rotation the agent runs that command again. After a withdrawal it deletes the copy: `gh secret delete AGENT_DIAG_DATABASE_URL --env guard`. A stale copy fails the measurements run, and once the reserve is 36 hours old every paid dial is refused.

**FA14. Guard deployments (an agent action, per the amendment).** `guard.yml` deploys from `main` after its policy tests pass, with no approval. An agent dispatches its admin routines (check, setup, order-standing, resume-ordering, reattach, measurements) from `main`.

**FA15. Required once, then about once a year (open).** Accepting a licence is an agreement, so an agent never does it. The first acceptance is required: on the Windows SDK, `create.mjs` stops at step 10 and prints the `sdkmanager --licenses` command, and `create.mjs --sdk-only --yes` finishes after it; on the VM's Linux SDK, `rig apk` cannot build until it is done, and `tools/rig/box/android-toolchain.sh --accept-licences` does it for the JDK and SDK pinned in `tools/rig/box/android-toolchain.json` (`tools/rig/README.md`). After that, accept a new licence when the agent upgrades a pinned SDK.

**FA16. Optional: start the rig at boot (5 minutes).** In an elevated terminal, `schtasks /Create /TN "Loonext Rig" /SC ONSTART /DELAY 0002:00 /RU <your user> /RP * /TR "<the command the agent gives you>"`, typing your password at the prompt. Without it, hostd starts from your Startup folder when you log on, so after a Windows Update restart the rig stays dark until you log on.

---

## 11. Deliberately out of scope

- **A hosted twin of Loonext in the production accounts.** It would add configuration drift, a public login page on the production Cloudflare account and a hosted test database. Re-evaluate when #323's trigger fires: a second person shipping, or a customer whose outage is expensive.
- **Synthetic tenants inside the production database.** Production point-in-time recovery is off. That approach also needed a session-minting endpoint in production, and its phone lane breaks on the first real Turnstile challenge.
- **An iPhone attached to the rig.** The [GitHub-hosted Simulator](QA.md#ios-simulator) is the iOS QA lane. X21 lists the accepted hardware gaps.
- **A raw SSH relay through the edge as the primary way in.** Host agents already have a full shell on the rig over SSH on the workstation. The relay stays optional (Phase 4).
- **A production probe number** for wiring checks. Cloudflare's monitor of webhook refusals in Workers Logs and the vendors' own notices stand in, with no dial and no exception to the guard's policy.
- **New accounts of any kind:** SIM, Apple, Workspace or Microsoft 365, device farm.
- **A hard release gate on synthetic results.** A flaky phone must not block a customer fix. Reconsider after 30 days with the device lanes under 2% flakiness.
- **Any copy of production data,** even scrubbed.
- **An App Store or TestFlight pipeline, porting, live 10DLC reviews, forced screening verdicts.**
- **A self-hosted GitHub runner.** On a public repo, fork pull requests could run code on it.
- **Load testing against production or the hosted stack.** Load runs on the rig (`pnpm --filter @loonext/api capacity:rig` and `test:rig`, results in docs/CAPACITY.md 2b), never against production. The hosted ceilings still need a hosted non-production target.
- **Switching on the #308 hourly text canary.** Its column bug is fixed in Phase 0a. Turning it on needs two more production numbers and about $12 a month by its own estimate; that stays its own decision.
- **A Supabase scoped token for production logs.** It expires within a year, which would make a recurring founder act. Database evidence comes from `agent_diag`.
- **A read-only live Stripe key for agents.** It would expose customer billing data. Billing repro uses the existing account's test mode.

---

## 12. Open risks

1. **A Telnyx fraud hold is account-wide** (accepted, the largest risk). Test traffic will probably be most of the account's calls. A hold would stop production calling too, and Telnyx does not disclose its scope. The guard verifies ownership and reports corroborated Telnyx notices (section 3.5). Recovery needs you, because only Telnyx support can lift a hold; that is a founder act outside the rig, which never contacts Telnyx.
2. **Shared call capacity.** Telnyx may reject a call during a test or a production call when the account reaches its concurrent limit.
3. **The guard's key has full production authority.** A merged policy bug could touch production. Mitigations: policy unit tests, the two-way registry check, start-up refusals, 403 probes (G01), attestation in R00, Telnyx's key notifications.
4. **Agents keep production reach** (the amendment). Agents hold production keys and can drive the founder's browser, as they do today. The guard does not widen that. Its protections are in code, and FA1/FA2 remain available as optional hardening.
5. **Ordering.** No number before production's `/health` shows the ownership rule and the first-order check passes. All eight standing roles are ordered; while paid dials are refused none is ordered with a voice connection.
6. **One home site, on one workstation.** Power or internet loss means the rig is unavailable until it is back. Nothing alerts on that, because nothing on the rig is scheduled; an agent who needs a repro waits for the workstation.
7. **Fidelity gaps from running locally** (X23).
8. **Production's ring events have little to measure today.** With one production number there are few of them, and repro issues may wait a long time for production evidence.
9. **Unproven mechanisms,** each with a spike and a fallback:
   - coded bursts surviving voice processing (fallback: "media arrived" plus speech recognition);
   - local ES256 sign-in;
   - the AI shim;
   - FCM rewrite and package pinning;
   - inbound recording;
   - the edge-to-guard binding (fallback: HMAC with a nonce); passed 2026-11-01, when `/g/health` with the diag token answered 200 from the guard over the binding;
   - the per-connection active-calls read (an unknown answer refuses the dial);
   - gRPC call audio on the emulators (EA1, risk 19); step one passed 2026-11-01 on `rig-pixel` with the default audio backend (a guest page played its microphone back; the detector heard the robot's code and the device's, each in 9 or more cycles at about 57-60 dB), and the production path (`playCode` and `hear`) passed the same way. `-no-audio` fails: `injectAudio` answers "There can be only one microphone active". Injecting before the guest opens its microphone crashed the emulator (exit 0xC0000005) both times it was tried, so injection must wait for the microphone. Step two passed on 2026-11-20. See risk 19 for the live run.
   - cloud-init's datasource detection on Workstation (VM1); passed on the first boot, 2026-11-01: `cloud-id` said `vmware`;
   - emulators started with nobody logged on (VM2); not measured: it needs FA16's ONSTART task, which stores the founder's password;
   - the tunnel and the rig-only adb server on 5137 (VM3). The tunnel half passed 2026-11-01: all ten reverse binds sit on the VM's loopback, sshd refused a bind on an unlisted port and on 0.0.0.0, hostd listens only on 127.0.0.1:15900, and `/v1/health` through the tunnel answered 401 without the token and 200 with it. The adb half passed the same day: from the VM, the 15037 end answered `host:version` and listed the one rig emulator, the emulator honoured `ANDROID_ADB_SERVER_PORT` (a default-port server listed nothing), and the console and gRPC ports answer through the tunnel.
10. **Cost uncertainty.** Provider charges vary with test usage.
11. **Recycled numbers attract strangers.** Rejected calls and dropped texts may still bill. Detach stops a flood; replacement waits for the monthly order slot.
12. **Shared quotas.** PostHog, Resend and Cloudflare usage depend on the provider plan.
13. **Old-version repro.** Old web refs need the rig-only unsupported-Next flag. Pre-seam server refs cannot run push or email scenarios. Old Android tags need an overlay.
14. **Production side findings, to be filed as separate production issues:**
    - Production's voice profile and messaging profiles have no Telnyx-side spend limits; auto-recharge is off and the credit limit is 0.
    - The account's two mobile push credentials (iOS and Android) are attached to no connection, so iOS closed-app wake cannot work today.
    - If the account is at the Paid level, Telnyx prepends its automated-call announcement to production's own greetings and dials, and caps customers at 5 concurrent calls and 100 a day.
    - `docs/deploy/04-telnyx.md` said ring legs come from the WebRTC connection, as D43's live fix made them. The code now dials every leg from the voice connection (`apps/api/src/calls/runtime.ts`), and D43 found that a ring dialed from the voice connection fails. 04-telnyx.md now says what the code does and keeps the question open. **Verify** on production's next inbound call that a browser rings.
15. **Windows Update.** A host restart interrupts the VM and the emulators. The rig is available again when they restart.
16. **Workstation power.** Runs require the workstation to be online.
17. **Host CPU load.** The workstation is 44-68% busy with agent sessions, and the VM and emulators add to it. Timing-sensitive verdicts (ring within 6-12 s, the 300 ms race in D09) may flake under load; a flake is retried once before it is reported.
18. **The F: disk budget.** F has 128 GB free. The VM's disk can grow to 90 GB, its secrets disk is 4 GB, and the AVDs need their own space. C has only 34 GB free and D is a hard drive, so neither is a fallback.
19. **Emulator call audio depends on a verified host.** EA1 passed on `rig-pixel` on 2026-11-20. Live D02 run `fix-calls-776-EA1-buffered-D02-1795208362` detected five microphone cycles at 24.8 dB on the robot and three playback cycles at 24.7 dB on the emulator. ADB still answered after the call. The lane opens injection after the guest opens its microphone, keeps a short queue of microphone samples, and captures playback after the robot connects. Keep `emulator-audio-proven` in the rig store for the host and flags that passed. A host without proof reports `emulator-audio-unproven` for audio. D07-2 and D07-3 test one direction at a time when a change to the host needs diagnosis.
20. **One PostHog project for production and the rig** (FA7, D146). Every alert reads `environment = 'production'`, so a rig or synthetic event cannot fire one. A new alert without that filter would, and nothing would notice; `docs/MONITORING.md` states the rule for editing them.
21. **An ordered number's read-back id.** The first read-back used the id on the number order's phone-number line, which Telnyx's spec documents as a number-order record. **It is not the `/v2/phone_numbers` id, and on 2026-11-01 the first standing order (ROBOT-1) was read back as `number_unreadable`** (health's `ordering.stopped_reason`), which latched ordering off. That failed safe: nothing was deleted, and the number is held in the partition's billing group with its messaging profile and no connection. The read-back no longer uses the line's id. It lists `/v2/phone_numbers` by the exact E.164 and the partition's group, requires one result in the group with the profile and connection the order asked for, and records that result's id (section 3.5, Ordering). Ordering resumes only through the `resume-ordering` routine, which records who and why and adopts ROBOT-1 rather than ordering it again; production resolves ordered numbers by phone number (`apps/api/src/telnyx/provisioning.ts`). Residual: a read-back that finds two, or finds the wrong group, profile or connection, stops ordering for good and leaves the number for a person, and so does a complete order whose number the group still does not list after 30 minutes (`number_missing`). A number left outside the group continues to incur rental charges until it is regrouped or released. Production's reconcile sweep flags it as unknown. The start-up checks mark the partition unsafe while the number carries a nonprod profile or connection. `rig deploy` needs all eight standing roles (`standingNumbers`), which ordering now supplies.

---

## 13. How disagreements and review gaps were settled

### 13.1 First-round reviews

| Point | Choice and reason |
|---|---|
| Which design | Both reviews chose the local rig. |
| Protecting production from the shared sweep | Positive ownership by billing group, not a deny-list secret. It needs no production secret and fails safe. |
| Filtering production's webhooks by connection id | Rejected: it would drop production's text and registration events. Ownership is decided at the edge, per event type. |
| How the guard knows production is ready | `/health` gains a capability list. |
| Production wiring | Cloudflare's monitor of webhook refusals in Workers Logs, and the vendors' own notices. No probe number. |
| The #308 text canary | Bug fixed; switching it on stays #308's decision. |
| Where triage runs | First a Claude cloud task, so a revoked rig sign-in could not stop it. Since 2026-11-01, an agent on the host, because nothing signs in to Claude in the VM (FA10 and FA12 dropped). |
| Production Telnyx reads | Merged into the guard as a redacted, GET-only class: one full-power key fewer. |
| PostHog write access | None on the rig: the project key only sends, and the personal key only queries. |
| FCM key rotation | No self-rotating key; non-expiry is checked at setup. |
| Rig memory | 24 GB for the VM. Each of the four configured emulators uses 2 cores and 3 GB on the host. All four can run together. |
| Transfer pricing | Transfers are budgeted at $0.10 each (SIP Refer, rate sheet 2026-10-29). |
| Cron path | `/cdn-cgi/handler/scheduled`, confirmed in wrangler 4.106.0. |
| Isolation proof | G01 proves the app layer and the guard's 403s when it is run (on demand since 2026-11-01). |
| Email realism | A robot mailbox through Email Routing, now limited to S34. |
| Stripe hidden step | Portal and tax settings are made by API. |
| Android build | `initWith(release)` plus a debuggable twin. |
| Database-level gate | Inside the send and dial functions, keyed on a rig-only setting. |

### 13.2 Second review: where each blocker and major gap is closed

| Gap | Closed by |
|---|---|
| Blocker: agents run as you and can drive your Chrome and credential store | Accepted under the amendment (12, risk 4). The reach audit lists what an agent can reach. A separate Windows user and a token that cannot approve stay available as FA1 and FA2 (3.1). |
| Blocker: production keys in commented lines of `apps/api/.dev.vars` | Removed only if you choose FA1, which also gives agents local-only env files with fakes. Either way, `check-local-secrets` stops a push while any file git would stage holds a live key, and CI checks again. Its session-start hook waits for your yes (3.1). |
| Blocker: shared call capacity | Telnyx applies account limits and the rig serializes its test attempts. |
| Test traffic is the majority, so surcharge and fraud reasoning was inverted | Account-level ratio control, single-surface audiences, cancelled ring legs assumed abandoned, and Telnyx notice reporting (2.2, 3.5) |
| Dials undercounted | Measured journeys and per-run dial counts in `tools/rig/scenarios.json` (4.1, 4.2) |
| Few production rings | Repro issues stay open until production's ring events are evidence enough (3.11, 9) |
| Wired fallback breaks adb | Moot since 2026-11-01: there is no phone. Emulator audio goes through gRPC, gated by EA1 (3.9) |
| FCM token seam missing | `FCM_OAUTH_TOKEN_URL`, a guard-token bearer in rig mode, a dummy key, and a test (3.3, 3.7) |
| iOS lane would talk to production | The Simulator QA build uses runner-local endpoints and a separate bundle ID. Release keeps the production endpoints. |
| Old web refs cannot build | Rig-only unsupported-Next flag; pre-seam mode; wider DNS block (3.2, 3.3) |
| Local sign-in would 401 | Bootstrap ES256 key, derived config, R00 check (3.3) |
| Guard approvals make you an operator | Class-based policy and the registry check in the same PR. Under the amendment guard deploys need no approval at all (3.5, FA14). |
| Removing your keys blinds agents | Prompt-free read tier: `agent-read`, `agent_diag`, `agent-logs-read`, guard `diag`. Under the amendment agents keep their keys, and `ops.yml` changes a flag from `main` with no approval (3.1). |
| Rig cron noise | Cron registry, CI check, zero unexplained fingerprints (3.3) |
| Robot mailbox could bounce production's domain | The mail handler never rejects; heartbeat gate; mailbox only in S34; halt on a missed delivery (3.4, 3.5) |
| Untrusted texts could reach production code | The edge never relays stranger content; rig PRs are never auto-merged (3.4, 3.10) |
| Vendor ceiling was 3 times the cap; inbound uncapped | Automatic detach for stranger floods (3.6) |
| S29 could not pass | `canceled_at` is backdated under the lease; the test clock is used only for Stripe-side assertions (4.2) |
| SDK-placed SIP calls bypass the guard | G02 sentinel probe; residual X25 if open, since `sip_uri_calling_preference` governs only inbound calls (4.2, 4.3) |
| Minor gaps | Notification webhook secret path and corroboration; guard with no public URL; secrets cutover order covering `backup-posture.yml`; `stripe listen --api-key`; device-side renewals (system-image and SDK pins, Play services, adb key); `DEPLOY_ENV` unset means local; ownership-mismatch alert and fallback marker; D02p dials zero; monthly PostHog ceiling; FCM Android-only rewrite; calendar partial; numeric verdicts for D13, E01 and S03; text events acknowledged at the edge; the network (now the VM's NAT and nftables), Ontario numbers; Phase 0 split (the API deploys before web in `ship.yml`); portal-only tools named (X26); SSH and PW01 simplified; production push-credential and Paid-level findings filed (12). |

---

## 14. Decision record

A new decision, numbered when committed because parallel sessions also write decisions (D141 is already taken): **"Rig mode, not staging."** It amends `docs/ENVIRONMENTS.md` (#323).

**What it says:**
- **#323 stands.** There is one deployed Loonext environment. The rig is the local stack connected to real vendors. The two Workers are tools that never run app code and hold no customer data.
- **Superseded:** only the staging recipe's step 3, "a Telnyx sub-account with one test number". Managed Accounts need a $1,000/month commit and returned 403 (2026-10-29), and the founder forbade new accounts (2026-10-29). It is replaced by the in-account partition behind the guard.
- **Amended:** the objection to standing number cost. Eight numbers at $8.80/month are justified by the human-free repro mandate.
- **Not adopted (amendment):** the rule that agents run only in a Windows user without production write keys. FA1/FA2 are optional hardening.
- **Unchanged:** the revisit trigger; previews from `wrangler versions upload` are never used for anything that sends, dials or bills; the #251 hosted driver still has no hosted target; its `rig` mode and the `test:rig` suites run on the rig only.
- **Do-not-build table** gains two rows: "copy production data into any test environment" and "synthetic tenants in the production database".

**Docs updated in the same change:**
- `docs/deploy/04-telnyx.md` section 6: "sandbox" becomes "the nonprod partition, through the guard"; the ring-leg description is corrected; the rule that production numbers never carry a billing group is added.
- New rows in `docs/deploy/06-env-reference.md`, enforced by `check-env-doc`.
- A new `docs/RIG.md`: runbook, verification checklist, and the resource list without ids.
- A note in `docs/CAPACITY.md`.

**Update, 2026-11-01: no Telnyx ticket, no new hardware.** Recorded in D142's update of that date, which wins where this file disagrees:
- **FA0 is withdrawn.** Nothing waits on Telnyx. The ten questions are answered by dated public docs, read-only API reads or the rig's own measurement, and otherwise by the costlier or safer answer (section 10, FA0).
- **Ordering** waits only on `/health` and the first-order check. The read-back lists the partition's group once the order is complete, finds the exact E.164 in it, requires exactly one match with the expected profile and connection, and records that `/v2/phone_numbers` id; a number not listed yet waits 30 minutes, and anything else stops ordering and deletes nothing (section 3.5, risk 21). The order line's own id is not the number's id. All eight standing roles are ordered at once, with no voice connection while paid dials are refused, and the `resume-ordering` routine lifts a `number_unreadable` stop, recording who and why, and adopts the number already held.
- **FA11 is withdrawn.** The rig is a new VMware Workstation VM, `loonext-rig`, with the Android emulators on the Windows host under WHPX, driven by `hostd` (section 3.2). The technician's phone is the AVD `rig-pixel`, and the id `pixel` names it. Call audio goes through the emulator's gRPC service, gated by EA1 (section 3.9). X6 widens to any physical phone, and X27 is new (section 4.3).
- **Founder actions:** FA5, FA7, FA8 and FA4 are substituted with what already exists; FA10 and FA12 are dropped; FA3, FA6, FA9 and FA13 are done; FA16 is new and optional (section 10).
- **Cost:** hardware $0 and about $8 one-time; about $24 a month plus $2-6 of workstation power, with a $1.50 set-aside inside the $35 cap (section 7).

**Second update, 2026-11-01: the rig runs nothing on a timer.** Recorded in D142's second update of that date, which wins where this file disagrees. Earlier sections describe what was decided at the time, and this list is the current behaviour:
- **On demand only.** No scenario timer, cron timer or health timer is installed by `rig deploy` or by bootstrap. The rig is a dev and QA environment: any ref runs there for real, and an agent uses it to reproduce, diagnose and verify a reported issue (a PostHog error, a customer report such as dropped calls) and for ad-hoc work. The scenarios are optional shortcuts. CI does regression testing (sections 1, 8 and 9).
- **Registry.** `tools/rig/scenarios.json` is the catalogue of what can be run: dials, far-end legs, room and variants. Its cadences, the encoded schedule, the monthly dial budget and the 20% retry and 60-dial repro reserves are gone (section 4.1).
- **Gone:** the edge's dead-man with its rig, suite and triage heartbeats, `['synthetic-infra', component]` stale alerts and `['ops','synthetic-dark']`; rigd's hourly schedule refresh; the hourly triage agent; rigd's hourly guard attestation, its five-minute exceptions report and their state files; the edge's `/ctl/alert`, its alert log and its daily PostHog caps. The edge's mail heartbeat stays because the guard's Resend gate reads it.
- **Cost:** about $13 a month fixed plus usage and $2-6 of workstation power; the $35 all-in ceiling is unchanged (section 7). This supersedes the $24 a month above.
