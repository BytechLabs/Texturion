# Loonext brand (#206)

The double-o is THE mark. Everything in this directory is the source of
truth; every raster the platforms use is generated from it.

## The mark

The "oo" of Loonext: two thick rings, the second one colored. Sources:

- `loonext-mark.svg` - bare mark, light contexts (ink + olive rings)
- `loonext-tile.svg` - app tile: mark on paper, hairline border (favicons, app icons)
- `loonext-tile-unread.svg` - tile + coral presence dot (unread favicon swap)
- `loonext-tile-dark.svg` - ink tile, paper + lime rings (dark contexts, og)
- `loonext-maskable.svg` - full-bleed paper, mark in the 80% safe zone (PWA maskable)

## The wordmark

"Loonext" set in **Golos Text SemiBold**, with the **second o** in the
accent: olive `#66801F` on light surfaces, lime `#B9CF57` on dark. Always
the second o, never both, never the first. Implemented in code per platform
(CSS/Compose/SwiftUI spans), not as an image, so it scales and themes.

## Palette (Paper & Olive)

| Role | Light | Dark |
| --- | --- | --- |
| Ink ring / text | `#191B14` | `#F0F1E5` |
| Colored ring / o | `#66801F` | `#B9CF57` |
| Tile | `#FDFDF9` | `#191B14` |
| Presence dot | `#D96C47` | `#D96C47` |

## Regenerating rasters

```bash
node brand/generate.mjs
```

Writes web favicons/PWA icons/og card into `apps/web/public/` and the iOS
1024 source into `brand/out/`. Uses the repo's Golos face via
`fonts.conf`; no system font install needed. Android's launcher icon is a
vector drawable (no rasters) - see `apps/android/.../res/drawable/`.
