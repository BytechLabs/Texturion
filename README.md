<img src="brand/loonext-mark.svg" alt="The Loonext double-o mark" width="72">

# Loonext

Loonext is a shared SMS inbox for small service businesses. A company buys a
subscription, gets a local business phone number, and every incoming text becomes
a conversation the whole team can see, reply to, assign, tag, note, and close.

`SPEC.md` is the authoritative build specification. `docs/DECISIONS.md` records
the binding product decisions (D1–D13). `brand/README.md` is the brand source of
truth: the double-o mark, the tiles, and the wordmark rule ("Loonext" in Golos
Text SemiBold with the second o in the accent color).

## Layout

```
apps/
  web/            Next.js 15 UI, deployed to Cloudflare Workers via @opennextjs/cloudflare
  api/            Hono Worker: /v1 API, /webhooks, Cron Triggers
packages/
  shared/         Code shared by web + api (error codes; schemas/constants land later)
brand/            Brand source of truth: double-o mark SVGs + raster generator (brand/README.md)
supabase/         config.toml + migrations/
.github/workflows CI (typecheck, lint, test, build) and deploy (wrangler + supabase db push)
```

## Development

Requires Node >= 22 and pnpm 9.

```
pnpm install
pnpm --filter @loonext/web dev      # Next.js dev server
pnpm --filter @loonext/api dev      # wrangler dev (needs apps/api/.dev.vars — see .dev.vars.example)
pnpm typecheck                      # tsc across all packages
pnpm lint                           # eslint across all packages
pnpm test                           # vitest across all packages
pnpm --filter @loonext/web build    # next build
pnpm --filter @loonext/web preview  # OpenNext build + local Workers preview
```

Environment:

- `apps/api/.dev.vars` — Worker secrets for local dev (`apps/api/.dev.vars.example`
  lists every required name). Production values are Worker encrypted secrets set
  from GitHub Actions.
- `apps/web/.env.local` — the two `NEXT_PUBLIC_*` variables (`apps/web/.env.example`).
  A missing variable fails `next dev`/`next build` loudly.

Production builds and deploys run on Linux CI (GitHub Actions) — OpenNext does not
guarantee Windows support locally (SPEC §3). Pushes to `main` deploy both Workers
and push Supabase migrations after CI passes.
