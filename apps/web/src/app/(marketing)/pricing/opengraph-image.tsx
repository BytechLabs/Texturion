import { ImageResponse } from "next/og";

/**
 * OpenGraph image for /pricing (BLUEPRINT §10.3): 1200×630, stone-50 background,
 * a petrol left rule, the pricing-page title, the JobText wordmark bottom-left,
 * and the "$29/mo flat" truth chip bottom-right (the chip §10.3 mandates for
 * pricing/home). Same Satori/Node-runtime constraints as the route-group default
 * (no runtime='edge' — OpenNext forbids it, SPEC §3; Satori built-in font).
 */
export const alt = "JobText pricing — $29/mo flat for the whole crew";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STONE_50 = "#FAFAF9";
const STONE_900 = "#1C1917";
const PETROL = "#0F766E";
const WHITE = "#FFFFFF";

export default function PricingOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: STONE_50,
          position: "relative",
        }}
      >
        {/* Petrol left rule */}
        <div style={{ width: 16, height: "100%", backgroundColor: PETROL }} />

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
                color: PETROL,
              }}
            >
              Pricing
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 68,
                fontWeight: 600,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                color: STONE_900,
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
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  backgroundColor: PETROL,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: WHITE,
                  fontSize: 34,
                  fontWeight: 600,
                }}
              >
                J
              </div>
              <div style={{ display: "flex", fontSize: 34, fontWeight: 600 }}>
                <span style={{ color: STONE_900 }}>Job</span>
                <span style={{ color: PETROL }}>Text</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 24px",
                borderRadius: 999,
                border: `1px solid ${PETROL}`,
                color: PETROL,
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
