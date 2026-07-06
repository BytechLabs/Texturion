import { ImageResponse } from "next/og";

/**
 * Default OpenGraph image for the marketing route group, rebuilt for the
 * "Open all night" identity (design spec §1, §4; copy deck FINAL metadata):
 * 1200×630, dark petrol ground #041F1C (never neutral black, spec §9), ONE
 * amber-lit inbound bubble carrying the deck's verbatim bubble text, a petrol
 * reply on its way back (the alt text's promise), the Loonext wordmark, the
 * 9:47 PM clock stamp, and the footer line "One inbox. The whole crew. $29
 * flat."
 *
 * Built with next/og's ImageResponse (Satori: inline flexbox only). We do NOT
 * set `runtime = 'edge'`. OpenNext forbids the Edge runtime (SPEC §3), so this
 * renders on the Node runtime. Satori cannot parse the self-hosted woff2 fonts
 * (Besley/Public Sans ship woff2-only), so it uses Satori's built-in font and
 * the card leans on color and composition: the lamp engine is recreated as
 * pre-painted layered radial gradients (Satori supports radial-gradient;
 * box-shadow is unreliable, so glows are gradient divs, exactly like the
 * page's own pre-rendered glow pseudos, spec §4).
 *
 * Individual pages may add their own opengraph-image to override this default.
 */

// Alt text verbatim from the copy deck FINAL metadata block.
export const alt =
  "A text message glowing warm out of a dark petrol screen at 9:47 pm, with a reply on its way back.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Night-act palette (hex literals: Satori doesn't evaluate CSS variables).
const INK_11PM = "#041F1C"; // primary dark ground
const INK_MIDNIGHT = "#02110F"; // vignette's darkest edge
const CAB_PANEL = "#0A312C"; // raised surface: the inbound bubble
const PETROL = "#0F766E"; // brand anchor: outbound bubble, wordmark tile
const SIGNAL_AQUA = "#3FD5C0"; // live signal on dark: wordmark accent
const MOONLIGHT = "#EAF4F0"; // text on dark grounds
const DUSK = "#8FB3AC"; // secondary text: the clock stamp
const WHITE = "#FFFFFF";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px",
          position: "relative",
          backgroundColor: INK_11PM,
          // Pre-painted static vignette (spec §6 S1): one luminance step of
          // cab-panel at the lamp's center falling to midnight at the edges,
          // hue-locked petrol throughout so the ground never reads as black.
          backgroundImage: `radial-gradient(circle at 32% 38%, ${CAB_PANEL} 0%, ${INK_11PM} 52%, ${INK_MIDNIGHT} 100%)`,
        }}
      >
        {/* Lamp engine, wide amber spill: porch-amber falloff across the card
            so the darkness visibly carries the incoming light (spec §4). */}
        <div
          style={{
            position: "absolute",
            left: -260,
            top: -420,
            width: 1400,
            height: 1400,
            backgroundImage:
              "radial-gradient(circle, rgba(255,180,84,0.10) 0%, rgba(255,180,84,0.03) 38%, rgba(255,180,84,0) 60%)",
          }}
        />
        {/* Lamp engine, warm core: amber-core -> porch-amber 35% -> transparent,
            centered behind the inbound bubble (the spec §4 gradient recipe; the
            opaque bubble covers the hot center, edges halo around it). Kept
            tight so the ground stays visibly petrol, never olive (spec §1:
            the amber is lamplight around the message, not a wash). */}
        <div
          style={{
            position: "absolute",
            left: 100,
            top: -105,
            width: 720,
            height: 720,
            backgroundImage:
              "radial-gradient(circle, rgba(255,244,223,0.42) 0%, rgba(255,180,84,0.26) 32%, rgba(255,180,84,0) 66%)",
          }}
        />
        {/* Outbound cool glow: signal-aqua at low intensity behind the reply,
            "two kinds of light meeting in the dark" (spec §4). */}
        <div
          style={{
            position: "absolute",
            left: 784,
            top: 125,
            width: 560,
            height: 560,
            backgroundImage:
              "radial-gradient(circle, rgba(63,213,192,0.20) 0%, rgba(63,213,192,0) 60%)",
          }}
        />

        {/* Clock stamp: the page's eyebrow hour, dusk secondary text. */}
        <div
          style={{
            color: DUSK,
            fontSize: 27,
            letterSpacing: "0.08em",
          }}
        >
          9:47 PM
        </div>

        {/* The thread: one amber-lit inbound bubble, one reply on its way. */}
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {/* Inbound bubble: cab-panel surface, porch-amber rim (the lit-state
              1px rim of spec §4, drawn at 2px because this 1200px card is
              displayed at ~600px). Radius 24 = the product's real 12px bubble
              radius at the card's 2x scale. Bubble text verbatim from the deck. */}
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: 800,
              backgroundColor: CAB_PANEL,
              border: "2px solid rgba(255,180,84,0.65)",
              borderRadius: 24,
              padding: "30px 38px",
              color: MOONLIGHT,
              fontSize: 40,
              lineHeight: 1.35,
            }}
          >
            Water heater’s leaking into the garage. Too late to text?
          </div>
          {/* The reply on its way back (per the alt text): a petrol outbound
              bubble with a typing ellipsis. No text, no claim of delivery. */}
          <div
            style={{
              alignSelf: "flex-end",
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 30,
              backgroundColor: PETROL,
              borderRadius: 24,
              padding: "26px 32px",
            }}
          >
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                backgroundColor: "rgba(234,244,240,0.95)",
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                backgroundColor: "rgba(234,244,240,0.60)",
              }}
            />
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: 999,
                backgroundColor: "rgba(234,244,240,0.35)",
              }}
            />
          </div>
        </div>

        {/* Footer row: wordmark left, the deck's footer line right. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Wordmark with the loon mark; "ext" carries signal-aqua, the
              interactive-light color on dark grounds (petrol is too dim
              against ink-11pm for small type). */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width={60} height={60} viewBox="0 0 512 512">
              <rect width="512" height="512" rx="128" ry="128" fill={PETROL} />
              <path
                fill={WHITE}
                d="M 196 396 C 178 330 186 256 236 222 C 228 178 262 150 302 152 C 330 154 346 168 348 180 L 436 170 L 350 202 C 352 216 346 246 324 264 C 302 308 298 352 302 396 Z"
              />
              <circle cx="300" cy="198" r="15" fill={PETROL} />
            </svg>
            <div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>
              <span style={{ color: MOONLIGHT }}>Loon</span>
              <span style={{ color: SIGNAL_AQUA }}>ext</span>
            </div>
          </div>

          {/* Footer line verbatim from the copy deck's OG image copy. */}
          <div style={{ color: MOONLIGHT, fontSize: 29 }}>
            One inbox. The whole crew. $29 flat.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
