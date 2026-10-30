# Loonext Rig: human-free repro and testing inside the accounts Loonext already has

Prepared 2026-10-30, revision 2.

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

1. Build one dedicated, always-on Linux mini-PC, **the rig**. It runs all of Loonext locally at any version: local Supabase, the API and web Workers under wrangler, browsers with fake microphones, Android emulators, a SIM-less Pixel, and a robot that is the far end of every call. An agent drives it and works inside it completely, like an EDR developer's repro VM.
2. The rig reaches real Telnyx only through **`loonext-telnyx-guard`**, a policy-enforcing Worker in the existing Cloudflare account.
   - It holds the one extra Telnyx key.
   - It lets calls and texts flow only between numbers in a capped partition of the existing Telnyx account.
   - Production is changed first, through release-please, so that its account-wide number sweep acts only on numbers it positively owns.
   - Test calls are sized so that they can never take the call capacity a customer's call needs.
3. Every scenario runs on a schedule, is judged by machine, and turns each distinct failure into one issue that an hourly cloud agent triages.
   - Cost: about **$24/month**, with Telnyx hard-capped at $35 all-in, plus about **$918 one-time**.
   - No new vendor account anywhere.
   - No recurring founder act in operating it.

### Your part

**Today (15 minutes): FA0.** Read your Telnyx account level and send the support ticket the agent drafts. The answer decides how much of the matrix can run, and whether paid calls can run at all.

**Optional hardening, not required (see the amendment above).**
- **FA1:** agents move to their own Windows user, and production keys leave every file they can read.
- **FA2:** that user's GitHub login becomes a token that cannot approve deployments or change settings.

**What these would close.** Today every agent runs as you, so it can:
- drive your real Chrome, including your vendor console sessions, through Claude in Chrome;
- read your Windows credential store;
- read production keys in `~/.claude/settings.json` and in commented lines of `apps/api/.dev.vars`. Checked by key name on 2026-10-30: the commented lines include the production Telnyx key, the live Stripe key, the Supabase secret key, database password and access token, and the production VAPID pair.

Any one of those bypasses the approval gates below, which is why the amendment does not rely on them.

**One time only (about 4 hours in all; click paths in section 10).**
- one Telnyx key;
- two placeholder Workers, five scoped Cloudflare tokens and one email address;
- a Stripe sandbox;
- a Firebase app and service account;
- two Sentry projects;
- a Resend key;
- a GitHub App, five environments and one ruleset;
- a Claude cloud environment;
- buying the hardware, plus one setup session;
- signing in to Claude on the rig;
- (no guard approval: agents deploy it, per the amendment).

**Recurring while the rig operates: none.** The system detects each of these first, and only then might it reach you:
- a Telnyx fraud review (test traffic has already stopped itself);
- a phone, battery, hub or box that physically breaks;
- Anthropic signing the rig out of Claude (tests and triage keep running);
- about once a year, accepting a new Android SDK licence when the agent upgrades the pinned SDK.

**Outside the rig.** Nothing changes. Under the amendment, agents keep making production writes as they do today, and guard deployments need no tap.

---

## 2. What changed because there are no new accounts

### 2.1 Everything created, and the existing account it lives in

| Existing account | What is created inside it |
|---|---|
| **Telnyx** (the production account) | **Key:** one API key, `nonprod-guard`, held only by the guard. **Billing group:** `loonext-nonprod`. **Voice:** two outbound voice profiles; two Call Control apps; two credential connections (`nonprod-webrtc`, with no outbound voice profile, and `nonprod-sentinel`, which has one credential, no numbers and is used only by test G02). **Messaging:** one robot messaging profile, plus four tenant profiles that the rig app creates through the guard (at most six in all). **Numbers:** eight Canadian local numbers, plus one bought and released each month. **Other:** one notification channel and its settings; telephony credentials created and deleted at runtime. |
| **Cloudflare** (the production account) | **Workers:** `loonext-rig-edge`, on workers.dev, and `loonext-telnyx-guard`, with no public URL and reached only through the edge. Each has its own Durable Object. **Rate-limit namespace ids:** 3001-3009. **Tokens:** five account-owned tokens: `rig-deploy`, `guard-deploy`, `guard-attest-read`, `production-deploy` and `agent-logs-read`. **Email:** one Email Routing address on loonext.com that delivers to the edge. **Not created:** KV, D1, tunnels, Access apps, DNS records. |
| **Supabase** | Nothing. The rig runs a local Supabase stack. |
| **Stripe** | One sandbox, `loonext-rig`, with its own catalog, customer portal and tax settings. Test clocks are created per run. |
| **Firebase / Google Cloud** (the existing project) | Android app `com.loonext.android.nonprod`. Service account `fcm-rig-sender`, with the messaging role only, and one key. |
| **Sentry** (the existing org) | Projects `loonext-rig` and `loonext-synthetic`. A read-only internal integration, `agent-read`. Spike protection switched on. |
| **Resend** (the existing team) | One sending-only key, `rig-sending`, restricted to the loonext.com domain. |
| **GitHub** (BytechLabs org, Texturion repo, your user account) | **App:** `loonext-rig`. **Environments:** `guard`, `rig-cloud`, `rig`, `production` and `production-ops`. **Ruleset:** one, on `main`. **Workflows:** `guard.yml`, `rig-cloud.yml`, `rig-secrets.yml` and `ops.yml`. **Label:** `synthetic`. **Token:** a fine-grained token in your account, used only by the agent Windows user. |
| **Claude** (your existing plan) | Cloud environment `synthetic-triage`, with one hourly scheduled task. Remote Control sessions on the rig and in the agent Windows user. |
| **Your PC** (not a vendor account) | A standard local Windows user, `loonext-agents`. It needs no Microsoft account. |
| **No account** | The mini-PC, a used Pixel with no SIM, a USB hub, Wi-Fi and Bluetooth adapters, and possibly a travel router. |

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
| **Your workstation identity.** Agents run as you. | An agent drives your Chrome to approve a guard deploy or read a console; reads your credential store; or reads production keys from settings or env files. Any of these bypasses every control below. | Agents run only under a separate Windows user, which has no console sessions, no Claude in Chrome and no production keys (FA1). Its GitHub token cannot approve deployments (FA2). Production write keys live only in GitHub environments and your password manager. A weekly reach audit and a secret scanner prove this stays true (section 3.1). |
| **Telnyx concurrent call limit.** It is account-wide: default 2, 10 after Level 2 (support.telnyx.com/en/articles/1130717, fetched 2026-10-30). At the Paid level it is 5 concurrent, 10 outbound an hour and 100 a day (developers.telnyx.com account levels, Paid, checked 2026-10-29). | A test call holds outbound legs (robot dial, ring legs, ring-me) while a customer calls in. The customer's ring legs are refused, and the customer reaches nobody. | The guard sets nonprod concurrency to **room = account limit minus production reserve**. The reserve is production's largest ring audience plus 1, read daily from production counts. Scenarios that need more legs than the room are not scheduled and are named (section 4.1). During a run, the guard also polls production's active calls every 2 seconds and hangs up every test leg on the first production call (verify the active-calls API). The dial window is the six quietest hours in production's own call history, rechecked monthly. Paid lanes stay off until FA0 returns the real limit. |
| **Telnyx surcharges and fraud profile, both computed on account totals.** Surcharges apply to short calls above 15% and to abandoned calls above 20%, at $0.005 each (support.telnyx.com/en/articles/1130707 and /12805746, checked 2026-10-29). | With one production number, test traffic will probably be most of the account's calls. The account's ratios and fraud profile therefore become the rig's. | The guard keeps the **whole account's** ratios (production plus rig, counts from detail records) at or below 15% abandoned and 10% short. Ring audiences are shrunk to one surface wherever the scenario does not test multi-ring, so cancelled legs are rare. FA0 tells Telnyx this traffic will be the majority, and asks whether cancelled ring legs count. If they count and the projection goes above 15%, multi-ring scenarios run monthly. The dollar effect is cents; the profile effect is what matters. |
| **Telnyx fraud holds.** Their scope is not disclosed (support.telnyx.com/en/articles/3610162 and /7915224, checked 2026-10-30). | A hold triggered by test calls also stops production calling. | Traffic is on-net only, with about 13 dials a day on average and calls of 20-50 seconds, inside the quiet window. A written notice goes to Telnyx (FA0). Any suspicious-traffic or account notice halts paid tests for 7 days and raises a production alert. **Residual, accepted: the largest risk in this design.** |
| **Telnyx prepaid balance.** Auto-recharge is off and the credit limit is 0 (read 2026-10-29). | Test traffic drains production's money. | Telnyx-enforced daily limits on every nonprod profile total $0.78 a day, about $35.50 a month with rentals. The guard's own cap is $35 all-in. Below a floor (the larger of $100 and 14 days of production spend), the guard refuses all test spend. A production alert fires at $150. Inbound legs and texts are not capped by Telnyx: the edge rejects strangers, and the guard detaches any number that strangers flood. |
| **Production's account-wide number sweep.** `reconcileNumbers` runs every 15 minutes, lists every number and can DELETE. | Production flags or releases test numbers, or the rig's copy of the code releases production numbers. | Positive ownership: production acts only on numbers with no billing group, and the rig only on its own group. The group is set in the order body. The guard orders nothing until production's `/health` reports the rule. It checks the first order actually carries the group, and releases the number at once if not. Production raises an alert if a number it would own shows up with a group. |
| **API keys with full account power.** Telnyx keys cannot be scoped (developers.telnyx.com authentication docs, checked 2026-10-30). | Any second key can release production numbers or text anyone. | Only the guard holds one. It has no public URL. Its deploys need your approval, which agents cannot give. Attestation runs hourly and a key inventory runs weekly. **Residual, accepted:** an approved but faulty guard can reach production. |
| **One webhook signing key for the whole account.** | A signature cannot tell test events from production events. | The edge decides ownership by resource: connection for call events, messaging profile for text events. Production's handler is deliberately left unchanged. |
| **Internal SIP calling.** Production's WebRTC connection accepts SIP calls from any connection on the account. | A test could ring a real member's device. | The guard dials a SIP address only if its username is on the rig's own connection. Calls that the apps' SDK places itself bypass the guard, so test G02 checks weekly whether a rig credential can ring a sentinel credential. If it can, that residual is named (X25). |
| **Cloudflare account and tokens.** | A test token redeploys production or the guard. | Every automation token is scoped to named Workers (granular Worker permissions, Cloudflare changelog 2026-09-15). Production CI moves to its own scoped token. Your broad user tokens never reach the agent user. |
| **Cloudflare rate-limit namespaces.** Counters are shared per id across the account (developers.cloudflare.com rate-limit binding docs, updated 2026-10-21). | Test traffic spends production's limiters. | The local stack's limiters are emulated on the rig. The cloud Workers use ids 3001-3009, and CI forbids 1001-1013 and 2001. |
| **Workers AI pool.** 10,000 free neurons a day per account, then $0.011 per 1,000 (developers.cloudflare.com/workers-ai/platform/pricing, updated 2026-10-20). | Local `wrangler dev` bills AI to the production account. | The rig's AI calls go through the guard, which caps them at 2,000 neurons a day. |
| **Cloudflare account standing.** | A Trust and Safety action against a test page hits the production account. | The edge serves no HTML and sets no cookies. The guard has no public URL. The Loonext app on the rig is never public. |
| **Firebase project.** One FCM credential reaches every app in the project. | A leaked key could push to production iOS or Android devices. | The key is held only in the guard. The guard sends Android-only messages to the nonprod package: it moves any top-level notification into the Android block, drops the iOS and web blocks, and forces the package name. The rig never holds a production device token. |
| **Sentry org quota.** | Test events crowd out production's errors. | Separate projects. A relay on the rig caps rig plus synthetic events at 100 a day and 3,000 a month, and alerts at 70%. Spike protection is on. |
| **Resend domain reputation and quota.** | A bounce from a failed robot mailbox, or a complaint, pauses sending for the whole team, which stops production password resets. | Default recipients are Resend's test addresses, which do not affect reputation (resend.com/docs, send-test-emails, checked 2026-10-30). The robot mailbox is used only by the weekly S34 test, and only while the edge's mail heartbeat is fresh. The edge's mail handler never rejects. Sending to the mailbox halts the first time a sent mail fails to arrive within 10 minutes. At most 10 emails a day. |
| **GitHub approval gate.** | Agents approve their own guard or ops run. | FA1 and FA2. Approvals come only from your phone or your own Windows user's browser. |
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
| A carrier SIM handset (K00-K05): real carrier calls both ways, carrier texts, STIR/SHAKEN, caller-name display, a STOP sent from a real phone | **Accepted** as defects X5, X10, X17 and X20. P01 measures real customers' rings passively, but with one production number today it mostly reports "insufficient sample". K01 can prove outbound carrier egress once Telnyx agrees. |
| Real-iPhone lanes and Loonext's own APNs wake path | **Accepted** as defect X21, unless an Apple membership already exists. The iOS Simulator lane was dropped too: it could not test wake, and the iOS app hard-codes production hosts. No customer runs an iOS build today, because `ship.yml` archives it unsigned. iOS keeps its CI unit tests. |
| Calendar test accounts | **Accepted** as defect X22. A Google partial path that needs no new account is offered in Phase 4. |
| A separate path to Telnyx's Verified level | **Accepted.** The shared account's level governs both production and the rig. |
| Separate Supabase, Resend, Sentry and Firebase tenancy | **Supabase:** replaced by the local stack, which is better isolated but less faithful. **Sentry and Resend:** mitigated with caps. **Firebase:** mitigated by package pinning. |
| Agents with production write keys in their shell | **Changed on purpose.** Production writes now wait for one tap each in the GitHub app. |

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
- **`production-ops`** holds write keys for `ops.yml`. That workflow runs a named `scripts/ops/*` command, such as a flag change, after you approve it with one tap.

