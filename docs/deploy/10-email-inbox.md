# 10 · Receiving email on loonext.com (minimum cost: $0/month)

**Status: CURRENT DIRECTION (#323).** A per-vendor deep-dive on receiving email at the domain. The numbered set 01–08 is the operator walkthrough — start there.

Loonext's site and legal pages reference three human inboxes: `support@loonext.com`,
`privacy@loonext.com`, and `security@loonext.com`. Transactional SENDING (auth emails,
usage alerts) is already covered by Resend (06-env-reference `RESEND_*`). This page is
about RECEIVING those addresses and replying from them, on the founder's budget.

## A. Receive: Cloudflare Email Routing (free, unlimited aliases)

You already run DNS on Cloudflare, so receiving costs nothing:

1. Cloudflare dashboard → your `loonext.com` zone → **Email → Email Routing** → Enable.
   Cloudflare adds the required MX and SPF records to the zone automatically (it will
   warn if anything conflicts; accept its records).
2. **Destination addresses**: add your real inbox (e.g. your Gmail) and click the
   verification link Cloudflare emails you.
3. **Custom addresses**: create five routes, all forwarding to that destination:
   - `support@loonext.com` — the human support inbox, and the address Resend stamps
     as `Reply-To` on every transactional send. **Route it: the code now defaults to
     this address, so it is where replies land whether or not the secret below is
     set.** Setting `RESEND_REPLY_TO` only changes WHICH inbox:
     ```
     printf '%s' 'Loonext Support <support@loonext.com>' | \
       wrangler secret put RESEND_REPLY_TO --config apps/api/wrangler.jsonc
     ```
     `RESEND_REPLY_TO` is optional in the schema; since #252, leaving it unset does
     NOT mean replies go nowhere — `resend.ts` falls back to `support@loonext.com`,
     so the "reply to this email" copy reaches a human on every deploy, including
     one where this step was skipped. Setting it here is how you point replies at a
     DIFFERENT inbox; the route below is still what makes that address deliver.
     ([06-env-reference](./06-env-reference.md) §A carries it as an optional row too.)

     > The old behaviour was the defect: with the secret unset, a reply went to the
     > FROM address instead of support, while five customer-facing emails told the
     > reader to reply. Two of those are the only stated route to undoing an
     > irreversible workspace deletion. Nothing failed and nothing warned; whether
     > the copy was true depended on whether somebody had wired a secret.
   - `privacy@loonext.com`
   - `security@loonext.com`
   - **The `RESEND_FROM` sender.** Route whichever address production actually sends
     as, so bounces and stray replies reach a person instead of bouncing into the
     void. **Check before creating it:** this repo says `notifications@loonext.com`
     in most places (`apps/api/src/env.ts`, `PRODUCTION.md`, the test stubs) while
     the live value recorded in [08-operations](./08-operations.md) is
     `noreply@loonext.com`. Route the live one.

     > Two follow-ups the founder owns, both out of scope for a code change:
     > reconcile that discrepancy so the repo states the sender once, and decide
     > whether the live sender should stay `noreply@`. A Reply-To makes a reply
     > ROUTE correctly, but the From line is what the reader sees first, and
     > `noreply@` is the most widely understood "your reply is not read" signal
     > in email. Every transactional footer now invites a reply, and the
     > workspace-deletion email's only stated way to undo an irreversible close
     > is to reply. Sending that from `noreply@` argues with it.
   - `dmarc@loonext.com` — receives the DMARC aggregate (`rua`) reports below. Keep it
     separate from `support@` so the daily XML reports never clutter the human inbox
     (a Gmail filter can archive them straight to a `DMARC` label).
4. Catch-all: set to **Drop** (a catch-all that forwards invites spam; anything real
   arrives at the five routed names).

Mail to those addresses now lands in your personal inbox. Filters/labels in Gmail
("to: support@loonext.com → label Support") keep them sorted.

## B. Reply AS support@loonext.com from Gmail (free, uses Resend SMTP)

Replying from your personal address looks amateur; wire Gmail's "Send mail as":

1. Gmail → Settings → **Accounts and Import → Send mail as → Add another email address**.
2. Name: `Loonext Support`, address `support@loonext.com`, untick "treat as alias".
3. SMTP server: `smtp.resend.com`, port `587`, username `resend`,
   password = a Resend API key (create a dedicated key named `gmail-send-as`).
4. Verify with the code Gmail sends (it arrives via the Email Routing forward).
5. Repeat for `privacy@` / `security@` if you want distinct From names, or just
   reply from support@ for everything at launch.

Resend's free tier (3,000 emails/month) is far above any support volume you'll see
at launch, and it signs with your already-verified DKIM, so replies land in inboxes.

## C. DNS records checklist (deliverability + anti-spoofing, industry standard)

After A and B, the zone should have:

- **MX** → Cloudflare Email Routing (added automatically in step A).
- **SPF** on the root → Cloudflare's include (added automatically). Resend sends from
  its own verified subdomain (see the Resend dashboard's DNS panel from 04-resend
  setup), so the two do not conflict.
- **DKIM** → the three CNAME/TXT records from Resend's domain verification (already
  required for transactional sending; verify they are green in Resend).
