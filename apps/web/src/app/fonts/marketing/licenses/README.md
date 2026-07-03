# Marketing font licenses

The self-hosted marketing type trio (see `src/lib/marketing/fonts.ts`) and its license terms.
All three are free for commercial use and redistribution with their license included.

| Family | Role | License | Source | License file here |
|---|---|---|---|---|
| Basteleur (Bold, Moonlight) | Display | SIL OFL 1.1 | Velvetyne, gitlab.com/velvetyne/basteleur | `Basteleur-OFL.txt` (TO VENDOR, see below) |
| Hanken Grotesk | Body | SIL OFL 1.1 | github.com/google/fonts ofl/hankengrotesk | `HankenGrotesk-OFL.txt` |
| Commit Mono | Mono | MIT | github.com/eigilnikolajsen/commit-mono | `CommitMono-LICENSE-MIT.txt` |

The shipped woff2 are latin subsets produced by `scripts/subset-marketing-fonts.mjs` from the
unsubset sources in `scripts/fonts-src/`. Subsetting preserves the license.

Open item (flagged for final verification): the Basteleur `OFL.txt` did not fetch from the raw
gitlab URLs tried. Vendor the exact `OFL.txt` from the Velvetyne Basteleur repository (the SIL OFL
1.1 text with Basteleur's own copyright line) into `Basteleur-OFL.txt` before release. The font is
OFL and free for commercial use; only the accompanying license file is pending.
