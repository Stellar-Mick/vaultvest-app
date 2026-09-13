#!/usr/bin/env bash
# Create the issues in issues.json on GitHub with the `gh` CLI.
#
# Usage:  .github/backlog/create-issues.sh [owner/repo]
#   Defaults to the repo of the current checkout. Requires `gh auth login`.
#
# Idempotent: labels are created/updated in place, and an issue whose exact
# title already exists (open or closed) is skipped, so re-running after a
# partial failure only creates what is missing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
json="$here/issues.json"
# Node cannot require a Git-Bash style /c/... path on Windows; hand it C:/... instead.
json="$(cygpath -m "$json" 2>/dev/null || echo "$json")"
repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

command -v gh >/dev/null || { echo "gh CLI not found. Install: winget install GitHub.cli" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in. Run: gh auth login" >&2; exit 1; }
command -v node >/dev/null || { echo "node is required to read issues.json" >&2; exit 1; }

echo "Repository: $repo"
total=$(node -p "require('$json').length")
echo "Issues in backlog: $total"

# --- labels -----------------------------------------------------------------
declare -A colors=(
  [security]=B60205 [contract]=0E8A16 [web]=1D76DB [sdk]=5319E7 [indexer]=006B75
  [api]=0052CC [ci]=FBCA04 [testing]=C2E0C6 [docs]=0075CA [ux]=D4C5F9
  [accessibility]=7057FF [performance]=F9D0C4 [enhancement]=A2EEEF [design]=BFD4F2
  [architecture]=D93F0B [governance]=E99695 [dependencies]=0366D6 [release]=2EA043
  [tooling]=C5DEF5 [tech-debt]=E4E669 [repo-hygiene]=EDEDED [observability]=5DADE2
  [tracking]=CFD3D7 ["good first issue"]=7057FF
)
echo "Ensuring labels…"
node -p "[...new Set(require('$json').flatMap(i=>i.labels))].join('\n')" | while IFS= read -r label; do
  [ -z "$label" ] && continue
  color="${colors[$label]:-CCCCCC}"
  gh label create "$label" --repo "$repo" --color "$color" --force >/dev/null 2>&1 || true
done

# --- existing titles (open + closed) ---------------------------------------
echo "Reading existing issues…"
existing="$(gh issue list --repo "$repo" --state all --limit 1000 --json title -q '.[].title')"

# --- create -----------------------------------------------------------------
created=0; skipped=0; failed=0
for ((i=0; i<total; i++)); do
  title=$(node -p "require('$json')[$i].title")
  if grep -Fxq -- "$title" <<<"$existing"; then
    echo "skip   $title"; skipped=$((skipped+1)); continue
  fi
  body=$(node -p "require('$json')[$i].body")
  labels=$(node -p "require('$json')[$i].labels.join(',')")
  if url=$(gh issue create --repo "$repo" --title "$title" --body "$body" --label "$labels" 2>&1); then
    echo "create $url"; created=$((created+1))
  else
    echo "FAILED $title :: $url" >&2; failed=$((failed+1))
  fi
  # Stay clear of GitHub's secondary rate limit on content creation.
  sleep 1.5
done

echo
echo "Done. created=$created skipped=$skipped failed=$failed"
[ "$failed" -eq 0 ]
