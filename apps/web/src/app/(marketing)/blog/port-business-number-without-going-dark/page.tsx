import type { Metadata } from "next";

import { ArticlePage } from "@/components/marketing/blog/article-page";
import { blogPost, blogPostPath } from "@/lib/marketing/blog";
import { buildMetadata } from "@/lib/marketing/seo";

import Content from "./content.mdx";

const POST = blogPost("port-business-number-without-going-dark");

export const metadata: Metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: blogPostPath(POST.slug),
});

export default function Page() {
  return (
    <ArticlePage post={POST}>
      <Content />
    </ArticlePage>
  );
}
