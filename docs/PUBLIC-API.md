# The public API, and what we promise about it

**Status: CURRENT DIRECTION (#243).** This is the compatibility promise itself,
not a description of one — the numbers below (twelve months, the notice points)
are the commitment. Where it disagrees with `docs/DECISIONS.md`, that file wins.

#243 asks for "versioning and deprecation policy from day one", in those
terms: *"A public API is a promise; shipping one without a stated compatibility
policy means the first breaking change is a support incident."*

This is that policy. It is short on purpose — a promise nobody can hold in
their head is one we will break by accident.

Every fact below cites the source that makes it true.

---

## What exists

Base path `/public/v1`
(`packages/shared/src/api-keys.ts` → `PUBLIC_API_BASE`), mounted at the Worker
root rather than under `/v1` (`apps/api/src/index.ts`). The first-party `/v1`
is a **different door with a different credential** and is not covered by
anything here: it changes shape whenever the product does, and no outside
integration should be built against it.

| Method | Path | Scope | Capability |
|---|---|---|---|
| GET | `/public/v1/me` | none | — |
| GET | `/public/v1/contacts` | `contacts:read` | `conversations.read` |
| POST | `/public/v1/contacts` | `contacts:write` | `conversations.note` |
| GET | `/public/v1/conversations` | `conversations:read` | `conversations.read` |
| GET | `/public/v1/conversations/:id/messages` | `messages:read` | `conversations.read` |
| POST | `/public/v1/messages` | `messages:send` | `conversations.send` |
| GET | `/public/v1/tasks` | `tasks:read` | `conversations.read` |
| POST | `/public/v1/tasks` | `tasks:write` | `conversations.note` |

Defined in `apps/api/src/routes/public-api.ts`. Every route carries **two**
gates: the scope the key was granted, and the capability the person who created
the key holds. See `apps/api/src/auth/api-key.ts`.

Outbound webhooks are the other half and are documented by their own contract
in `packages/shared/src/webhook-events.ts`.

---

## Authentication

`Authorization: Bearer lnx_…`. Keys are created in Settings → API keys and
shown exactly once; we store a SHA-256 and the first twelve characters
(`supabase/migrations/20260814070000_a_key_can_do_less_than_the_person_who_made_it.sql`).

A key **acts as the person who created it**, narrowed by its scopes, with that
person's membership and per-number visibility resolved live on every request.
Two consequences worth stating plainly to an integrator:

- A key never outlives its creator's access. If they leave the workspace or
  lose sight of a number, the key loses it on the next request.
- A key created by a bookkeeper reaches less than one created by an owner, with
  identical scopes.

---

## What "v1" promises

While `v1` exists:

1. **A field we publish will not be removed or change meaning.** New fields may
   be added, so parse permissively — an unknown field is not an error.
2. **A route will not be removed, and its method and path will not change.**
3. **An event name in `WEBHOOK_EVENT_TYPES` will not be removed or repurposed.**
   New ones may be added; a receiver should ignore names it does not know.
4. **The signature scheme will not change under `v1=`.** A `v2=` may appear
   alongside it; a receiver checking `v1=` keeps working.
5. **Error codes** come from the shared table
   (`packages/shared/src/error-codes.ts`) and their HTTP statuses will not
   change.

What is explicitly **not** promised:

- **Ordering beyond what a route documents.** Lists are newest-first; nothing
  else about order is stable.
- **Rate limits.** `API_KEY_REQUESTS_PER_MINUTE` may rise or fall. Handle 429.
- **Response timing.** Webhook delivery is best-effort with retries; nothing
  here is synchronous with the event that caused it.
- **The first-party `/v1` API**, in any respect.

---

## How a breaking change would happen

A breaking change means a new version path — `/public/v2` — served **beside**
`v1`, never replacing it under a running integration. Every response carries
`Loonext-Api-Version` (`PUBLIC_API_VERSION_HEADER`), so a client that pins
nothing is still told what answered.

When `v1` is eventually retired:

1. It is announced in the product's What's new and by email to every workspace
   holding a live key. We know exactly who they are — `api_keys.last_used_at`
   says who is still calling.
2. **At least 12 months** pass between the announcement and the shutdown.
3. Six months in, and again one month in, we email the workspaces whose keys
   are still calling `v1`.

Twelve months is chosen to be longer than the gap between a contractor's
integrator finishing a job and being asked back. A policy measured in weeks is
one that breaks somebody's business on a Tuesday.

---

## Retention of what the API touches

Webhook delivery payloads are copies of message content and are pruned at 30
days (`docs/PERSONAL-DATA-INVENTORY.md` §5,
`api_prune_webhook_deliveries`). API keys and their revocations are kept for the
life of the workspace, because "when was that turned off, and by whom" is an
incident question.

---

## Related

- `packages/shared/src/api-keys.ts` — scopes, caps, the version constants.
- `packages/shared/src/webhook-events.ts` — event names, signature, retry.
- `docs/PERSONAL-DATA-INVENTORY.md` — what the tables behind this hold.
- `docs/DECISIONS.md` — the decisions this rests on.
