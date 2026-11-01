# Loonext Rig: human-free repro and testing inside the accounts Loonext already has

**Status: CURRENT DIRECTION (D142).** The design and runbook for the rig. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Prepared 2026-10-30, revision 2. Brought in line with what was built on 2026-10-31 (D142's update of that date), and with D142's update of 2026-11-01: no Telnyx ticket and no new hardware.

This replaces the separate-accounts design, which was rejected only because it needed new vendor accounts. Everything from that design that did not depend on a new account is kept:
- the Phase 0 safety work;
- coded-burst audio verdicts;
- the robot and the run lease;
- the expiry table;
- the test matrix and repro workflow;
- the CI guards and the triage loop.

Two independent reviews scored three no-new-account designs, and both chose this one. A second review then found 3 blockers and 15 major gaps in the first draft. Section 13.2 says where each one is closed.

> **Amendment, 2026-10-30 (binding; it overrides anything below that disagrees).** The founder's standing directives are "don't ask me" and "the entire thing must be human free", and agents were given production credentials on purpose. So:
> - **FA1 and FA2 are optional hardening, not prerequisites.** No phase waits on them. Production writes do not move behind approvals, and agents keep the access they have today.
> - **What that means for the guard.** While agents act under the founder's GitHub identity, an approval gate on the `guard` environment cannot stop an agent. Agents already hold production keys with more reach than the guard's key, so the guard does not widen the trust boundary. What it does is narrow what *test code* can do. Its protection therefore rests on its own code: policy unit tests, the two-way registry check, start-up refusals, hourly attestation, the weekly key inventory and the CI guards. `guard.yml` deploys from `main` after those tests pass, the same way `ship.yml` ships production.
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
   - It lets calls and texts flow only between numbers in a capped partition of the existing Telnyx account.
   - Production is changed first, through release-please, so that its account-wide number sweep acts only on numbers it positively owns.
   - Test calls are sized so that they can never take the call capacity a customer's call needs.
3. Every scenario runs on a schedule, is judged by machine, and turns each distinct failure into one issue that an hourly agent on the host triages.
   - Cost: about **$24/month**, with Telnyx hard-capped at $35 all-in, plus an estimated $2-6 of workstation power and about **$8 one-time**. Hardware is $0.
   - No new vendor account anywhere.
   - No recurring founder act in operating it.

### Your part

There is no Telnyx ticket and no hardware to buy (D142, update of 2026-11-01). The rig is a new VMware VM that an agent creates, plus Android emulators on the Windows host. Four one-time acts are still yours, because each needs a console or an agreement no agent may make (section 10):
- **FA15, open:** accept the Android SDK licences once on the Windows SDK, before `create.mjs` can install the emulators, and once on the VM's Linux SDK, before `rig apk` can build. Each is one `sdkmanager --licenses` that the agent prints.
- **FA7 steps 3-5, open:** filter every production alert rule on `environment:production`, turn on spike protection, and create the `agent-read` integration. Until step 3 is done the rig sends no event to Sentry: its DSNs are withheld until you set the variable `SENTRY_ALERTS_FILTERED` (section 12, risk 20).
- **FA4 step 2's `guard-attest-read` token, open:** without it the hourly attestation of the guard's deployment cannot run.
- **FA4 step 3, Email Routing on loonext.com, open:** without it `rig-robot@loonext.com` reaches nothing and S34's mail check cannot pass.

What is left beyond those is optional:
- **FA1:** agents move to their own Windows user, and production keys leave every file they can read.
- **FA2:** that user's GitHub login becomes a token that cannot approve deployments or change settings.
- **FA16:** an elevated ONSTART task that starts the rig at boot, with your password stored. Without it the rig starts when you log on.
- **Active hours and overnight power:** moving Windows Update's active hours to cover 04:00-10:00 UTC, and leaving the PC on overnight, keep the dial window lit. Without them the rig loses some windows, and says so as infrastructure, never as a product failure (section 3.2).

**What FA1 and FA2 would close.** Today every agent runs as you, so it can:
- drive your real Chrome, including your vendor console sessions, through Claude in Chrome;
- read your Windows credential store;
- read production keys in `~/.claude/settings.json` and in commented lines of `apps/api/.dev.vars`. Checked by key name on 2026-10-30: the commented lines include the production Telnyx key, the live Stripe key, the Supabase secret key, database password and access token, and the production VAPID pair.

Any one of those would bypass an approval gate, which is why the amendment does not rely on one.

**One time, already done or substituted (section 10).**
- Done: the guard's Telnyx key (FA3), the Firebase app and service account (FA6), the rig GitHub App (FA9) and the `agent_diag` login (FA13).
- Substituted with what already exists: the existing Cloudflare Workers token (FA4, except the two open steps above), the existing Stripe account's test mode (FA5), the existing Sentry project with environments `rig` and `synthetic` (FA7, except the open steps above), and the existing send-only Resend key (FA8).
- Dropped: the Claude cloud environment (FA10; triage runs on the host) and signing in to Claude on the rig (FA12; host agents drive the VM over SSH).
- Withdrawn: the Telnyx ticket (FA0) and the hardware (FA11).
- No guard approval: agents deploy it, per the amendment.

**Recurring while the rig operates: none.** The system detects each of these first, and only then might it reach you:
- a Telnyx fraud notice (the paid lanes have already latched off, section 3.5);
- the workstation being off or rebooting in the dial window (reported as infrastructure);
- about once a year, accepting a new Android SDK licence when the agent upgrades the pinned SDK (FA15).

**Outside the rig.** Nothing changes. Under the amendment, agents keep making production writes as they do today, and guard deployments need no tap.

---

## 2. What changed because there are no new accounts

### 2.1 Everything created, and the existing account it lives in

| Existing account | What is created inside it |
|---|---|
| **Telnyx** (the production account) | **Key:** one API key, `nonprod-guard`, held only by the guard. **Billing group:** `loonext-nonprod`. **Voice:** three outbound voice profiles (one of them, `nonprod-limit-probe-ovp`, has no connection and exists only to measure the concurrent limit); two Call Control apps; two credential connections (`nonprod-webrtc`, with no outbound voice profile, and `nonprod-sentinel`, which has one credential, no numbers and is used only by test G02). **Messaging:** one robot messaging profile, plus four tenant profiles that the rig app creates through the guard (at most six in all). **Numbers:** eight Canadian local numbers, plus one bought and released each month. **Other:** one notification channel and its settings; telephony credentials created and deleted at runtime. |
| **Cloudflare** (the production account) | **Workers:** `loonext-rig-edge`, on workers.dev, and `loonext-telnyx-guard`, with no public URL and reached only through the edge. Each has its own Durable Object. **Rate-limit namespace ids:** 3001-3009. **Tokens:** none new. The existing Workers token, held only in the `main`-only environments `guard` and `rig-cloud`, deploys the guard and the edge (FA4 substitution). The five scoped tokens (`rig-deploy`, `guard-deploy`, `guard-attest-read`, `production-deploy` and `agent-logs-read`) are optional hardening; `guard-attest-read` is still wanted for attestation. **Email:** one Email Routing address on loonext.com that delivers to the edge. **Not created:** KV, D1, tunnels, Access apps, DNS records. |
| **Supabase** | Nothing. The rig runs a local Supabase stack. |
| **Stripe** | Nothing. The rig uses the existing account's test mode: its test-mode key and test prices (FA5 substitution). Test clocks are created per run. Every customer and subscription the rig creates carries `metadata[loonext_rig]=1`, and every test clock a name starting `loonext_rig `, because Stripe keeps no metadata on a clock. Before a delete or a clock advance the object is read, and the change is refused unless it carries the tag, so the rig never changes what a developer made. S32's subscription comes from the app's own Checkout, which sets no metadata, so rigd tags it only after the rig's database shows that S32's own sign-up address owns the workspace that names it. |
| **Firebase / Google Cloud** (the existing project) | Android app `com.loonext.android.nonprod`. Service account `fcm-rig-sender`, with the messaging role only, and one key. |
| **Sentry** (the existing org) | No new project. The existing project carries rig and synthetic events under the environments `rig` and `synthetic` (FA7 substitution). A read-only internal integration, `agent-read`. Spike protection switched on. |
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

If an Apple Developer Program membership already exists, the separate-accounts design's iPhone lane can be added later. Nothing here depends on it.

### 2.2 What sharing accounts now risks for production, and what contains it

| Shared thing | Risk to production | What contains it |
|---|---|---|
| **Your workstation identity.** Agents run as you. | An agent drives your Chrome into a vendor console; reads your credential store; or reads production keys from settings or env files. Any of these bypasses every control below. | Accepted under the amendment (section 12, risk 4). The reach audit lists every credential an agent session can reach, and the secret scanner stops a push while any file git would stage holds a live key (section 3.1). FA1 and FA2 stay optional: with them, agents run only under a separate Windows user with no console sessions, no Claude in Chrome and no production keys, and its GitHub token cannot approve deployments. |
| **Telnyx concurrent call limit.** It is account-wide: default 2, 10 after Level 2 (support.telnyx.com/en/articles/1130717, fetched 2026-10-31). At the Paid level it is 5 concurrent, 10 outbound an hour and 100 a day (developers.telnyx.com account levels, Paid, checked 2026-10-29). These come from two separate level frameworks, an account sits in one of them, and no API exposes the level or the limit. | A test call holds outbound legs (robot dial, ring legs, ring-me) while a customer calls in. The customer's ring legs are refused, and the customer reaches nobody. | The guard sets nonprod concurrency to **room = limit in force minus production reserve**. The reserve is production's largest ring audience plus 1, read daily from production counts. The limit in force comes from the guard's **proof ladder** (section 3.5): a floor of 2 while unproven, which leaves room 0 and no paid dials; a $0 validation check on a voice profile with no connection, because Telnyx's API spec says a profile's `concurrent_call_limit` "Must be no more than your global concurrent call limit"; a lower bound from production's own overlapping calls, which checks the validation but opens no room alone; and ceilings from Telnyx's refusal codes 90041, 90042 and 90043 (account, voice profile, connection) and 90103 with HTTP 429 (dial rate). Scenarios that need more legs than the room are not scheduled and are named (section 4.1). During a run, the guard also polls production's active calls every 2 seconds per connection and hangs up every test leg on the first production call; an unknown answer refuses. The dial window is the six quietest hours in production's own call history, rechecked monthly. |
| **Telnyx surcharges and fraud profile, both computed on account totals.** Surcharges apply to short calls above 15%, at $0.01 a call, and to abandoned calls above 20%, at $0.005 a call (support.telnyx.com/en/articles/1130707 and /12805746, checked 2026-10-31). | With one production number, test traffic will probably be most of the account's calls. The account's ratios and fraud profile therefore become the rig's. | The guard keeps the **whole account's** ratios (production plus rig, counts from detail records) at or below 15% abandoned and 10% short. Abandoned calls are assumed to include the ring legs Loonext cancels, since Telnyx counts a call the caller's side hangs up while ringing. Ring audiences are shrunk to one surface wherever the scenario does not test multi-ring, so cancelled legs are rare. If the projection goes above 15%, multi-ring scenarios run monthly. The dollar effect is cents; the profile effect is what matters. |
| **Telnyx fraud holds.** Their scope is not disclosed (support.telnyx.com/en/articles/3610162 and /7915224, checked 2026-10-30), and the only stated way to lift one is emailing support. | A hold triggered by test calls also stops production calling. | Traffic is on-net only, with about 13 dials a day on average and calls of 20-50 seconds, inside the quiet window. A hold is assumed account-wide and irreversible, so the first fraud-type notice latches the paid lanes off until a reviewed change to `SIGNAL_LATCH_RESET`, and raises a production alert. Any other notice halts paid tests for 7 days. **Residual, accepted: the largest risk in this design.** |
| **Telnyx prepaid balance.** Auto-recharge is off and the credit limit is 0 (read 2026-10-29). | Test traffic drains production's money. | Telnyx-enforced daily limits on every nonprod profile total $0.78 a day, about $35.50 a month with rentals. The guard's own cap is $35 all-in. Below a floor (the larger of $100 and 14 days of production spend), the guard refuses all test spend. A production alert fires at $150. Inbound legs and texts are not capped by Telnyx: the edge rejects strangers, and the guard detaches any number that strangers flood. |
| **Production's account-wide number sweep.** `reconcileNumbers` runs every 15 minutes, lists every number and can DELETE. | Production flags or releases test numbers, or the rig's copy of the code releases production numbers. | Positive ownership: production acts only on numbers with no billing group, and the rig only on its own group. The group is set in the order body. The guard orders nothing until production's `/health` reports the rule. It checks the first order actually carries the group, and releases the number at once if not. Production raises an alert if a number it would own shows up with a group. |
| **API keys with full account power.** Telnyx keys cannot be scoped (developers.telnyx.com authentication docs, checked 2026-10-30). | Any second key can release production numbers or text anyone. | Only the guard holds one. It has no public URL. It deploys only from `main`, after its policy tests pass (no approval, per the amendment). Attestation runs hourly and a key inventory runs weekly. **Residual, accepted:** a merged but faulty guard can reach production. |
| **One webhook signing key for the whole account.** | A signature cannot tell test events from production events. | The edge decides ownership by resource: connection for call events, messaging profile for text events. Production's handler is deliberately left unchanged. |
| **Internal SIP calling.** Production's WebRTC connection accepts SIP calls from any connection on the account. | A test could ring a real member's device. | The guard dials a SIP address only if its username is on the rig's own connection. Calls that the apps' SDK places itself bypass the guard, so test G02 checks weekly whether a rig credential can ring a sentinel credential. If it can, that residual is named (X25). |
| **Cloudflare account and tokens.** | A test token redeploys production or the guard. | The existing Workers token deploys the guard and the edge, and sits only in the `guard` and `rig-cloud` environments, which take deployments from `main` only, so what it deploys is merged code (FA4 substitution). The VM never holds it. Scoping each automation token to named Workers (granular Worker permissions, Cloudflare changelog 2026-09-15) stays optional hardening. |
| **Cloudflare rate-limit namespaces.** Counters are shared per id across the account (developers.cloudflare.com rate-limit binding docs, updated 2026-10-21). | Test traffic spends production's limiters. | The local stack's limiters are emulated on the rig. The cloud Workers use ids 3001-3009, and CI forbids 1001-1013 and 2001. |
| **Workers AI pool.** 10,000 free neurons a day per account, then $0.011 per 1,000 (developers.cloudflare.com/workers-ai/platform/pricing, updated 2026-10-20). | Local `wrangler dev` bills AI to the production account. | The rig's AI calls go through the guard, which caps them at 2,000 neurons a day. |
| **Cloudflare account standing.** | A Trust and Safety action against a test page hits the production account. | The edge serves no HTML and sets no cookies. The guard has no public URL. The Loonext app on the rig is never public. |
| **Firebase project.** One FCM credential reaches every app in the project. | A leaked key could push to production iOS or Android devices. | The key is held only in the guard. The guard sends Android-only messages to the nonprod package: it moves any top-level notification into the Android block, drops the iOS and web blocks, and forces the package name. The rig never holds a production device token. |
| **Sentry project and quota.** | Test events crowd out production's errors, or a rig event fires a production alert rule. | Rig and synthetic events carry the environments `rig` and `synthetic` in the existing project (FA7 substitution), and production's alert rules must filter on `environment:production`. Until the founder records that done (`SENTRY_ALERTS_FILTERED`), the rig's DSNs are withheld and no rig event is sent. A relay on the rig caps rig plus synthetic events at 100 a day and 3,000 a month, and alerts at 70%. Spike protection is on. |
| **Resend domain reputation and quota.** | A bounce from a failed robot mailbox, or a complaint, pauses sending for the whole team, which stops production password resets. | Default recipients are Resend's test addresses, which do not affect reputation (resend.com/docs, send-test-emails, checked 2026-10-30). The robot mailbox is used only by the weekly S34 test, and only while the edge's mail heartbeat is fresh. The edge's mail handler never rejects. Sending to the mailbox halts the first time a sent mail fails to arrive within 10 minutes. At most 10 emails a day. |
| **GitHub approval gate.** | Agents approve their own guard or ops run. | Under the amendment there is no gate to approve: guard and ops runs need no approval. Both environments take deployments from `main` only, so what runs is merged code (FA9). |
| **Claude plan limits.** | Rig sessions compete with your other sessions. | Triage runs only when there are failures to triage. |

### 2.3 What was lost against the separate-accounts design

| Lost | Status |
|---|---|
| A separate Telnyx balance behind a bank-card limit that no code could lift | **Rebuilt** with Telnyx daily limits sized to the cap, the guard ledger and the balance floor. Inbound is not vendor-capped, so it is bounded by stranger rejection and auto-detach. There is no bank-level backstop. |
| Separate Telnyx fraud scoring, call limits, API buckets and surcharge ratios | **Mitigated** by the room formula, preemption, account-level ratio control and the halt. The fraud-hold residual is **accepted**. If the account's room is small, call lanes are **lost** rather than squeezed in (section 4.1). |
| A Telnyx key that physically could not touch production | **Rebuilt** as the guard's policy. This is weaker: a guard bug now reaches production. |
| A separate webhook signing key | **Rebuilt** as ownership checks by resource. |
| Separate Cloudflare accounts for the test app and the guard | **Rebuilt** with scoped tokens, disjoint ids and a guard with no public URL. Your own dashboard login still sits above everything. |
| A hosted, always-on nonprod: real Workers runtime, hosted Supabase auth settings, and cloud lanes that survive a home outage | **Accepted.** Hosted behaviour is defect X23, partly covered by the production watches (P01, PW01). The rig is a single point of failure, watched by a dead-man. |
| A carrier SIM handset (K00-K05): real carrier calls both ways, carrier texts, STIR/SHAKEN, caller-name display, a STOP sent from a real phone | **Accepted** as defects X5, X10, X17 and X20. P01 measures real customers' rings passively, but with one production number today it mostly reports "insufficient sample". K01 could prove outbound carrier egress, but by default it never runs (Phase 4, optional). |
| Real-iPhone lanes and Loonext's own APNs wake path | **Accepted** as defect X21, unless an Apple membership already exists. The iOS Simulator lane was dropped too: it could not test wake, and the iOS app hard-codes production hosts. No customer runs an iOS build today, because `ship.yml` archives it unsigned. iOS keeps its CI unit tests. |
| Calendar test accounts | **Accepted** as defect X22. A Google partial path that needs no new account is offered in Phase 4. |
| A separate path to Telnyx's Verified level | **Accepted.** The shared account's level governs both production and the rig. |
| Separate Supabase, Resend, Sentry and Firebase tenancy | **Supabase:** replaced by the local stack, which is better isolated but less faithful. **Sentry and Resend:** mitigated with caps. **Firebase:** mitigated by package pinning. |
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
- Sentry `agent-read`;
- `agent_diag`, which reads only non-personal views;
- `agent-logs-read`, read-only Workers logs for `loonext-api` and `loonext-web`;
- the guard's redacted `diag` class.

**Its GitHub login** is a fine-grained token without Administration, Deployments, Environments, Secrets or Variables permission (FA2). It therefore cannot approve a deployment or loosen a gate. Under the amendment, guard and ops runs need no approval, so nothing waits on you.

**Two checks keep this true:**
- `scripts/check-local-secrets.mjs` refuses if any file git would stage matches a live-secret shape: `sk_live_`, `rk_live_`, a Telnyx v2 key, `sb_secret_`, or a pooler URL with a password. It reads each file as written, with its escapes undone, and as UTF-16, and prints only the file and the shape. `--all` adds the gitignored files. It runs before every push, from the `pre-push` hook in `.githooks` that the root `prepare` script enables, and again in CI's checks, because a hook can be skipped. It is also meant to run at every agent session start. That hook is not installed: it is persistent agent configuration, which waits for your yes.
- `scripts/ops/audit-agent-reach.mjs` lists every credential an agent session can reach, by name and never by value: environment variables, the Claude settings files, every env file in its clones (commented lines included) and `~/.loonext/`. It places each as production-write, production-read, nonprod or none. Without FA1 it reports and passes. With FA1 chosen (`LOONEXT_FA1=1`, or `"fa1": true` in `~/.loonext/hardening.json`), any production-write or unclassified credential fails it. A run that read nothing fails either way. It does not read the Windows credential store, browser sessions or a GitHub token's scopes yet, and says so on every run. Still planned: a weekly run from the agent user, probes of GitHub endpoints that need Administration, Environments or Secrets permission (each must answer 403), and `['ops','agent-reach']` in production Sentry on any finding.

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
- Unattended upgrades reboot the VM outside the dial window. A Windows Update reboot of the host is a named risk (section 12, risk 15).

**Why the emulators are not inside it.** Hyper-V stays on, so Workstation runs every VM in Host VBS mode, which gives the guest no nested virtualisation, and Google says an accelerated emulator cannot run inside another VM (developer.android.com/studio/run/emulator-acceleration). So they run on Windows under WHPX, which is already enabled.

**Why not WSL2.** A WSL distro mounts the Windows drives, which hold production keys in `apps/api/.dev.vars`, and shares one kernel with every other distro. The VM sees none of the host's drives.

**The Windows side: `hostd`.** `tools/rig/host/hostd.mjs` is a dependency-free Node supervisor. Its ports and devices are `tools/rig/host/contract.json`. It:
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
- Inside the VM only, `api.telnyx.com`, `api.resend.com`, `oauth2.googleapis.com`, `fcm.googleapis.com` and `us.i.posthog.com` also resolve to nothing. Any code that skips the guard therefore fails closed, including old releases that predate the seams. The emulators keep their own route to Google's push service.

**TLS.** Caddy serves the `.rig.internal` names on 192.168.70.10 with a certificate authority generated in the VM and never committed. The nonprod build trusts it for `*.rig.internal` only. Caddy restarts on failure.

**Recovery.** hostd restarts a stuck emulator by killing its process and cold-booting it (`-no-snapshot-load`), which is what D11 tests. A stuck VM is reverted to its powered-off baseline snapshot; the secrets disk is independent, so it survives the revert.

**What running on the workstation costs.** Measured read-only on 2026-10-31:
- **It is not always on.** In the last 60 days the workstation booted 33 times and was dark about 56 hours in all. Five of those gaps were overnight power-offs of 9-14 hours, each covering the whole dial window.
- **Update restarts land in the window.** Windows Update restarted it 6 times, at 08:29-10:44 UTC, against the default 04:00-10:00 UTC dial window. Active hours are 08:00-02:00 local. Sleep and hibernate on AC are already Never.
- **It is busy.** CPU is 44-68% busy with about 20 Claude processes running; 90 of 128 GB of RAM is free.
- **Disks.** C (NVMe) has only 34 GB free, D is a hard drive, and F (NVMe) has 128 GB free, so the VM and the AVDs live on F.

Dark time is infrastructure (`['ops','synthetic-dark']` after 6 hours, section 3.10), never a product failure.

### 3.3 Loonext in rig mode

**Deploying a version.** `rig deploy --ref <tag|branch|sha>`:
1. creates a git worktree and installs dependencies;
2. migrates the local database, resetting and reseeding it if the ref's schema is older;
3. derives the configuration;
4. restarts the services.

A schema change stops the services, the cron timers and rigd's scenario timers before anything migrates, and before it stops them `rig deploy` leaves `state/deploy-hold.json` in the rig's home. Scenario runs already going, timed or a triage rerun, are stopped first, while the API still serves: a stopped run releases its lease's undos before it exits. rigd's hourly schedule refresh starts no timer while that file is there, and a run started under it records `skipped` without running. The deploy removes it only once the services serve the new ref and rigd's timers are installed, so a deploy that fails leaves them stopped until one succeeds. `rig health` fails on a hold over an hour old, naming the file.

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

**Crons.** systemd timers fire each cron in that ref's config at its time, through `/cdn-cgi/handler/scheduled?cron=<expr>&time=<ms>`. That route is present in the repo's pinned wrangler 4.106.0 (checked 2026-10-29), with `/__scheduled` as the fallback. `time` is in milliseconds and reaches the job as its scheduled time. The fallback ignores `time`, so the job runs at the wall clock, and `rig cron` says so (both checked 2026-10-31). An agent can replay any cron at a chosen instant.

A cron registry, `tools/rig/crons.json`, classifies every cron in every tracked Worker config, keyed by config and cron. An API cron also lists its jobs, which must equal `CRON_JOBS` in `apps/api/src/index.ts`, so a job added to a cron forces someone to classify it again. Each cron is one of:
- **run**;
- **run, expecting a refusal**, with what that refusal makes Sentry receive suppressed (for example 10DLC polls and porting reconciles: in rig mode the app refuses every 10DLC, porting, hosted-messaging and documents request itself, with `rig_endpoint_refused`, before it reaches the guard, which refuses them too). Each refusal says whether the job lets it out, so its liveness alert follows, or catches it and reports its own event;
- **skip**, with a reason. The edge's and the guard's crons are skips: they fire on Cloudflare, never on the rig, and they suppress nothing, because the API's own alert for the same expression must stay visible. A skipped API cron lists the liveness keys it silences, and rigd expects those.

`rig deploy` refuses without the registry and installs one timer for each cron it runs. CI checks the registry against each ref's Worker configs (`scripts/check-rig-crons.mjs`). R00 requires zero unexplained Sentry fingerprints over 24 hours, so a standing red cannot hide a new one.

A cron's failure is explained only when its AggregateError is the outermost exception and every other exception that is not an AggregateError is a refusal listed for that cron. A job that collects its failures adds an AggregateError of its own in between. Sentry stops reading inside a chain once it has listed six exceptions, though it still lists every sibling of the one it is in. So an AggregateError it never read inside leaves the event unexplained: it may hold a real failure.

**Stripe and auth mail.**
- `stripe listen --api-key <test-mode key> --forward-to https://api.rig.internal/webhooks/stripe`. It never uses `stripe login`, whose pairing expires after 90 days. R00 checks the listener is alive and that its signing secret matches.
- Supabase Auth mail goes to a local Mailpit.

**Sentry.** Rig and synthetic events pass through a small relay in `rigd`. It enforces 100 events a day and 3,000 a month, and alerts at 70%.

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
- the existing Sentry project's DSN, with environment `rig`, through the relay (FA7);
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
| QA-G | Owner (Chromium) | No standing number. The month's S28 number is bought beside DEV-C1, taking its area code and messaging profile. It rings the owner until S29's grace run releases it the next day. | Number buying, cancellation, grace and release |
| QA-E | Emulator member | DEV-E1, on its own messaging profile | Emulator lane, STOP and START |
| Robot | none | ROBOT-1, ROBOT-2, STRANGER-1 | Far end of everything. Only ROBOT-2 ever sends STOP. STRANGER-1 is owned but kept off the app's allowlist so G01 can prove the stranger gate. |

### 3.4 The edge relay, `loonext-rig-edge` (Cloudflare Worker on workers.dev)

The internet can reach only these paths; everything else returns an empty 404:
- **`/t/v`, `/t/v2` (failover), `/t/w`, `/t/m`, `/t/r`.** Telnyx webhooks for the nonprod voice app, the WebRTC connection, the messaging profiles and the robot.
- **`/t/n/<secret>`.** Account notifications. These may be unsigned, so the path carries a secret segment. Before halting anything, the edge corroborates a notice: a balance notice by reading the balance through the guard; any notice when Telnyx refuses the account's reads; any other notice only when it carries a valid Telnyx signature and names a notification type enabled on the account. The notification-event list names types, not occurrences, so it never corroborates on its own. An unsigned notice the edge cannot corroborate halts nothing and goes to Sentry's `synthetic` environment as `['synthetic-infra','telnyx-notice']`.
- **`/w/<secret>/...`.** Customer webhooks from the rig's API to the robot. The app refuses `*.internal` webhook hosts, so the robot's endpoint is here. The secret segment stays at the edge, which queues each delivery (at most 256 KB) for the robot with the rest of the path.
- **`/m/...`.** Telnyx fetches of MMS and greeting media. Only Supabase-signed URLs, only for those two buckets, at most 5 MB.
- **An `email()` handler** for the robot's address on loonext.com (named in the rig's private config, never in git) and its `+tag` sub-addresses. It never rejects mail. It stores it; if storage fails it still accepts and counts. It keeps a heartbeat.
- **`/g/*`.** Authenticated callers forwarded to the guard over a service binding, along with their caller class.
- **`/ctl/uplink`, `/ctl/rpc`, `/ctl/secrets` and `/ctl/alert`.** The rig's own outbound WebSocket, `rig` commands, encrypted secret delivery, and rigd's one production alert (section 3.10). Each needs a bearer token.

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

