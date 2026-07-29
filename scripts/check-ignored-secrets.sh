#!/usr/bin/env bash
#
# [#282] The .gitignore rules that keep real credentials out of a PUBLIC repo,
# asserted rather than assumed.
#
# `.dev.vars` deliberately holds commented-out PRODUCTION Supabase credentials
# — a working practice with a live blast radius the moment the ignore rule
# slips. gitleaks catches the paste; this catches the RULE, which is the thing
# somebody could quietly break while tidying .gitignore, months before the
# paste that exploits it.
#
# Run from the repo root. Exits non-zero with a named failure.
set -euo pipefail

fail() {
  echo "SECRET-IGNORE CHECK FAILED: $1" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 1. The patterns are still ignored.
#
# `git check-ignore -q` is the real answer to "would git stage this", which is
# the only question that matters — grepping .gitignore would pass a rule that
# a later negation had already undone.
# ---------------------------------------------------------------------------
must_ignore=(
  ".dev.vars"
  ".dev.vars.local"
  "apps/api/.dev.vars"
  "apps/web/.env.local"
  ".env"
  ".env.production"
  "prod-secrets.json"
)
for path in "${must_ignore[@]}"; do
  git check-ignore -q "$path" \
    || fail "$path is NOT ignored — a real credential file could be committed"
done

# ---------------------------------------------------------------------------
# 2. The example files are still NOT ignored.
#
# The negations (`!.dev.vars.example`) are what make the rules usable. If one
# is dropped, the next person finds no example, writes their own from memory,
# and the ignore rule stops being obviously load-bearing.
# ---------------------------------------------------------------------------
must_not_ignore=(
  ".dev.vars.example"
  ".env.example"
)
for path in "${must_not_ignore[@]}"; do
  if git check-ignore -q "$path"; then
    fail "$path IS ignored — the example that documents the real file is gone"
  fi
done

# ---------------------------------------------------------------------------
# 3. Nothing matching those shapes is actually TRACKED right now.
#
# Belt and braces: the rules could be perfect and a file could still have been
# force-added before them.
# ---------------------------------------------------------------------------
tracked=$(git ls-files \
  | grep -E '(^|/)(\.dev\.vars|\.env)([^.]|$)|(^|/)prod-secrets\.json$' \
  | grep -v '\.example$' || true)
if [ -n "$tracked" ]; then
  fail "these credential files are tracked in git:
$tracked"
fi

echo "OK: credential files are ignored, examples are not, nothing is tracked."
