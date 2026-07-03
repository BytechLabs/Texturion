# App font licenses

The self-hosted APP typeface (see `src/lib/app/fonts.ts`) and its license terms.
Free for commercial use and redistribution with its license included.

| Family | Role | License | Source | License file here |
|---|---|---|---|---|
| Golos Text | App primary sans | SIL OFL 1.1 | github.com/google/fonts ofl/golostext | `GolosText-OFL.txt` |

The shipped `src/app/fonts/GolosText.woff2` is a latin subset produced by
`scripts/subset-app-fonts.mjs` from the unsubset source in `scripts/fonts-src/GolosText-Variable.ttf`.
Subsetting preserves the license. Golos Text REPLACES Inter in the (app) subtree; the marketing trio
(Basteleur / Hanken Grotesk / Commit Mono) is licensed separately under `../marketing/licenses/`.