- **DMARC** (add manually, TXT on `_dmarc.loonext.com`):
  `v=DMARC1; p=quarantine; rua=mailto:dmarc@loonext.com; fo=1`
  The `rua` points at the routed `dmarc@loonext.com` address (section A) so aggregate
  reports stay out of the support inbox. Start with `p=none` for the first week if you
  want to observe reports before enforcement, then move to `p=quarantine`.

## D. What this deliberately avoids paying for

- Google Workspace ($7+/user/mo): unnecessary until you want a real shared mailbox
  with teammates. The moment that happens, migrate by pointing the three routes at
  the Workspace inbox; nothing on the site changes.
- Helpdesk tools (Zendesk/Front): overkill pre-revenue. Gmail labels + templates
  cover launch volume.

Total: **$0/month**, and every address on the site actually works.

## Email authentication, verified 2026-07-28 (#386 ask 5)

Queried live over DNS-over-HTTPS. This is what the internet actually returns
for `loonext.com`, not what the setup guide says it should:

| Record | State | Value |
|---|---|---|
| SPF (root `loonext.com`) | present, **does not authorize Resend** | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| SPF (`send.loonext.com`) | present, correct for Resend | `v=spf1 include:amazonses.com ~all` |
| DKIM (`resend._domainkey.loonext.com`) | **present at the root**, 1024-bit RSA | published |
| DMARC (`_dmarc.loonext.com`) | **MISSING** | — |
| DMARC (`_dmarc.send.loonext.com`) | **MISSING** | — |

### Two findings, both operator actions (DNS is not changed from code)

**1. No DMARC record anywhere.** This is the significant one. Gmail and Yahoo's
bulk-sender rules require a DMARC policy of at least `p=none`, and without a
record we also receive no aggregate reports — so we have no visibility into
whether our mail authenticates, or into anyone spoofing the domain. That
absence is the #386/D55 shape exactly: nothing fails loudly, and "authenticating
fine" and "stopped authenticating" look identical from here.

Suggested first step, deliberately the non-destructive one:

```
_dmarc.loonext.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@loonext.com"
```

`p=none` changes no delivery behaviour and starts the reports. Tighten to
`quarantine` only after the reports show alignment is clean.

**2. `RESEND_FROM` sends from the root domain, whose SPF does not include
Resend.** The root SPF is Cloudflare Email Routing's (that is inbound routing,
which is correct and should stay). The Resend SPF is published on
`send.loonext.com`, which the sender does not use. DKIM is published at the
root and signs with `d=loonext.com`, so mail should still authenticate on DKIM
alone — but it authenticates on one leg instead of two, and once DMARC exists
SPF will fail alignment.

Either is a fix; the first is less invasive:

- point `RESEND_FROM` at `send.loonext.com` (already configured correctly), or
- add Resend's include to the root SPF alongside Cloudflare's.

Re-verify with:

```bash
curl -s 'https://dns.google/resolve?name=_dmarc.loonext.com&type=TXT'
```