**Read access stays prompt-free** for the agent user, because none of these can change anything:
- Sentry `agent-read`;
- `agent_diag`, which reads only non-personal views;
- `agent-logs-read`, read-only Workers logs for `loonext-api` and `loonext-web`;
- the guard's redacted `diag` class.

**Its GitHub login** is a fine-grained token without Administration, Deployments, Environments, Secrets or Variables permission (FA2). It therefore cannot approve a deployment or loosen a gate. You approve guard and ops runs from the GitHub mobile app.

**Two checks keep this true:**
- *scripts/check-local-secrets.mjs* (planned) runs at every agent session start and before every push. It refuses if any file under the checkout matches a live-secret shape: `sk_live_`, `rk_live_`, a Telnyx v2 key, `sb_secret_`, or a pooler URL with a password.
- *scripts/ops/audit-agent-reach.mjs* (planned) runs weekly from the agent user. It scans environment variables, the agent user's credential store, settings files and every env file in its clones for production-write material. It also probes GitHub endpoints that need Administration, Environments or Secrets permission, and expects 403 on each. Any finding raises `['ops','agent-reach']` in production Sentry. On the first guard deployment, the agent also calls the review endpoint with its own token and state "rejected", and must get 403. If it does not, that run is merely rejected and the token is fixed before you approve the re-run.

**Local defaults.** In the agent user's clone, `apps/api/.dev.vars` carries a fake Telnyx key, with `TELNYX_API_BASE` pointing at the e2e fake. Plain `wrangler dev` on the workstation therefore cannot reach real Telnyx.

### 3.2 The rig box

**Hardware and OS.** A dedicated mini-PC: 8 cores, 32 GB RAM, 1 TB NVMe, wired Ethernet. It runs Ubuntu 24.04 LTS with Docker Engine (open source, no Docker account) and native KVM.
- The BIOS powers it back on after a power loss.
- Unattended upgrades reboot it outside the dial window.

**Why not your workstation.** It holds your sessions, Windows Update reboots it, you use it daily, and it is paired with your personal phone.

**Network.**
- **Uplink:** Ethernet to your router's guest network, with client isolation. If the guest network is Wi-Fi only, a small travel router joins it and gives the rig an Ethernet port.
- **Phone network:** a USB Wi-Fi adapter runs a 5 GHz access point that only the Pixel joins. A USB Bluetooth adapter on a short extension cable carries the hands-free audio link, kept away from the Wi-Fi radios.
- **Firewall:** the phone can reach only the rig's web front and the internet. `tc netem` on the access point adds loss, delay and outages for bad-network tests.

**Name resolution.** This makes "cannot touch production" a property of the network:
- `api.rig.internal`, `app.rig.internal` and `db.rig.internal` resolve to the rig. `.internal` is reserved for private use.
- For the rig, the phone and the emulators, `loonext.com`, `supabase.co`, `pooler.supabase.com` and `api.supabase.com` resolve to nothing.
- On the rig host only, `api.telnyx.com`, `api.resend.com`, `oauth2.googleapis.com`, `fcm.googleapis.com` and `us.i.posthog.com` also resolve to nothing. Any code that skips the guard therefore fails closed, including old releases that predate the seams. The phone keeps its own route to Google's push service.

**TLS.** Caddy serves the `.rig.internal` names with a certificate authority generated on the rig and never committed. The Pixel's nonprod build trusts it for `*.rig.internal` only.

**Power control.** A USB hub with per-port power switching lets the agent power-cycle a stuck phone.

### 3.3 Loonext in rig mode

**Deploying a version.** `rig deploy --ref <tag|branch|sha>`:
1. creates a git worktree and installs dependencies;
2. migrates the local database, resetting and reseeding it if the ref's schema is older;
3. derives the configuration;
4. restarts the services.

Every verdict records the SHA it ran against.

**API.** `wrangler dev` runs with a gitignored `wrangler.rig.jsonc`, derived from that ref's `wrangler.jsonc`:
- no routes;
- crons emptied, because the rig fires them itself;
- the rate limiters kept, since they are emulated locally;
- the `ai` binding replaced by a local shim that forwards to the guard's capped AI path.

**Web.** The OpenNext build runs under wrangler, so it has the same shape as production. `next dev` is used for interactive debugging. `NEXT_PUBLIC_APP_ORIGIN` is unset, so every route stays on one origin.

**Local sign-in.** The production API accepts ES256 tokens only (`apps/api/src/auth/jwt.ts`). Local Supabase signs with HS256 unless it is given a key, and `supabase/config.toml` leaves `signing_keys_path` commented out.
- Bootstrap generates an ES256 key into a gitignored working folder, with a derived `config.toml` that points at it. The committed config is untouched.
- R00 checks that a seeded user's `/v1` call returns 200.
- Verify what the pinned Supabase CLI issues by default.

**Crons.** systemd timers fire each cron in that ref's config at its time, through `/cdn-cgi/handler/scheduled?cron=<expr>&time=<ms>`. That route is present in the repo's pinned wrangler 4.106.0 (checked 2026-10-29), with `/__scheduled` as the fallback. An agent can replay any cron at a chosen instant.

A cron registry, `tools/rig/crons.json`, classifies every cron as one of:
- **run**;
- **run, expecting a refusal**, with that refusal's fingerprint suppressed (for example 10DLC polls and porting reconciles, which the guard refuses);
- **skip**, with a reason.

CI checks the registry against each ref's `wrangler.jsonc`. R00 requires zero unexplained Sentry fingerprints over 24 hours, so a standing red cannot hide a new one.

**Stripe and auth mail.**
- `stripe listen --api-key <sandbox key> --forward-to https://api.rig.internal/webhooks/stripe`. It never uses `stripe login`, whose pairing expires after 90 days. R00 checks the listener is alive and that its signing secret matches.
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
- the sandbox Stripe key;
- the `loonext-rig` Sentry DSN, through the relay;
- `RIG_OWNED_E164`, generated from the guard's live listing and never committed;
- Turnstile test keys.

**Old versions.**
- **Web:** refs from before the Next 16 move cannot pass OpenNext's support-date check. The rig builds them with `--dangerouslyUseUnsupportedNextVersion`. That flag stays rejected for production, but the rig is never customer-facing.
- **Server:** refs older than Phase 0b run in `--pre-seam` mode. Telephony still goes through the guard, because old code already honours `TELNYX_API_BASE`. Email and push fail closed on the DNS block. Scenarios that need email or push are marked not runnable on those refs.

**Seed.**
- *scripts/rig/seed.mjs* (planned) targets only the database that `supabase status` reports.
- It creates the tenants with fixed rig-only company ids. These are random, generated once and kept in the rig's secret store; never the fixed id in `scripts/dev-seed.mjs`.
- It re-attaches the standing numbers and their messaging profiles by reading them from the guard.
- It sets each number's **ring audience** to the fewest surfaces the scenarios need. Scenarios that need more surfaces add them under the run lease, and the lease's undo removes them.

**Tenants.** All numbers use Ontario area codes, which avoids the 2026 Alberta time-zone rule change; R00 compares the tz versions of Node and Postgres.

| Tenant | Members and surfaces | Numbers and who they ring | Used for |
|---|---|---|---|
| QA-W | Owner and technician (Chromium on the rig). A note-level member and a two-factor member (API only, never ring). | DEV-W1 rings the owner only. DEV-W2 rings the owner and technician. | Browser calling, transfers, texting |
| QA-A | Technician (the Pixel). Dispatcher (rig Chrome; rings only when a scenario's lease adds it). Owner (API only). | DEV-A1 rings the Pixel by default. Inbound caller-name lookup is on. | Device lane |
| QA-C | Owner (Chromium); a member used for sign-out tests | DEV-C1, plus the monthly number | Calls between workspaces, caps, pause, billing, number buying |
| QA-E | Emulator member | DEV-E1, on its own messaging profile | Emulator lane, STOP and START |
| Robot | none | ROBOT-1, ROBOT-2, STRANGER-1 | Far end of everything. Only ROBOT-2 ever sends STOP. STRANGER-1 is owned but kept off the app's allowlist so G01 can prove the stranger gate. |

### 3.4 The edge relay, `loonext-rig-edge` (Cloudflare Worker on workers.dev)

The internet can reach only these paths; everything else returns an empty 404:
- **`/t/v`, `/t/v2` (failover), `/t/w`, `/t/m`, `/t/r`.** Telnyx webhooks for the nonprod voice app, the WebRTC connection, the messaging profiles and the robot.
- **`/t/n/<secret>`.** Account notifications. These may be unsigned, so the path carries a secret segment. Before halting anything, the edge corroborates a notice by reading notification events or the balance through the guard.
- **`/m/...`.** Telnyx fetches of MMS and greeting media. Only Supabase-signed URLs, only for those two buckets, at most 5 MB.
- **An `email()` handler** for the robot's address on loonext.com (named in the rig's private config, never in git) and its `+tag` sub-addresses. It never rejects mail. It stores it; if storage fails it still accepts and counts. It keeps a heartbeat.
- **`/g/*`.** Authenticated callers forwarded to the guard over a service binding, along with their caller class.
- **`/ctl/uplink`, `/ctl/rpc` and `/ctl/secrets`.** The rig's own outbound WebSocket, `rig` commands, and encrypted secret delivery. Each needs a bearer token.

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
   - **Call events** are relayed to the rig synchronously over a hibernating Durable Object WebSocket. The edge returns the rig's own status code within the app's 10-second webhook timeout, so Telnyx's retries and failover stay real.
   - **Text events** are acknowledged as soon as they are durably queued in the edge's Durable Object, because Telnyx expects a 2xx within 2 seconds. The edge then delivers them to the rig with its own retry, for up to 24 hours.

