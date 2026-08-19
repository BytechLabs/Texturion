/**
 * Hand a `.md` file to the bundler as its own text.
 *
 * This is the Turbopack half of the rule in `next.config.ts`. Webpack has a
 * built-in module type for this (`asset/source`); Turbopack does not, and wants
 * a loader.
 *
 * ## Why this file exists rather than a dependency
 *
 * The obvious answer is `raw-loader`, and it costs 52 packages — webpack,
 * terser, browserslist and the rest arrive as its peers. That is a large amount
 * of new supply-chain surface on a public repository to buy one `JSON.stringify`,
 * and it installs a second copy of the bundler the framework already ships.
 *
 * The transform is the whole file. Keeping it here means the rule has no
 * dependency to audit, to update, or to be compromised.
 *
 * `JSON.stringify` is doing real work: the documents contain quotes, newlines
 * and backslashes, and it is the escaping that makes the result a valid literal.
 */
module.exports = function markdownSourceLoader(source) {
  return `export default ${JSON.stringify(source)};`;
};