**Dead-man.** A 15-minute cron checks three heartbeats: the rig's, the last suite run, and the last triage run.

**SSH.** Optional, Phase 4. Host agents already get a full shell on the rig over SSH on the workstation (section 8). A raw SSH relay is added only if a tool needs one.

### 3.5 The guard, `loonext-telnyx-guard` (Cloudflare Worker, no public URL)

**What it holds:**
- the Telnyx key;
- the Resend sending key;
- the FCM send key;
- the production Sentry DSN, which is ingest-only;
- an AI binding.

**Reachability.** workers.dev is off. The guard is reached only through the edge's service binding.
- A spike checks that the edge's scoped token can deploy that binding.
- If it cannot, the guard goes on workers.dev and every request must also carry an HMAC signature with a timestamp and a single-use nonce.

**Deploys** come only from `main`, through `guard.yml` in the `guard` environment, after the policy tests pass (no approval, per the amendment).

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
  - A live run lease and room in the budget are required. Test code names the lease in its header; the app's own legs (`rig-api`) run under the live lease. A header that names any other lease is refused.
- **Messages.** `from` and `to` must both be owned, and the profile must be a nonprod profile.
- **Provisioning (an explicit list):**
  - telephony credentials only on `nonprod-webrtc` and `nonprod-sentinel`;
  - number search at most once every 10 seconds, only under the S28 lease;
  - at most one order per 25 days and at most 10 numbers held. Each order body must carry the nonprod group and profile, and the nonprod connection once paid dials are open. The first order is read back to confirm the group stuck. The read-back judges only after the order reports success, and on a mismatch releases only the number id the order returned, never a number matched by phone number alone. When anything is ambiguous, ordering stops and nothing is deleted.
  - PATCH or DELETE only on owned numbers that are not standing numbers. One exception, **detach**: it clears a standing number's connection and messaging profile when strangers flood it.
  - Messaging profiles must carry a daily limit of $0.06 or less, a US/CA whitelist and an edge webhook. A messaging profile has no billing group field (Telnyx's API reference, checked 2026-10-31), so the guard knows the partition's profiles by id: the ones its setup routine created and the ones the app created through it.
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
- **Resend:** recipients must be `*@resend.dev`. `rig-robot+<tag>@loonext.com` is allowed only during S34 and only while the edge's mail heartbeat is fresh. At most 10 emails a day. Sending to the mailbox halts if a sent mail does not arrive within 10 minutes.
- **FCM:** data plus Android only. Any top-level notification block moves into the Android block, iOS and web blocks are dropped, and `restricted_package_name` is forced to `com.loonext.android.nonprod`. At most 300 sends a day. Production's sender puts a top-level notification and an iOS block on every alert (`apps/api/src/notifications/fcm.ts`), which is why the guard rewrites instead of refusing.
- **AI:** a model allowlist, at most 2,000 neurons a day.

**Admission.**
- **Room.** Room is the concurrent limit in force minus production's reserve. Production's reserve is its largest ring audience plus 1, read daily from production counts. The limit in force comes from the proof ladder below. While only its floor of 2 is in force, the room is 0 whatever the reserve, so no paid dial runs. The nonprod voice profiles' concurrent limits are set to the room, and the guard's own live-leg count enforces it as well. During a paid run the guard polls production's active calls every 2 seconds, per connection (`GET /v2/connections/{id}/active_calls`; Telnyx has no account-wide list), and hangs up every test leg on the first production call. That run is recorded as "preempted", not failed. An answer the guard cannot read refuses the dial.
- **The concurrency proof ladder.** No API exposes the account's level or its limit, and nothing waits on Telnyx to state it (D142, update of 2026-11-01). The guard's Durable Object keeps the evidence:
  - **Floor.** `TELNYX_CONCURRENT_FLOOR=2`, the lowest documented default (support.telnyx.com/en/articles/1130717, fetched 2026-10-31). While only the floor is in force, every request that adds a leg is refused as `admission.limit_unproven`. The guard never probes the limit by dialing.
  - **Validation check.** Telnyx's API spec says an outbound voice profile's `concurrent_call_limit` "Must be no more than your global concurrent call limit". The setup routine tests that on `nonprod-limit-probe-ovp`, a profile with no connection. It writes an absurd 9999 first. Only if Telnyx refuses that with a 422 naming `concurrent_call_limit` does it binary-search, in at most 16 writes, for the V that is accepted while V+1 is refused. It always resets the profile to 1. It costs $0 and places no call. An accepted 9999 means the rule is not enforced, so the limit stays unproven; any other answer is inconclusive. It is the only evidence that lifts the limit above the floor, and only as far as the Paid level's 5, or the history bound when that is higher: Telnyx does not say the boundary is the account's limit rather than a product maximum. A validated value above that raises `['ops','telnyx-guard-limit-capped']`, a warning, once per value.
  - **History lower bound.** The most overlapping answered production calls in 28 days, from `ops_diag.call_sessions`, filed by the daily `measure` run. The account carried that many, so its limit is at least that. It checks the validation (a validation below it is a conflict) and raises the cap on a validated value, but never opens room by itself.
  - **Ceilings.** A refusal with code 90041 (account), 90042 (voice profile) or 90043 (connection), or 90103 with HTTP 429 (dial rate), caps the limit and also halts and alerts (account signals, below). A 10039 on a dial, an account-level cap reached, halts the same way with no ceiling. Any ceiling newer than the validation makes the check due again, inside its once-a-day pace. A refusal that reaches the rig only in a `call.hangup` webhook, as a SIP 403 or 486, is not read yet: it ends that call, and lowers nothing until the next synchronous refusal or validation. The robot hearing Telnyx's automated-call announcement means the account is at Paid or below, which caps the limit at 5.
  - **Conflict and lapse.** Evidence that contradicts itself refuses as `admission.limit_conflict` and alerts. Evidence older than 35 days falls back to the floor. A ceiling read from a refusal can be 0, when the rig had no live leg and production was idle; it then conflicts with the floor and refuses everything until it lapses, which is the safe reading.
  - **Where it lives.** The store keys are `limit:validation`, `limit:history`, `limit:ceiling`, `limit:probe`, `limit:conflict-alert` and `limit:capped-alert`. Admin's `POST /limit-probe` runs the validation check, and the daily `measurements` run files `/concurrency-history` from the `agent_diag` read. The robot files the announcement as `POST /evidence/level`, a route only the robot may call. A conflict raises `['ops','telnyx-guard-limit-conflict']` and a probe that could not reset its profile `['ops','telnyx-guard-limit-probe-reset']`, both in production. Setup refuses to run the check on a probe profile any connection uses (`limit_probe_ovp_in_use`). Its `daily_spend_limit` of `0.00` and empty destination list are unverified against the live account; if Telnyx refuses either, setup reports the step as skipped and the floor stays in force.
- **Account-wide rate.** The guard assumes the Paid level's 10 outbound calls an hour and 100 a day, account-wide (developers.telnyx.com account levels, checked 2026-10-29), and refuses a dial when the rig's dials plus production's measured peak hour or day would exceed them (`admission.account_hour_full`, `admission.account_day_full`), or when that measurement is stale (`admission.account_rate_unknown`). The measurement is filed daily by `measurements` as `/account-rate` and kept under `admission:account-rate`; production's peaks are the most outbound legs in any 60 minutes and any 24 hours, not in one UTC hour or day. The rig's own dials are counted over the current and the previous UTC hour, and day, which bounds any rolling window from above, so the guard may refuse a little before Telnyx would. Its own caps in section 4.1 stay as ceilings below them.
- **Window.** Paid dials run only in the six consecutive UTC hours with the fewest production calls over the past 28 days, rechecked monthly. Until there is data, the window is 04:00-10:00 UTC; it is safe because the room already reserves production's ring.
- **Ratios.** The guard keeps the whole account's abandoned share at or below 15% and short-call share at or below 10%, using counts from detail records. Abandoned calls are assumed to include the ring legs Loonext cancels.
- **Money.** Telnyx-enforced daily limits; the $35/month all-in cap, with a daily allowance after reserving next month's rental and a $1.50 set-aside for month-end surcharges and charges on detached numbers; tiers: green, amber (core only), red (only hang-ups allowed). Below the balance floor, all test spend is refused. At the cap, every non-robot number is detached, so stranger inbound stops too. A detached number is assumed still billed, which is what the set-aside covers. `call_cost_in_webhooks` is on for both nonprod Call Control apps, so `call.cost` events record each call's actual cost in the rig's own database (`apps/api/src/billing/provider-costs.ts`). Nothing checks the guard's ledger against them yet: the ledger charges `COST_USD`'s estimates, and only the month's usage an agent files from detail records can raise it.
- **Measurements.** Production's reserve, ratios and window are filed through `guard.yml`'s `measurements` routine, because the guard Worker has no login to production's database. A daily scheduled run (`measure`, 03:23 UTC) computes the reserve from the `ops_diag` views as `agent_diag`, whose login is the `guard` environment secret `AGENT_DIAG_DATABASE_URL` (copied in once FA13 has run, and again after each rotation). It refiles the window once the guard's is 28 days old. Without the login it posts a notice and files nothing. The ratios are not read yet: the repo's Telnyx spec has no call-control detail record, and nothing yet says which records Telnyx counts as abandoned or short. Until the guard can count them, an agent dispatches `measurements` with `calls`, `abandoned` and `short`. The reserve and the ratios go stale after 36 hours and the window after 35 days. A stale reserve or ratio refuses every paid dial (`admission.ratios_unknown` for the ratios) rather than guess, and a stale window falls back to 04:00 UTC.

**Run lease.** One paid scenario runs at a time across the system. Scenarios register undo actions with `rigd`, the rig's service daemon. If the lease is not released within 15 minutes, `rigd` runs the undo itself.

The guard counts every Telnyx request that reaches it while a lease is live, refusals included, on that lease's record by caller, endpoint and outcome. `GET /g/lease/<id>/activity` reads the record back until the next lease is acquired. It names endpoints and rule names, never ids or numbers. G01 reads it to prove the app's refused send and dial never reached the guard. S09, S12 and S14 read it to prove a refused dial or send made no request, and S28 to prove one search and one order. A run under a local lease has no record. While no lease is live, the guard refuses every app dial, which is what keeps D02p at zero dials.

A run with no dials holds a local lease, except S34, which holds the guard's: the guard mails the robot mailbox only under a live S34 lease. S34 asks for it with `dials: false`, and the guard admits no dial under such a lease, the app's included, so S34 never makes a dial the app reaches for admissible. When another scenario holds the lease, S34 waits for it as a paid run does, at any hour.

A run that prepares before its lease holds its lane for the whole attempt (no runner prepares today: D03's stepped Doze takes seconds), in a file under `state/rigd/holds`. Another run on that lane waits for it as it would for a busy lease, then is skipped. A hold lapses by itself, so a run that died cannot keep the lane. If no run follows a finished prepare (no lease, or the window closed), the runner puts back what the prepare changed.

**Safety checks.**
- **At start-up**, the guard refuses to serve if any nonprod resource points at `api.loonext.com`, if any nonprod id overlaps a production id, or if any nonprod number is bound to a production connection.
- **Ordering** waits only on production's `/health` listing `telnyx-partition-v1` and on the first-order check, not on the concurrent limit. While paid dials are refused, the guard orders only the text-lane roles: ROBOT-1, DEV-W1 and DEV-E1, with no voice connection, and a standing order answers the calls-only roles it held back as `deferred`. A number bound to a connection takes inbound calls, which hold account channels, so binding waits for paid dials: order-standing then binds each held standing number that has no connection and is not detached, and until then S28's order and any PATCH setting a `connection_id` are refused as `provisioning.voice_closed`, and `reattach` restores only the messaging profile. Each ordered number is read back by the id the order returned, never matched by phone number. Telnyx's spec documents that id as a number-order record, which may not be the `/v2/phone_numbers` id; if it is not, the first read-back gets a 404 and ordering stops for good as `number_unreadable`, deleting nothing and alerting production, and resuming it is a decision (section 12, risk 21).
- **Hourly version attestation.** `rigd` reads the guard's deployment list with `guard-attest-read`: Cloudflare's `GET /accounts/<id>/workers/scripts/loonext-telnyx-guard/deployments`, whose first entry is the one serving traffic. It compares the live deployment with every Deploy step `guard.yml` ran on `main`, ordered by when each step started, from the newest down to the newest that succeeded. Those runs are read through the rig's GitHub App with a token that can only read Actions, pushes and dispatches only, because a scheduled run never deploys. Failed, cancelled and running steps count, because they may have deployed, so re-running an older run is a rollback, not a mismatch. The deployment matches when it serves one version, its message is `guard.yml <sha>` for one of those steps (`guard.yml` deploys with `--message "guard.yml <sha>"`, which wrangler also puts on the deployment), and Cloudflare made it during that step, with two minutes of clock slack. A secret change (FA3, FA6 and FA8 paste keys this way) redeploys the live code with no message, so `rigd` reads through it to the deployment it replaced. A mismatch raises `['ops','telnyx-guard-integrity']` in production through the edge's `/ctl/alert` (section 3.10). A side `rigd` cannot read raises `['synthetic-infra','guard-attest']`, never a pass, and so does a missing store file: `cf-guard-attest-token`, `cloudflare-account-id`, `rig-app-id` or `rig-app-key`. rigd publishes each result in `state/guard-attest.json`. **Residual, accepted:** Cloudflare takes the secret-change label from whoever creates a deployment, and `guard-attest-read` cannot read a version's code, so a holder of the guard's deploy rights could put other code under one.
- **Weekly key inventory.** Any unexpected Telnyx key raises `['ops','telnyx-key-inventory']`.
- **Daily negative probes** run in G01.

**Account signals.** A Telnyx notification channel posts to `/t/n/<secret>` for Suspicious Outbound Voice Traffic, Account Disabled, Low Balance, Messaging Suspicious Traffic, and the Abandoned and Short-duration call notices. None exist today. A fraud hold is assumed to cover the whole account and to be permanent for the rig, which never contacts Telnyx. Lifting a hold on production is a founder act outside the rig. So:
- The first corroborated fraud-type notice (Suspicious Outbound Voice Traffic, Account Disabled or Messaging Suspicious Traffic) latches the paid lanes off at once, until a reviewed change to `SIGNAL_LATCH_RESET`, and raises `['ops','telnyx-account-signal']`.
- Any other corroborated signal halts paid tests for 7 days and raises the same alert. A second within 30 days latches them off the same way.
- A refusal with code 90041, 90042, 90043, or 90103 with HTTP 429, halts the same way and counts toward the latch.
- A notice with a valid signature that arrives late still halts, deduplicated by its notice id, rather than being dropped with a 400.
- Every signed type halts; narrowing that list was rejected, because it would weaken the control.

### 3.6 The Telnyx partition (inside the existing account)

The guard's setup routine creates everything from a committed spec, `tools/guard/telnyx-spec.json`, which holds names and values only, never ids.

| Resource | Settings |
|---|---|
| Billing group `loonext-nonprod` | The ownership marker on every rig number. Messaging profiles have no billing group, so the guard keeps their ids instead. |
| Outbound voice profile `nonprod-voice-ovp` | Daily spend limit $0.40, reset at 00:00 UTC. Concurrent limit set to the room minus the robot's share. Maximum rate $0.01/min. US/CA whitelist. At most 20 calls per destination per calling window. |
| Outbound voice profile `nonprod-robot-ovp` | Daily spend limit $0.20; concurrent limit 1 |
| Outbound voice profile `nonprod-limit-probe-ovp` | No connection, so it can carry no call. Concurrent limit 1, except during the proof ladder's validation check, which always resets it to 1. |
| Call Control app `nonprod-voice` | Webhook `/t/v`, failover `/t/v2`, webhook timeout 10 s, RTCP capture on if offered, `call_cost_in_webhooks` on, channel limits matching the room |
| Call Control app `nonprod-robot` | Webhook `/t/r`; `call_cost_in_webhooks` on; channel limit 1 |
| Credential connection `nonprod-webrtc` | SIP URI calling set to internal. Webhook `/t/w`. **No outbound voice profile**, so an app credential cannot call a phone number. No push credential. |
| Credential connection `nonprod-sentinel` | One credential, no numbers, no outbound voice profile. Used only by G02. |
| Messaging profiles | `nonprod-robot` at $0.06 a day, with webhook `/t/r`, plus four tenant profiles at $0.03 a day each, with webhook `/t/m` (Telnyx refuses sends above the limit with HTTP 429 code 40333). US/CA whitelist. At most six profiles. |
| Numbers | Eight Canadian local numbers with Ontario area codes: ROBOT-1, ROBOT-2, STRANGER-1, DEV-W1, DEV-W2, DEV-A1, DEV-C1, DEV-E1. Plus one bought each month by S28 into QA-G and released the next day by S29's grace run. Each is ordered with the group, connection and profile in the order body. A standing number also carries a customer reference naming its role (`rig-standing-<role>`), so the role lives on Telnyx itself and no number is ever written into git to say which is which. |

**Vendor-enforced daily maximum:** $0.40 + $0.20 + $0.06 + 4 × $0.03 = **$0.78** (`nonprod-limit-probe-ovp` carries no call, so it adds nothing). That is about $24 in a 31-day month, about $35.50 with rentals, so Telnyx itself holds the cap even if the guard is wrong. Inbound legs and texts are not limited by these profiles; the edge's stranger rejection and the guard's detach bound them.

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
   - Production refuses to start with any vendor seam set (`TELNYX_API_BASE`, `TELNYX_WEBHOOK_URL`, `TELNYX_MEDIA_PUBLIC_BASE`, `STRIPE_API_BASE`, `RESEND_API_BASE`, `FCM_API_BASE`, `FCM_OAUTH_TOKEN_URL`). This goes further than the design's original `TELNYX_API_BASE` alone: each of the others would send a vendor credential or customer traffic to the host it names. Sentry's environment comes from `DEPLOY_ENV`.
3. **SQL destination gate.** `gate_outbound_send`, `api_claim_outbound_line` and the greeting-capture claim refuse non-endpoint destinations when the database setting `loonext.deploy_env` is `rig`. That setting exists only on the rig's local database. A SQL test proves production is unchanged.
   - The setting fails open: `supabase db reset` drops it, and a pooled connection opened before it was set never sees it. So the rig's API asks `rig_database_posture()` before it serves, and answers every request 503, and runs no cron, until the database reports `rig` with at least one endpoint. The rig bootstrap therefore runs `alter database postgres set loonext.deploy_env = 'rig'` and sets `loonext.rig_endpoints` to the `RIG_OWNED_E164` list after every reset, then restarts PostgREST and the pooler.
4. **Repro evidence.**
   - The `push_attempts` ledger: provider response class, priority and latency, kept 14 days, registered in the four add-a-table guards.
   - Ring beacons from the web, Android and iOS apps (the iOS code compiles in CI): stage events plus app, OS, permission and standby state, nothing personal.
   - `ops_diag` views, including hourly call counts and ring-audience sizes.
   - The `agent_diag` role, with an SQL test proving it cannot read messages, contacts, numbers or payloads.
   - `scripts/ops/call-trace.mjs`, which reads only the `ops_diag` views as `agent_diag`.
   - P01 and PW01 (section 3.11).
5. **Hermetic call journeys.** The fake Telnyx gains dialing and telephony credentials, and `CALL_SESSIONS` is bound. Inbound, outbound, voicemail and transfer journeys run on every push. They also emit each scenario's dial count and peak concurrent legs, which feed the budget check in section 4.1. A trace-to-fixture tool renumbers real traces into the fictional 555-01xx range.
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
   - the scenario registry;
   - the dial-budget check;
   - the test-id contract.
8. **Workstation tools:** `check-local-secrets.mjs`, `audit-agent-reach.mjs` and `ops.yml`.
9. **Deploy secrets.** `ship.yml` and `backup-posture.yml` move to the `production` environment, which uses the scoped `production-deploy` token. Both read repo-level secrets today.
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
- Chromium runs the call lanes. Google Chrome stable, headed under a virtual display, runs Web Push.
- Each member has its own browser profile.
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

This is gated by spike EA1 (section 10). **Until EA1 passes, every device-lane audio verdict is the infrastructure result `emulator-audio-unproven`, never a pass.** Wake verdicts do not depend on it. If EA1 fails, the fallback (`-allow-host-audio`) would need a third-party virtual audio cable and would share one input across every emulator, so audio verdicts stay infrastructure results instead.

**Where the lanes find their devices.** rigd reads each device's serial, console and gRPC ports from `tools/rig/host/contract.json`, the lock PIN from the store's `pixel-pin`, and the robot mailbox's address from `robot-mailbox`. The retired store keys `pixel-serial`, `pixel-bluetooth-mac`, `pixel-hub-location` and `pixel-hub-port` are gone: no store key moves a device off the contract.

The store also holds `hostd-token`, hostd's bearer token, which hostd copies into the VM only when it differs; `emulator-audio-proven`, `{"date":"YYYY-MM-DD","flags":[...]}`, written when EA1 passes, without which no audio verdict is given; and `play-services-pins.json`, the Play services versionName each emulator's system image pins, by device name.

The VM's environment names:
- `RIG_HOSTD_ORIGIN` (default `http://127.0.0.1:15900`) and `RIG_ADB_SERVER` (default `127.0.0.1:15037`), the tunnel's two ends, both refused off loopback;
- `RIG_WHISPER_BIN` and `RIG_WHISPER_MODEL`, for whisper.cpp (ffmpeg converts audio that is not WAV);
- `RIG_CHROME_BIN`, Google Chrome for the dispatcher's Web Push;
- `RIG_MAILPIT_URL`.

No lane runs anything through `sudo`: shaping goes through the emulator console, and restarts through hostd. `rig health` alone uses it, for `nft list table inet loonext_rig`, through a sudoers entry that allows that one command.

**What the Android lanes report.** Failure classes: `whpx_unusable`, `hostd_tunnel_down`, `pixel_deep_idle_disabled`, `emulator_deep_idle_disabled`, `pixel_audio_link_down`, `push_token_mismatch` and `no_device_push_token`, plus `health_hostd`, `health_adb_tunnel` and `health_nftables` from `rig health`. Infrastructure results: `hostd`, `emulator-audio-unproven`, `play-services-pin` and `app-probe`. D11's list of what failed to come back names `pixel-audio-link`. The lane installs `$RIG_HOME/work/apk/current.apk` and `previous.apk`, which `rig apk --ref` places there. `previous.apk` is the build of the commit placed before `current.apk`, not necessarily the release before it, so release builds are placed oldest first: D12 installs `current.apk` over it, and adb refuses a downgrade. A `--worktree` or `--debuggable` build is not placed.

R00 compares Play services with the minimum the installed nonprod build declares. play-services-basement merges `com.google.android.gms.version` into the app's manifest, and the lane reads it with aapt2 from the APK installed on `rig-pixel`.

**No iOS lane.** Section 2.3 explains why.

### 3.10 Scheduler, reporting, triage, dead-man

**Scheduler.** `rigd` uses systemd timers, all in UTC. Paid dials run only inside the measured window. Texts and push-only checks run at any time. A scenario rigd cannot run yet gets no timer, and the schedule lists it with its reason (`NOT_RUNNABLE_YET` in `tools/rig/rigd/src/scenarios/index.ts`). Today these are G02, S08 and S26. A test keeps every scenario the rig times either runnable or listed. A runner can read its own earlier attempts and their evidence from the verdict store, which is how E01 judges emulator audio over a week.

**Reporting.**
- A failing scenario is retried once.
- If it fails again, one event goes through the relay, by DSN only, to Sentry's `synthetic` environment, fingerprinted `['synthetic', scenario, failure_class]`.
- Infrastructure faults use `['synthetic-infra', component]`, so one dead phone is one issue.
- Noise limits: at most 50 events per run; a repeated fingerprint is suppressed for 6 hours. Auto-resolve is a project-wide setting, so it is not set on the shared project; triage resolves a synthetic issue after 24 hours without events (not built yet).
- No Sentry write token exists anywhere.
- **One project, three environments (FA7 substitution).** Rig and synthetic events go to the existing project with the environments `rig` and `synthetic`, and every event passes rigd's relay, which stamps its environment. Production's alert rules must filter on `environment:production`, or a rig event could fire one (section 12, risk 20). That is FA7 step 3, still open; until the variable `SENTRY_ALERTS_FILTERED` is set, the rig's DSNs are withheld and no rig or synthetic event is sent.
- The rig VM sends nothing to production's environment. Its one production alert, the guard attestation's `['ops','telnyx-guard-integrity']`, goes to the edge's `POST /ctl/alert` with the `rig` control token. The edge sends it by DSN from its production budget, at most once every 6 hours, and refuses any key not in `RIG_PRODUCTION_ALERTS` in `tools/rig-protocol`. Any answer but 200 means production did not get it, and rigd reports that to Sentry's `synthetic` environment as `['synthetic-infra','guard-attest']`.
- Each run posts an informational `synthetic/full-matrix` commit status through the rig's GitHub App.

**Triage.** An hourly agent on the Windows host drives the rig over SSH, through the `rig` CLI (FA10 is dropped, so there is no Claude cloud environment):
1. reads unresolved failures from the rig's verdict store;
2. re-runs the scenario;
3. attaches evidence;
4. opens or updates one issue labelled `synthetic` through the rig App.

Issue numbers stay out of commit trailers. Triage runs only while the workstation is on, which is also when the rig runs, so it misses nothing it could act on.

**Rig-authored code.** The rig App can open branches and pull requests; a ruleset keeps it off `main`. Workstation agents never auto-merge a rig-authored PR. They review the diff as untrusted input and re-run the checks themselves first.

**Dead-man.**
- If a heartbeat is stale, the edge sends `['synthetic-infra', component]` to Sentry's `synthetic` environment.
- If the whole system is dark for more than 6 hours, it sends `['ops','synthetic-dark']` to production. The rig is on while the workstation is on, not always on, so dark time is infrastructure, never a product failure (section 3.2).
- The suite and triage heartbeats carry when each last ran, and the edge judges them by that time, never by when the beat arrived.
- Each destination has its own daily cap: synthetic 20, production 10, which rigd's alerts through `/ctl/alert` share. A missing DSN spends none, and a refused send is retried hourly.

**What reaches you.** You hear about the test system only when:
- it is dark;
- isolation is at risk (G01, G02, guard integrity, key inventory, agent reach);
- the Telnyx account or balance needs attention.

Product regressions go to agents as GitHub issues.

### 3.11 Production watches

**P01 (ring success, hourly, in production).** `api_ring_success`, read on production's existing hourly cron.
- Ring success per platform and app version: the share of ring pushes that the same device reported as "ringing shown" within 15 seconds of the send starting. A push the provider answered "gone" is not an attempt.
- The share of answered sessions with media is not measured yet: nothing records whether audio flowed on an answered call. The answered count is returned, and media is reported as not measured.
- The version is the one the push's session last sent the API, and nothing else.
- The window is the 24 hours ending a minute ago. The baseline is the same platform's judged versions over the 7 days before it.
- Every row reports its sample size **n** and one verdict, first match wins:
  - `unattributed`: the push's session or version is unknown;
  - `not_instrumented`: the version is below the platform's beacon floor, the lowest version that sent any beacon in the 14 days kept;
  - `insufficient_sample`: under 30 attempts in the window;
  - `no_baseline`: under 30 attempts in the baseline;
  - `drop`: the window's rate is below `t - 3 * sqrt(t(1 - t)(1/n_window + 1/n_baseline))`, where t is the baseline rate minus 5 points;
  - `pass`.
- Only `pass` is a pass. `unattributed` and `not_instrumented` rows are counted but never judged, and stay out of the baseline.
- Computed exactly from the binomial, the threshold fires by chance on at most 0.28% of windows, and 0.05% once the baseline holds 100 attempts.
- A `drop` alerts `['ops','ring-success-<platform>']` the hour it first appears, then every 6 hours while it lasts.
- Only non-personal aggregates are used: platforms, versions, counts, rates and verdicts.
- With one production number today, it will mostly say `insufficient_sample`. It is the only real-carrier, real-device signal possible without a SIM, and it grows with the customer base.

**PW01 (wiring check, daily, read-only, no number).** It runs inside production's own scheduled handler, on the existing daily `0 13 * * *` cron, with production's existing Telnyx key and GET requests only. It never goes through the guard, and `productionWatchRefusal` stops it on the rig and on a laptop before any request. It:
- reads production's Call Control app, its credential connection and the messaging profiles its workspaces use, and confirms the webhook URL, failover URL and webhook API version "2" against the URL production builds for itself. The credential connection may leave its failover unset, as `docs/deploy/04-telnyx.md` creates it;
- reads the last 24 hours of failed webhook deliveries. A failure at production's URL, or at production's host under another path, alerts `['ops','telnyx-wiring']`. Failures at other hosts, such as the rig's edge, are counted and not alerted.

Payloads, passwords and query strings are never logged or alerted. This catches portal and webhook drift without a dial or any exception to the guard's policy.

### 3.12 One call, end to end (S02)

1. The robot asks the guard, through the edge, to dial DEV-W1 from ROBOT-1. The guard checks the lease, budget, room, window and ownership, then dials.
2. Telnyx sends `call.initiated` for `nonprod-voice` to the edge's `/t/v`. The edge verifies the signature, sees a nonprod connection and an owned caller, registers the call and relays the event to the rig.
3. The local API's Durable Object claims the line and asks the guard to dial one ring leg, to the QA-W owner's SIP username on `nonprod-webrtc`.
4. The owner's Chromium page rings and Playwright answers. Media flows through Telnyx.
5. After hang-up:
   - the robot judges its recording for the owner's 1,300 Hz code;
   - the page has already judged the robot's 1,100 Hz code;
   - the rig checks the call row and the Stripe test-mode meter.
6. The verdict is stored with the SHA. A second failure becomes one Sentry event, and triage picks it up within the hour.

---

## 4. Test matrix

### 4.1 Budget, concurrency and window

**Dials, not calls.** Telnyx limits count dials, and ring legs, transfers and ring-me legs are dials too. Each scenario's dials and peak concurrent outbound legs are taken from the hermetic journeys, which record them in `apps/api/e2e/call-journey-budget.json` and fail when the code disagrees with it. A rig run's dials are its `dials` plus its `far_end_legs`. For S01, S02, S04 and S07 the measured values equal the planning estimates; the numbers below are planning estimates for the rest.

**Budget rule, checked in CI.** Scheduled dials times their frequency, plus a 20% retry reserve, plus a 60-dial monthly repro reserve, must fit the daily cap times 30.

**The guard's own cap:**
- 18 dials a day and 3 an hour;
- 358.7 scheduled dials a month, 490.5 with both reserves, against a ceiling of 540;
- about 300 texts a month.

**The account-wide check.** Below that cap, the guard assumes the Paid level's limits for the whole account (section 3.5): the rig's dials in an hour plus production's peak hour come to at most 10, and a day's to at most 100. A stale measurement of production's peaks refuses.

**The encoded schedule.** `tools/rig/scenarios.json` holds 4.2 as data, with each run placed on a day and a UTC hour inside the window. Over its 210-day cycle the busiest hour holds 3 dials and the busiest day 18. Two days sit exactly at the daily cap, so a retry on those days waits. 4.2 at its written cadence would need 435.4 dials a month (582.5 with reserves), so not every row is scheduled:
- S07, S08, S10 and D01 need 4 dials in one run, and S09 needs 5, against 3 an hour. They stay unscheduled, because the hourly cap of 3 is final (below). S09 also needs two robot calls at once, and `nonprod-robot-ovp` allows one.
- K01 waits for Phase 4.

A run with no dials may name `offset_days`, which ties it to that day of its period at any hour: S29 runs on day 2 of the 30-day cycle, the day after S28's day 1.

**Editing this section, 4.2 or 4.3.** A change to 4.1, 4.2 or 4.3 updates `tools/rig/scenarios.json` in the same change. `scripts/check-rig-scenarios.mjs` fails CI when the two disagree: names, far ends, cadences, dials, room, the cap and the reserves. It does not read the totals above, so copy them from its output, which prints each one.

**Room** = the concurrent limit in force minus production's reserve (section 3.5). The limit in force comes from the guard's proof ladder; while only its floor of 2 is in force, the room is 0. It decides which call scenarios may run at all.

| Room | What runs | What is lost |
|---|---|---|
| 4 or more | Everything | Nothing |
| 3 | Everything except D01 and S10 | Ringing every surface at once; X-to-Y calls in one workspace |
| 2 | One-leg probes and single-surface calls only (G01, G02, K01, S01, S02, S04-S06, S11-S17, S24, S28, D07, D08), plus D02p, which needs no dial | Every paid Android wake test (D02-D04, D09-D12, E01), transfers and consults |
| 1 or less | No paid calls. Texts, D02p, hermetic and local tests continue. | All paid call lanes |

R00 publishes the room and the scenarios it blocks. A room under 3 would also mean production cannot ring a three-person crew, which is itself a production finding.

**The cap does not rise.** The old route for raising it was to let test traffic use up to 25% of each stated limit. At the Paid level 25% of 10 an hour is 2.5, below 3, so the cap never rises on that route, and S07-S10 and D01 have no promised date.

### 4.2 Scenarios

"Pages" means the browser pages on the rig. **Pass** lists every condition the agent checks with no human. The last column is how often the scheduled run exercises it, with dials per run.

| ID | Scenario | Far end | How the agent verifies it, with no human | How often (dials) |
|---|---|---|---|---|
| R00 | Rig health | none | **Pass:** services answer; local sign-in returns 200; the device-lane emulator is booted, reachable over the tunnel, unlocked and Doze-enabled, and its Play services version meets the minimum the installed nonprod build declares; the other emulators are up (booting them is D11's job); the guard is healthy and above the balance floor; the edge uplink is up; the nonprod apps point at the edge; the Stripe listener is alive; tz versions match; zero unexplained Sentry fingerprints in 24 h. **Critical:** the guard's start-up checks report the partition unsafe. **Also publishes:** the current room and the scenarios it blocks. While D03 holds the device lane for its stepped idle, the device-lane emulator's lock state is not judged. | Every 15 min (0) |
| H01 | Hermetic suite, including the call journeys | Fake Telnyx and Stripe | **Pass:** the CI status, watched after every push. | Every push (0) |
| G01 | Isolation self-test | A fictional 555-01xx number; STRANGER-1 | **Pass:** the app refuses a send and a dial to 555-01xx before Telnyx, by rig mode's destination gate. The database gate is reached first and raises `rig_destination_refused`, so each route answers 500 and the API's own error report for that route names the gate. A text that the Worker's gate refuses instead is filed as failed with that code. The guard's lease record holds no app request it refused for an unowned destination. STRANGER-1's call to DEV-W1 is rejected before any ring leg, row or voicemail, and its text is not threaded. The guard returns 403 to a dial on production's connection, a text from a number outside the group, and a dial to a non-owned number, each under its own rule. The relay's report counts the two error reports of a G01 attempt as expected. **Any success:** a critical result, sent at once to Sentry's `synthetic` environment. A production alert for it is not built yet. | Daily (1) |
| G02 | Calls the apps' SDK places itself | The sentinel credential, held by a test page on the rig | **Pass:** the browser SDK and the device-lane emulator's SDK, both signed in on `nonprod-webrtc`, each try a direct call to the sentinel; both are refused and the sentinel never rings. **If it rings:** alert, and residual X25 applies. Not runnable yet: the Android half needs the nonprod build to place an SDK call to a SIP address, and the app has no entry point for one. | Weekly (1) |
| P01 | Production ring-success watch | Real customers' calls | **Verdicts** per platform and version, first match wins: `unattributed` (session or version unknown), `not_instrumented` (below the platform's beacon floor), `insufficient_sample` (under 30 attempts in 24 h), `no_baseline` (under 30 in the 7 days before), `drop`, `pass`. **Pass:** only `pass`. **Drop:** the rate is below the baseline less 5 points, by more than 3 standard errors of both samples; it alerts `['ops','ring-success-<platform>']` (3.11). | Hourly, in production (0) |
| PW01 | Production wiring check | Production's own settings | **Runs** in production's own daily cron, with production's key, GET only, never through the guard. **Pass:** webhook URL, failover URL and API version on production's app, connection and profiles equal production's own, and no delivery to production's host failed in 24 h. **Otherwise:** it alerts `['ops','telnyx-wiring']`. | Daily (0) |
| S01 | Browser calls a phone number (on-net) | ROBOT-1 answers after 4 s | **Pass:** ringback energy before answer; the page hears 1,100 Hz and the robot hears 1,300 Hz; caller ID is DEV-W1; the one-time token is used once; the row is answered; a voice-seconds meter event lands in Stripe's test mode. | Every 3 days (2) |
| S02 | Phone number calls Loonext, answered in the browser | ROBOT-1 dials DEV-W1 | **Pass:** ring dialog and SDK ringing within 6 s; both codes heard; row answered; billed seconds equal the meter. | Every 2 days (2) |
| S03 | Loonext calls Loonext across workspaces | QA-C page dials DEV-W1 | **Pass:** the QA-W owner rings and answers; each side hears the other's code; two rows with distinct session keys, each billed to its own workspace; no text-back. **Recorded, not judged:** how Telnyx routed and billed the call, for the rig's billing measurement. | Weekly (3) |
| S04 | Unanswered call: voicemail, transcript, intake, webhook, text-back | ROBOT-1 speaks after the beep | **Pass:** voicemail stored locally, and the Telnyx copy returns 404; transcript word error 0.25 or lower; intake row; signed `voicemail.received` at the robot sink; text-back at ROBOT-1 within 60 s. | Every 3 days (2) |
| S05 | Caller hangs up while ringing | ROBOT-1 hangs up at 8 s | **Setup:** under the lease, QA-W escalates after 10 minutes on the destination clock with no business hours, so the call is after hours, and the owner is on call for DEV-W1. **Pass:** the call is missed; the text-back arrives within 60 s; a ring push is recorded; an escalation opens, and widens when the rig fires the minute cron 10.5 minutes later. | Fortnightly (2) |
| S06 | Hold, mute, keypad | ROBOT-1 | **Pass:** the member's code is absent from the robot's recording during hold and mute and returns within 2 s; digits 1-2-3-# arrive in order. | Fortnightly (2) |
| S07 | Blind transfer; decline, timeout and hop-cap variants | ROBOT-1 to DEV-W2 | **Setup:** QA-W rings in turn under the lease, so the owner's page rings alone first and the technician's phone is never dialed for the inbound call. **Pass:** the robot's heard code switches from 1,300 to 1,700 Hz, and the technician's transfer leg is answered. **Variants:** decline and timeout snap the call back to the owner, who is heard again. The hop cap is the API's one automatic snap-back; after it, the call reaches voicemail. | Weekly; variants monthly (4) |
| S08 | Consult transfer, inbound and outbound (the first live test of outbound transfer) | ROBOT-1 | **Pass:** during the consult the robot hears no member while the pages hear each other; after completion the robot hears the target and the sender's leg ends. Not runnable yet: the web call bar has no consult transfer control. Outbound also needs four Loonext dials (the browser call's two and the consult's two). Before S08 runs, in one change, this row's cell becomes (5) and S08's `dials` in `scenarios.json` becomes 4. | Weekly, alternating direction (4) |
| S09 | Busy line, second caller, self-dial | ROBOT-1, ROBOT-2 | **Pass:** the second caller reaches voicemail within 8 s; while the line is busy, the owner's dial shows "This line is on another call" and the guard's lease record shows no new app dial; after hang-up, a self-dial reaches voicemail. | Monthly (5) |
| S10 | Number X calls number Y in one workspace; call waiting | DEV-W1 to DEV-W2 | **Pass:** the technician and the owner ring (DEV-W2's audience includes the owner); the owner's page shows call waiting; the pages hear each other; DEV-W1's inbound row is answered. | Monthly (4) |
| S11 | After-hours, on-call, in-turn, ring length | ROBOT-1 | **Setup:** under the lease, today's hours are set two hours from now, so the shop is closed; after-hours calls are `on_call_only`, ringing is in turn with a 20 s ring, and the technician is on call for DEV-W2. **Pass:** only the on-call page rings, and the owner's stays idle for 15 s; voicemail answers at 20 s, plus or minus 2 s. | Weekly (2) |
| S12 | Voice and dial-count caps (QA-C) | ROBOT-1 | **Setup:** call records seeded, already reported, to production's own cap values, never lowered: the dial ceiling first, on its own, then the minute cap. Both gates read `call_records`, not usage rows. **Pass:** at the dial ceiling, outbound gets 402 `usage_cap_reached` and the guard's lease record shows no dial; over the minute cap, inbound ends busy and the text-back still arrives. | Fortnightly (1) |
| S13 | Paused, suspended or released number receives a call | ROBOT-1 | **Pass:** each fortnight's run tests two of the three states, each put back as soon as its call ends: no ring legs; the "line is down" notice is transcribed (75% of its words), or the call rings out when the row says the notice was not spoken; a released number is dropped within 5 s. | Fortnightly (2) |
| S14 | Kill switches (local flags only) | ROBOT-1 | **Pass:** `kill:calls` refuses a new call with 503 while a live call's codes continue; `kill:outbound-send` refuses with 503 before the guard, and nothing reaches the robot; `kill:ai` stops Lou's drafts (the same `runAiFeature` gate also covers transcripts); every flag is reset afterwards. | Fortnightly (2) |
| S15 | Greeting-capture call | ROBOT-2, seeded as the owner's mobile | **Pass:** the robot hears the prompt (75% of the capture prompt's words, leaving out the business name) and speaks 16 s after answer; the new greeting's audio transcribes within 0.25 word error of what it said. | Monthly (1) |
| S16 | Note-level member; signing a device out revokes voice for the person (D130) | ROBOT-1 | **Pass:** the note-level member gets no ring leg and no push while the owner rings, and its dial attempt gets 403. After the seed's sign-out member signs its session out, token minting gets 401, as for any revoked session. **Afterwards:** a fresh sign-in mints again. | Fortnightly (2) |
| S17 | Webhook failover and duplicate delivery | The edge returns 503 once | **Pass:** webhook deliveries (read through the guard) show the 503, then a 2xx on the failover; the event is recorded once and processed. rigd's webhook forwarder answers the next call event with the fault S17 arms. | Monthly (3) |
| S20 | Outbound text | ROBOT-1 | **Pass:** exact body within 30 s; status goes sent, then delivered; usage row and test-mode meter event; `message.sent` webhook at the sink. | Daily (0) |
| S21 | Inbound text | ROBOT-1 to DEV-W1 | **Pass:** threaded once within 15 s; realtime update in the page; a push-attempt row. | Daily (0) |
| S22 | Picture messages both ways | ROBOT-1 | **Outbound pass:** the exact body and picture reach ROBOT-1 from DEV-W1, and the hash Telnyx reports equals the stored file's, so Telnyx fetched it through the edge. **Inbound pass:** threaded with an attachment and stored as a JPEG with GPS EXIF stripped, not quarantined. | Weekly (0) |
| S23 | Loonext texts Loonext | DEV-W1 and DEV-E1 | **Pass:** both thread; no 40007 loop error. | Weekly (0) |
| S24 | STOP, START, HELP, ARRET, AIDE, plain-English opt-out | ROBOT-2 to DEV-E1 only | **Pass:** the opt-out is recorded; the next send is refused before the guard; a call to ROBOT-2 still connects (D38); the plain-English request is only flagged. **Cleanup:** the undo has ROBOT-2 send START. A STOP left in place after cleanup is critical. | Weekly (2) |
| S25 | Automated texts and quiet hours | ROBOT-1 | **Pass:** the away reply, emergency acknowledgement, scheduled send and reminder arrive at the daytime run. At the night run (destination clock) the scheduled send and reminder are held. The away reply and emergency acknowledgement still arrive, because they answer the customer's own text (D4). The help reply answers AIDE, which S24 sends. | Weekly, two runs (0) |
| S26 | Messaging caps and budgets | Seeded rows, at most 2 real sends | **Pass:** each refusal carries its own gate's error: 402 `usage_cap_reached` at the monthly segment cap (seeded usage rows), and 429 `rate_limited` at the hourly limit (a seeded outbound message, which the carrier's daily count also includes); the 80% carrier-ceiling alert lands in Sentry's `rig` environment. Not runnable yet: the API raises that warning by email only, never as a Sentry event. | Weekly (0) |
| S27 | Website widget code | ROBOT-1 | **Pass:** a start with no Turnstile token is refused and the always-pass key passes; the code reaches ROBOT-1 from DEV-W1 within 60 s; verify succeeds; the verification count goes up. The always-block key is not checked, because the rig's Turnstile secret accepts every token. | Weekly (0) |
| S28 | Number buy, bind, call, release | ROBOT-1 calls the new number | **Pass:** one search and one order (the guard's lease record), the order carrying group, profile and connection; the first-order group check passes, or is still pending after 60 s while the number shows in the group; the number rings; no other number is touched. The number is not released. A passing S28 hands it to S29; its undo, registered before the purchase, releases every number QA-G holds unreleased when S28 did not pass, and fails, naming the row, for one whose row never named its Telnyx number. A hand-off no S29 took within two days is taken back by the next S28, which reports it as `infra` (handoff) and releases it. Whether a production Sentry event mentions the number is for production's own ownership-mismatch alert to raise, because the rig reads nothing from production. | Monthly (2) |
| S29 | Cancel, grace, release, billing | Stripe test mode (shared) | **Setup:** the day after S28, under the lease, S29 takes over S28's number, backdates QA-G's `canceled_at` to 31 days ago and fires the grace cron. Grace runs on the database clock (`apps/api/src/billing/grace.ts`), not Stripe's. **Pass:** grace releases S28's number, which then answers 404 through the guard; no live campaign remains; the workspace moves through grace (notices on days 1, 15 and 27, then the release). Rig mode refuses 10DLC, so QA-G holds no campaign, a pass says its deactivation was not covered, and deactivating a real campaign is tested only in the hermetic suite. With no number from S28, S29 still runs grace and reports the release half as not covered. A retry keeps the first attempt's release verdict, because that attempt's undo already released the number. The undo releases the number through the guard if grace did not, and puts QA-G back. **Separately:** a seed-created customer on a Stripe test clock checks invoice and meter totals against the month's usage; the clock is deleted after. | Monthly (0) |
| S31 | Lou reply drafts and AI caps | A synthetic thread | **Pass:** a draft comes back through the guard and the guard's AI neuron count rises; the `suggest_reply` usage row counts it; a request seeded at the 1,500 cap answers `over_cap`. | Weekly (0) |
| S32 | Onboarding, Checkout with the 4242 test card, customer portal | Stripe test mode (shared) | **Pass:** sign-up is confirmed through Mailpit; onboarding completes; Checkout with the 4242 test card returns; the workspace records a subscription Stripe's test mode reports active; the portal opens on `billing.stripe.com`. **Recorded, not judged:** whether Checkout challenged the headless browser. | Weekly (0) |
| S33 | Two-factor login | none | **Pass:** with a TOTP code from the rig's store, the session reaches the second assurance level and the API accepts it. | Weekly (0) |
| S34 | Emails | Robot mailbox; Mailpit | **Pass:** API mail (an invite) arrives at the robot mailbox through Resend and Email Routing within 10 minutes, under S34's own guard lease, with working links; auth mail (a password reset) is read from Mailpit within 2 minutes and its link works. A missed-call alert is push-only since D45, so no mail is checked for one. | Weekly (0) |
| S35 | Public sign-up form | Mailpit | **Pass:** sign up, confirm by email, reach the app. | Weekly (0) |
| D01 | Inbound call rings every rig surface; the answering surface rotates | ROBOT-1 to DEV-A1, dispatcher added under the lease | **Pass:** within 8 s the page dialog shows, and the device-lane emulator shows Telecom RINGING plus the full-screen notification. The robot identifies the answerer by code; the other clears within 3 s; one database winner. | Weekly (4) |
| D02 | Android wake: app killed, forced Doze, locked with a PIN | ROBOT-1 to DEV-A1 | **Pass:** FCM accepted the push at high priority; the nonprod app's beacon stages arrive, each after the stage that causes it; Telecom shows RINGING within 12 s; UIAutomator answers; the rig hears 1,100 Hz through `streamAudio` and the robot hears 2,300 Hz through `injectAudio` (until spike EA1 passes, the audio half is `emulator-audio-unproven`). **Recorded, not judged:** the lock state at ring time, since adb can read an occluded keyguard as unlocked. | Daily (3) |
| D02p | Android wake with no call | none | **Pass:** a real FCM call push for a synthetic session is accepted, received, reported to Telecom, and shown ringing within 12 s; no ring-me beacon follows within 15 s, because the app stops at the session's 404 before it asks to be rung. Zero dials: D02p runs under a local lease, and the guard refuses every app dial while no lease is live. | 4 times a day (0) |
| D03 | Stepped Doze | ROBOT-1 | **Setup:** `dumpsys deviceidle enable all`, screen off, battery unplugged in software; then step deep idle to IDLE through one maintenance cycle, holding the device lane so no other run uses the device-lane emulator meanwhile. If the run cannot start after that, the battery goes back in and the emulator is unlocked. D03 runs on a day of its week when no other paid device-lane run is due. **Then:** as D02. Not reaching IDLE is an infrastructure result. Natural deep-Doze entry is not tested, because an emulator never enters it by itself (X6). | Weekly (3) |
| D04 | Android variants: standby buckets, battery saver, secure lock, before first unlock, app hibernation | ROBOT-1 | **Pass:** one variant per run. Its state is read back before the ring and judged against the runner's expectations table; the first runs confirm each row. A device that stays quiet counts only when FCM accepted the push. | Fortnightly, rotating (3) |
| D07 | Android app calls out | ROBOT-1 answers | **Pass:** the device-lane emulator's call connects; codes heard both ways (the device's half through gRPC audio, `emulator-audio-unproven` until EA1 passes); caller ID is DEV-A1. | Fortnightly (2) |
| D08 | Background tab and Web Push | ROBOT-1, dispatcher-only audience under the lease | **Pass:** the app's service worker shows the ring notification within 10 s, and the same notification carries the outcome within 30 s of hang-up. Chrome's own notification centre is not read. | Fortnightly (2) |
| D09 | First-answer race | ROBOT-1 | **Pass:** the device-lane emulator and a page answer within 300 ms of each other; the robot hears exactly one code; the database has one winner, the one heard; the loser holds no call within 5 s. Neither app shows "answered elsewhere": both drop a lost ring silently. | Fortnightly (3) |
| D10, D12 | Fresh install; upgrade from the previous release | ROBOT-1 | **Pass:** after install, or after an upgrade from the signed-in previous build, the app has a push target, then D02p and D02 pass. A stale row from the earlier install also counts as a push target, so D02p's beacons are what prove the new install works. | Weekly, alternating (3) |
| D11 | Unattended recovery | none | **Setup:** hard-kill the device-lane emulator's process, restart the other emulators, and cold-boot it with `-no-snapshot-load`. **Pass:** within 10 min, every `rig health` result is green, every emulator is booted, and the device-lane emulator is back, unlocked with its PIN and Doze-enabled; then D02p passes. | Weekly (0) |
| D13 | Bad network and a mid-call Wi-Fi drop | ROBOT-1 | **Setup:** the emulator console sets 80 ms of delay and a reduced network speed; 15 s after answer, `svc wifi disable` drops Wi-Fi, and `gsm data unregistered` with Wi-Fi off makes a 3 s outage. **Pass:** the call survives; the device's code is heard before the outage and again from 5 s after it. No loss is judged, because the console has no loss control (X27); Telnyx's RTP statistics are recorded. The device's own concealment is not measured. | Monthly (2) |
| D14 | In-app voicemail and MMS playback | none | **Setup:** under a local lease, S04's newest voicemail (its audio and transcript) is copied into a QA-A call row on DEV-A1, marked as already transcribed; the undo removes the row and the audio. **Pass:** the device-lane emulator's app lists the call with its "Play voicemail" control, and the rig's transcript of its media audio, heard through `streamAudio`, is within 0.25 word error of S04's phrase (`emulator-audio-unproven` until EA1 passes). Until S04 has left a voicemail, it is an infrastructure result. | Weekly (0) |
| E01 | Emulator wake, rotating through API 34, 35 and 36 | ROBOT-1 to DEV-E1 | **Pass:** as D02, except the emulator hearing the robot: only the device lane has the gRPC audio link (section 3.9), so E01 records no emulator's audio and a pass says that half was not judged. At least one API level a week must also pass the audio verdict, or the lane raises "emulator-audio-degraded". **Weekly variants:** notifications revoked, and force-stopped; both must NOT ring. | Every 3 days (3) |
| K01 | Outbound carrier egress (optional, Phase 4) | A public echo-test line | By default it never runs: Phase 4 is optional. **Pass:** the robot hears its own code echoed back with a 0.1-1.5 s delay. **Any other answer:** hang up within 3 s, and the line is removed permanently. | Weekly (1) |

**How your original examples map:**
- **Loonext to Loonext:** S03, S10, S23.
- **Loonext to phones:** S01, D07 (K01 later).
- **Phones to Loonext:** S02, D01, D02, E01.
- **"An app didn't ring":** D02, D02p, D03, D04, D10-D12, E01 and P01.

### 4.3 Named defects (not covered human-free, and why)

| ID | Gap | Why a machine cannot do it within the rules | What would close it |
|---|---|---|---|
| X5 | Texts to and from real handsets on carriers, including US 10DLC and a STOP from a real phone | Needs a SIM (forbidden), and a registered campaign for US traffic | A SIM, if the rule is ever lifted |
| X20 | A real carrier call into Loonext: ringback, early media, STIR/SHAKEN | All inbound calls come from the robot, on-net | The same. P01 measures it passively once production has volume. |
| X10 | Outbound caller-name display on a recipient handset | No carrier handset | The same |
| X17 | Wi-Fi to cellular handover; a cellular call interrupting a Loonext call | The emulators have no real radio; the console's `gsm call` simulates one and no lane runs it yet | None (no SIMs); a data SIM only if the rule is ever lifted |
| X21 | Any iOS device or Simulator test: PushKit and CallKit wake, APNs, lock-screen answer, call audio | No Apple membership is assumed, and the free tier has no Push Notifications capability (developer.apple.com supported-capabilities-ios, parsed 2026-10-30). The iOS app hard-codes production hosts. | An existing membership turns on the separate-accounts iPhone lane. iOS keeps its CI unit tests. |
| X22 | Calendar consent, refresh revocation, and all of Microsoft | No test identities can be created | Phase 4 offers a Google partial: a service account in the existing project owns its own calendar, and a token-URL seam lets the guard hand the app service-account tokens. That covers the Google API, the sync worker and push channels (verify the push-channel domain rule). |
| X23 | Hosted behaviour: Durable Object eviction under load, CPU limits, hosted Supabase auth settings, Realtime at scale, OpenNext on real Workers | The rig is local | Partly covered by P01, PW01 and the hermetic workerd Durable Object test |
| X24 | Supabase Auth mail over Resend SMTP; Resend bounce and complaint webhooks | Auth mail stays in Mailpit. Resend webhooks are team-wide and would carry production events. | Stays hermetic |
| X25 | A rig credential's SDK ringing another internal credential directly | Only if G02 shows the SDK path is open | Accepted residual if G02 rings; `sip_uri_calling_preference` governs only inbound calls, so no connection setting closes it. Production SIP usernames are never in any rig context. |
| X26 | Telnyx portal-only tools: SIP call flow, PCAP, QoS graphs, push debugging | No API exists for them | The robot's own RTP statistics, plus session analysis and call events read through the guard, substitute |
| X1 | A genuine Telnyx "flagged" screening verdict | Telnyx decides it | Recorded payloads cover our handling |
| X2 | Real port-in and port-out | Needs a legal signature; port-out loses the number | Not recommended |
| X3 | Hosted-SMS text-enablement; the sole-proprietor code | Needs a number elsewhere, plus paperwork each time | None |
| X4 | Live 10DLC reviews | No sandbox for them (D31) | Hermetic golden-us |
| X6 | Wake, Doze and call audio on a physical Android phone | No new hardware: every Android lane is an emulator with a Pixel profile, so it misses OEM power management, natural deep-Doze entry, a real radio, Bluetooth and a vendor audio stack | None. Production's P01 ring-success watch measures wake on customers' phones hourly; nothing in production measures call audio. |
| X7 | Firefox Web Push quota | Not automated | None |
| X8 | A third incoming call auto-declining | Needs a third QA-W number | One more number, $1.10/month |
| X9 | A text stuck "queued" for 15 minutes | Fault injection | Stays hermetic |
| X12 | Safari softphone | No Safari on Linux | A Mac (out of scope) |
| X13 | Google and Apple sign-in | Consent screens and bot checks | Stays hermetic |
| X14 | Passkey enrolment | Real authenticator; the relying-party id is app.loonext.com | A virtual authenticator, web only |
| X15 | Real Turnstile | Blocks automation by design | Test keys, kept honest by the always-block check |
| X16 | Speaker and earpiece audio routes | The rig hears only the emulator's one virtual input and output | None |
| X27 | Packet loss on the Android device's network path | The emulator console sets delay and speed but has no loss control | None. P01 covers wake only. |

---

## 5. Everything that expires, and what renews it

| Credential or device state | Lifetime | Automatic renewal or check |
|---|---|---|
| Telnyx key `nonprod-guard` | No expiry | Guard health every 15 minutes; weekly key inventory |
| The existing Cloudflare Workers token in `guard` and `rig-cloud` (FA4); `guard-attest-read`, and the optional scoped tokens, once made | No expiry | Deploy health; hourly attestation; the weekly reach audit |
| GitHub App key | No expiry | Installation tokens last 1 hour and are minted per use |
| Fine-grained token for the agent Windows user (FA2, optional) | No expiry, unless the org forces one | If forced, renewing it is a 5-minute act once a year; the reach audit warns 14 days ahead. This affects development, not rig operation. |
| The Stripe test-mode key (FA5); the existing Resend send-only key (FA8); the Sentry DSN (FA7); Sentry `agent-read`; `agent_diag` password | No expiry | Used daily; failures surface in R00 or the reach audit |
| FCM service-account key | No expiry, unless an org policy sets one | Checked at FA6; a daily dry-run send detects failure |
| Edge, guard and robot caller tokens; rig certificate authority (10 years); rig ES256 signing key; VAPID keys; Android nonprod keystore (25 years) | No practical expiry | Rotated only after an incident |
| `stripe listen` | Uses the test-mode key directly; no 90-day login | R00 checks it |
| The VM's SSH key pair and its pre-seeded host keys | No expiry | hostd's tunnel refuses a host key that does not match the pinned one; R00 checks the tunnel |
| hostd on the host | Per logon from the Startup folder, or per boot with FA16 | The dead-man notices a dark rig; triage on the host flags a missing triage heartbeat |
| Telnyx balance and rentals | Spends down; monthly | Production's existing chore. The floor stops test spending first, the $150 alert warns, and the ledger reserves next month's rental. |
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
| Windows on the host | Monthly updates | Windows Update may restart the host inside the dial window (section 12, risk 15); hostd brings the VM and emulators back at the next logon, or boot with FA16 |

---

## 6. Isolation guarantees and the mechanism behind each

1. **Agents and the gates (amended).** Under the amendment, agents keep the production access they have today, and guard and ops runs need no approval, so there is no gate for an agent to approve (section 12, risk 4). What still holds:
   - guard and ops runs take only `main`, through each environment's deployment-branch rule (FA9);
   - the reach audit lists every credential an agent session can reach. Its weekly run and its GitHub probes are still planned (section 3.1);
   - with FA1 and FA2, which stay optional, agents would run in a separate Windows user with no console sessions, no Claude in Chrome and no production keys, under a GitHub token that lacks Deployments, Administration, Environments, Secrets and Variables.
2. **No real person is called or texted.**
   - The guard holds the only usable Telnyx key. It requires an owned `from` and an owned `to` (live by billing group) or a SIP username on the rig's own connection.
   - The app's destination gate covers every send and dial site, with a census test that fails on a skipped site or on zero sites.
   - The SQL gate inside the send and dial functions refuses non-endpoint destinations on the rig's database.
   - The rig's credential connection has no outbound voice profile.
   - The rig's database holds synthetic data only.
   - G01 proves this daily.

   The only non-owned destination is the optional echo line. Email goes only to Resend test addresses, or to the robot during S34. Pushes reach only the nonprod Android package.
3. **Strangers cannot drive the rig, or put words in an agent's input.**
   - The edge rejects strangers' calls through the guard and drops their texts, so their content never reaches the rig or any agent.
   - The app also rejects owned-but-unlisted numbers, and G01 proves that daily with STRANGER-1.
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
   - Ownership is positive, by billing group, set in the order body and read back on the first order.
   - Nothing is ordered before `/health` reports the rule.
   - An ownership-mismatch alert covers the silent case.
   - 10DLC writes are refused.
   - S28 proves this monthly.
7. **Test calls never take a customer's call capacity.**
   - Nonprod concurrency is set to the room left after production's reserve, and the guard's own leg count also enforces it.
   - When the API allows, test legs are hung up on the first production call.
   - Paid dials happen only in the quietest hours.
8. **The rig cannot command production calls or ring production devices through the guard.**
   - Commands work only on registered legs, SIP targets are limited to the rig's own credentials, and connections are pinned.
   - The SDK's direct-call path is checked weekly by G02, and named as X25 if open.
9. **Webhook ownership is decided by resource, never by signature.** The edge checks the connection for calls and the profile for texts. Production's handler is untouched.
10. **Spending is bounded in four layers:**
    - the app's own caps;
    - Telnyx daily limits, $0.78 a day, sized so a 31-day month stays near the $35 cap;
    - the guard's $35/month all-in ledger;
    - the balance floor.

    Inbound is bounded by stranger rejection and auto-detach. If the guard is down, the rig can do no telephony.
11. **The dangerous keys sit in one place.**
    - The Telnyx, Resend and FCM keys live only in the guard, which has no public URL.
    - It deploys only from `main`, after its policy tests pass.
    - Version attestation runs hourly and the key inventory weekly.
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
    - Rig and synthetic events carry the environments `rig` and `synthetic` in the shared project, through a capped relay, and are sent only once production's alert rules filter on `environment:production` (FA7 step 3, gated by `SENTRY_ALERTS_FILTERED`).
    - Only isolation, guard, agent-reach, account, balance and "system dark" signals reach production on purpose.
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
| Transfer | $0.10 per invocation ("Call transfer" on the call-control page, "SIP Refer" on the rate sheet, both fetched 2026-10-31). The guard budgets $0.13, one leg more. |
| Billing increment | 60 seconds |

A judged call costs about $0.02-0.03.

**Unknowns, budgeted at the costlier answer** (D142, update of 2026-11-01):
- Canadian carrier fees on texts: assumed on both ends, at the highest published $0.008845 a part (Rogers and Fido).
- On-net calls: assumed billed at full off-net rates on both legs.
- Per-dial charges: none is published for Call Control or WebRTC.
- Surcharges: $0.01 per short call above 15% of the account's calls and $0.005 per abandoned call above 20%, with cancelled ring legs assumed to count as abandoned.
- A number with no connection: assumed still billed for inbound calls and texts.

`call_cost_in_webhooks` is on, so `call.cost` events record what each call actually cost, in the rig's database. The guard does not read them yet, so a cost higher than assumed sheds tests only once an agent files the month's usage from detail records, which the ledger then counts.

| Cost center | Monthly (expected) | One-time | Hard cap, and who enforces it | Alert before the cap | Source, date |
|---|---|---|---|---|---|
| Telnyx numbers: 8 standing at $1.00 + $0.10 SMS; caller-name lookup on one ($0.40); one monthly S28 number (about $2.10) | $11.30 | $8 | At most 10 numbers held and one extra order per 25 days (guard) | none (fixed) | telnyx.com/pricing/numbers and telnyx.com/pricing.md, 2026-10-29 |
| Telnyx usage: the scheduled dials in section 4.1, about 300 texts, recordings, beep detection, a few transfers | about $9 | none | $35/month all-in, rentals included (guard ledger, then drop). Telnyx daily limits of $0.78/day, about $35.50 a month with rentals. Balance floor. Stranger inbound bounded by reject and detach. | Tier-change and projected-overrun alerts in Sentry's `synthetic` environment. A production alert below $150. | Rates above, 2026-10-29; surcharges at support.telnyx.com/en/articles/1130707 and /12805746, 2026-10-29 |
| Cloudflare: 2 Workers and their Durable Objects on the existing Workers Paid plan; Workers AI through the guard | about $0.50 | none | AI capped at 2,000 neurons a day (guard), so at most about $0.66 a month even if the shared free tier is used up. Requests stay within the included 10M. | The 3 existing billing alerts | developers.cloudflare.com/workers/platform/pricing (updated 2026-10-02) and /workers-ai/platform/pricing (updated 2026-10-20), fetched 2026-10-29 |
| Supabase | $0 | none | Local stack only | none | none |
| Stripe test mode, FCM, Resend, Sentry, GitHub Actions, Claude | $0 | none | Resend at most 10 a day; Sentry at most 100 a day and 3,000 a month; triage only when failures exist | Resend at 7 a day; Sentry at 70% | Stripe test mode has no charge; firebase.google.com/pricing, 2026-10-29; resend.com/pricing, 2026-10-30 |
| Set-aside for month-end surcharges and charges on detached numbers | $1.50 | none | Inside the $35 cap, not added to it (guard ledger, `SET_ASIDE_USD`) | None of its own: the usage an agent files from detail records counts whenever it is above the ledger's estimate | D142, update of 2026-11-01 |
| Electricity | Estimate: $2-6, the workstation's extra draw | none | none | none | Estimate |
| Hardware | none | $0 | none | none | No hardware is bought: the rig is a VM on the workstation, and the phones are emulators |
| **Total** | **about $24, plus $2-6 of power; ceiling about $40** | **about $8** | | | |

**Conditional and optional:**

| Item | Monthly | One-time | When | Source |
|---|---|---|---|---|
| Echo-test probe K01 | about $0.05 | none | Phase 4, optional; by default it never runs (inside the cap) | Rates above |

**Telnyx Managed Accounts, for comparison.** They would give real isolation, but need the Starter commit plan at a $1,000 monthly minimum, with Telnyx approval (support.telnyx.com/en/articles/4951492, checked 2026-10-29). The production account returned 403 on that API.

---

## 8. How an agent gets in, and what it can see and drive

### Ways in

- **SSH from the host.** Host agents reach the VM with `ssh rig@192.168.70.10`, using the key `F:\loonext-rig\host\ssh\rig`, and the host key the VM was created with is pinned.
  - It is a full shell on the rig, which is the "SSH in and diagnose everything" of the EDR analogy.
  - Each repro or fix gets its own worktree, so the agent patches, re-runs and verifies in one place.
  - `vmrun` guest operations are a rescue path only: they need a guest password on the command line, which puts it in the process list.
  - Nothing is signed in to Claude in the VM, and there is no Remote Control session there (FA12 is dropped).
- **The `rig` CLI**, locally or through `/ctl/rpc`:
  - `rig deploy --ref`, `rig seed [--recipe]`;
  - `rig run <scenario> [--recipe] [--repeat N] [--build <ref>]`, `rig suite daily|weekly|release`;
  - `rig device pixel|emu34|emu35|emu36 install|kill|forcestop|doze|standby|saver|lock|unlock|coldboot|network|screenshot|logcat|callflow|bugreport`;
  - `rig robot dial|answer|dtmf|sms|mms|verdict|inbox|mail`;
  - `rig cron <expr> [--time]`;
  - `rig budget`, `rig room`, `rig lease`, `rig evidence <run>`.
- **The hourly triage agent on the host** (section 3.10), over the same SSH path. FA10 is dropped, so there is no cloud triage task.
- **Workstation agents**, for production reads only, from the host and never from the VM:
  - `scripts/ops/call-trace.mjs` as `agent_diag`;
  - Workers logs through `agent-logs-read`;
  - the guard's `diag` class;
  - production Sentry through `agent-read`.
- **Optional (Phase 4):** a raw SSH relay through the edge, for reaching the rig from outside the workstation.

### Tokens

**On the rig:**
- guard caller tokens (`rig-api`, `robot`);
- the edge uplink token;
- the Stripe test-mode key, and no other Stripe key (FA5);
- the GitHub App key (`main` is blocked by the ruleset);
- Sentry DSNs (ingest only);
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
- `loonext-rig`, which wraps the rig commands, robot verdicts, the inbox and the guard's nonprod reads.

There is no Telnyx, Cloudflare or Sentry MCP there.

### What the agent can see

- **Server side:** unsampled API and web logs; the whole local database (calls, legs, sessions, push attempts, beacons, the webhook ledger, messages, opt-outs, usage); Durable Object state.
- **Telnyx, through the guard:** call events, detail records, webhook deliveries, session analysis, recordings and the budget ledger, for nonprod ids only.
- **Robot and edge:** robot verdicts with per-frame numbers and RTP statistics; edge relay logs.
- **Android:** logcat; `dumpsys` telecom, notification, deviceidle, power and usagestats; the debug variant's call-flow log; screenshots; bug reports.
- **Elsewhere on the rig:** Chrome traces and `getStats`; the Stripe listener log; Mailpit; rig health history; the current room and budget.
- **Production, from the host:** `ops_diag` views, Workers logs (3-7 days), Sentry and redacted Telnyx reads.

**Not visible:** Telnyx's portal-only tools (X26).

### What the agent can drive

- **Calls:** place a call from the robot, any page, or any emulator. Answer or decline anywhere. Send keypad digits, hold, mute, transfer and consult.
- **Texts:** send texts and pictures.
- **Device states:** put emulators into killed, force-stopped, Doze, standby, battery-saver, locked, cold-booted or bad-network states.
- **Pushes:** trigger them by calling, or with D02p at no cost.
- **Data:** seed tenants, audiences and usage; fire any cron at any time; flip local kill switches; move Stripe clocks.
- **Builds and devices:** deploy any ref; build and install any `.nonprod` APK; cold-boot an emulator, or revert the VM to its baseline snapshot.

---

## 9. Customer-repro workflow

Example: "A customer's Android phone didn't ring yesterday."

1. **Intake.** Open a GitHub issue holding only a hash of the workspace id, the platform and the time window. The issue number stays out of commit trailers until the work is done.
2. **Read production without copying it** (agent Windows user). Run `node scripts/ops/call-trace.mjs --company-hash <h> --since 48h` as `agent_diag`. The login comes from `AGENT_DIAG_DATABASE_URL`, or from the same name in `~/.loonext/agent-diag.env`, which FA13 writes (the pooler login `agent_diag.<project ref>`). Any other login is refused. Every session first checks its own safety: read-only, each timeout at 60 seconds or less, no TEMP, no `pg_net`, and nothing outside `ops_diag`. The tool runs `psql`, or without one the client inside a local Supabase database container. `--company-id <uuid>` hashes the id locally and sends only the hash. For the window it shows:
   - sessions and legs per device;
   - each push attempt, with response class, priority and latency;
   - ring-beacon stages;
   - app version, OS, permissions and standby bucket.

   Add Workers logs for those requests, Telnyx call events through the guard's `diag` class, and production Sentry. Only codes, timings and versions go into the issue.
3. **Classify the stage:**
   - (a) no push was sent;
   - (b) accepted by the provider, never received;
   - (c) received, no ring shown;
   - (d) rang, but answering or audio failed.

   If the customer's app predates the beacon, (b) and (c) cannot be separated, so reproduce both. Android and iOS send all six stages (`push_received`, `os_reported`, `ring_me_sent`, `ringing_shown`, `answered`, `declined`); the web sends the last three it can see. Every client keys a beacon on the INVITE's `X-Loonext-Session`, and `apps/api/src/routes/ring-beacons.test.ts` fails if a client stops sending a stage it is listed for.
4. **Write a recipe.** `tools/synthetic/recipes/<issue>.yml` holds settings only: app version, Android level, phone state, ring strategy, member levels, network. `check-rig-no-e164` checks it in CI.
5. **Hand it to the rig.** Run `rig repro <issue>` in the VM over SSH.
6. **Rebuild what the customer ran.**
   - `rig deploy --ref <server release tag>`. Old web refs use the rig-only unsupported-Next flag; pre-seam server refs run in `--pre-seam` mode.
   - `rig apk build --ref <app tag>`. Tags older than the `nonprod` build type get a build-config overlay.
   - `rig seed --recipe <issue>`.
7. **Reproduce at a rate, for free.** Run `rig run D02p --recipe <issue> --repeat 20` on the device-lane emulator and on an emulator at the customer's API level. Stage (d), or a confirmation, uses the paid D02: at most 5 runs from the repro reserve, in the next window.
8. **If it does not reproduce, sweep.** Change one variable at a time: standby bucket, battery saver, each permission, lock and before-first-unlock states, network loss, app version. Record each negative result. If the cause looks specific to a physical phone (OEM power management, the radio, the audio stack), record it as X6.
9. **Fix test-first, in a rig worktree.**
   1. Write a failing test that pins the cause: Robolectric with `@Config(sdk = [34])`, or an API, SQL or workerd test.
   2. Fix it.
   3. Run lint, `pnpm -r typecheck` and `pnpm -r test`, plus the Android suite if shared code changed.
10. **Verify before merge.**
    - Deploy the branch on the rig and build the APK from it.
    - Require 20 of 20 D02p passes, 5 of 5 D02 passes, and a core run with no new failures.
    - The rig App posts a `synthetic/repro` status and opens the PR.
    - A workstation agent reviews the diff as untrusted input, re-runs the checks, and merges it.
11. **Release and confirm.**
    - Production changes only when the release-please PR merges.
    - The rig reruns the recipe against the released tag.
    - The issue stays open, labelled `awaiting-production-evidence`, until P01 has at least 30 attempts for that platform and version with a passing rate; P01 then closes it automatically. With today's volume that can take a long time, and the label says so.
    - The recipe joins the rotation for good, and its trace becomes a hermetic fixture under `apps/api/e2e/` through `node scripts/trace-to-fixture.mjs <trace> --out <fixture>`, which renumbers every number into 555-0100..0199 and writes nothing if any number survives.

At no step does any customer number, name, message, recording or database row leave production.

---

## 10. Build phases

| Phase | What gets built | Agent can build it | What needs you |
|---|---|---|---|
| **0a. The small production release** | Ownership rule, `/health` capability, ownership-mismatch alert, inbound-canary fix. Ships with `0fd3583c`, already on main. | Yes, now | Nothing beyond the normal release merge |
| **0b. Seams, evidence, guards, workstation tools** | Everything else in section 3.7, and the docs in section 14 | Yes, now | FA4 and FA9 to move `ship.yml` and `backup-posture.yml`. |
| **1. Cloud pieces in existing accounts** | Edge and guard; the Telnyx partition created by the guard's setup routine; the notification channel; attestation and key inventory; `rig-cloud.yml`, `guard.yml`, `rig-secrets.yml`. Number orders wait for 0a in production and the first-order check; paid dials wait for 0a and the ladder. Texts may start sooner. | Yes | Open: FA4's `guard-attest-read` token and Email Routing, and FA7 steps 3-5. FA3, FA6 and FA9 are done, FA5 and FA8 are substituted, and FA10 is dropped. |
| **2. The rig** | **Spikes first:** (2) code calibration; (3) local ES256 sign-in; (4) the cron route; (5) the AI shim; (6) FCM rewrite and package pinning; (7) robot inbound recording; (8) emulators under WHPX, started by hostd; (9) the edge-to-guard service binding; **EA1** gRPC call audio, in two steps: with no Telnyx cost, an AVD booted with `-grpc` and `-no-snapshot-load` (with and without `-no-audio`) whose in-guest page plays its microphone back, with a Node client injecting the 2,300 Hz code and streaming the output, passing when the detector hears both codes at 48 kHz, and measuring injection before and after the microphone opens; then one robot dial under the lease, passing when each side hears the other's code in at least 3 cycles with calibration's 10 dB of separation and no emulator crash; **VM1** cloud-init's datasource detection on Workstation, unproven until the first boot; **VM2** emulators started with nobody logged on; **VM3** the tunnel and the 5137 adb server, including whether the emulators honour `ANDROID_ADB_SERVER_PORT`. Spike (1), the Bluetooth purchase gate, is gone with the hardware. **Then:** VM creation, bootstrap, network, rig mode, seed, robot, `rigd`, lanes. | Yes | Open: FA15's first licence acceptance, on the Windows SDK and on the VM's SDK. VM creation replaces FA11 and is an agent action; FA12 is dropped. FA16 is optional. |
| **3. Schedule, reporting, triage, production watches** | Timers and the dial-budget plan; the Sentry relay; triage on the host; dead-man; G01, G02, P01, PW01. The guard's own cap is final (section 4.1). | Yes | Nothing |
| **4. Optional** | K01 echo probe (by default it never runs); the Google calendar partial (X22); raw SSH relay | Yes | For calendar: enable the Calendar API and create one service account in the existing Google Cloud project (10 minutes). |

### Founder actions, with click paths

Labels are as of 2026-10-29; vendor screens change.

**FA0. Withdrawn (2026-10-31).** No ticket goes to Telnyx, and nothing waits on a reply. Each question it asked is answered by a dated public doc, a read-only API read or the rig's own measurement; where none settles it, the rig takes the costlier or safer answer (D142, update of 2026-11-01):

| Question | How it is answered now |
|---|---|
| 1. The account's level and its concurrent, hourly and daily limits | No API exposes them. The guard's proof ladder (section 3.5) sets the concurrent limit in force, with a floor of 2 and room 0 until proven. Hourly and daily limits are assumed at Paid: 10 an hour and 100 a day, account-wide. SIP-URI ring legs are assumed to count. |
| 2. Per-dial charges; transfer pricing | None is published. A transfer is $0.10 ("Call transfer $0.10 per invocation"); the guard keeps $0.13, one leg more. `call_cost_in_webhooks` is on, so the rig records actual cost; the ledger is not yet checked against it. |
| 3. Routing and billing between our numbers; Canadian carrier fees | Assumed billed at full off-net rates on both legs, and the Canadian carrier fee assumed on both ends, at the highest published $0.008845 a part. |
| 4. Whether cancelled ring legs count as abandoned | Assumed to count. The short-call surcharge is $0.01 a call. |
| 5. Fraud-hold scope | Assumed account-wide and, for the rig, permanent: the rig never contacts Telnyx, and lifting a hold on production is a founder act outside it. So the first fraud-type notice latches the paid lanes off (section 3.5). |
| 6. Ordering both countries; `billing_group_id` on orders | Measured by the first-order read-back, which releases only the number id the order returned. |
| 7. An active-call count | Measured: `GET /v2/connections/{id}/active_calls`, per connection. An unknown answer refuses. |
| 8. Disabling outbound SIP URI calls per connection | `sip_uri_calling_preference` governs only inbound calls, so X25 stays an accepted residual, measured weekly by G02. |
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

**FA4. Cloudflare (substituted; the scoped tokens are optional hardening).** The existing Workers token is `CF_API_TOKEN` in the `main`-only environments `guard` and `rig-cloud`, and deploys the guard and the edge. Still wanted from step 2, and open: `guard-attest-read`, for the hourly attestation. The other four tokens in step 2 are optional hardening. Step 1 is unchanged; step 3, Email Routing, is open and agents cannot do it, having no access to the zone.
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

**FA5. Substituted: the existing account's test mode.** No sandbox is created. The existing Stripe account's test-mode key and test prices, from `apps/api/.dev.vars`, are the `rig` environment's `STRIPE_SECRET_KEY`. The rig refuses anything not `sk_test_` or `rk_test_` before Stripe is contacted. `rig deploy` runs `apps/api/scripts/stripe-setup.ts`, which is idempotent, only when a price id the template needs is missing.

**FA6. Firebase and Google Cloud (done).**
1. console.firebase.google.com > the existing project > Project settings > General > Add app > Android.
   - Package `com.loonext.android.nonprod`, plus the SHA-256 the agent gives you (the first `rig apk` makes the signing key, then stops and prints that SHA-256 until this file is in the rig's store).
   - Register, download `google-services.json`, and put it into environment `rig` as `ANDROID_NONPROD_GOOGLE_SERVICES_JSON`.
2. console.cloud.google.com > same project > IAM & Admin > Service Accounts > Create `fcm-rig-sender`, role Firebase Cloud Messaging API Admin > Done. Open it > Keys > Add key > Create new key > JSON.
3. The key must show no expiry. If creation is blocked or an expiry shows: IAM & Admin > Organization policies > `iam.disableServiceAccountKeyCreation` or `iam.serviceAccountKeyExpiryHours` > Manage policy > override for this project only, then create the key again.
4. Paste the JSON into the guard as secret `FCM_SERVICE_ACCOUNT_JSON` (same path as FA3 step 2), then delete the download.

**FA7. Substituted: the existing Sentry project.** No project is created.
1. The existing project's DSN goes into environment `rig` as `SENTRY_RIG_DSN` and `SENTRY_SYNTHETIC_DSN`, and into `rig-cloud` as `SENTRY_SYNTHETIC_DSN`: the edge's dead-man sends stale heartbeats there. Events carry the environments `rig` and `synthetic`.
2. The same project's DSN goes into environments `rig-cloud` and `guard` as `SENTRY_PROD_DSN`, for the alerts meant for production.
3. Open: every production alert rule must filter on `environment:production`, or a rig or synthetic event could fire one (section 12, risk 20). Auto-resolve is not set: it is a project-wide setting. Once it is done, set the variable `SENTRY_ALERTS_FILTERED` to the date in environments `rig` and `rig-cloud`; until then `rig-secrets.yml` and `rig-cloud.yml` withhold `SENTRY_RIG_DSN` and `SENTRY_SYNTHETIC_DSN`, so no rig or synthetic event is sent.
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
   1. The agent lists every workflow's secrets. Today `ship.yml` and `backup-posture.yml` both use repo-level secrets.
   2. It moves each consumer into the `production` environment.
   3. It proves `production-deploy` by redeploying the current release.
   4. After two green releases, delete the repo-level copies under Settings > Secrets and variables > Actions, and only those copies.

**What each GitHub environment holds.** An agent sets everything below except the vendor values your founder actions name, `production-ops`' pair included (step 2). Each token and secret path it generates is 256 random bits.

| Environment | Secrets | Variables | Read by |
|---|---|---|---|
| `guard` | `CF_API_TOKEN` (the existing Workers token, FA4 substitution), `CLOUDFLARE_ACCOUNT_ID`, `EDGE_ORIGIN`, `SENTRY_PROD_DSN` (FA7), `ROBOT_MAILBOX`, `NOTIFICATION_PATH_SECRET`, `GUARD_ADMIN_TOKEN`, and `AGENT_DIAG_DATABASE_URL` once FA13 has run | None. The account id and the edge's origin are secrets too, because Actions prints a step's environment in its public log and masks only secrets. | `guard.yml` |
| `rig-cloud` | `CF_API_TOKEN` (the existing Workers token, FA4 substitution), `TOKEN_SHA256_RIG_API`, `TOKEN_SHA256_ROBOT`, `TOKEN_SHA256_DIAG`, `TOKEN_SHA256_ADMIN`, `TOKEN_SHA256_RIG`, `TOKEN_SHA256_TRIAGE`, `ROBOT_WEBHOOK_SECRET_SHA256`, `NOTIFICATIONS_SECRET_SHA256`, `SENTRY_SYNTHETIC_DSN` and `SENTRY_PROD_DSN` (FA7) | `CLOUDFLARE_ACCOUNT_ID`, `TELNYX_PUBLIC_KEY` (the account's webhook key), `ROBOT_MAIL_ADDRESS`, `SENTRY_ALERTS_FILTERED` (FA7 step 3's date; unset, `SENTRY_SYNTHETIC_DSN` is withheld) | `rig-cloud.yml`, and the store job of `rig-secrets.yml` |
| `rig` | `STRIPE_SECRET_KEY` (FA5), `ANDROID_NONPROD_GOOGLE_SERVICES_JSON` (FA6), `SENTRY_RIG_DSN` and `SENTRY_SYNTHETIC_DSN` (FA7), `RIG_APP_KEY` (FA9), `CF_GUARD_ATTEST_TOKEN` (FA4), `CLOUDFLARE_ACCOUNT_ID` (the same value as in `guard`, for rigd's attestation), `RIG_TOKEN_UPLINK`, `RIG_TOKEN_RIG_API`, `RIG_TOKEN_ROBOT`, `ROBOT_WEBHOOK_SECRET` | `RIG_BUNDLE_PUBLIC_KEY`, `RIG_APP_ID` (FA9), `TELNYX_PUBLIC_KEY` (the same value as in `rig-cloud`), `RESEND_FROM`, `SENTRY_ALERTS_FILTERED` (as in `rig-cloud`; unset, both Sentry DSNs are withheld) | The seal job of `rig-secrets.yml`, which delivers them to the rig's secret store |
| `production-ops` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | None | `ops.yml` |
| `production` | What `ship.yml` and `backup-posture.yml` read as repository secrets today, once step 4 moves them | Likewise, once moved | `ship.yml`, `backup-posture.yml` |

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
node scripts/ops/call-trace.mjs --self-check
```

- `--dry-run` connects to nothing. `--check` is read-only, and refuses until the migration is live.
- The script generates the password, sends the database only its SCRAM-SHA-256 verifier, and writes the login to `~/.loonext/agent-diag.env`, readable by that user only. Nobody sees the password, and no CI job creates or sets it. Running it again rotates it.
- If `call-trace` ever refuses the login as unsafe, withdraw it: `node scripts/ops/set-agent-diag-password.mjs --target production --withdraw`.
- An agent then copies the same login into environment `guard` as `AGENT_DIAG_DATABASE_URL`, for the daily measurements run (section 3.5), without printing it: `gh secret set --env guard -f ~/.loonext/agent-diag.env`. That run is the one CI job that receives the login.
- After every rotation the agent runs that command again. After a withdrawal it deletes the copy: `gh secret delete AGENT_DIAG_DATABASE_URL --env guard`. A stale copy fails the measurements run, and once the reserve is 36 hours old every paid dial is refused.

**FA14. Guard deployments (an agent action, per the amendment).** `guard.yml` deploys from `main` after its policy tests pass, with no approval. An agent dispatches its admin routines (check, setup, order-standing, key-inventory, accept-key-inventory, reattach, measurements) from `main`.

**FA15. Required once, then about once a year (open).** Accepting a licence is an agreement, so an agent never does it. The first acceptance is required: on the Windows SDK, `create.mjs` stops at step 10 and prints the `sdkmanager --licenses` command, and `create.mjs --sdk-only --yes` finishes after it; on the VM's Linux SDK, `rig apk` cannot build until it is done (`tools/rig/README.md`). After that, accept a new licence when the agent upgrades a pinned SDK.

**FA16. Optional: start the rig at boot (5 minutes).** In an elevated terminal, `schtasks /Create /TN "Loonext Rig" /SC ONSTART /DELAY 0002:00 /RU <your user> /RP * /TR "<the command the agent gives you>"`, typing your password at the prompt. Without it, hostd starts from your Startup folder when you log on, so after a Windows Update restart the rig stays dark until you log on.

---

## 11. Deliberately out of scope

- **A hosted twin of Loonext in the production accounts.** It would add configuration drift, a public login page on the production Cloudflare account and a hosted test database. Re-evaluate when #323's trigger fires: a second person shipping, or a customer whose outage is expensive.
- **Synthetic tenants inside the production database.** Production point-in-time recovery is off. That approach also needed a session-minting endpoint in production, and its phone lane breaks on the first real Turnstile challenge.
- **An iOS Simulator lane.** It could not test wake, it would need an iOS rig configuration plus a TCP relay, and no customer runs an iOS build.
- **A raw SSH relay through the edge as the primary way in.** Host agents already have a full shell on the rig over SSH on the workstation. The relay stays optional (Phase 4).
- **A production probe number** for wiring checks. PW01 reads production's settings and delivery log instead, with no dial and no exception to the guard's policy.
- **New accounts of any kind:** SIM, Apple, Workspace or Microsoft 365, device farm.
- **A hard release gate on synthetic results.** A flaky phone must not block a customer fix. Reconsider after 30 days with the device lanes under 2% flakiness.
- **Any copy of production data,** even scrubbed.
- **An App Store or TestFlight pipeline, porting, live 10DLC reviews, forced screening verdicts.**
- **A self-hosted GitHub runner.** On a public repo, fork pull requests could run code on it.
- **Load testing.** The #251 driver still has no deployed non-production target.
- **Switching on the #308 hourly text canary.** Its column bug is fixed in Phase 0a. Turning it on needs two more production numbers and about $12 a month by its own estimate; that stays its own decision.
- **A Supabase scoped token for production logs.** It expires within a year, which would make a recurring founder act. Database evidence comes from `agent_diag`.
- **A read-only live Stripe key for agents.** It would expose customer billing data. Billing repro uses the existing account's test mode.

---

## 12. Open risks

1. **A Telnyx fraud hold is account-wide** (accepted, the largest risk). Test traffic will probably be most of the account's calls. A hold would stop production calling too, and Telnyx does not disclose its scope. Mitigations: on-net only, low volume, quiet hours, and the first fraud-type notice latches the paid lanes off until a reviewed change to `SIGNAL_LATCH_RESET` (section 3.5). Recovery needs you, because only Telnyx support can lift a hold; that is a founder act outside the rig, which never contacts Telnyx.
2. **Concurrency room may be too small.** If the account's limit is 2 or 5, most or all paid call lanes do not run (section 4.1). Telnyx documents a default of 2 (support.telnyx.com/en/articles/1130717, fetched 2026-10-31) and 5 at the Paid level (developers.telnyx.com account levels, checked 2026-10-29), and no API says which applies. Until the proof ladder proves more than its floor of 2, the room is 0 and no paid call lane runs. That would also mean production cannot ring a full crew, which is worth knowing on its own.
3. **The guard's key has full production authority.** A merged policy bug could touch production. Mitigations: policy unit tests, the two-way registry check, start-up refusals, daily 403 probes, attestation, key inventory.
4. **Agents keep production reach** (the amendment). Agents hold production keys and can drive the founder's browser, as they do today. The guard does not widen that. Its protections are in code, and FA1/FA2 remain available as optional hardening.
5. **Ordering.** No number before production's `/health` shows the ownership rule and the first-order check passes. While paid dials are refused, only ROBOT-1, DEV-W1 and DEV-E1 are ordered.
6. **One home site, on one workstation.** Power or internet loss stops synthetic coverage. The dead-man alerts production after 6 hours dark.
7. **Fidelity gaps from running locally** (X23).
8. **P01 has little to measure today.** With one production number, it mostly reports "insufficient sample", and repro issues may wait a long time for production evidence.
9. **Unproven mechanisms,** each with a spike and a fallback:
   - coded bursts surviving voice processing (fallback: "media arrived" plus speech recognition);
   - local ES256 sign-in;
   - the AI shim;
   - FCM rewrite and package pinning;
   - inbound recording;
   - the edge-to-guard binding (fallback: HMAC with a nonce); passed 2026-11-01, when `/g/health` with the diag token answered 200 from the guard over the binding;
   - the per-connection active-calls read (an unknown answer refuses the dial);
   - the proof ladder's validation check (an inconclusive answer leaves the floor in force);
   - gRPC call audio on the emulators (EA1, risk 19);
   - cloud-init's datasource detection on Workstation (VM1); passed on the first boot, 2026-11-01: `cloud-id` said `vmware`;
   - emulators started with nobody logged on (VM2); not measured, because no emulator is installed until FA15;
   - the tunnel and the rig-only adb server on 5137 (VM3). The tunnel half passed 2026-11-01: all ten reverse binds sit on the VM's loopback, sshd refused a bind on an unlisted port and on 0.0.0.0, hostd listens only on 127.0.0.1:15900, and `/v1/health` through the tunnel answered 401 without the token and 200 with it. The adb half, and whether the emulators honour `ANDROID_ADB_SERVER_PORT`, wait on FA15, which installs adb.
10. **Cost uncertainty.** Each unknown is budgeted at its costlier answer (section 7). A higher real cost would shrink coverage, not raise spend.
11. **Recycled numbers attract strangers.** Rejected calls and dropped texts may still bill. Detach stops a flood; replacement waits for the monthly order slot.
12. **Shared quotas without a vendor-side split:** Sentry, Resend, Workers usage, Workers AI, Claude limits. Each is capped in our code.
13. **Old-version repro.** Old web refs need the rig-only unsupported-Next flag. Pre-seam server refs cannot run push or email scenarios. Old Android tags need an overlay.
14. **Production side findings, to be filed as separate production issues:**
    - Production's voice profile and messaging profiles have no Telnyx-side spend limits; auto-recharge is off and the credit limit is 0.
    - The account's two mobile push credentials (iOS and Android) are attached to no connection, so iOS closed-app wake cannot work today.
    - If the account is at the Paid level, Telnyx prepends its automated-call announcement to production's own greetings and dials, and caps customers at 5 concurrent calls and 100 a day.
    - `docs/deploy/04-telnyx.md` said ring legs come from the WebRTC connection, as D43's live fix made them. The code now dials every leg from the voice connection (`apps/api/src/calls/runtime.ts`), and D43 found that a ring dialed from the voice connection fails. 04-telnyx.md now says what the code does and keeps the question open. **Verify** on production's next inbound call that a browser rings.
15. **Windows Update restarts the host inside the dial window.** It did 6 times in 60 days, at 08:29-10:44 UTC. The VM and the emulators stop with it, and come back at the next logon, or at boot with FA16. Moving active hours over 04:00-10:00 UTC would avoid most of them; that is your choice.
16. **Overnight power-offs.** Five gaps of 9-14 hours in 60 days each covered the whole dial window. A dark night is infrastructure (`synthetic-dark`), never a product failure, and costs that day's paid runs.
17. **Host CPU load.** The workstation is 44-68% busy with agent sessions, and the VM and emulators add to it. Timing-sensitive verdicts (ring within 6-12 s, the 300 ms race in D09) may flake under load; a flake is retried once before it is reported.
18. **The F: disk budget.** F has 128 GB free. The VM's disk can grow to 90 GB, its secrets disk is 4 GB, and the AVDs need their own space. C has only 34 GB free and D is a hard drive, so neither is a fallback.
19. **Emulator audio is unproven.** gRPC `injectAudio` and `streamAudio` have not run on this workstation. Until spike EA1 passes, every device-lane audio verdict is `emulator-audio-unproven`, never a pass, so call audio on Android is not judged at all.
20. **One Sentry project for production and the rig** (FA7). Production's alert rules must filter on `environment:production`, or a rig or synthetic event could fire a production alert. Nothing reads the rules yet: `agent-read` (FA7 step 5) does not exist. So the gate is the founder's word: `SENTRY_ALERTS_FILTERED`, set once step 3 is done, releases the rig's DSNs. A new alert rule without that filter reopens it, and nothing would notice.
21. **An ordered number's read-back id.** The guard reads each ordered number back by the id the order returned, which Telnyx's spec documents as a number-order record. If that is not the `/v2/phone_numbers` id, the first read-back gets a 404 and ordering stops for good (`number_unreadable`), deleting nothing and alerting production. That fails safe, but resuming ordering would be a decision; production resolves ordered numbers by phone number (`apps/api/src/telnyx/provisioning.ts`).

---

## 13. How disagreements and review gaps were settled

### 13.1 First-round reviews

| Point | Choice and reason |
|---|---|
| Which design | Both reviews chose the local rig. |
| Protecting production from the shared sweep | Positive ownership by billing group, not a deny-list secret. It needs no production secret and fails safe. |
| Filtering production's webhooks by connection id | Rejected: it would drop production's text and registration events. Ownership is decided at the edge, per event type. |
| How the guard knows production is ready | `/health` gains a capability list. |
| Production wiring | PW01 reads production settings and deliveries. No probe number. |
| The #308 text canary | Bug fixed; switching it on stays #308's decision. |
| Where triage runs | First a Claude cloud task, so a revoked rig sign-in could not stop it. Since 2026-11-01, an agent on the host, because nothing signs in to Claude in the VM (FA10 and FA12 dropped). |
| Production Telnyx reads | Merged into the guard as a redacted, GET-only class: one full-power key fewer. |
| Sentry write access | None anywhere. Synthetic issues go by DSN. |
| FCM key rotation | No self-rotating key; non-expiry is checked at setup. |
| Rig memory | 24 GB for the VM; the emulators run on the host, 2 cores and 3 GB each, at most 3 booted (2026-11-01). |
| Transfer pricing | Transfers are budgeted at $0.10 each (SIP Refer, rate sheet 2026-10-29). |
| Cron path | `/cdn-cgi/handler/scheduled`, confirmed in wrangler 4.106.0. |
| Isolation proof | G01 runs daily at the app layer; guard 403 probes run daily. |
| Email realism | A robot mailbox through Email Routing, now limited to S34. |
| Stripe hidden step | Portal and tax settings are made by API. |
| Android build | `initWith(release)` plus a debuggable twin. |
| Database-level gate | Inside the send and dial functions, keyed on a rig-only setting. |

### 13.2 Second review: where each blocker and major gap is closed

| Gap | Closed by |
|---|---|
| Blocker: agents run as you and can drive your Chrome and credential store | Accepted under the amendment (12, risk 4). The reach audit lists what an agent can reach. A separate Windows user and a token that cannot approve stay available as FA1 and FA2 (3.1). |
| Blocker: production keys in commented lines of `apps/api/.dev.vars` | Removed only if you choose FA1, which also gives agents local-only env files with fakes. Either way, `check-local-secrets` stops a push while any file git would stage holds a live key, and CI checks again. Its session-start hook waits for your yes (3.1). |
| Blocker: test calls can starve a customer's call | Room formula, live-leg count, preemption, measured window; paid lanes open only on the proof ladder's evidence, with room 0 at the floor (3.5, 4.1) |
| Test traffic is the majority, so surcharge and fraud reasoning was inverted | Account-level ratio control, single-surface audiences, cancelled ring legs assumed abandoned, and a latch on the first fraud-type notice (2.2, 3.5) |
| Dials undercounted | Counts derived from the journeys; CI budget check with retry and repro reserves; the cadence encoded in `tools/rig/scenarios.json`, with the runs the hourly cap cannot hold named (4.1, 4.2) |
| P01 has no sample | Reports n; "insufficient sample" is never a pass; repro issues stay open until evidence exists (3.11, 9) |
| Wired fallback breaks adb | Moot since 2026-11-01: there is no phone. Emulator audio goes through gRPC, gated by EA1 (3.9) |
| FCM token seam missing | `FCM_OAUTH_TOKEN_URL`, a guard-token bearer in rig mode, a dummy key, and a test (3.3, 3.7) |
| iOS lane would talk to production | iOS Simulator lane and TCP relay dropped (2.3, 11) |
| Old web refs cannot build | Rig-only unsupported-Next flag; pre-seam mode; wider DNS block (3.2, 3.3) |
| Local sign-in would 401 | Bootstrap ES256 key, derived config, R00 check (3.3) |
| Guard approvals make you an operator | Class-based policy and the registry check in the same PR. Under the amendment guard deploys need no approval at all (3.5, FA14). |
| Removing your keys blinds agents | Prompt-free read tier: `agent-read`, `agent_diag`, `agent-logs-read`, guard `diag`. Under the amendment agents keep their keys, and `ops.yml` changes a flag from `main` with no approval (3.1). |
| Rig cron noise | Cron registry, CI check, zero unexplained fingerprints (3.3) |
| Robot mailbox could bounce production's domain | The mail handler never rejects; heartbeat gate; mailbox only in S34; halt on a missed delivery (3.4, 3.5) |
| Untrusted texts could reach production code | The edge never relays stranger content; rig PRs are never auto-merged (3.4, 3.10) |
| Vendor ceiling was 3 times the cap; inbound uncapped | Daily limits resized to $0.78; automatic detach for floods (3.6) |
| S29 could not pass | `canceled_at` is backdated under the lease; the test clock is used only for Stripe-side assertions (4.2) |
| SDK-placed SIP calls bypass the guard | G02 sentinel probe; residual X25 if open, since `sip_uri_calling_preference` governs only inbound calls (4.2, 4.3) |
| Minor gaps | Notification webhook secret path and corroboration; guard with no public URL; secrets cutover order covering `backup-posture.yml`; `stripe listen --api-key`; device-side renewals (system-image and SDK pins, Play services, adb key); `DEPLOY_ENV` unset means local; ownership-mismatch alert and fallback marker; D02p dials zero; monthly Sentry ceiling; FCM Android-only rewrite; calendar partial; numeric verdicts for D13, E01 and S03; text events acknowledged at the edge; the network (now the VM's NAT and nftables), Ontario numbers; Phase 0 split (the API deploys before web in `ship.yml`); portal-only tools named (X26); SSH and PW01 simplified; production push-credential and Paid-level findings filed (12). |

---

## 14. Decision record

A new decision, numbered when committed because parallel sessions also write decisions (D141 is already taken): **"Rig mode, not staging."** It amends `docs/ENVIRONMENTS.md` (#323).

**What it says:**
- **#323 stands.** There is one deployed Loonext environment. The rig is the local stack connected to real vendors. The two Workers are tools that never run app code and hold no customer data.
- **Superseded:** only the staging recipe's step 3, "a Telnyx sub-account with one test number". Managed Accounts need a $1,000/month commit and returned 403 (2026-10-29), and the founder forbade new accounts (2026-10-29). It is replaced by the in-account partition behind the guard.
- **Amended:** the objection to standing number cost. Eight numbers at $8.80/month are justified by the human-free repro mandate.
- **Not adopted (amendment):** the rule that agents run only in a Windows user without production write keys. FA1/FA2 are optional hardening.
- **Unchanged:** the revisit trigger; previews from `wrangler versions upload` are never used for anything that sends, dials or bills; the #251 driver still has no target.
- **Do-not-build table** gains two rows: "copy production data into any test environment" and "synthetic tenants in the production database".

**Docs updated in the same change:**
- `docs/deploy/04-telnyx.md` section 6: "sandbox" becomes "the nonprod partition, through the guard"; the ring-leg description is corrected; the rule that production numbers never carry a billing group is added.
- New rows in `docs/deploy/06-env-reference.md`, enforced by `check-env-doc`.
- A new `docs/RIG.md`: runbook, cadence plan, verification checklist, and the resource list without ids.
- A note in `docs/CAPACITY.md`.

**Update, 2026-11-01: no Telnyx ticket, no new hardware.** Recorded in D142's update of that date, which wins where this file disagrees:
- **FA0 is withdrawn.** Nothing waits on Telnyx. The ten questions are answered by dated public docs, read-only API reads or the rig's own measurement, and otherwise by the costlier or safer answer (section 10, FA0).
- **The concurrency proof ladder** replaces "paid lanes off until FA0": a floor of 2 with room 0, a $0 validation check on `nonprod-limit-probe-ovp`, a lower bound from production's history, and ceilings from refusals and level evidence (section 3.5). The account-wide rate assumes the Paid values, and the guard's cap of 18 a day and 3 an hour is final (section 4.1).
- **Ordering** waits only on `/health` and the first-order check, and the read-back releases only the number id the order returned.
- **The first fraud-type notice latches the paid lanes off**, until a reviewed `SIGNAL_LATCH_RESET`.
- **FA11 is withdrawn.** The rig is a new VMware Workstation VM, `loonext-rig`, with the Android emulators on the Windows host under WHPX, driven by `hostd` (section 3.2). The technician's phone is the AVD `rig-pixel`, and the id `pixel` names it. Call audio goes through the emulator's gRPC service, gated by EA1 (section 3.9). X6 widens to any physical phone, and X27 is new (section 4.3).
- **Founder actions:** FA5, FA7, FA8 and FA4 are substituted with what already exists; FA10 and FA12 are dropped; FA3, FA6, FA9 and FA13 are done; FA16 is new and optional (section 10).
- **Cost:** hardware $0 and about $8 one-time; about $24 a month plus $2-6 of workstation power, with a $1.50 set-aside inside the $35 cap (section 7).
