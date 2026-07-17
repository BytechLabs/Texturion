import { ImageResponse } from "next/og";

import { BLOG_POSTS } from "@/lib/marketing/blog";
import { blogArt } from "@/lib/marketing/blog-art";

/**
 * Per-post OG card (#130 follow-up): /og/blog/<slug> renders the post's own
 * plate (the same deterministic art the index card and article banner draw,
 * lib/marketing/blog-art) behind the dateline + title. Every post page points
 * its og:image here via buildMetadata's `image` param — a file-convention
 * opengraph-image.tsx would be shadowed by the config images (see the
 * precedence note in lib/marketing/seo.ts), so a plain route is the honest
 * shape.
 *
 * Same Satori/Node constraints as the shipped OG routes: no runtime='edge'
 * (OpenNext forbids it, SPEC §3), Satori's built-in font (the brand fonts are
 * woff2-only, which Satori can't parse), hex literals only (Satori doesn't
 * read CSS variables), inline flexbox only.
 *
 * Unknown slugs 404 before any render: the surface is exactly the registry,
 * never an open image generator (cost-protection).
 */

const GROUND = "#EDF2FB"; // Frost: the plate well, full-bleed.
const INK = "#10173B";
const INK_55 = "#5A6080";
const COBALT = "#2740DE";
const FLARE = "#FF4A1F";
const GREEN = "#0B7A50";
const WHITE = "#FFFFFF";

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) {
    return new Response("Not found", { status: 404 });
  }

  const spec = blogArt(post.slug, post.dateline, "og");
  const tickPath = spec.ticks
    .map((t) => `M${t.x} ${t.y - 2} L${t.x} ${t.y + 2}`)
    .join(" ");
  // Long titles step down a size so three lines always fit the clear zone.
  const titleSize = post.title.length > 62 ? 50 : 56;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: GROUND,
        }}
      >
        {/* The plate, full-bleed behind the text. */}
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${spec.width} ${spec.height}`}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {tickPath ? (
            <path
              d={tickPath}
              stroke={COBALT}
              strokeOpacity={0.12}
              strokeWidth={1}
              fill="none"
            />
          ) : null}
          {spec.trails.map((trail) => (
            <path
              key={trail.d}
              d={trail.d}
              fill="none"
              stroke={COBALT}
              strokeOpacity={
                trail.role === "lead"
                  ? 0.85
                  : trail.role === "mid"
                    ? 0.3
                    : 0.14
              }
              strokeWidth={trail.role === "lead" ? 3 : 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <circle
            cx={spec.dock.x}
            cy={spec.dock.y}
            r={18}
            fill="none"
            stroke={COBALT}
            strokeOpacity={0.18}
            strokeWidth={2}
          />
          <circle
            cx={spec.dock.x}
            cy={spec.dock.y}
            r={9}
            fill="none"
            stroke={COBALT}
            strokeOpacity={0.45}
            strokeWidth={2}
          />
          {spec.waiting ? (
            <circle cx={spec.waiting.x} cy={spec.waiting.y} r={6} fill={FLARE} />
          ) : null}
          {spec.docked ? (
            <circle cx={spec.docked.x} cy={spec.docked.y} r={6} fill={GREEN} />
          ) : null}
        </svg>

        {/* Text column: dateline + title bottom-left, footer row below. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "64px 72px 56px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: COBALT,
            }}
          >
            {post.dateline}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              maxWidth: 820,
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.14,
              letterSpacing: "-0.02em",
              color: INK,
            }}
          >
            {post.title}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 44,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <svg width={44} height={44} viewBox="0 0 512 512">
                <rect width="512" height="512" rx="128" ry="128" fill={INK} />
                <path
                  fill={WHITE}
                  d="M 196 396 C 178 330 186 256 236 222 C 228 178 262 150 302 152 C 330 154 346 168 348 180 L 436 170 L 350 202 C 352 216 346 246 324 264 C 302 308 298 352 302 396 Z"
                />
                <circle cx="300" cy="198" r="15" fill={INK} />
              </svg>
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  fontWeight: 700,
                  color: INK,
                }}
              >
                Loonext
              </div>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 600,
                color: INK_55,
              }}
            >
              loonext.com/blog
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        // Deterministic per deploy; crawlers may cache for a day.
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}
