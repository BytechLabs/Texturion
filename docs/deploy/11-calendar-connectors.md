# 11 - Calendar connectors (Google Calendar and Microsoft 365)

**Status: CURRENT DIRECTION (#323).** A per-vendor deep-dive on switching on the two-way calendar connectors (#245). The numbered set 01-08 is the operator walkthrough; this page is the console click path for the one step it leaves out.

The two-way connectors (#245, D137) are shipped and stay dark until their
secrets exist. Nothing here opens a new vendor account: the Google OAuth client
lives in a Google Cloud project under a Google account you already hold, and the
Microsoft app registration lives in an Entra directory under a Microsoft account
you already hold. If you hold no Microsoft account at all, say so on #245 and
leave Microsoft off: Google works without it, and the settings screen only
offers a provider whose secrets are set.

**Google, as set up on 2026-11-09.** Project `loonext-4125c` (Loonext) has:
- the Calendar API enabled;
- Google Auth Platform: External audience, in Testing, with the founder as the
  one test user;
- branding: home page, privacy and terms links, `loonext.com` as the authorized
  domain, `support@loonext.com` as developer contact;
- the two scopes below;
- the web client `Loonext calendar` with the production callback.

`loonext-api` holds `GOOGLE_CALENDAR_CLIENT_ID` and
`GOOGLE_CALENDAR_CLIENT_SECRET`.

Still open:
- the consent screen's user support email moves to `support@loonext.com`, a
  Google account on that address with OAuth Config Editor on the project;
- step 3;
- step 8;
- section D's round trip.

What each connector asks for, and why it is the narrowest that works:

| Provider | Scopes | Why |
|---|---|---|
| Google | `https://www.googleapis.com/auth/calendar.events.owned`, `https://www.googleapis.com/auth/calendar.calendars.readonly` | Write events on calendars the member owns; read the calendar list to pick one. No shared or delegated calendar writes, no contacts, no Gmail. |
| Microsoft | `Calendars.ReadWrite` (delegated), `offline_access` | Graph has no narrower delegated calendar write scope. |

The connector never reads an event it did not create (D143). The provider
delta call returns content-free notices and Loonext only fetches the ones that
map to a job.

Callback and webhook URLs (replace `API_ORIGIN` with the API's public origin,
`https://api.loonext.com` in production):

- Google redirect URI: `API_ORIGIN/calendar/oauth/google/callback`
- Microsoft redirect URI: `API_ORIGIN/calendar/oauth/microsoft/callback`
- Provider push receivers (set by the connector itself, listed so the domain can
  be registered): `API_ORIGIN/calendar/webhooks/google` and
  `API_ORIGIN/calendar/webhooks/microsoft`

## A. Encryption keyring (no console; do first)

The refresh credentials are stored as AES-GCM ciphertext under a keyring you
generate. Generate one 32-byte key and name its version:

```
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

The output is 43 characters. Then set two Worker secrets on `loonext-api`:

- `CALENDAR_TOKEN_ENCRYPTION_KEYS` = `{"v1":"<the 43 characters>"}`
- `CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY` = `v1`

To rotate later, add `v2` to the JSON, set the active key to `v2`, and keep `v1`
until every connection has been re-encrypted.

## B. Google

1. Open https://console.cloud.google.com and sign in with the Google account
   that owns Loonext. In the project picker (top bar) choose the Loonext
   project, or choose **New project** and name it `Loonext` (same account, no
   billing needed).
2. **APIs & Services** > **Library** > search **Google Calendar API** >
   **Enable**.
3. Verify `loonext.com` in Google Search Console (a Domain property, DNS TXT
   record on the Cloudflare zone) under the account that owns the project.
   Step 8 needs it, because Google checks the authorized domain's ownership
   there. The old **APIs & Services** > **Domain verification** page no longer
   exists: its console address answered "URL not found" on 2026-11-09.
4. **Google Auth Platform** (older consoles: **APIs & Services** > **OAuth
   consent screen**) > **Branding**: app name `Loonext`, user support email, app
   logo, application home page `https://loonext.com`, privacy policy
   `https://loonext.com/legal/privacy`, terms of service
   `https://loonext.com/legal/terms`, authorized domain `loonext.com`, developer
   contact email.
5. **Audience** > user type **External**. Leave **Publishing status** at
   **Testing** until step 8. In Testing, only the test users you list can
   connect and Google expires their refresh credentials after 7 days.
6. **Data Access** > **Add or remove scopes** > tick the two scopes in the table
   above (filter by `calendar.events.owned` and `calendar.calendars.readonly`) >
   **Update** > **Save**.
7. **Clients** > **Create client** > application type **Web application**, name
   `Loonext calendar` > **Authorized redirect URIs** > **Add URI** >
   `API_ORIGIN/calendar/oauth/google/callback` > **Create**. Copy the client id
   and the client secret.
8. Production use by anyone outside the test list needs Google's OAuth app
   verification. **Google Auth Platform** > **Verification Center** >
   **Prepare for verification**, then submit. Both scopes are sensitive, not
   restricted, so no third-party security assessment is required. Google asks
   for: the verified domain, the privacy policy link, a scope justification (use
   the table above: "creates and updates events for jobs the member scheduled in
   Loonext, and reads those same events back to apply reschedules; never reads
   other events"), and a screen recording of the full consent flow ending in a
   scheduled job appearing in the member's calendar. Review takes days to a few
   weeks. After approval, set **Audience** > **Publish app**.
9. Set the Worker secrets on `loonext-api`: `GOOGLE_CALENDAR_CLIENT_ID` and
   `GOOGLE_CALENDAR_CLIENT_SECRET`.

## C. Microsoft 365

1. Open https://entra.microsoft.com and sign in with the Microsoft account that
   owns Loonext. A personal Microsoft account gets a default directory for this;
   an Entra ID Free directory needs no Azure subscription.
2. **Entra ID** > **App registrations** > **New registration**. Name
   `Loonext calendar`. **Supported account types**: *Accounts in any
   organizational directory and personal Microsoft accounts*. **Redirect URI**:
   platform **Web**, value `API_ORIGIN/calendar/oauth/microsoft/callback` >
   **Register**.
3. On the **Overview** page copy **Application (client) ID**.
4. **Certificates & secrets** > **Client secrets** > **New client secret** >
   description `loonext-api`, the longest expiry offered > **Add**. Copy the
   **Value** immediately (not the Secret ID). Put the expiry date in your
   calendar: the connector stops refreshing the day it passes.
5. **API permissions** > **Add a permission** > **Microsoft Graph** >
   **Delegated permissions** > tick `Calendars.ReadWrite` and `offline_access`
   (`User.Read` is already there) > **Add permissions**. Do not click **Grant
   admin consent**: members consent for themselves.
6. Optional: **Branding & properties** > set the app name, logo, home page,
   terms and privacy URLs shown on the consent prompt. Publisher verification
   needs a Microsoft Cloud Partner Program enrolment, which is a separate
   Microsoft program, so skip it. Without it, a member whose organization
   blocks unverified apps asks their administrator for consent, and the
   connect screen reports the refusal.
7. Leave `MICROSOFT_CALENDAR_TENANT` unset (it defaults to `common`, matching
   step 2). Set the Worker secrets `MICROSOFT_CALENDAR_CLIENT_ID` and
   `MICROSOFT_CALENDAR_CLIENT_SECRET`.

## D. Set the secrets and check

From `apps/api`, once per secret (each prompts for the value, so nothing lands
in shell history):

```
pnpm exec wrangler secret put GOOGLE_CALENDAR_CLIENT_SECRET
```

Then `pnpm exec wrangler secret list` shows the names (never the values). A
provider is offered on Settings > Calendar only when its client id, client
secret and the keyring are all set. Connect one calendar of your own, schedule a
job assigned to you, and confirm the event appears within a minute, then move it
in the calendar and confirm the job follows.
