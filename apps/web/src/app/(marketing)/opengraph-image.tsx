import { ImageResponse } from "next/og";

/**
 * Default OpenGraph image for the marketing route group (BLUEPRINT §10.3):
 * 1200×630, stone-50 background, a petrol left rule, the title, the JobText
 * wordmark bottom-left, and one truth chip ("$29/mo flat") bottom-right.
 *
 * Built with next/og's ImageResponse (Satori: inline flexbox only). We do NOT
 * set `runtime = 'edge'` — OpenNext forbids the Edge runtime (SPEC §3), so this
 * renders on the Node runtime. It uses Satori's built-in font (the self-hosted
 * Inter is only shipped as woff2, which Satori can't parse); the layout, petrol
 * accent, and mark carry the brand.
 *
 * Individual pages may add their own opengraph-image to override this default.
 */
export const alt = "JobText — the shared text inbox for your crew";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand colors (hex — Satori doesn't evaluate CSS variables or oklch).
const STONE_50 = "#FAFAF9";
const STONE_900 = "#1C1917";
const PETROL = "#0F766E";
const WHITE = "#FFFFFF";

export default function OpengraphImage() {
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
        <div
          style={{
            width: 16,
            height: "100%",
            backgroundColor: PETROL,
          }}
        />

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
          {/* Title */}
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
            Every customer text, in one inbox your whole crew can see.
          </div>

          {/* Footer row: wordmark left, truth chip right */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {/* Wordmark with bubble mark */}
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

            {/* Truth chip */}
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
