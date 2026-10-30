/**
 * Repo markdown imported as a string, inlined at BUILD time.
 *
 * ## Why this exists
 *
 * Three legal pages — the accessibility statement, the DPA and the
 * vulnerability-disclosure policy — are generated from markdown that lives
 * outside `apps/web`, because the same documents are the canonical ones the
 * rest of the repo cites. They used to read that markdown with
 * `readFileSync(join(process.cwd(), "..", "..", "docs", …))`.
 *
 * That works locally and in `next build`, and **500s in production**. The
 * deployed Worker has no repo on disk and its `process.cwd()` is `/`, so the
 * path resolved to `/docs/ACCESSIBILITY.md` and the render threw
 * `no such file or directory`. All three pages were 500 from the day each
 * shipped.
 *
 * The `.md` rules in `next.config.ts` turn the import into its source text at
 * build time — the Turbopack loader for the production build, the webpack rule
 * for a `--webpack` rollback — so the document travels INSIDE the bundle and no
 * filesystem exists at request time to be wrong about.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
