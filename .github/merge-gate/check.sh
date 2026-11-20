#!/usr/bin/env bash
# The merge gate's checks for claudeslab.com. The workflow runs this file from the default branch against the pull
# request's code, with no secrets. Locally: bash .github/merge-gate/check.sh [base-branch]
#   1. syntax of every changed .js/.mjs/.cjs (node --check) and .json (JSON.parse)
#   2. the generated pages match their data: both generators run, and index.html, papers/index.html and
#      data/home-cards.hash must come out as committed (the same check as .github/workflows/generated-check.yml)
#   3. the label rule's own cases
set -euo pipefail
base="${1:-main}"
case "$base" in origin/*) ;; *) base="origin/$base" ;; esac
git rev-parse --verify -q "$base" >/dev/null || git fetch -q origin "${base#origin/}"
fail=0; n=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in
    *.json) node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" || { echo "::error file=$f::not valid JSON"; fail=1; }; n=$((n+1)) ;;
    *.js|*.mjs|*.cjs) node --check "$f" || { echo "::error file=$f::JavaScript syntax error"; fail=1; }; n=$((n+1)) ;;
  esac
done < <(git diff --name-only --diff-filter=ACMR "$base...HEAD")
echo "checked $n changed JS/JSON file(s)"
[ "$fail" = 0 ] || { echo "::error::syntax check failed (above)"; exit 1; }
node scripts/build-home-index.mjs
node scripts/build-papers-index.mjs
if ! git diff --quiet -- index.html papers/index.html data/home-cards.hash; then
  git --no-pager diff --stat -- index.html papers/index.html data/home-cards.hash
  echo "::error::a generated page differs from a fresh regenerate: edit data/home-cards.json or papers/papers.json, run node scripts/build-home-index.mjs && node scripts/build-papers-index.mjs, and commit the outputs"
  exit 1
fi
echo "generated pages match their data"
bash .github/merge-gate/test-label.sh | tail -1
