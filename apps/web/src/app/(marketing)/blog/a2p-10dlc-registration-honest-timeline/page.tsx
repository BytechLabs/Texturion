import type { Metadata } from "next";

import { ArticlePage } from "@/components/marketing/blog/article-page";
import { blogPost, blogPostOgImage, blogPostPath } from "@/lib/marketing/blog";
import { buildMetadata } from "@/lib/marketing/seo";

import Content from "./content.mdx";

const POST = blogPost("a2p-10dlc-registration-honest-timeline");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
  image: blogPostOgImage(POST),
  article: { publishedTimeIso: POST.datePublishedIso },
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <Content />
    </ArticlePage>
  );
}
