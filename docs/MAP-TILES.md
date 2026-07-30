# Map tiles: where the basemap comes from (#428)

**The Map view ships with no basemap.** Pins, clustering and "you are here" all
work; the street background does not, until a provider is configured. That is the
deliberate state, and this document is how to change it.

---

## 1. Why it is not just switched on

It used to be. Web served `tile.openstreetmap.org` and Android used osmdroid's
`TileSourceFactory.MAPNIK`, which is the same host. That host is the **OpenStreetMap
Foundation's own infrastructure, run on donated resources.** Their Tile Usage Policy
exists for OSM's own use and light third-party use, prohibits heavy use, and
requires permission for commercial applications.

We are a paid product serving those tiles to every customer who opened the Map. The
attribution was correct — the source was not ours to use.

**The enforcement is a silent block.** The OSMF blocks by user-agent and referrer,
and a blocked map simply stops drawing tiles. Markers still plot, the page still
loads, nothing throws. It is the same absence-shaped failure as #387, and it arrives
when the feature is being used *most*, because tile requests scale with usage.

**So the code fails toward no basemap, never toward somebody else's goodwill.** With
nothing configured the map is worse and honest. Keeping the OSM URL as a fallback
would have meant the compliant path was the one nobody was on.

`lib/maps/basemap.ts` and `features/tasks/Basemap.kt` both **refuse
`tile.openstreetmap.org` even if it is configured**, so the violation cannot come
back through a copied `.env`, a tutorial, or a well-meant "restore the map" fix.
Tests cover both the refusal and the over-blocking direction.

**iOS is unaffected.** `TaskMapView.swift` uses MapKit — Apple's own tiles under the
platform terms — so it never had this problem and needs no key.

---

## 2. Turning it on

Pick any provider whose terms permit a **paid product** to serve their tiles. The
requirement is a URL template and the credit line they specify. Leaflet and osmdroid
both stay; only configuration changes.

**Web** (`apps/web`, Cloudflare Worker env or `.env.local`):

```
NEXT_PUBLIC_MAP_TILE_URL=https://<provider>/{z}/{x}/{y}.png?key=<your-key>
NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=<the provider's required credit HTML>
NEXT_PUBLIC_MAP_TILE_MAX_ZOOM=19
```

**Android** (`apps/android/app/build.gradle.kts`, the `buildConfigField` pair):

```kotlin
buildConfigField("String", "MAP_TILE_URL", "\"https://…/{z}/{x}/{y}.png?key=…\"")
buildConfigField("String", "MAP_TILE_ATTRIBUTION", "\"…\"")
```

**Both values are required together.** A URL with no attribution is treated as no
basemap, because a tile source with no credit is the same licensing problem wearing
a different provider's name.

---

## 3. What to record when you choose one

Per #424, a new external dependency should be understood before it can surprise us.
When the provider is picked, write down here:

| | |
|---|---|
| **Provider** | _to be filled in_ |
| **Free-tier ceiling** | _requests/month, and what happens at the ceiling_ |
| **Behaviour when exceeded** | hard block, throttle, or overage billing? |
| **Where the key lives** | Worker env + `build.gradle.kts`; never committed for web |
| **Attribution string** | verbatim, as the provider requires |
| **Terms reviewed on** | _date_ |

**The ceiling matters more than the price.** Per the cost-protection posture, a
provider that bills overage silently is a worse choice than one that blocks, because
a block is visible and a bill is not. If the chosen provider bills for overage, that
belongs in the usage-alert path rather than left to a monthly invoice.

**Attribution is not optional and not ours to word.** Most providers require crediting
both themselves *and* OpenStreetMap where OSM data underlies their tiles. Copy their
string; do not paraphrase it.

---

## 4. Knowing when tiles stop drawing

A map that renders no tiles looks exactly like a map with no pins, which is why the
original problem could have run for months unnoticed. Two things now make it
visible:

- **The unconfigured state is stated in the UI**, not left blank — the same sentence
  on web and Android, asserted by a test in each so they cannot drift.
- **Tile failures are counted and surfaced** once they stop looking incidental
  (`lib/maps/tile-health.ts`): the map says the background is not loading and that
  the pins are still exact, and a marked line goes to the console. The counter does
  not reset on a success, because a provider serving *some* tiles is still a provider
  with a problem.

**Said plainly: this is not server-side alerting, and it should not be described as
such.** Client Sentry is unreliable in this product — ad blockers eat it, and the
tunnel was declined — so nobody is paged when a basemap stops drawing. What exists is
(a) the customer sees an honest sentence instead of a blank grid, and (b) a support
session can find the console marker.

**Closing that gap properly means a server-side probe**, which is #477's scope
(synthetic checks with history). A tile fetch from the Worker on a schedule would
turn "a crew member mentioned the map looks odd" into an alert. Until then the
honest statement is the one above: we notice faster than before, and we are not
paged.
