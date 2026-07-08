# 10 · Receiving email on loonext.com (minimum cost: $0/month)

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
     as `Reply-To` on every transactional send. Set the optional Worker secret
     `RESEND_REPLY_TO` to this address so alert replies land here, not in the
     unmonitored `notifications@` sender:
     ```
     printf '%s' 'Loonext Support <support@loonext.com>' | \
       wrangler secret put RESEND_REPLY_TO --config apps/api/wrangler.jsonc
     ```
     `RESEND_REPLY_TO` is optional in the schema (`apps/api/src/env.ts:53`); leave it
     unset and `resend.ts` omits `Reply-To` entirely (the pre-hardening behavior), so
     wiring it here is what makes the "reply to this email" copy actually reach a human.
     ([06-env-reference](./06-env-reference.md) §A carries it as an optional row too.)
   - `privacy@loonext.com`
   - `security@loonext.com`
   - `notifications@loonext.com` — the Resend `RESEND_FROM` sender. Routing it means
     bounces and stray replies to outbound alerts still reach a person instead of
     bouncing into the void.
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
