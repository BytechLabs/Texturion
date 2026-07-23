import { ImageResponse } from "next/og";

/**
 * OpenGraph image for /pricing, v4 "FIRST RESPONSE" palette: Signal White
 * ground, a cobalt left rule, Dispatch Ink title, the wordmark bottom-left,
 * and the "$29/mo flat" truth chip bottom-right. Same Satori/Node-runtime
 * constraints as the route-group default (no runtime='edge'; OpenNext forbids
 * it, SPEC §3; Satori built-in font).
 */
export const alt = "Loonext pricing, $29/mo flat for the whole crew";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GROUND = "#FBFCFE";
const INK = "#10173B";
const COBALT = "#2740DE";
const WHITE = "#FFFFFF";
// Brand identity on light grounds (#206, brand/README.md): ink + olive.
const BRAND_INK = "#191B14"; // first ring
const BRAND_OLIVE = "#66801F"; // second ring + the wordmark's second o

export default function PricingOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: GROUND,
          position: "relative",
        }}
      >
        {/* Cobalt left rule */}
        <div style={{ width: 16, height: "100%", backgroundColor: COBALT }} />

        {/* Content column */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "72px 80px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                display: "flex",
                fontSize: 28,
                fontWeight: 600,
                color: COBALT,
              }}
            >
              Pricing
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 68,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                color: INK,
                maxWidth: 900,
              }}
            >
              One price for the whole crew. Nothing hidden.
            </div>
          </div>

          {/* Footer row: wordmark left, truth chip right */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {/* The double-o mark + wordmark (#206, brand/README.md): ink +
                olive rings on this light ground; the wordmark's SECOND o
                takes the olive accent — spans, never an image. */}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <svg width={56} height={56} viewBox="0 0 512 512">
                <circle
                  cx="136"
                  cy="256"
                  r="86"
                  fill="none"
                  stroke={BRAND_INK}
                  strokeWidth={52}
                />
                <circle
                  cx="376"
                  cy="256"
                  r="86"
                  fill="none"
                  stroke={BRAND_OLIVE}
                  strokeWidth={52}
                />
              </svg>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 600 }}>
                <span style={{ color: INK }}>Lo</span>
                <span style={{ color: BRAND_OLIVE }}>o</span>
                <span style={{ color: INK }}>next</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 24px",
                borderRadius: 999,
                backgroundColor: COBALT,
                color: WHITE,
                fontSize: 30,
                fontWeight: 600,
              }}
            >
              $29/mo flat
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
