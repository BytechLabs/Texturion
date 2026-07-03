import { jsonLdScript } from "@/lib/marketing/seo";

/**
 * Renders a JSON-LD graph as an inline <script> in a server component, the
 * official Next pattern (BLUEPRINT §11.2). Pass one or more schema.org nodes;
 * they're wrapped in an @graph so a page ships a single script tag.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const payload = Array.isArray(data) ? { "@graph": data } : data;
  return (
    <script
      type="application/ld+json"
      // Escaped via jsonLdScript (replaces "<"); content is our own static data.
      dangerouslySetInnerHTML={{ __html: jsonLdScript(payload) }}
    />
  );
}