If the rig is offline, call events get a 503 and Telnyx retries.

**Hardening.**
- No path serves HTML or sets a cookie.
- Responses carry a sandbox CSP and `nosniff`.
- The edge refuses to serve on any loonext.com hostname.

**Dead-man.** A 15-minute cron checks three heartbeats: the rig's, the last suite run, and the last triage run.

**SSH.** Optional, Phase 4. An agent already gets a full shell on the rig through Remote Control (section 8). A raw SSH relay is added only if a tool needs one.

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
  - A run-lease header and room in the budget are required.
- **Messages.** `from` and `to` must both be owned, and the profile must be a nonprod profile.
- **Provisioning (an explicit list):**
  - telephony credentials only on `nonprod-webrtc` and `nonprod-sentinel`;
  - number search at most once every 10 seconds, only under the S28 lease;
  - at most one order per 25 days and at most 10 numbers held. Each order body must carry the nonprod group, profile and connection. The first order is read back to confirm the group stuck; if it did not, the number is released and ordering stops.
  - PATCH or DELETE only on owned numbers that are not standing numbers. One exception, **detach**: it clears a standing number's connection and messaging profile when strangers flood it.
  - Messaging profiles must carry a daily limit of $0.06 or less, a US/CA whitelist, an edge webhook and the nonprod group.
- **Refused outright:**
  - 10DLC, porting, verification codes and hosted SMS;
  - managed accounts, API keys and auto-recharge;
  - any write to profiles, apps, connections or notification settings outside the setup routine.

**Keeping the policy in step with the code.** The policy is generated from a Telnyx endpoint registry. CI fails any product PR that introduces a Telnyx endpoint outside the existing classes, so a needed guard change rides the same release. Guard approvals per month are tracked, with a target of one or fewer.

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
- **Room.** Room is the account's concurrent limit (from FA0) minus production's reserve. Production's reserve is its largest ring audience plus 1, read daily from production counts. The nonprod voice profiles' concurrent limits are set to the room, and the guard's own live-leg count enforces it as well. If the active-calls API exists (verify), the guard polls production's active calls every 2 seconds during a paid run and hangs up every test leg on the first production call. That run is recorded as "preempted", not failed.
- **Window.** Paid dials run only in the six consecutive UTC hours with the fewest production calls over the past 28 days, rechecked monthly. Until there is data, the window is 04:00-10:00 UTC; it is safe because the room already reserves production's ring.
- **Ratios.** The guard keeps the whole account's abandoned share at or below 15% and short-call share at or below 10%, using counts from detail records.
- **Money.** Telnyx-enforced daily limits; the $35/month all-in cap, with a daily allowance after reserving next month's rental; tiers: green, amber (core only), red (only hang-ups allowed). Below the balance floor, all test spend is refused. At the cap, every non-robot number is detached, so stranger inbound stops too.

**Run lease.** One paid scenario runs at a time across the system. Scenarios register undo actions with `rigd`, the rig's service daemon. If the lease is not released within 15 minutes, `rigd` runs the undo itself.

**Safety checks.**
- **At start-up**, the guard refuses to serve if any nonprod resource points at `api.loonext.com`, if any nonprod id overlaps a production id, or if any nonprod number is bound to a production connection.
- **Ordering** stays off until production's `/health` lists `telnyx-partition-v1` and FA0 has returned the concurrent limit.
- **Hourly version attestation.** `rigd` reads the guard's live version id with `guard-attest-read`, and compares it with the last guard deployment you approved. A mismatch raises `['ops','telnyx-guard-integrity']`.
- **Weekly key inventory.** Any unexpected Telnyx key raises `['ops','telnyx-key-inventory']`.
- **Daily negative probes** run in G01.

**Account signals.** A Telnyx notification channel posts to `/t/n/<secret>` for Suspicious Outbound Voice Traffic, Account Disabled, Low Balance, Messaging Suspicious Traffic, and the Abandoned and Short-duration call notices. None exist today.
- Any corroborated signal halts paid tests for 7 days and raises `['ops','telnyx-account-signal']`.
- A second signal within 30 days keeps the paid lanes off until the design changes.

### 3.6 The Telnyx partition (inside the existing account)

The guard's setup routine creates everything from a committed spec, `tools/guard/telnyx-spec.json`, which holds names and values only, never ids.

| Resource | Settings |
|---|---|
| Billing group `loonext-nonprod` | The ownership marker on every rig number and profile |
| Outbound voice profile `nonprod-voice-ovp` | Daily spend limit $0.40, reset at 00:00 UTC. Concurrent limit set to the room minus the robot's share. Maximum rate $0.01/min. US/CA whitelist. At most 20 calls per destination per calling window. |
| Outbound voice profile `nonprod-robot-ovp` | Daily spend limit $0.20; concurrent limit 1 |
| Call Control app `nonprod-voice` | Webhook `/t/v`, failover `/t/v2`, webhook timeout 10 s, RTCP capture on if offered, channel limits matching the room |
| Call Control app `nonprod-robot` | Webhook `/t/r`; channel limit 1 |
| Credential connection `nonprod-webrtc` | SIP URI calling set to internal. Webhook `/t/w`. **No outbound voice profile**, so an app credential cannot call a phone number. No push credential. |
| Credential connection `nonprod-sentinel` | One credential, no numbers, no outbound voice profile. Used only by G02. |
| Messaging profiles | `nonprod-robot` at $0.06 a day, plus four tenant profiles at $0.03 a day each (Telnyx refuses sends above the limit with HTTP 429 code 40333). US/CA whitelist, nonprod group. At most six profiles. |
| Numbers | Eight Canadian local numbers with Ontario area codes: ROBOT-1, ROBOT-2, STRANGER-1, DEV-W1, DEV-W2, DEV-A1, DEV-C1, DEV-E1. Plus one bought and released each month by S28. Each is ordered with the group, connection and profile in the order body. |

**Vendor-enforced daily maximum:** $0.40 + $0.20 + $0.06 + 4 × $0.03 = **$0.78**. That is about $24 in a 31-day month, about $35.50 with rentals, so Telnyx itself holds the cap even if the guard is wrong. Inbound legs and texts are not limited by these profiles; the edge's stranger rejection and the guard's detach bound them.

**Why Canadian numbers.** Production's only number is Canadian, and Canadian inventory was reservable on 2026-10-29. The app needs no registration for Canada-bound texts, and every test text stays on-net anyway.

**Fallbacks.**
- **If Canadian ordering is refused,** US numbers are used. QA-W then gets a seeded "approved registration" row, which is named in `docs/RIG.md`. The guard still keeps every text on-net.
- **If billing groups are not honoured on orders,** ordering stops. A fallback ownership marker (the nonprod messaging profile and connection pair, both set in the order body) ships to production first.

**10DLC and STOP.**
- No 10DLC brand or campaign is ever created. Production has no brand to reuse, and a customer's campaign would send under that customer's name.
- Opt-out blocks apply per messaging profile (developers.telnyx.com advanced opt-in/out, checked 2026-10-29). DEV-E1 therefore has its own profile, and a STOP is lifted only by ROBOT-2, the side we control, sending START.

### 3.7 Production changes (through release-please)

**Phase 0a: a small release, first.**
1. **Ownership rule.** A new *apps/api/src/telnyx/ownership.ts* (planned) provides `ownsTelnyxNumber(env, number)`.
   - With `TELNYX_BILLING_GROUP_ID` set, an environment owns only numbers in that group. With it unset, as in production, it owns only numbers with no group.
   - It is checked before both the warning and the DELETE in `reconcileNumbers`, in `adoptOrphanNumber`, and as a GET-then-check before `releaseNumberRow` deletes anything.
   - Foreign numbers are counted, never flagged and never deleted.
   - A foreign number whose customer reference names a production company raises `['ops','telnyx-ownership-mismatch']`, so a production number that ever gains a group is caught instead of silently orphaned.
   - Number orders carry `billing_group_id` when the variable is set.
   - `docs/deploy/04-telnyx.md` gains a rule: production numbers never carry a billing group.
2. **Capability flag.** `/health` returns `capabilities: ['telnyx-partition-v1']`. Today it returns only `{ ok: true }` (`apps/api/src/index.ts`, checked 2026-10-30).
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
   - Only `src/environments/` may read the variable (*scripts/check-deploy-env-branches.mjs* (planned)), and it may only add restrictions. In rig mode it adds:
     - an outbound destination gate, plus a call-site test that fails if any send or dial site skips it, or if it finds zero sites;
     - an inbound gate that rejects any non-allowlisted caller or texter before ring, voicemail, transcription or text-back;
     - refusal of live Stripe keys and live events;
     - refusal of any Supabase host outside `*.rig.internal` or loopback;
     - customer webhooks delivered to the robot only.
   - The one rig-only route is `POST /v1/rig/simulate-incoming`, for D02p. Its synthetic sessions refuse ring-me before Telnyx, so D02p never dials. A test proves production's route table lacks it, and another asserts zero guard dials per D02p run.
   - Production refuses `TELNYX_API_BASE`, and Sentry's environment comes from `DEPLOY_ENV`.
3. **SQL destination gate.** `gate_outbound_send`, `api_claim_outbound_line` and the greeting-capture claim refuse non-endpoint destinations when the database setting `loonext.deploy_env` is `rig`. That setting exists only on the rig's local database. A SQL test proves production is unchanged.
4. **Repro evidence.**
   - The `push_attempts` ledger: provider response class, priority and latency, kept 14 days, registered in the four add-a-table guards.
   - Ring beacons from the web, Android and iOS apps (the iOS code compiles in CI): stage events plus app, OS, permission and standby state, nothing personal.
   - `ops_diag` views, including hourly call counts and ring-audience sizes.
   - The `agent_diag` role, with an SQL test proving it cannot read messages, contacts, numbers or payloads.
   - *scripts/ops/call-trace.mjs* (planned).
   - P01 and PW01 (section 3.11).
5. **Hermetic call journeys.** The fake Telnyx gains dialing and telephony credentials, and `CALL_SESSIONS` is bound. Inbound, outbound, voicemail and transfer journeys run on every push. They also emit each scenario's dial count and peak concurrent legs, which feed the budget check in section 4.1. A trace-to-fixture tool renumbers real traces into the fictional 555-01xx range.
6. **Android `nonprod` build type**, created with `initWith(release)`:
   - minified, with the `.nonprod` suffix, and signed with a stable key held on the rig;
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
| Pixel | 2,300 Hz |
| Emulator | 2,750 Hz |

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

### 3.9 Browser, Pixel and emulator lanes

