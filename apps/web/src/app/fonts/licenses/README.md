# Font licenses

Every typeface this web app serves, and the license that has to travel with it.

**Serving a `.woff2` from our own origin is redistribution.** That is what makes
these files an obligation rather than a courtesy: SIL OFL 1.1 §2 permits the
redistribution outright, but only "provided that each copy contains the above
copyright notice and this license". So a font whose license is not in this
directory is one we are shipping outside its terms.

That includes the `next/font/google` faces. Next.js **downloads them at build
time and self-hosts them from our origin** — it does not hot-link Google — so
they redistribute exactly like the two local files do, and they are in the table
for the same reason (#429).

| Family | Where it renders | Loaded by | License | Upstream | File here |
|---|---|---|---|---|---|
| Golos Text | App shell — replaces Inter in `(app)` | `next/font/local`, `src/lib/app/fonts.ts` | SIL OFL 1.1 | github.com/googlefonts/golos-text | `GolosText-OFL.txt` |
| Inter | `<body>` root, so marketing and anything outside `(app)` | `next/font/local`, `src/app/layout.tsx` | SIL OFL 1.1 | github.com/rsms/inter | `Inter-OFL.txt` |
| Bricolage Grotesque | Marketing display (H1/H2, wordmark) | `next/font/google`, `src/lib/marketing/fonts.ts` | SIL OFL 1.1 | github.com/ateliertriay/bricolage | `BricolageGrotesque-OFL.txt` |
| Hanken Grotesk | Marketing body | `next/font/google`, `src/lib/marketing/fonts.ts` | SIL OFL 1.1 | github.com/marcologous/hanken-grotesk | `HankenGrotesk-OFL.txt` |
| Spline Sans Mono | Marketing mono — every countable truth | `next/font/google`, `src/lib/marketing/fonts.ts` | SIL OFL 1.1 | github.com/SorkinType/SplineSansMono | `SplineSansMono-OFL.txt` |

Each file is the upstream `OFL.txt`/`LICENSE.txt` verbatim, copyright line
included. Do not hand-edit them.

## Subsetting

`src/app/fonts/GolosText.woff2` is a latin subset produced by
`scripts/subset-app-fonts.mjs` from `scripts/fonts-src/GolosText-Variable.ttf`.
Subsetting is a modification the OFL permits, and it does not change the
obligation — the license still ships, which is why the row above is unchanged.

## Not shipped

`scripts/fonts-src/display-candidates/` and `mono-candidates/` hold Basteleur and
Commit Mono, which were **evaluated and not chosen**. They are never imported,
never built and never served, so they redistribute nothing and need no row. (The
previous version of this file named them as the live marketing trio and pointed
at a `../marketing/licenses/` directory that has never existed.) If one is ever
adopted, its license belongs here before it ships.

## Adding a font

Put its license in this directory and add a row, in the same commit that adds the
font. `packages/shared/src/font-licenses.test.ts` fails otherwise — this
directory went a whole release with Inter missing precisely because the
obligation was met from memory rather than by a check.

The wider third-party asset list — icons, map tiles, geocoding, AI models —
lives in `docs/THIRD-PARTY-ASSETS.md`.
