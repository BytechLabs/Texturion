# 05 — Supabase Project Setup + Migrations

Everything the operator does on the Supabase side: project provisioning, the
**ES256 JWT signing key** requirement, extensions, the `mms-media` storage
bucket, RLS posture, custom SMTP, Turnstile, and the migration-push flow. Every
fact cites `file:line`.

---

## Step 1 — Provision the project

- **Plan / region:** Supabase **Pro**, single US region **`us-east-1`**
  (`SPEC.md:98`). Pro is required for the capacity the app assumes (500 Realtime
  connections, 5M Realtime msgs/mo, never auto-paused) — `SPEC.md:947,1134`.
- **Postgres major version 17** — the local config pins `major_version = 17`
  (`supabase/config.toml:42`); the remote must match for `db push`.

From the project you get three values used as API Worker secrets and three as web
build vars:

| Value | Dashboard location | Used as |
|---|---|---|
| Project URL `https://<ref>.supabase.co` | Settings → API → Project URL | `SUPABASE_URL` (api) + `NEXT_PUBLIC_SUPABASE_URL` (web) |
| Secret key `sb_secret_...` | Settings → API keys → **Secret keys** | `SUPABASE_SECRET_KEY` (api only) |
| Publishable key `sb_publishable_...` | Settings → API keys → **Publishable key** | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (web only) |

The Worker talks to Supabase over **HTTP with the `sb_secret_` key** (PostgREST +
Storage), not a Postgres connection and not the legacy `service_role` JWT
(`apps/api/src/db.ts:11-22`, `SPEC.md:103`; `env.ts:10`). The `sb_secret_` role
has `BYPASSRLS`, which is why RLS is defense-in-depth only
(`supabase/migrations/20260701000300_rls.sql:5-7`).

## Step 2 — Enable ES256 (asymmetric) JWT signing keys — REQUIRED

This is the single most important Supabase-side prerequisite. The Worker verifies
every access token **locally, ES256-only**, against the project JWKS
(`apps/api/src/auth/jwt.ts:36-49`):

- Algorithm restricted to `ES256` (`jwt.ts:41`).
- Issuer must equal `<SUPABASE_URL>/auth/v1` (`jwt.ts:26-29,42`).
- Audience must be `authenticated` (`jwt.ts:43`).

If the project is still on the legacy shared **HS256** secret, no JWKS is
published, the ES256 verification fails, and **every `/v1/*` request 401s**.