**Browsers** (on the rig).
- Chromium runs the call lanes. Google Chrome stable, headed under a virtual display, runs Web Push.
- Each member has its own browser profile.
- The fake microphone plays the member's code: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture` (chromium `media_switches.cc`, checked 2026-10-29).
- A test-only script attaches the remote stream to a muted audio element and judges it in the page. Without that, Chrome hands analysis code silence (crbug 933677).
- `getStats` supplies audio level, energy and concealed samples.
- `--host-resolver-rules` blocks `*.loonext.com` and `*.supabase.co`.

**Pixel** (a used 8a or 9a).
- **Purchase:** unlocked, bought from a retailer with Factory Reset Protection cleared. Wi-Fi only, no SIM, no Google account.
- **App:** runs the `.nonprod` release-style build, built on the rig from any ref. `rigd` refuses any APK whose package is not `.nonprod`.
- **Control:** adb over USB, UIAutomator and mobile-mcp. The adb key is backed up in the rig's secret store.
- **States the agent can create:**
  - killed with `am kill` (force-stop is a separate case, because FCM drops messages to force-stopped apps);
  - forced Doze;
  - standby buckets and battery saver;
  - locked, with a PIN the agent types;
  - rebooted.
- **Updates:** Google's full OTA images, applied monthly over adb (`adb reboot sideload-auto-reboot`). These refresh the preinstalled Google Play services; R00 compares that version with the app's minimum.
- **Developer verification (2027):** verify that adb installs stay exempt. If not, new builds run on emulators only. No new account is created.

**Pixel audio.** The rig acts as the Pixel's Bluetooth hands-free unit (PipeWire `hfp_hf`). It plays the Pixel's code into the uplink and records the downlink. Android forbids software capture of voice-call audio (developer.android.com, AudioAttributes, checked 2026-10-29).
- The Bluetooth spike is a **purchase gate**.
- If it fails, the fallback is a second Android phone with a 3.5 mm headset jack (several current Moto G models have one; confirm at purchase), wired to a USB sound card. Its USB-C port stays free for adb and power. The Pixel stays for wake verdicts.
- A USB-C audio adapter on the Pixel is never used: it takes the only port and ends USB adb, and wireless adb does not survive a reboot unattended.

**Emulators.** Three AVDs with Google Play images (API 34, 35 and 36) run headless on KVM, with virtual audio devices.
- FCM works on them without a signed-in account (firebase.google.com Android client docs, checked 2026-10-29).
- Variants that could teach FCM to deprioritise pushes run here only: notifications revoked, and force-stopped.

**No iOS lane.** Section 2.3 explains why.

### 3.10 Scheduler, reporting, triage, dead-man

**Scheduler.** `rigd` uses systemd timers, all in UTC. Paid dials run only inside the measured window. Texts and push-only checks run at any time.

**Reporting.**
- A failing scenario is retried once.
- If it fails again, one event goes through the relay, by DSN only, to `loonext-synthetic`, fingerprinted `['synthetic', scenario, failure_class]`.
- Infrastructure faults use `['synthetic-infra', component]`, so one dead phone is one issue.
- Noise limits: at most 50 events per run; a repeated fingerprint is suppressed for 6 hours; the project auto-resolves an issue after 24 hours without events.
- No Sentry write token exists anywhere.
- Each run posts an informational `synthetic/full-matrix` commit status through the rig's GitHub App.

**Triage.** An hourly Claude cloud scheduled task, `synthetic-triage`, drives the rig through `/ctl/rpc`:
1. reads unresolved failures from the rig's verdict store;
2. re-runs the scenario;
3. attaches evidence;
4. opens or updates one issue labelled `synthetic` through the rig App.

Issue numbers stay out of commit trailers. A revoked rig sign-in never stops triage.

**Rig-authored code.** The rig App can open branches and pull requests; a ruleset keeps it off `main`. Workstation agents never auto-merge a rig-authored PR. They review the diff as untrusted input and re-run the checks themselves first.

**Dead-man.**
- If a heartbeat is stale, the edge sends `['synthetic-infra', component]` to `loonext-synthetic`.
- If the whole system is dark for more than 6 hours, it sends `['ops','synthetic-dark']` to production.

**What reaches you.** You hear about the test system only when:
- it is dark;
- isolation is at risk (G01, G02, guard integrity, key inventory, agent reach);
- the Telnyx account or balance needs attention.

Product regressions go to agents as GitHub issues.

### 3.11 Production watches

**P01 (ring success, hourly, in production).**
- Ring success per platform and app version: the share of push attempts that reach "ringing shown" within 15 seconds, and the share of answered sessions with media.
- Every result reports its sample size **n**. Below 30 push attempts per platform and version in the window, it reports "insufficient sample", never "pass".
- It alerts `['ops','ring-success-<platform>']` when a sufficient sample drops below the trailing baseline.
- Only non-personal aggregates are used.
- With one production number today, it will mostly say "insufficient sample". It is the only real-carrier, real-device signal possible without a SIM, and it grows with the customer base.

**PW01 (wiring check, daily, read-only, no number).** Through the guard's `diag` class:
- read production's Call Control app, credential connection and messaging profile settings, and confirm the webhook and failover URLs equal the expected production values;
- read production's webhook deliveries for the last 24 hours, and alert on any failed delivery.

This catches portal and webhook drift without a dial or any exception to the guard's policy.

### 3.12 One call, end to end (S02)

1. The robot asks the guard, through the edge, to dial DEV-W1 from ROBOT-1. The guard checks the lease, budget, room, window and ownership, then dials.
2. Telnyx sends `call.initiated` for `nonprod-voice` to the edge's `/t/v`. The edge verifies the signature, sees a nonprod connection and an owned caller, registers the call and relays the event to the rig.
3. The local API's Durable Object claims the line and asks the guard to dial one ring leg, to the QA-W owner's SIP username on `nonprod-webrtc`.
4. The owner's Chromium page rings and Playwright answers. Media flows through Telnyx.
5. After hang-up:
   - the robot judges its recording for the owner's 1,300 Hz code;
   - the page has already judged the robot's 1,100 Hz code;
   - the rig checks the call row and the sandbox meter.
6. The verdict is stored with the SHA. A second failure becomes one Sentry event, and triage picks it up within the hour.

---

## 4. Test matrix

### 4.1 Budget, concurrency and window

**Dials, not calls.** Telnyx limits count dials, and ring legs, transfers and ring-me legs are dials too. Each scenario's dials and peak concurrent outbound legs are taken from the hermetic journeys. The numbers below are the planning estimates.

**Budget rule, checked in CI.** Scheduled dials times their frequency, plus a 20% retry reserve, plus a 60-dial monthly repro reserve, must fit the daily cap times 30.

**Default cap**, until Telnyx states the limits in writing:
- 18 dials a day and 3 an hour;
- about 400 scheduled dials a month;
- about 300 texts a month.

**Room** = the account's concurrent limit minus production's reserve (section 3.5). It decides which call scenarios may run at all.

| Room | What runs | What is lost |
|---|---|---|
| 4 or more | Everything | Nothing |
| 3 | Everything except D01 and S10 | Ringing every surface at once; X-to-Y calls in one workspace |
| 2 | Single-surface calls only (S01, S02, S04-S06, S11-S17, S24, S28, D07, D08), plus D02p, which needs no dial | Every paid Android wake test (D02-D04, D09-D12, E01), transfers and consults |
| 1 or less | No paid calls. Texts, D02p, hermetic and local tests continue. | All paid call lanes |

R00 publishes the room and the scenarios it blocks. FA0 asks Telnyx to raise the limit if the room is under 4. A room under 3 would also mean production cannot ring a three-person crew, which is itself a production finding.

**After Telnyx answers**, test traffic may use up to 25% of each stated limit, through an approved guard configuration deploy. The core then runs twice inside each day's window.

### 4.2 Scenarios

"Pages" means the browser pages on the rig. **Pass** lists every condition the agent checks with no human. The last column is how often the scheduled run exercises it, with dials per run.

