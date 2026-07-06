# 02 — Supabase

Provision the database, Auth, and Storage. This produces four env values
(`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, the web publishable
key) and the three CI migration secrets. **The ES256 signing key in §2 is
mandatory** — skip it and every authenticated request 401s.

---

## 1. Create the project

1. Supabase → **New project**.
2. **Plan: Pro** (required, `SPEC.md:98`).
3. **Region: US East (`us-east-1`)** — single US region (`SPEC.md:98`).
4. **Postgres version: 17** — must match `supabase/config.toml:42` (`major_version = 17`)
   or `supabase db push` will refuse.
5. Set a strong **database password** — save it, it becomes `SUPABASE_DB_PASSWORD`.
6. After creation, note the **Project URL** (`https://<ref>.supabase.co`) and the
   **Project ref** (`<ref>`, the subdomain).

---

## 2. Enable an ES256 (asymmetric) JWT signing key — MANDATORY

The API verifies Supabase access tokens **locally**, ES256-only, against the
project JWKS (`apps/api/src/auth/jwt.ts:26-29,41-44`). With only the legacy HS256
secret, no JWKS is published and **every `/v1/*` request returns 401**
(`SPEC.md:100,1044`).

1. Supabase dashboard → **Authentication → JWT Keys** (a.k.a. Signing Keys).
2. **Add / rotate to an asymmetric key**, algorithm **ES256 (ECC P-256)**, and make
   it the **current (in-use)** key so tokens are minted with it.
3. Confirm the JWKS is published — it must serve keys at:

   ```
   https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
   ```

   The Worker consumes exactly this URL via `jose` `createRemoteJWKSet`
   (`apps/api/src/auth/jwt.ts:15-24,40`; canonical form asserted in
   `apps/api/src/test/support.ts:16-17`). It is edge-cached ~10 min.

The token contract the Worker enforces (`apps/api/src/auth/jwt.ts:41-44`):
`alg = ES256`, `iss = <SUPABASE_URL>/auth/v1`, `aud = authenticated`.

---

## 3. Collect the keys

Supabase dashboard → **Project Settings → API**:

| Value | Where | Env binding |
|-------|-------|-------------|
| Project URL `https://<ref>.supabase.co` | Settings → API | `SUPABASE_URL` (api secret) **and** `NEXT_PUBLIC_SUPABASE_URL` (web build) |
| **Secret key** `sb_secret_...` | Settings → API → **Secret keys** | `SUPABASE_SECRET_KEY` (api secret) |
| **Publishable key** `sb_publishable_...` | Settings → API → **Publishable key** | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (web build) |
| JWKS URL (constructed) | `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` | `SUPABASE_JWKS_URL` (api secret) |

Key facts:

- `SUPABASE_SECRET_KEY` is the **new `sb_secret_` key**, *not* the legacy
  `service_role` JWT. The Worker uses it for all PostgREST/Storage HTTP calls with
  `BYPASSRLS` semantics (`apps/api/src/db.ts:11-22`, `apps/api/src/env.ts:10`).
- The **browser never touches PostgREST**; the web app uses the `sb_publishable_`
  key only for Auth (`apps/web/src/env.ts:5`).

---

## 4. Apply migrations (`supabase link` + `supabase db push`)

Migrations run **before either Worker deploys** (`.github/workflows/deploy.yml:50-62`).
CI does this for you on merge to `main`; to run it manually:

```bash
# from the repo root, Supabase CLI installed and logged in
export SUPABASE_ACCESS_TOKEN=sbp_...          # personal access token
export SUPABASE_DB_PASSWORD=...               # the db password from §1

supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase db push
```

This is exactly what the deploy workflow runs (`.github/workflows/deploy.yml:54-56`).
The migrations under `supabase/migrations/` create, among other things:

- **Extensions** (in the `extensions` schema, *not* the dashboard):
  `moddatetime`, `pg_trgm`, `citext`
  (`supabase/migrations/20260701000100_extensions_and_enums.sql:6-8`).
- **RLS deny-by-default** on every table, no grants to `anon`/`authenticated`; the
  only end-user policy is realtime `company:{id}` broadcast topic authorization
  (`supabase/migrations/20260701000300_rls.sql:9-39,72-76`).
- The **`mms-media` storage bucket** — see §5.

The three CI secrets this step needs (set them in [05](./05-workers-deploy.md) §5):
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
(`.github/workflows/deploy.yml:52-55`).

---

## 5. The `mms-media` storage bucket — created BY MIGRATION

**Do not create this bucket in the dashboard.** It is created by migration as a
**private** bucket, 5 MB file-size limit, MIME allow-list
`image/jpeg, image/png, image/gif, image/webp`
(`supabase/migrations/20260701000300_rls.sql:84-86`,
`supabase/migrations/20260701001000_mms_storage.sql:8-19`).

There are **no end-user storage RLS policies** — the bucket is service-role only
(the Worker's `sb_secret_` key), and the migration **fails loudly** if RLS is ever
off or an `mms-media` end-user policy appears
(`supabase/migrations/20260701001000_mms_storage.sql:29-49`). The API mints
short-lived signed URLs after membership checks; object path is
`{company_id}/{message_id}/{n}` (`apps/api/src/messaging/media.ts:41-47`).

After `db push`, just **verify** the bucket exists (Storage → Buckets → `mms-media`,
private). If it's missing, the migration didn't run.

---

## 6. Signup CAPTCHA = Cloudflare Turnstile

Turnstile has **two halves** (`SPEC.md:1052`):

- **Secret key → Supabase dashboard**: Supabase → **Authentication → Attack
  Protection → CAPTCHA** → enable, provider **Turnstile**, paste your Cloudflare
  Turnstile **secret** key.
- **Site key → the web build**: the widget's **site** key is the optional
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` build var (`apps/web/src/env.ts:10`). When
  set, signup/login/reset-password render the Turnstile widget and pass its
  `captchaToken` to Supabase Auth; when unset, no captcha renders.

> **Order of operations — do NOT enable the dashboard setting first.** Once
> Supabase enforces captcha, any auth attempt without a `captchaToken` is
> rejected — a web build without the site key means **every email/password
> signup/login/reset breaks**. Set the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` GitHub
> Actions secret (the deploy workflow passes it into the web build,
> `.github/workflows/deploy.yml:23-26`), redeploy web, *then* flip the Supabase
> setting. See [06](./06-env-reference.md) §B.

---

## 7. Resend as Supabase Auth custom SMTP

Supabase Auth sends invite/signup/reset emails (e.g. `inviteUserByEmail`) via a
**custom SMTP = Resend** (`SPEC.md:100,832,1065`). This is separate from the API
Worker's own Resend usage.

1. In **Resend**: verify your sending domain (e.g. `loonext.app`) — add the DNS
   records Resend gives you, wait for verification.
2. In Resend, create an **SMTP** credential (or use the API-key-as-SMTP-password
   flow Resend documents) and note host/port/username/password.
3. Supabase → **Project Settings → Authentication → SMTP Settings** → enable custom
   SMTP, enter the Resend SMTP host/port/credentials, and set the **sender** to an
   address **at the verified Resend domain** (e.g. `notifications@loonext.app`).

> The API Worker's transactional email (billing notices, etc.) uses the Resend
> **REST API** with `RESEND_API_KEY` + `RESEND_FROM` — configured in
> [06](./06-env-reference.md), not here. Both must sit on the same verified domain.

---

## 8. What you now have

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL` → api Worker secrets.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → web build vars.
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` → GitHub
  Actions secrets.
- ES256 signing key live; migrations applied; `mms-media` bucket present; Turnstile
  + Resend-SMTP configured.

Next: [03 — Stripe](./03-stripe.md).
