#!/usr/bin/env bash
# The merge gate's label check. The workflow (.github/workflows/merge-gate.yml) runs this file from the default branch
# and gives it no pull-request code, so a pull request can't soften it.
# What it decides, from the files a pull request changes:
#   - lock files (LOCKS): files that steer a Claude session or run by themselves (instruction files, settings and hooks,
#     workflows, this gate). They need the label "owner-go", and it counts only when the repo's owner added it by hand on
#     github.com: not through the Claude app, not through a workflow.
#   - free files (FREE minus NOT_FREE, optional): notes and data that need no label, up to 25 files, added or modified
#     only, from a claude/* branch of this repo.
#   - everything else needs the label "go".
#   - a base branch that matches CHECKED_BASES (optional, e.g. ^wave/) needs the label "checked" and nothing else; its
#     files meet the rules above when that branch itself goes to the default branch.
# A new push takes the labels off, so new commits are looked at too.
# Env: GH_TOKEN REPO PR ACTION DRAFT OWNER HEAD HEAD_REPO BASE  LOCKS (extended regex)  FREE, NOT_FREE (extended regex,
#      may be empty)  ALL_LOCKS (true|"")  CHECKED_BASES (extended regex, may be empty)
# Output ($GITHUB_OUTPUT): ok=true|false  why=<one line>  need=<label still missing>
set -euo pipefail
out() { echo "$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }
GO=go; OWNER_GO=owner-go; CHECKED=checked

have=$(gh api "repos/$REPO/issues/$PR/labels" --jq '.[].name')
if [ "${ACTION:-}" = synchronize ]; then
  for l in "$GO" "$OWNER_GO" "$CHECKED"; do
    if grep -qxF "$l" <<<"$have"; then
      gh api -X DELETE "repos/$REPO/issues/$PR/labels/$l" >/dev/null
      echo "::warning::new commits after '$l': the label is off until the new commits are looked at"
    fi
  done
  have=$(gh api "repos/$REPO/issues/$PR/labels" --jq '.[].name')
fi
if [ "${DRAFT:-false}" = true ]; then echo "draft: labels checked, nothing merges until it is ready"; out "ok=false"; out "why=draft"; exit 0; fi

if [ -n "${CHECKED_BASES:-}" ] && grep -qE "$CHECKED_BASES" <<<"${BASE:-}"; then
  if grep -qxF "$CHECKED" <<<"$have"; then echo "label '$CHECKED' is on: ok to merge into $BASE"; out "ok=true"; out "why=label $CHECKED on"; exit 0; fi
  echo "::notice::waiting for the '$CHECKED' label into $BASE. Not merging."
  out "ok=false"; out "why=waiting for the $CHECKED label"; out "need=$CHECKED"; exit 0
fi

files=$(gh api --paginate "repos/$REPO/pulls/$PR/files" --jq '.[] | [.status, .filename, (.previous_filename // "")] | @tsv')
n=$(grep -c . <<<"$files" || true)
locks=""; unfree=""
while IFS=$'\t' read -r st f prev; do
  [ -z "${f:-}" ] && continue
  for p in "$f" "$prev"; do
    [ -z "$p" ] && continue
    if [ "${ALL_LOCKS:-}" = true ] || grep -qE "$LOCKS" <<<"$p"; then locks+="$p; "; fi
  done
  case "$st" in added|modified) ;; *) unfree+="$f ($st); "; continue ;; esac
  if [ -z "${FREE:-}" ] || ! grep -qE "$FREE" <<<"$f"; then unfree+="$f; "
  elif [ -n "${NOT_FREE:-}" ] && grep -qE "$NOT_FREE" <<<"$f"; then unfree+="$f; "; fi
done <<<"$files"
# GitHub lists at most 3,000 files of a pull request: one that large is read as touching a lock file.
if [ "$n" -ge 3000 ]; then locks+="(3,000 or more files); "; fi

if [ -n "$locks" ]; then
  echo "lock files in this pull request: ${locks:0:600}"
  if ! grep -qxF "$OWNER_GO" <<<"$have"; then
    echo "::notice::this pull request changes files that act as locks. It merges once $OWNER adds the label '$OWNER_GO' by hand on github.com."
    out "ok=false"; out "why=changes lock files: waiting for $OWNER's own '$OWNER_GO' label"; out "need=$OWNER_GO"; exit 0
  fi
  last=$(gh api --paginate "repos/$REPO/issues/$PR/events" --jq ".[] | select(.event==\"labeled\" and .label.name==\"$OWNER_GO\") | [.actor.login, (.performed_via_github_app.slug // \"\")] | @tsv" | tail -1)
  who=$(cut -f1 <<<"$last"); app=$(cut -f2 <<<"$last")
  if [ "$who" = "$OWNER" ] && [ -z "$app" ]; then
    echo "'$OWNER_GO' was added by $OWNER by hand: ok to merge"; out "ok=true"; out "why=$OWNER_GO by $OWNER's own hand"; exit 0
  fi
  echo "::warning::'$OWNER_GO' is on, but it was added by '${who:-nobody}'${app:+ through the app '$app'}. It counts only when $OWNER adds it by hand on github.com: take it off and add it there."
  out "ok=false"; out "why=$OWNER_GO was not added by $OWNER's own hand"; out "need=$OWNER_GO"; exit 0
fi

if grep -qxF "$GO" <<<"$have"; then echo "label '$GO' is on: ok to merge"; out "ok=true"; out "why=label $GO on"; exit 0; fi
if [ -n "${FREE:-}" ] && [[ "${HEAD:-}" == claude/* ]] && [ "${HEAD_REPO:-}" = "$REPO" ] && [ "$n" -ge 1 ] && [ "$n" -le 25 ] && [ -z "$unfree" ]; then
  echo "notes and data only ($n file(s)): no label needed"; out "ok=true"; out "why=notes and data only, no label needed"; exit 0
fi
echo "::notice::waiting for the '$GO' label${unfree:+ (because of: ${unfree:0:400})}. Not merging."
out "ok=false"; out "why=waiting for the $GO label"; out "need=$GO"