| ID | Scenario | Far end | How the agent verifies it, with no human | How often (dials) |
|---|---|---|---|---|
| R00 | Rig health | none | **Pass:** services answer; local sign-in returns 200; the Pixel is reachable, unlocked and Bluetooth-paired, and its Play services version meets the app's minimum; emulators boot; the guard is healthy and above the balance floor; the edge uplink is up; the nonprod apps point at the edge; the Stripe listener is alive; tz versions match; zero unexplained Sentry fingerprints in 24 h. **Also publishes:** the current room. | Every 15 min (0) |
| H01 | Hermetic suite, including the call journeys | Fake Telnyx and Stripe | **Pass:** the CI status, watched after every push. | Every push (0) |
| G01 | Isolation self-test | A fictional 555-01xx number; STRANGER-1 | **Pass:** the app refuses a send and a dial to 555-01xx before Telnyx (guard log empty). STRANGER-1's call to DEV-W1 is rejected before any ring leg, row or voicemail, and its text is not threaded. The guard returns 403 to a dial on production's connection, a text from a number outside the group, and a dial to a non-owned number. **Any success:** critical alert in production. | Daily (1) |
| G02 | Calls the apps' SDK places itself | The sentinel credential, held by a test page on the rig | **Pass:** the browser SDK and the Pixel's SDK, both signed in on `nonprod-webrtc`, each try a direct call to the sentinel; both are refused and the sentinel never rings. **If it rings:** alert, and residual X25 applies. | Weekly (1) |
| P01 | Production ring-success watch | Real customers' calls | **Pass:** a sufficient sample at or above baseline. **Below 30 attempts:** "insufficient sample", never pass. **Drop:** alert. | Hourly, in production (0) |
| PW01 | Production wiring check | Production's own settings | **Pass:** webhook and failover URLs on production's app, connection and profiles equal the expected values, and there are no failed deliveries in 24 h. | Daily (0) |
| S01 | Browser calls a phone number (on-net) | ROBOT-1 answers after 4 s | **Pass:** ringback energy before answer; the page hears 1,100 Hz and the robot hears 1,300 Hz; caller ID is DEV-W1; the one-time token is used once; the row is answered; a voice-seconds meter event lands in the sandbox. | Every 3 days (2) |
| S02 | Phone number calls Loonext, answered in the browser | ROBOT-1 dials DEV-W1 | **Pass:** ring dialog and SDK ringing within 6 s; both codes heard; row answered; billed seconds equal the meter. | Every 2 days (2) |
| S03 | Loonext calls Loonext across workspaces | QA-C page dials DEV-W1 | **Pass:** the QA-W owner rings and answers; each side hears the other's code; two rows with distinct session keys, each billed to its own workspace; no text-back. **Recorded, not judged:** how Telnyx routed and billed the call, for the FA0 follow-up. | Weekly (3) |
| S04 | Unanswered call: voicemail, transcript, intake, webhook, text-back | ROBOT-1 speaks after the beep | **Pass:** voicemail stored locally, and the Telnyx copy returns 404; transcript word error 0.25 or lower; intake row; signed `voicemail.received` at the robot sink; text-back at ROBOT-1 within 60 s. | Every 3 days (2) |
| S05 | Caller hangs up while ringing | ROBOT-1 hangs up at 8 s | **Pass:** call missed; text-back sent; crew push recorded; escalation widens after 10 min (cron fired by the rig). | Fortnightly (2) |
| S06 | Hold, mute, keypad | ROBOT-1 | **Pass:** the member's code is absent from the robot's recording during hold and mute and returns within 2 s; digits 1-2-3-# arrive in order. | Fortnightly (2) |
| S07 | Blind transfer; decline, timeout and hop-cap variants | ROBOT-1 to DEV-W2 | **Pass:** the robot's heard code switches from 1,300 to 1,700 Hz, and the transfer is recorded. **Variants:** decline and timeout snap back; the hop cap reaches voicemail. | Weekly; variants monthly (4) |
| S08 | Consult transfer, inbound and outbound (the first live test of outbound transfer) | ROBOT-1 | **Pass:** during the consult the robot hears no member while the pages hear each other; after completion the robot hears the target and the sender's leg ends. | Weekly, alternating direction (4) |
| S09 | Busy line, second caller, self-dial | ROBOT-1, ROBOT-2 | **Pass:** the second caller reaches voicemail within 8 s; "This line is on another call" is shown, with no dial; a self-dial reaches voicemail. | Monthly (5) |
| S10 | Number X calls number Y in one workspace; call waiting | DEV-W1 to DEV-W2 | **Pass:** the crew rings; call-waiting is shown; codes are exchanged. | Monthly (4) |
| S11 | After-hours, on-call, in-turn, ring length | ROBOT-1 | **Setup:** hours seeded relative to now, under the lease. **Pass:** only the on-call page rings, and the other stays idle for 15 s; voicemail starts at the configured length, plus or minus 2 s. | Weekly (2) |
| S12 | Voice and dial-count caps (QA-C) | ROBOT-1 | **Setup:** usage seeded to production's cap values, never lowered. **Pass:** inbound ends busy and the text-back still arrives; outbound gets 402 with no dial. | Fortnightly (1) |
| S13 | Paused, suspended or released number receives a call | ROBOT-1 | **Pass:** no ring legs; the "line is down" notice is transcribed, or the call rings out according to the notice cap; a released number is dropped within 5 s. | Fortnightly (2) |
| S14 | Kill switches (local flags only) | ROBOT-1 | **Pass:** `kill:calls` blocks new calls while a live call's codes continue; `kill:outbound-send` refuses before the guard; `kill:ai` stops transcripts; every flag is reset afterwards. | Fortnightly (2) |
| S15 | Greeting-capture call | ROBOT-2, seeded as the owner's mobile | **Pass:** the robot hears the prompt and speaks after the beep; the greeting's transcript matches. | Monthly (1) |
| S16 | Note-level member; signing a device out revokes voice for the person (D130) | ROBOT-1 | **Pass:** the note-level member never rings, and its dial attempt gets 403; after sign-out, token minting gets 403. **Afterwards:** restored. | Fortnightly (2) |
| S17 | Webhook failover and duplicate delivery | The edge returns 503 once | **Pass:** webhook deliveries (read through the guard) show the failure, then a failover success; the event is processed once. | Monthly (3) |
| S20 | Outbound text | ROBOT-1 | **Pass:** exact body within 30 s; status goes sent, then delivered; usage row and sandbox meter event; `message.sent` webhook at the sink. | Daily (0) |
| S21 | Inbound text | ROBOT-1 to DEV-W1 | **Pass:** threaded once within 15 s; realtime update in the page; a push-attempt row. | Daily (0) |
| S22 | Picture messages both ways | ROBOT-1 | **Outbound pass:** the media hash matches, so Telnyx fetched it through the edge. **Inbound pass:** stored with GPS EXIF stripped and a scan verdict. | Weekly (0) |
| S23 | Loonext texts Loonext | DEV-W1 and DEV-E1 | **Pass:** both thread; no 40007 loop error. | Weekly (0) |
| S24 | STOP, START, HELP, ARRET, AIDE, plain-English opt-out | ROBOT-2 to DEV-E1 only | **Pass:** the opt-out is recorded; the next send is refused before the guard; a call to ROBOT-2 still connects (D38); the plain-English request is only flagged. **Cleanup:** the undo has ROBOT-2 send START. A STOP left in place after cleanup is critical. | Weekly (2) |
| S25 | Automated texts and quiet hours | ROBOT-1 | **Pass:** away reply, scheduled send, reminder, emergency acknowledgement and help reply arrive at the daytime run and are held at the night run (destination clock). | Weekly, two runs (0) |
| S26 | Messaging caps and budgets | Seeded rows, at most 2 real sends | **Pass:** each refusal carries its gate's own error; the 80% carrier-ceiling alert lands in `loonext-rig`. | Weekly (0) |
| S27 | Website widget code | ROBOT-1 | **Pass:** the always-pass Turnstile key passes and the always-block key is refused; the code reaches ROBOT-1; the budget is decremented. | Weekly (0) |
| S28 | Number buy, bind, call, release | ROBOT-1 calls the new number | **Pass:** one search and one order, carrying group, profile and connection; the first-order group check passes; the number rings; after release it returns 404; no other number is touched; no production Sentry event mentions it. | Monthly (2) |
| S29 | Cancel, grace, release, billing | Stripe sandbox | **Setup:** under the lease, the seed backdates the workspace's `canceled_at` to 31 days ago and fires the grace cron. Grace runs on the database clock (`apps/api/src/billing/grace.ts`), not Stripe's. **Pass:** the number is released and the workspace moves through grace as specified. **Separately:** a seed-created customer on a Stripe test clock checks invoice and meter totals against the month's usage; the clock is deleted after. | Monthly (0) |
| S31 | Lou reply drafts and AI caps | A synthetic thread | **Pass:** a draft comes back through the guard; an AI cap row is written; a request seeded at the cap is refused. | Weekly (0) |
| S32 | Onboarding, Checkout with the 4242 test card, customer portal | Stripe sandbox | **Pass:** subscription active; portal opens. **Verify:** Checkout shows no challenge to a headless browser. | Weekly (0) |
| S33 | Two-factor login | none | **Pass:** with a TOTP code from the rig's store, the session reaches the second assurance level and the API accepts it. | Weekly (0) |
| S34 | Emails | Robot mailbox; Mailpit | **Pass:** API mail (an invite and a missed-call alert) arrives at the robot mailbox through Resend and Email Routing, with working links; auth mail is read from Mailpit and its link works. | Weekly (0) |
| S35 | Public sign-up form | Mailpit | **Pass:** sign up, confirm by email, reach the app. | Weekly (0) |
| D01 | Inbound call rings every rig surface; the answering surface rotates | ROBOT-1 to DEV-A1, dispatcher added under the lease | **Pass:** within 8 s the page dialog shows, and the Pixel shows Telecom RINGING plus the full-screen notification. The robot identifies the answerer by code; the other clears within 3 s; one database winner. | Weekly (4) |
| D02 | Android wake: app killed, forced Doze, locked with a PIN | ROBOT-1 to DEV-A1 | **Pass:** FCM accepted the push at high priority for the nonprod package; beacon stages arrive in order; Telecom shows RINGING within 12 s; UIAutomator answers on the lock screen; the rig hears 1,100 Hz and the robot hears 2,300 Hz. | Daily (3) |
| D02p | Android wake with no call | none | **Pass:** a real FCM call push for a synthetic session is accepted, received, reported to Telecom, and shown ringing within 12 s; ring-me is refused before Telnyx; the guard logs zero dials. | 4 times a day (0) |
| D03 | Natural Doze | ROBOT-1 | **Setup:** screen off, battery unplugged in software; wait for deep idle. **Then:** as D02. Never reaching deep idle is an infrastructure result. | Weekly (3) |
| D04 | Android variants: standby buckets, battery saver, secure lock, before first unlock, app hibernation | ROBOT-1 | **Pass:** one variant per run, judged against an expectations file. | Fortnightly, rotating (3) |
| D07 | Android app calls out | ROBOT-1 answers | **Pass:** codes heard both ways; caller ID is DEV-A1. | Fortnightly (2) |
| D08 | Background tab and Web Push | ROBOT-1, dispatcher-only audience under the lease | **Pass:** Chrome shows the ring notification within 10 s, replaced by the outcome after hang-up. | Fortnightly (2) |
| D09 | First-answer race | ROBOT-1 | **Pass:** the Pixel and a page answer within 300 ms of each other; the robot hears exactly one code; one winner; the loser shows "answered elsewhere". | Fortnightly (3) |
| D10, D12 | Fresh install; upgrade from the previous release | ROBOT-1 | **Pass:** after install, or after an upgrade from the signed-in previous build, the push token is stored, then D02p and D02 pass. | Weekly, alternating (3) |
| D11 | Unattended recovery | none | **Setup:** reboot the Pixel, power-cycle its port, restart the emulators. **Pass:** health green within 10 min and D02p passes. | Weekly (0) |
| D13 | Bad network and a mid-call Wi-Fi drop | ROBOT-1 | **Setup:** loss and delay, then a 3 s outage. **Pass:** the call survives; codes resume within 5 s; concealed samples stay under 5% outside the outage. | Monthly (2) |
| D14 | In-app voicemail and MMS playback | none | **Pass:** the rig captures the Pixel's media audio over Bluetooth and its transcript matches S04's phrase. | Weekly (0) |
| E01 | Emulator wake, rotating through API 34, 35 and 36 | ROBOT-1 to DEV-E1 | **Pass:** as D02. At least one API level a week must also pass the audio verdict, or the lane raises "emulator-audio-degraded". **Weekly variants:** notifications revoked, and force-stopped; both must NOT ring. | Every 3 days (3) |
| K01 | Outbound carrier egress (optional, Phase 4) | A public echo-test line | **Pass:** the robot hears its own code echoed back with a 0.1-1.5 s delay. **Any other answer:** hang up within 3 s, and the line is removed permanently. | Weekly (1) |

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
| X17 | Wi-Fi to cellular handover; a cellular call interrupting a Loonext call | The Pixel has no SIM | A data SIM |
| X21 | Any iOS device or Simulator test: PushKit and CallKit wake, APNs, lock-screen answer, call audio | No Apple membership is assumed, and the free tier has no Push Notifications capability (developer.apple.com supported-capabilities-ios, parsed 2026-10-30). The iOS app hard-codes production hosts. | An existing membership turns on the separate-accounts iPhone lane. iOS keeps its CI unit tests. |
| X22 | Calendar consent, refresh revocation, and all of Microsoft | No test identities can be created | Phase 4 offers a Google partial: a service account in the existing project owns its own calendar, and a token-URL seam lets the guard hand the app service-account tokens. That covers the Google API, the sync worker and push channels (verify the push-channel domain rule). |
| X23 | Hosted behaviour: Durable Object eviction under load, CPU limits, hosted Supabase auth settings, Realtime at scale, OpenNext on real Workers | The rig is local | Partly covered by P01, PW01 and the hermetic workerd Durable Object test |
| X24 | Supabase Auth mail over Resend SMTP; Resend bounce and complaint webhooks | Auth mail stays in Mailpit. Resend webhooks are team-wide and would carry production events. | Stays hermetic |
| X25 | A rig credential's SDK ringing another internal credential directly | Only if G02 shows the SDK path is open | Ask Telnyx (FA0) to disable outbound SIP URI calls per connection. Production SIP usernames are never in any rig context. |
| X26 | Telnyx portal-only tools: SIP call flow, PCAP, QoS graphs, push debugging | No API exists for them | The robot's own RTP statistics, plus session analysis and call events read through the guard, substitute |
| X1 | A genuine Telnyx "flagged" screening verdict | Telnyx decides it | Recorded payloads cover our handling |
| X2 | Real port-in and port-out | Needs a legal signature; port-out loses the number | Not recommended |
| X3 | Hosted-SMS text-enablement; the sole-proprietor code | Needs a number elsewhere, plus paperwork each time | None |
| X4 | Live 10DLC reviews | No sandbox for them (D31) | Hermetic golden-us |
| X6 | Wake and audio on non-Pixel Android | One Pixel | A used Samsung on the hub, about $150 (estimate) |
| X7 | Firefox Web Push quota | Not automated | None |
| X8 | A third incoming call auto-declining | Needs a third QA-W number | One more number, $1.10/month |
| X9 | A text stuck "queued" for 15 minutes | Fault injection | Stays hermetic |
| X12 | Safari softphone | No Safari on Linux | A Mac (out of scope) |
| X13 | Google and Apple sign-in | Consent screens and bot checks | Stays hermetic |
| X14 | Passkey enrolment | Real authenticator; the relying-party id is app.loonext.com | A virtual authenticator, web only |
| X15 | Real Turnstile | Blocks automation by design | Test keys, kept honest by the always-block check |
| X16 | Speaker and earpiece audio routes | The rig hears only the Bluetooth or wired route | None |

