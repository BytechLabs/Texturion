import query from "@tanstack/eslint-plugin-query";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// oxlint (.oxlintrc.json at the repo root) runs every other rule. These two
// have no oxlint equivalent, so ESLint keeps them, with the parser and plugins
// eslint-config-next already sets up.
const ESLINT_ONLY = new Set(["react/no-deprecated", "@next/next/no-location-assign-relative-destination"]);

const onlyEslintRules = (config) =>
  config.rules
    ? {
        ...config,
        rules: Object.fromEntries(
          Object.keys(config.rules)
            .filter((rule) => ESLINT_ONLY.has(rule))
            .map((rule) => [rule, "error"]),
        ),
      }
    : config;

export default defineConfig([
  ...[...nextVitals, ...nextTs].map(onlyEslintRules),
  globalIgnores([
    "node_modules/**",
    ".next/**",
    ".next-*/**",
    ".open-next/**",
    ".wrangler/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
  ]),
  {
    // The eslint-disable comments in the app are for rules oxlint now runs.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "@tanstack/query": query },
    rules: { "@tanstack/query/no-unstable-deps": "error" },
  },
]);
