import type { Metadata } from "next";

import { JobPhotoPage } from "@/components/public/job-photo-page";
import { publicPageLoader, publicPageMetadata } from "@/lib/public-page";

interface Props {
  params: Promise<{ token: string }>;
}

const loadPhotos = publicPageLoader<{
  locale?: string;
  business_name: string;
  photos: { id: string; work_phase: "before" | "after" | null; url: string }[];
  truncated?: boolean;
}>("photos");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const photos = await loadPhotos((await params).token);
  return publicPageMetadata(photos?.locale, "misc.photosPageTitle");
}

export default async function Page({ params }: Props) {
  const data = await loadPhotos((await params).token);
  if (!data) return <JobPhotoPage notAvailable />;
  return (
    <JobPhotoPage
      locale={data.locale}
      businessName={data.business_name}
      photos={data.photos}
      truncated={data.truncated ?? false}
    />
  );
}