---

## 5. Everything that expires, and what renews it

| Credential or device state | Lifetime | Automatic renewal or check |
|---|---|---|
| Telnyx key `nonprod-guard` | No expiry | Guard health every 15 minutes; weekly key inventory |
| Cloudflare tokens (`rig-deploy`, `guard-deploy`, `guard-attest-read`, `production-deploy`, `agent-logs-read`) | No expiry | Deploy health; hourly attestation; the weekly reach audit |
| GitHub App key | No expiry | Installation tokens last 1 hour and are minted per use |
| Fine-grained token for the agent Windows user | No expiry, unless the org forces one | If forced, renewing it is a 5-minute act once a year; the reach audit warns 14 days ahead. This affects development, not rig operation. |
| Stripe sandbox key; Resend sending key; Sentry DSNs; Sentry `agent-read`; `agent_diag` password | No expiry | Used daily; failures surface in R00 or the reach audit |
| FCM service-account key | No expiry, unless an org policy sets one | Checked at FA6; a daily dry-run send detects failure |
| Edge, guard and robot caller tokens; rig certificate authority (10 years); rig ES256 signing key; VAPID keys; Android nonprod keystore (25 years) | No practical expiry | Rotated only after an incident |
| `stripe listen` | Uses the sandbox key directly; no 90-day login | R00 checks it |
| Claude sign-in on the rig | Refreshes; Anthropic can revoke it | The dead-man notices. Scheduled runs and cloud triage continue. Re-login is a named conditional act. |
| Claude cloud scheduled task | Research preview | The dead-man flags a missing triage heartbeat |
| Remote Control in the agent Windows user | Session-based | A scheduled task restarts it at boot |
| Telnyx balance and rentals | Spends down; monthly | Production's existing chore. The floor stops test spending first, the $150 alert warns, and the ledger reserves next month's rental. |
| Telnyx evidence windows (call status 10 minutes after hang-up; call events 24 hours; SIP flow tool 3 days) | Short | The robot stores ids and RTP statistics at test time |
| Stripe test clocks | Per run | Created and deleted by each run |
| Local Supabase | Never pauses | none needed |
| Rig disk | Fills | Nightly purge of synthetic media, plus webhook rows older than 7 days; alert at 70% |
| adb authorisation | 7 days by default | "Disable adb authorization timeout" set once; the adb key is backed up |
| Android auto-revoke of permissions | Months | Set to ignore at baseline; D04 tests hibernation on purpose |
| Play Protect checks of adb installs; developer verification | Ongoing; changes due 2027 | Off at baseline. Verify the adb exemption; otherwise emulators only for new builds. |
| Google Play services on the Pixel | Ages without a Google account | Monthly full OTA over adb; R00 compares the version with the app's minimum |
| FCM deprioritisation | Builds up over 7 days | Risky variants run on emulators only; a falling D02p receive rate raises an infrastructure alert |
| Android OS updates | Monthly | Auto-update off; the agent applies them in a monthly window and re-applies settings |
| Pixel reboot | Any time | `rigd` unlocks with the PIN, re-applies settings and re-pairs Bluetooth |
| Pixel sign-in | Can be lost | The local stack uses Turnstile test keys, so `rigd` signs in again with no human |
| Pixel battery | Years | 80% charge limit (support.google.com/pixelphone/answer/6090612). Replacement every 2-3 years is a named physical act. |
| Android SDK packages | Pinned | Upgrading means accepting a new licence: a named founder act, about once a year |
| Rig OS | Weekly updates | Unattended upgrades, rebooting outside the window |

---

## 6. Isolation guarantees and the mechanism behind each

1. **Agents cannot reach production write power or approve the gates.**
   - They run only in a separate Windows user, with no console sessions, no Claude in Chrome and no production keys.
   - Their GitHub token lacks Deployments, Administration, Environments, Secrets and Variables.
   - Approvals come only from your phone or your own Windows user.
   - Proved weekly by the reach audit, and on the first guard deploy by the rejected-review probe.
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
   - The rig holds only the sandbox key.
   - The app refuses live keys and live events outside production.
   - `stripe-setup.ts` refuses a live key without `--live`.
5. **No production customer data is touched or copied.**
   - No production database credential exists on the rig, the edge or the guard.
   - DNS blocks production API and database hosts for the rig, the phone and the emulators.
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
11. **The dangerous keys sit in one place, behind you.**
    - The Telnyx, Resend and FCM keys live only in the guard, which has no public URL.
    - Its deploys need your approval.
    - Version attestation runs hourly and the key inventory weekly.
12. **No automation token can redeploy production or the guard.**
    - Every Cloudflare token is scoped to named Workers.
    - The production deploy token lives in the `production` environment, limited to `main` and release tags.
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
    - Rig and synthetic events go to their own projects, through a capped relay.
    - Only isolation, guard, agent-reach, account, balance and "system dark" signals reach production on purpose.
    - Production's email reputation is protected by the mail rules in section 3.5.
18. **The rig cannot reach your other machines.** It sits on the guest network with client isolation, the phone is on the rig's own access point, and every connection starts from the rig outward.
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
| Transfer (SIP Refer) | $0.10 per invocation |
| Billing increment | 60 seconds |

A judged call costs about $0.02-0.03.

**Unknowns, budgeted conservatively:**
- Canadian carrier fees on on-net texts: up to $0.0088 more per part.
- Any per-dial charge.

If either is higher, the guard sheds tests to stay under the cap.

| Cost center | Monthly (expected) | One-time | Hard cap, and who enforces it | Alert before the cap | Source, date |
|---|---|---|---|---|---|
| Telnyx numbers: 8 standing at $1.00 + $0.10 SMS; caller-name lookup on one ($0.40); one monthly S28 number (about $2.10) | $11.30 | $8 | At most 10 numbers held and one extra order per 25 days (guard) | none (fixed) | telnyx.com/pricing/numbers and telnyx.com/pricing.md, 2026-10-29 |
| Telnyx usage: about 400 dials, about 300 texts, recordings, beep detection, a few transfers | about $9 | none | $35/month all-in, rentals included (guard ledger, then drop). Telnyx daily limits of $0.78/day, about $35.50 a month with rentals. Balance floor. Stranger inbound bounded by reject and detach. | Tier-change and projected-overrun alerts in `loonext-synthetic`. A production alert below $150. | Rates above, 2026-10-29; surcharges at support.telnyx.com/en/articles/1130707 and /12805746, 2026-10-29 |
| Cloudflare: 2 Workers and their Durable Objects on the existing Workers Paid plan; Workers AI through the guard | about $0.50 | none | AI capped at 2,000 neurons a day (guard), so at most about $0.66 a month even if the shared free tier is used up. Requests stay within the included 10M. | The 3 existing billing alerts | developers.cloudflare.com/workers/platform/pricing (updated 2026-10-02) and /workers-ai/platform/pricing (updated 2026-10-20), fetched 2026-10-29 |
| Supabase | $0 | none | Local stack only | none | none |
| Stripe sandbox, FCM, Resend, Sentry, GitHub Actions, Claude | $0 | none | Resend at most 10 a day; Sentry at most 100 a day and 3,000 a month; triage only when failures exist | Resend at 7 a day; Sentry at 70% | docs.stripe.com/sandboxes and firebase.google.com/pricing, 2026-10-29; resend.com/pricing, 2026-10-30 |
| Electricity (about 35 W average) | about $3 | none | none | none | Estimate |
| Mini-PC: 8 cores, 32 GB, 1 TB NVMe, Ethernet | none | about $450 | none | none | Estimate; DDR5 prices are volatile in 2026 |
| Used Pixel 8a or 9a, unlocked, FRP cleared, from a retailer | none | about $300 | none | none | Estimate. A new Pixel 10a is $599 (Android Authority, 2026-10-02). |
| USB hub with per-port power switching | none | about $60 | none | none | Estimate |
| USB Wi-Fi adapter that can run a 5 GHz access point | none | about $35 | none | none | Estimate |
| USB Bluetooth adapter and short extension cable | none | about $25 | none | none | Estimate |
| Travel router (only if the guest network is Wi-Fi only) | none | about $40 | none | none | Estimate |
| **Total** | **about $24; ceiling about $40** | **about $918** | | | |

**Conditional and optional:**

| Item | Monthly | One-time | When | Source |
|---|---|---|---|---|
| Phone with a 3.5 mm jack, plus USB sound card and cable | none | about $230 | Only if the Bluetooth spike fails | Estimate |
| Echo-test probe K01 | about $0.05 | none | Phase 4, after Telnyx agrees (inside the cap) | Rates above |
| Used Samsung (closes X6) | none | about $150 | Optional | Estimate |
| UPS | none | about $80 | Optional | Estimate |
| Extra 32 GB RAM | none | about $100 | Only if three emulators do not fit | Estimate |

**Telnyx Managed Accounts, for comparison.** They would give real isolation, but need the Starter commit plan at a $1,000 monthly minimum, with Telnyx approval (support.telnyx.com/en/articles/4951492, checked 2026-10-29). The production account returned 403 on that API.

---

## 8. How an agent gets in, and what it can see and drive

### Ways in

- **Claude Code on the rig.** `claude remote-control --spawn worktree` runs as a systemd user service and uses outbound HTTPS only (code.claude.com/docs/en/remote-control, checked 2026-10-29).
  - You, or a workstation agent, attach from claude.ai/code or the Claude app, or send it a message.
  - It has a full shell on the rig, which is the "SSH in and diagnose everything" of the EDR analogy.
  - Each repro or fix gets its own worktree, so the agent patches, re-runs and verifies in one place.
- **The `rig` CLI**, locally or through `/ctl/rpc`:
  - `rig deploy --ref`, `rig seed [--recipe]`;
  - `rig run <scenario> [--recipe] [--repeat N] [--build <ref>]`, `rig suite daily|weekly|release`;
  - `rig device pixel|emu34|emu35|emu36 install|kill|forcestop|doze|standby|saver|lock|unlock|reboot|power-cycle|netem|screenshot|logcat|callflow|bugreport`;
  - `rig robot dial|answer|dtmf|sms|mms|verdict|inbox|mail`;
  - `rig cron <expr> [--time]`;
  - `rig budget`, `rig room`, `rig lease`, `rig evidence <run>`.
- **The hourly cloud triage task**, which holds only a triage-scoped token.
- **Workstation agents** (in the agent Windows user), for production reads only:
  - *scripts/ops/call-trace.mjs* (planned) as `agent_diag`;
  - Workers logs through `agent-logs-read`;
  - the guard's `diag` class;
  - production Sentry through `agent-read`.
