import type { Metadata } from "next";

import { JobPhotoPage } from "@/components/public/job-photo-page";
import { publicEnv } from "@/env";

/**
 * #294 — the page a homeowner opens to see the photos of their own job.
 *
 * No account, no login, no shell. This file may export ONLY the page and its
 * metadata; the rendering lives in a component, because a Next page.tsx that
 * exports anything else breaks `next build` while every other check passes.
 */

/**
 * Kept out of every index, belt and braces.
 *
 * The API already sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`
 * on its side (D75). This is the HTML half of the same instruction, because the
 * page is fetched by a browser that a crawler may also be driving, and a snippet
 * is where a customer's details would surface.
 */
export const metadata: Metadata = {
  title: "Job photos",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const base = publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  // No-store, so a shared link on a shared machine does not leave the photos in
  // a disk cache after it expires.
  const response = await fetch(`${base}/photos/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });

  if (!response.ok) return <JobPhotoPage notAvailable />;

  const data = (await response.json()) as {
    business_name: string;
    photos: { id: string; work_phase: "before" | "after" | null; url: string }[];
  };
  return <JobPhotoPage businessName={data.business_name} photos={data.photos} />;
}
