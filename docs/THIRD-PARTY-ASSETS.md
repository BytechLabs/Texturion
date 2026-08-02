# Third-party assets: what each one obliges us to do, and where that is done

**Status: CURRENT DIRECTION (#429).** Describes how the product works today.
Where it disagrees with `docs/DECISIONS.md`, that file wins.

This is the list for assets we **ship or call** — fonts, icons, map tiles,
geocoding, AI models. It is the asset-level companion to the provider-level
sub-processor list; that one answers "whose servers see customer data", this one
answers "what did we promise the author in exchange for using this for free".

## Why the list exists at all

Every row here was, at some point, handled correctly by whoever added the asset,
at the moment they added it, from whatever they happened to read. That works
right up until an asset has **two** obligations, or arrives **beside one already
handled** — and then it silently does not:

- OpenStreetMap tiles carried attribution *and* commercial-use terms. The
  attribution was right; the tile source was never licensed for a paid product
  (#428).
- Inter arrived next to Golos Text, whose OFL was already filed. Inter's was not,
  and stayed missing for a release (#429).

Free assets are the ones nobody revisits, because there was no invoice and no
contract to file. So the obligation is written down, and — where it can be — it
is checked by something that fails.

## Fonts

All five typefaces the web app serves are SIL OFL 1.1, and all five licenses are
filed in `apps/web/src/app/fonts/licenses/`, which carries the per-font table.

**The obligation:** OFL 1.1 §2 permits redistribution "provided that each copy
contains the above copyright notice and this license". Serving a `.woff2` from
our origin **is** redistribution — including the `next/font/google` faces, which
Next.js downloads at build time and self-hosts rather than hot-linking.

**Where it is satisfied:** upstream license text, verbatim, one file per family,
in that directory. **Enforced by** `packages/shared/src/font-licenses.test.ts`,
which fails when a font is loaded without a license on file.

## Icons

| Asset | License | Obligation | Where satisfied |
|---|---|---|---|
| `lucide-react` 1.23.0 | ISC (verified in the installed package, not assumed) | Retain the copyright notice and permission notice in copies | The package's own `LICENSE` ships in the dependency tree; nothing is vendored or re-published under our name |

**Phosphor is not a dependency.** The house UI guidance names Phosphor *or*
Lucide; the codebase uses Lucide alone. Checked rather than assumed, because
assuming is what produced #429. No row is needed until one is added.

## Maps and geocoding

| Asset | Obligation | Where satisfied |
|---|---|---|
| Basemap tiles | A provider's terms must permit a **paid product** to serve their tiles | **Nothing is shipped.** The Map has no basemap until a provider is configured, and `apps/web/src/lib/maps/basemap.ts` plus `apps/android/app/src/main/kotlin/com/loonext/android/features/tasks/Basemap.kt` both *refuse* `tile.openstreetmap.org` even if configured, so the violation cannot return through a copied `.env`. See `docs/MAP-TILES.md` (#428) |
| Nominatim geocoding | Max 1 request/second, and a descriptive `User-Agent` with a real contact | `apps/api/src/geocode/nominatim.ts` — `NOMINATIM_MIN_INTERVAL_MS = 1000` paced by the caller, and `NOMINATIM_USER_AGENT` identifying the app. The policy URL is cited in the file. Both were deliberate (D25) |
| iOS map | Apple's platform terms | `TaskMapView.swift` uses MapKit, so it never needed a key or a tile licence |

## AI models (Workers AI)

We call Cloudflare's hosted inference. **We do not download, host, redistribute
or fine-tune any model**, which is what decides most of the column below.

| Model | Used for | Upstream license | What it obliges *us* to do |
|---|---|---|---|
| `@cf/openai/whisper-large-v3-turbo`, `@cf/openai/whisper` | Voicemail transcription | MIT (github.com/openai/whisper, © 2022 OpenAI) | Nothing beyond MIT's notice retention, which binds the party distributing the software. We distribute none of it |
| `@cf/meta/llama-3.1-8b-instruct-fast`, `@cf/meta/llama-3.2-1b-instruct` | Lou — reply drafting, enrichment | Llama 3.1 / 3.2 Community License, © Meta Platforms | See below |

**The Llama attribution question, answered rather than left open.** §1.b.i
requires that a party who "distribute[s] or make[s] available the Llama
Materials … or a product or service … that **contains** any of them" prominently
display "Built with Llama". Our product contains no Llama Materials — it calls an
API that Cloudflare makes available, and Cloudflare is the party that clause
binds. The training clause does not apply either: we do not use outputs to
create, train or fine-tune a model.

What *does* flow down is the **Llama Acceptable Use Policy**, since it governs
use of the outputs.

So: the display requirement is **not triggered**, on a reading of the actual
clause rather than a cautious guess. Displaying "Built with Llama" anyway is
cheap and would remove the question permanently — that is a call for the founder,
not a compliance gap, and it is recorded here so it is not rediscovered from
scratch a third time.

## Adding an asset

Add the row **in the same commit** that adds the asset, and say where the
obligation is satisfied — not that it will be. A row reading "TBD" is the state
this document exists to prevent.

For fonts specifically, a missing license fails
`packages/shared/src/font-licenses.test.ts`. The other categories are too varied
for one mechanical check, so they rely on this list being part of the change.

## What is deliberately not here

- **Dependency licenses at large.** #429 noted, correctly, that a shallow scan of
  top-level `node_modules` manifests is not a license audit: it misses transitive
  depth and depends on what was installed locally. This document covers assets we
  *ship or call*, which is a smaller and answerable set. A real
  SPDX-level dependency audit is separate work and should be filed as its own
  issue rather than half-done here.