- **Optional (Phase 4):** a raw SSH relay through the edge.

### Tokens

**On the rig:**
- guard caller tokens (`rig-api`, `robot`);
- the edge uplink token;
- the Stripe sandbox key;
- the GitHub App key (`main` is blocked by the ruleset);
- Sentry DSNs (ingest only);
- the nonprod Firebase config;
- the nonprod keystore;
- test passwords and the TOTP seed.

**In the agent Windows user:** the read-tier tokens listed above, and the fine-grained GitHub token.

**Never on the rig or in the agent user:**
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
- **Production, from the agent Windows user:** `ops_diag` views, Workers logs (3-7 days), Sentry and redacted Telnyx reads.

**Not visible:** Telnyx's portal-only tools (X26).

### What the agent can drive

- **Calls:** place a call from the robot, any page, the Pixel or an emulator. Answer or decline anywhere. Send keypad digits, hold, mute, transfer and consult.
- **Texts:** send texts and pictures.
- **Phone states:** put phones into killed, force-stopped, Doze, standby, battery-saver, locked, rebooted or bad-network states.
- **Pushes:** trigger them by calling, or with D02p at no cost.
- **Data:** seed tenants, audiences and usage; fire any cron at any time; flip local kill switches; move Stripe clocks.
- **Builds and hardware:** deploy any ref; build and install any `.nonprod` APK; power-cycle a hub port.

---

## 9. Customer-repro workflow

Example: "A customer's Android phone didn't ring yesterday."

1. **Intake.** Open a GitHub issue holding only a hash of the workspace id, the platform and the time window. The issue number stays out of commit trailers until the work is done.
2. **Read production without copying it** (agent Windows user). Run `node scripts/ops/call-trace.mjs --company-hash <h> --since 48h` as `agent_diag`. For the window it shows:
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

   If the customer's app predates the beacon, (b) and (c) cannot be separated, so reproduce both.
4. **Write a recipe.** `tools/synthetic/recipes/<issue>.yml` holds settings only: app version, Android level, phone state, ring strategy, member levels, network. `check-rig-no-e164` checks it in CI.
5. **Hand it to the rig.** Send the issue link to the rig's Remote Control session, or run `rig repro <issue>`.
6. **Rebuild what the customer ran.**
   - `rig deploy --ref <server release tag>`. Old web refs use the rig-only unsupported-Next flag; pre-seam server refs run in `--pre-seam` mode.
   - `rig apk build --ref <app tag>`. Tags older than the `nonprod` build type get a build-config overlay.
   - `rig seed --recipe <issue>`.
7. **Reproduce at a rate, for free.** Run `rig run D02p --recipe <issue> --repeat 20` on the Pixel and on an emulator at the customer's API level. Stage (d), or a confirmation, uses the paid D02: at most 5 runs from the repro reserve, in the next window.
8. **If it does not reproduce, sweep.** Change one variable at a time: standby bucket, battery saver, each permission, lock and before-first-unlock states, network loss, app version. Record each negative result. If the customer's phone is not a Pixel and the cause looks OEM-specific, record it as X6.
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
    - The recipe joins the rotation for good, and its trace becomes a hermetic fixture.

At no step does any customer number, name, message, recording or database row leave production.

---

## 10. Build phases

| Phase | What gets built | Agent can build it | What needs you |
|---|---|---|---|
| **0a. The small production release** | Ownership rule, `/health` capability, ownership-mismatch alert, inbound-canary fix. Ships with `0fd3583c`, already on main. | Yes, now | Nothing beyond the normal release merge |
| **0b. Seams, evidence, guards, workstation tools** | Everything else in section 3.7, the docs in section 14, and the drafted Telnyx ticket | Yes, now | FA0 now. FA4 and FA9 to move `ship.yml` and `backup-posture.yml`. |
| **1. Cloud pieces in existing accounts** | Edge and guard; the Telnyx partition created by the guard's setup routine; the notification channel; attestation and key inventory; `rig-cloud.yml`, `guard.yml`, `rig-secrets.yml`. Number orders and paid dials wait for 0a in production and FA0's limit. Texts may start sooner. | Yes | FA3-FA10. |
| **2. The rig** | **Spikes first:** (1) Bluetooth hands-free on the Pixel, the purchase gate for the fallback phone; (2) code calibration; (3) local ES256 sign-in; (4) the cron route; (5) the AI shim; (6) FCM rewrite and package pinning; (7) robot inbound recording; (8) three emulators in 32 GB; (9) the edge-to-guard service binding. **Then:** bootstrap, network, rig mode, seed, robot, `rigd`, lanes. | Yes | FA11 (hardware and setup session), FA12 (Claude sign-in) |
| **3. Schedule, reporting, triage, production watches** | Timers and the dial-budget plan; the Sentry relay; cloud triage; dead-man; G01, G02, P01, PW01. The default cap holds until Telnyx answers. | Yes | Forward Telnyx's reply. Raising the cadence is one approved guard deploy (FA14). |
| **4. Optional** | K01 echo probe (after Telnyx agrees); the Google calendar partial (X22); raw SSH relay; used Samsung; UPS | Yes | Optional hardware. For calendar: enable the Calendar API and create one service account in the existing Google Cloud project (10 minutes). |

### Founder actions, with click paths

Labels are as of 2026-10-29; vendor screens change.

**FA0. Telnyx ticket and account level (15 minutes, now).**
1. portal.telnyx.com > account menu > Account Level (or Verification). Copy the level and any concurrent, hourly and daily outbound limits, and give them to the agent.
2. Support > New ticket. Paste the agent's draft. It states that synthetic monitoring between numbers we own on this account will probably be **most** of the account's call traffic (about 13 dials a day on average, overnight). It asks:
   1. Our level and its concurrent, hourly and daily outbound limits; whether SIP-URI ring legs to our own credentials count toward them; and, if the concurrent limit is under 5, whether it can be raised.
   2. Any per-dial or per-call charge beyond the rate sheet, and whether `transfer` is billed as SIP Refer at $0.10.
   3. How calls and texts between two of our numbers are routed and billed, including Canadian carrier fees on texts.
   4. Whether cancelled ring legs count toward the abandoned-call surcharge.
   5. Whether a fraud hold applies to the whole account or to one profile or connection, and whether this traffic is acceptable.
   6. Whether US and Canadian local numbers can both be ordered, whether `billing_group_id` is honoured on number orders, and whether listings and detail records filter by billing group.
   7. Whether an API gives a connection's active-call count.
   8. Whether outbound SIP URI calls can be disabled per credential connection.
   9. Whether account notification webhooks are signed.
   10. Whether a number with no connection and no messaging profile is billed for inbound calls or texts.
3. Forward the reply to the agent.

**FA1. Give agents their own Windows user and remove production keys from their reach (about 45 minutes, prerequisite).**
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

**FA2. The agent user's GitHub login (15 minutes, prerequisite).**
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

**FA3. The guard's Telnyx key (5 minutes, after FA4 step 1).**
1. portal.telnyx.com > Auth (API Keys) > Create API Key. Label `nonprod-guard`, no expiry.
2. dash.cloudflare.com > Workers & Pages > `loonext-telnyx-guard` > Settings > Variables and Secrets > Add. Type: Secret, name `TELNYX_API_KEY`, paste > Deploy.
3. Paste it nowhere else.

**FA4. Cloudflare (25 minutes).**
1. Workers & Pages > Create > Start with Hello World, twice:
   - `loonext-rig-edge`: Settings > Domains & Routes > workers.dev > Enable.
   - `loonext-telnyx-guard`: Settings > Domains & Routes > workers.dev > Disable.
2. Manage Account > Account API Tokens > Create Token > Custom token, five times:
   - **`rig-deploy`:** Workers Scripts, Specified Workers `loonext-rig-edge`, role Editor. Paste into GitHub environment `rig-cloud` as `CF_API_TOKEN`.
   - **`guard-deploy`:** the same for `loonext-telnyx-guard`. Paste into environment `guard`.
   - **`guard-attest-read`:** `loonext-telnyx-guard`, role Metadata Read-only. Paste into environment `rig`.
   - **`production-deploy`:** Specified Workers `loonext-api` and `loonext-web`, role Editor. Plus, on zone loonext.com: Workers Routes Edit, DNS Edit, Cache Purge. Paste into environment `production` as `CLOUDFLARE_API_TOKEN`.
   - **`agent-logs-read`:** Workers Tail Read and the Workers logs or observability read permission, on `loonext-api` and `loonext-web` if the page lets you pick Workers. Paste it when the agent's setup prompts in the `loonext-agents` user.
3. loonext.com > Email > Email Routing:
   - Settings > Subaddressing > enable.
   - Routing rules > Custom addresses > Create address `rig-robot`, action "Send to a Worker", Worker `loonext-rig-edge` > Save.

**FA5. Stripe sandbox (3 minutes).** dashboard.stripe.com > account picker > Sandboxes > Create sandbox `loonext-rig`. Inside it: Developers > API keys > reveal the secret key. Then github.com > Texturion > Settings > Environments > `rig` > Add secret `STRIPE_SECRET_KEY`. The agent sets the catalog, portal and tax settings through the API.

**FA6. Firebase and Google Cloud (15 minutes).**
1. console.firebase.google.com > the existing project > Project settings > General > Add app > Android.
   - Package `com.loonext.android.nonprod`, plus the SHA-256 the agent gives you.
   - Register, download `google-services.json`, and put it into environment `rig` as `ANDROID_NONPROD_GOOGLE_SERVICES_JSON`.
2. console.cloud.google.com > same project > IAM & Admin > Service Accounts > Create `fcm-rig-sender`, role Firebase Cloud Messaging API Admin > Done. Open it > Keys > Add key > Create new key > JSON.
3. The key must show no expiry. If creation is blocked or an expiry shows: IAM & Admin > Organization policies > `iam.disableServiceAccountKeyCreation` or `iam.serviceAccountKeyExpiryHours` > Manage policy > override for this project only, then create the key again.
4. Paste the JSON into the guard as secret `FCM_SERVICE_ACCOUNT_JSON` (same path as FA3 step 2), then delete the download.

**FA7. Sentry (10 minutes).**
1. sentry.io > Projects > Create Project > Node.js > `loonext-rig`; repeat for `loonext-synthetic`. Put both DSNs into environment `rig`.
2. Put the production API project's DSN (its Settings > Client Keys) into environments `rig-cloud` and `guard` as `SENTRY_PROD_DSN`.
3. `loonext-synthetic` > Settings > Issues: auto-resolve after 24 hours.
4. Organization Settings > Spike Protection: turn it on for all projects.
5. Settings > Developer Settings > Custom Integrations > Create New Integration > Internal Integration `agent-read`, with Organization, Project and Issue & Event Read. Paste its token when the agent's setup prompts in `loonext-agents`.

**FA8. Resend (2 minutes).** resend.com > API Keys > Create API Key `rig-sending`, Permission: Sending access, Domain: loonext.com. Paste it into the guard as secret `RESEND_API_KEY`.

**FA9. GitHub (30 minutes).**
1. github.com/organizations/BytechLabs/settings/apps/new > `loonext-rig`.
   - Webhook: untick Active.
   - Repository permissions: Contents, Pull requests, Issues and Commit statuses read and write; Actions and Metadata read.
   - Only on this account > Create > Generate a private key > Install App on Texturion only.
   - Put the key into environment `rig` as `RIG_APP_KEY`, and the App id as a variable.
