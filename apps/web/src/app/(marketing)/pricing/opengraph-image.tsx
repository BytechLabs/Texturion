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
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <svg width={56} height={56} viewBox="0 0 512 512">
                <rect width="512" height="512" rx="128" ry="128" fill={INK} />
                <path
                  fill={WHITE}
                  d="M 196 396 C 178 330 186 256 236 222 C 228 178 262 150 302 152 C 330 154 346 168 348 180 L 436 170 L 350 202 C 352 216 346 246 324 264 C 302 308 298 352 302 396 Z"
                />
                <circle cx="300" cy="198" r="15" fill={INK} />
              </svg>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>
                <span style={{ color: INK }}>Loonext</span>
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