**Operator action:** Supabase dashboard → Authentication → JWT / Signing Keys →
enable an **asymmetric ECC (ES256) signing key** (SPEC: "asymmetric ES256 signing
keys enabled at project setup" — `SPEC.md:100,1044`).

### The JWKS URL

`SUPABASE_JWKS_URL` is the published JWKS endpoint, canonical form:

```
https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

(`SPEC.md:100`; test fixture builds exactly this shape at
`apps/api/src/test/support.ts:16-17`.) It is consumed by `jose`
`createRemoteJWKSet`, which edge-caches the key set (~10 min upstream)
(`apps/api/src/auth/jwt.ts:15-24,40`). Set it as the `SUPABASE_JWKS_URL` secret
(`apps/api/src/env.ts:11`).

## Step 3 — Custom SMTP (Resend) for Auth emails

Supabase Auth sends invite/signup/reset emails via `inviteUserByEmail` using
**Resend as the custom SMTP provider** (`SPEC.md:100,1065`; invites at
`SPEC.md:832`). Configure Supabase dashboard → Authentication → Emails / SMTP
with Resend's SMTP credentials, and a sender at the **verified Resend domain**
(same domain as `RESEND_FROM`). See [07](./07-webhooks-and-vendor-setup.md)
§Resend for the domain-verification step. (Note: `supabase/config.toml:237-244`
shows the SMTP block commented out — SMTP is set on the **hosted** project, not
via committed local config.)

## Step 4 — Turnstile (signup CAPTCHA)

Signup is protected by **Cloudflare Turnstile via Supabase Auth's captcha
setting**, because Supabase Auth traffic goes browser → `<project>.supabase.co`
directly and is not behind JobText's Cloudflare zone (`SPEC.md:1052`).

Two halves:

- **Supabase dashboard (secret key):** Authentication → Attack Protection →
  CAPTCHA → provider **Turnstile**, paste the Turnstile **secret** key
  (`SPEC.md:1052`).
- **Web build (site key):** the widget's **site** key is the optional
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` build var (`apps/web/src/env.ts:10`) — when
  set, signup/login/reset-password render Turnstile and pass its `captchaToken`
  to Supabase Auth; unset, no captcha renders. The deploy workflow injects it
  from the optional GitHub secret of the same name
  (`.github/workflows/deploy.yml:23-26`).

> **Ordering:** set the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` GitHub secret and
> redeploy web **before** enabling the dashboard setting. Captcha enforced
> against a web build with no site key rejects every email/password
> signup/login/reset (no token is ever sent).

## Step 5 — Push migrations

Migrations are applied by the deploy workflow, **before either Worker deploys**
(`.github/workflows/deploy.yml:50-62`):

```
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
```

This needs three GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
`SUPABASE_PROJECT_REF` (`.github/workflows/deploy.yml:52-55`). CI additionally
runs the full migration set from zero against a local stack on every push, then
**every SQL assertion suite** via the root `db:test:ci` script (delegates to
`db:test:all` — `.github/workflows/ci.yml:9-36`, `package.json:30-31`), so a
broken migration fails CI before deploy.

The initial schema migrations, in order (`supabase/migrations/` — later feature
waves appended more files on top of these, e.g. porting, tasks/attachments,
send-features, and the voice wave; the directory listing is the source of truth
and `db push` applies them all):

| File | Creates |
|---|---|
| `20260701000100_extensions_and_enums.sql` | extensions + all enums |
| `20260701000200_tables.sql` | tables |
| `20260701000300_rls.sql` | RLS enable + the one realtime policy + `mms-media` bucket |
| `20260701000400_triggers.sql` | triggers |
| `20260701001000_mms_storage.sql` | pins `mms-media` MIME types + asserts RLS posture |
| `20260701001100_messaging_functions.sql` | messaging RPCs |
| `20260701001200_provision_number_slot.sql` | number-slot RPC |
| `20260701010000_api_route_functions.sql` | route RPCs |
| `20260701020000_notification_debounce.sql` | notification debounce |
| `20260701030000_service_role_grants.sql` | service-role grants |
| `20260701040000_cancel_at_period_end.sql` | cancel-at-period-end column |
| `20260701050000_list_snippets_usage_history.sql` | snippets/usage history |
| `20260702000000_unread_excludes_own_sends.sql` | unread-count fix |
| `20260702010000_message_done_state.sql` | message done state |
| `20260702020000_company_timezone.sql` | company timezone |

### Extensions installed (migration, not dashboard)

Created in the `extensions` schema by the first migration
(`supabase/migrations/20260701000100_extensions_and_enums.sql:6-8`):

- `moddatetime` — `updated_at` maintenance
- `pg_trgm` — trigram search
- `citext` — case-insensitive text

No operator action; `supabase db push` installs them.

### The `mms-media` storage bucket (migration, not dashboard)

The bucket is created **by migration**, not in the Storage UI — do not create it
by hand.

- Inserted **private**, 5 MB limit, in the RLS migration
  (`supabase/migrations/20260701000300_rls.sql:84-86`).
- Its MIME allow-list is pinned by the storage migration:
  `image/jpeg, image/png, image/gif, image/webp`, 5 MB limit
  (`supabase/migrations/20260701001000_mms_storage.sql:8-19`).
- **No end-user storage RLS policies** — the bucket is service-role-only; the API
  mints short-lived signed URLs after membership checks
  (`20260701001000_mms_storage.sql:22-49`, `apps/api/src/messaging/media.ts:11,
  160-177`). The storage migration **asserts** this posture and fails loudly if
  RLS is ever off or an `mms-media` end-user policy appears
  (`20260701001000_mms_storage.sql:29-49`).

Bucket-relative object path is `{company_id}/{message_id}/{n}`
(`apps/api/src/messaging/media.ts:41-47`). Outbound media is uploaded here and
handed to Telnyx as 24-hour signed URLs (`media.ts:118-177`).

### RLS posture (defense-in-depth)

Every table has RLS enabled and there are **no** grants to `anon`/`authenticated`
on data tables (`supabase/migrations/20260701000300_rls.sql:9-39`). The only
end-user RLS policy is on `realtime.messages` for private company Broadcast
topics `company:{id}` (`20260701000300_rls.sql:41-76`). Nothing to configure —
the migration is the source of truth.

**Yields env vars:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`
(api); `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (web);
and the three GitHub secrets for the push (`SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`).