2. Texturion > Settings > Environments > New environment, five times:
   - **`guard`:** Required reviewers: you. Leave "Prevent self-review" **off**: agents act under your GitHub identity, so with it on you could never approve. FA1 and FA2 are what stop agents approving. Deployment branches: `main` only.
   - **`production-ops`:** the same settings. Add the production write secrets the agent lists (from your password manager).
   - **`rig-cloud`** and **`rig`:** `main` only.
   - **`production`:** `main` and the release tag pattern the agent gives you, plus the secrets the agent lists.
3. Settings > Rules > Rulesets > New branch ruleset. Target: default branch. Rule: Restrict updates. Bypass: Repository admin. The rig App is not an admin, so it can never write to `main`.
4. **Cutover order.**
   1. The agent lists every workflow's secrets. Today `ship.yml` and `backup-posture.yml` both use repo-level secrets.
   2. It moves each consumer into the `production` environment.
   3. It proves `production-deploy` by redeploying the current release.
   4. After two green releases, delete the repo-level copies under Settings > Secrets and variables > Actions, and only those copies.

**FA10. Claude cloud environment (10 minutes).** claude.ai/code > Settings > Environments > New environment `synthetic-triage`. Network access: Custom, adding `loonext-rig-edge.<acct>.workers.dev` to the defaults. Secret: the triage token the agent gives you. The agent then creates the hourly task.

**FA11. Hardware and one setup session (about 1 hour).**
- **Router:** turn on the guest network with client isolation. If it has no Ethernet port, use the travel router on the agent's list.
- **Buy:** the mini-PC; a used Pixel 8a or 9a, unlocked and FRP-cleared, from a retailer; the switchable USB hub; the access-point Wi-Fi adapter; the Bluetooth adapter with extension cable. Buy the fallback phone only if the agent says the Bluetooth spike failed.
- **Mini-PC:**
  1. BIOS: power on after AC loss.
  2. Install Ubuntu Server 24.04 with OpenSSH, pasting the agent's public key.
  3. Connect Ethernet.
  4. Run the agent's bootstrap command, which shows the Android SDK and Google Chrome licences for you to accept.
- **Pixel:**
  1. First boot without a Google account.
  2. Settings > About phone > tap Build number 7 times.
  3. Developer options: turn on USB debugging and "Disable adb authorization timeout".
  4. Plug it into the hub and tap "Always allow from this computer".

**FA12. Sign in to Claude on the rig (2 minutes).** In the rig's console, run `claude` and open the sign-in link in your browser.

**FA13. One production write (1 tap).** In the GitHub app, approve the `ops.yml` run `set-agent-diag-password`. It sets a random password and hands it to the agent user encrypted to that user's key; no one sees it.

**FA14. Approve guard deployments (development, not operation).** In the GitHub app: the run > Review deployments > Approve. You do this once in Phase 1, once when Telnyx's answer lets the cadence rise, and otherwise only when the guard's code changes (target: at most once a month).

**FA15. Conditional, about once a year.** Accept a new Android SDK licence when the agent upgrades the pinned SDK on the rig.

---

## 11. Deliberately out of scope

- **A hosted twin of Loonext in the production accounts.** It would add configuration drift, a public login page on the production Cloudflare account and a hosted test database. Re-evaluate when #323's trigger fires: a second person shipping, or a customer whose outage is expensive.
- **Synthetic tenants inside the production database.** Production point-in-time recovery is off. That approach also needed a session-minting endpoint in production, and its phone lane breaks on the first real Turnstile challenge.
- **An iOS Simulator lane.** It could not test wake, it would need an iOS rig configuration plus a TCP relay, and no customer runs an iOS build.
- **A raw SSH relay as the primary way in.** Remote Control already gives an agent a full shell on the rig. SSH stays optional (Phase 4).
- **A production probe number** for wiring checks. PW01 reads production's settings and delivery log instead, with no dial and no exception to the guard's policy.
- **New accounts of any kind:** SIM, Apple, Workspace or Microsoft 365, device farm.
- **A hard release gate on synthetic results.** A flaky phone must not block a customer fix. Reconsider after 30 days with the device lanes under 2% flakiness.
- **Any copy of production data,** even scrubbed.
- **An App Store or TestFlight pipeline, porting, live 10DLC reviews, forced screening verdicts.**
- **A self-hosted GitHub runner.** On a public repo, fork pull requests could run code on it.
- **Your workstation as the rig.**
- **Load testing.** The #251 driver still has no deployed non-production target.
- **Switching on the #308 hourly text canary.** Its column bug is fixed in Phase 0a. Turning it on needs two more production numbers and about $12 a month by its own estimate; that stays its own decision.
- **A Supabase scoped token for production logs.** It expires within a year, which would make a recurring founder act. Database evidence comes from `agent_diag`.
- **A read-only live Stripe key for agents.** It would expose customer billing data. Billing repro uses the sandbox.

---

## 12. Open risks

1. **A Telnyx fraud hold is account-wide** (accepted, the largest risk). Test traffic will probably be most of the account's calls. A hold would stop production calling too, and Telnyx does not disclose its scope. Mitigations: on-net only, low volume, quiet hours, a written notice, an automatic 7-day halt. Recovery may need you.
2. **Concurrency room may be too small.** If the account's limit is 2 or 5, most or all paid call lanes do not run (section 4.1). That would also mean production cannot ring a full crew, which is worth knowing on its own.
3. **The guard's key has full production authority.** An approved policy bug could touch production. Mitigations: policy unit tests, the two-way registry check, your approval, start-up refusals, daily 403 probes, attestation, key inventory.
4. **Agents keep production reach** (the amendment). Agents hold production keys and can drive the founder's browser, as they do today. The guard does not widen that. Its protections are in code, and FA1/FA2 remain available as optional hardening.
5. **Ordering.** No number before production's `/health` shows the ownership rule, and FA0 returns the limit.
6. **One home site.** Power or internet loss stops synthetic coverage. The dead-man alerts production after 6 hours dark.
7. **Fidelity gaps from running locally** (X23).
8. **P01 has little to measure today.** With one production number, it mostly reports "insufficient sample", and repro issues may wait a long time for production evidence.
9. **Unproven mechanisms,** each with a spike and a fallback:
   - coded bursts surviving voice processing (fallback: "media arrived" plus speech recognition);
   - Bluetooth hands-free on the self-managed call (fallback: the jack phone);
   - local ES256 sign-in;
   - the AI shim;
   - FCM rewrite and package pinning;
   - inbound recording;
   - the edge-to-guard binding (fallback: HMAC with a nonce);
   - the active-calls API (fallback: room limits only);
   - Remote Control started from a scheduled task on Windows;
   - the adb exemption from developer verification.
10. **Cost uncertainty.** A per-dial charge or carrier fees on on-net texts would shrink coverage, not raise spend.
11. **Recycled numbers attract strangers.** Rejected calls and dropped texts may still bill. Detach stops a flood; replacement waits for the monthly order slot.
12. **Shared quotas without a vendor-side split:** Sentry, Resend, Workers usage, Workers AI, Claude limits. Each is capped in our code.
13. **Old-version repro.** Old web refs need the rig-only unsupported-Next flag. Pre-seam server refs cannot run push or email scenarios. Old Android tags need an overlay.
14. **Production side findings, to be filed as separate production issues:**
    - Production's voice profile and messaging profiles have no Telnyx-side spend limits; auto-recharge is off and the credit limit is 0.
    - The account's two mobile push credentials (iOS and Android) are attached to no connection, so iOS closed-app wake cannot work today.
    - If the account is at the Paid level, Telnyx prepends its automated-call announcement to production's own greetings and dials, and caps customers at 5 concurrent calls and 100 a day.
    - `docs/deploy/04-telnyx.md` says ring legs come from the WebRTC connection; the code dials every leg from the voice connection.

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
| Where triage runs | A Claude cloud task, so a revoked rig sign-in never stops it. |
| Production Telnyx reads | Merged into the guard as a redacted, GET-only class: one full-power key fewer. |
| Sentry write access | None anywhere. Synthetic issues go by DSN. |
| FCM key rotation | No self-rotating key; non-expiry is checked at setup. |
| Box memory | 32 GB unless the emulator spike needs more. |
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
| Blocker: agents run as you and can drive your Chrome and credential store | Separate Windows user, the reach audit, approvals only from your phone or your own user (3.1, FA1, FA2) |
| Blocker: production keys in commented lines of `apps/api/.dev.vars` | Removed with the old checkout. Agents get local-only env files with fakes. `check-local-secrets` runs at session start and before push (3.1, FA1). |
| Blocker: test calls can starve a customer's call | Room formula, live-leg count, preemption, measured window; paid lanes gated on FA0 (3.5, 4.1) |
| Test traffic is the majority, so surcharge and fraud reasoning was inverted | Account-level ratio control, single-surface audiences, disclosure in FA0 (2.2, 3.5) |
| Dials undercounted | Counts derived from the journeys; CI budget check with retry and repro reserves; cadence rewritten to about 400 a month (4.1, 4.2) |
| P01 has no sample | Reports n; "insufficient sample" is never a pass; repro issues stay open until evidence exists (3.11, 9) |
| Wired fallback breaks adb | Bluetooth is a purchase gate; the fallback is a second phone with a jack (3.9) |
| FCM token seam missing | `FCM_OAUTH_TOKEN_URL`, a guard-token bearer in rig mode, a dummy key, and a test (3.3, 3.7) |
| iOS lane would talk to production | iOS Simulator lane and TCP relay dropped (2.3, 11) |
| Old web refs cannot build | Rig-only unsupported-Next flag; pre-seam mode; wider DNS block (3.2, 3.3) |
| Local sign-in would 401 | Bootstrap ES256 key, derived config, R00 check (3.3) |
| Guard approvals make you an operator | Class-based policy, registry check in the same PR, a target of at most one approval a month (3.5) |
| Removing your keys blinds agents | Prompt-free read tier: `agent-read`, `agent_diag`, `agent-logs-read`, guard `diag`. Writes go through approved `ops.yml` (3.1). |
| Rig cron noise | Cron registry, CI check, zero unexplained fingerprints (3.3) |
| Robot mailbox could bounce production's domain | The mail handler never rejects; heartbeat gate; mailbox only in S34; halt on a missed delivery (3.4, 3.5) |
| Untrusted texts could reach production code | The edge never relays stranger content; rig PRs are never auto-merged (3.4, 3.10) |
| Vendor ceiling was 3 times the cap; inbound uncapped | Daily limits resized to $0.78; automatic detach for floods (3.6) |
| S29 could not pass | `canceled_at` is backdated under the lease; the test clock is used only for Stripe-side assertions (4.2) |
| SDK-placed SIP calls bypass the guard | G02 sentinel probe; residual X25 if open; question in FA0 (4.2, 4.3) |
| Minor gaps | Notification webhook secret path and corroboration; guard with no public URL; secrets cutover order covering `backup-posture.yml`; `stripe listen --api-key`; device-side renewals (Play services, FRP, SDK pin, adb key); `DEPLOY_ENV` unset means local; ownership-mismatch alert and fallback marker; D02p dials zero; monthly Sentry ceiling; FCM Android-only rewrite; calendar partial; numeric verdicts for D13, E01 and S03; text events acknowledged at the edge; Ethernet uplink, 5 GHz access point, Ontario numbers; Phase 0 split (the API deploys before web in `ship.yml`); portal-only tools named (X26); SSH and PW01 simplified; production push-credential and Paid-level findings filed (12). |

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
