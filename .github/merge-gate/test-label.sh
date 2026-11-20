#!/usr/bin/env bash
# Runs label.sh against a stub `gh` that answers from files in $STUB. Prints PASS/FAIL.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd); fails=0; bin=$(mktemp -d)
mk() { STUB=$(mktemp -d); export STUB; printf '%s\n' "$1" > "$STUB/labels"; printf '%b' "$2" > "$STUB/files"; printf '%b' "${3:-}" > "$STUB/events"; : > "$STUB/deleted"; }
cat > "$bin/gh" <<'GH'
#!/usr/bin/env bash
# stub: gh api [-X DELETE] [--paginate] <path> [--jq <expr>]
method=GET; path=""; while [ $# -gt 0 ]; do case "$1" in api|--paginate) ;; -X) method=$2; shift ;; --jq) shift ;; *) path=$1 ;; esac; shift; done
case "$method $path" in
  "DELETE "*/labels/*) l=${path##*/}; echo "$l" >> "$STUB/deleted"; grep -vxF "$l" "$STUB/labels" > "$STUB/l2" || true; mv "$STUB/l2" "$STUB/labels" ;;
  "GET "*/labels) cat "$STUB/labels" ;;
  "GET "*/files) cat "$STUB/files" ;;
  "GET "*/events) cat "$STUB/events" ;;
esac
GH
chmod +x "$bin/gh"
run() { GITHUB_OUTPUT="$STUB/out" PATH="$bin:$PATH" GH_TOKEN=x REPO=o/r PR=1 OWNER=Recoverystarts HEAD="${HEAD:-claude/x}" HEAD_REPO="${HEAD_REPO:-o/r}" BASE="${BASE:-main}" ACTION="${ACTION:-labeled}" DRAFT="${DRAFT:-false}" LOCKS="$LOCKS" FREE="${FREE:-}" NOT_FREE="${NOT_FREE:-}" ALL_LOCKS="${ALL_LOCKS:-}" CHECKED_BASES="${CHECKED_BASES:-}" bash "$here/label.sh" > "$STUB/log" 2>&1; cat "$STUB/out" 2>/dev/null | tr '\n' ' '; }
t() { local want="$1" name="$2" got; got=$(run); if grep -q -- "$want" <<<"$got"; then echo "PASS $name"; else echo "FAIL $name  -> $got"; cat "$STUB/log"; fails=$((fails+1)); fi; }
# The lock itself: the gate's scripts and its workflow (merge-gate.yml; auto-merge-claude.yml in meeting-finder).
LOCKS='^\.github/merge-gate/|^\.github/workflows/(merge-gate|auto-merge-claude)\.yml$'
export LOCKS
# Files that steer a Claude session or run by themselves. They need go, so each workflow puts them in NOT_FREE.
STEER='(^|/)\.[^/]+(/|$)|(^|/)(CLAUDE|AGENTS|GEMINI|SKILL)(\.local)?\.md$'
G=.github/merge-gate/label.sh

# ---- go ----
mk "" "modified\tserver/a.mjs\t\n";                                   t "ok=false why=waiting for the go label need=go" "code with no label waits for go"
mk "go" "modified\tserver/a.mjs\t\n";                                 t "ok=true why=label go on" "code with go merges"
mk "" "modified\tCLAUDE.md\t\n";                                      t "ok=false why=waiting for the go label need=go" "the instruction file with no label waits for go"
mk "go" "modified\tCLAUDE.md\t\n";                                    t "ok=true why=label go on" "the instruction file with go merges"
mk "go" "added\t.claude/settings.json\t\nmodified\ta.md\t\n";         t "ok=true why=label go on" "a new settings file with go merges"
mk "go" "modified\t.github/workflows/weekly-freshness.yml\t\n";       t "ok=true why=label go on" "a workflow that is not the gate merges with go"
mk "go" "added\tskills/x/SKILL.md\t\nadded\t.mcp.json\t\n";           t "ok=true why=label go on" "a skill and a dot-file merge with go"

# ---- owner-go: the gate itself ----
mk "go" "modified\t$G\t\n";                                           t "ok=false why=changes lock files" "the gate's script with only go waits for owner-go"
mk "go" "modified\t.github/merge-gate/check.sh\t\nmodified\tserver/a.mjs\t\n"; t "need=owner-go" "the gate's checks among other files wait for owner-go"
mk "go" "modified\t.github/workflows/merge-gate.yml\t\n";             t "need=owner-go" "the gate's workflow waits for owner-go"
mk "go" "modified\t.github/workflows/auto-merge-claude.yml\t\n";      t "need=owner-go" "meeting-finder's merge workflow waits for owner-go"
mk "go" "removed\t.github/merge-gate/test-label.sh\t\n";              t "need=owner-go" "deleting a gate file waits for owner-go"
mk "go" "renamed\tdocs/old-gate.sh\t$G\n";                            t "need=owner-go" "renaming a gate file away counts as changing it"
mk "go" "added\t.github/merge-gate/extra.sh\t\n";                     t "need=owner-go" "a new file in the gate's folder waits for owner-go"
mk "owner-go" "modified\t$G\t\n" "Recoverystarts\t\n";                 t "ok=true why=owner-go by Recoverystarts's own hand" "owner-go by the owner's hand merges"
mk "owner-go" "modified\t$G\t\n" "Recoverystarts\tclaude\n";           t "ok=false why=owner-go was not added by Recoverystarts's own hand" "owner-go through the Claude app does not count"
mk "owner-go" "modified\t$G\t\n" "github-actions[bot]\tgithub-actions\n"; t "ok=false why=owner-go was not added" "owner-go from a workflow does not count"
mk "owner-go" "modified\t$G\t\n" "Recoverystarts\t\nRecoverystarts\tclaude\n"; t "ok=false" "the latest owner-go is the one that counts"
mk "owner-go" "modified\t$G\t\n" "Recoverystarts\tclaude\nRecoverystarts\t\n"; t "ok=true" "…also when the latest one is by hand"
mk "owner-go" "modified\t$G\t\n" "";                                   t "ok=false" "owner-go with no record of who added it does not count"
mk "$(printf 'go\nowner-go')" "modified\t$G\t\n" "Recoverystarts\t\n"; ACTION=synchronize t "ok=false why=changes lock files" "a new push takes owner-go off"
grep -qx "owner-go" "$STUB/deleted" && grep -qx "go" "$STUB/deleted" && echo "PASS both labels were removed on the new push" || { echo "FAIL labels not removed"; fails=$((fails+1)); }
mk "go" "modified\tREADME.md\t\n"; ALL_LOCKS=true t "need=owner-go" "ALL_LOCKS: every file waits for owner-go"
many=$(for i in $(seq 1 3000); do printf 'modified\tdata/f%s.json\t\n' "$i"; done); mk "go" "$many"; t "need=owner-go" "3,000 files reads as touching a lock"

# ---- drafts, and files that need no label ----
mk "go" "modified\tserver/a.mjs\t\n"; DRAFT=true t "ok=false why=draft" "a draft does not merge"
mk "" "modified\tcloud-notes/a.md\t\nadded\tanalytics/x.json\t\n"; FREE='\.(md|txt|json|csv)$' t "ok=true why=notes and data only" "notes and data need no label where FREE is set"
mk "" "modified\tcloud-notes/a.md\t\nadded\tanalytics/x.mjs\t\n"; FREE='\.(md|txt|json|csv)$' t "need=go" "a script among the notes waits for go"
mk "" "removed\tcloud-notes/a.md\t\n"; FREE='\.(md|txt|json|csv)$' t "need=go" "deleting a note waits for go"
mk "" "modified\tcloud-notes/a.md\t\n";                               t "need=go" "with no FREE set, notes wait for go too"
mk "" "modified\tcloud-notes/a.md\t\n"; FREE='\.md$' HEAD=wave/x t "need=go" "free files are free only from a claude/* branch"
mk "" "modified\tcloud-notes/a.md\t\n"; FREE='\.md$' HEAD_REPO=stranger/r t "need=go" "…and only from this repo, not a fork"
mk "" "modified\tnotes/SKILL.md\t\n"; FREE='\.(md|txt|json|csv)$' NOT_FREE="$STEER" t "need=go" "an instruction file waits for go even where notes are free"
mk "" "modified\t.claude/settings.json\t\n"; FREE='\.(md|txt|json|csv)$' NOT_FREE="$STEER" t "need=go" "a settings file waits for go even where JSON is free"
mk "" "modified\tnotes/a.md\t\nmodified\tCLAUDE.md\t\n"; FREE='\.(md|txt|json|csv)$' NOT_FREE="$STEER" t "need=go" "a note beside an instruction file waits for go"

# ---- meeting-finder ----
MF_NOT_FREE="^(data|registry|ingest|pipeline|deploy|server)/|$STEER"
mk "" "modified\tdocs/a.md\t\nmodified\tresearch/x.py\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "ok=true" "meeting-finder: Markdown and research/ need no label"
mk "" "modified\tdata/notes.md\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "need=go" "meeting-finder: Markdown under data/ waits for go"
mk "" "modified\tserver/route-words.test.mjs\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "need=go" "meeting-finder: a test waits for go"
mk "" "modified\tCLAUDE.md\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "need=go" "meeting-finder: CLAUDE.md waits for go"
mk "go" "modified\tCLAUDE.md\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "ok=true why=label go on" "meeting-finder: CLAUDE.md with go merges"
mk "" "added\tresearch/.claude/settings.json\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "need=go" "meeting-finder: a settings file under research/ waits for go"
mk "go" "modified\t.github/workflows/auto-merge-claude.yml\t\nmodified\tCLAUDE.md\t\n"; FREE='^research/|\.md$' NOT_FREE="$MF_NOT_FREE" t "need=owner-go" "meeting-finder: the merge workflow beside CLAUDE.md waits for owner-go"
mk "" "modified\tCLAUDE.md\t\n"; BASE=wave/2026-x CHECKED_BASES='^wave/' t "need=checked" "into a wave branch: checked is the label"
mk "checked" "modified\tCLAUDE.md\t\n"; BASE=wave/2026-x CHECKED_BASES='^wave/' t "ok=true why=label checked on" "…and checked merges there"
mk "checked" "modified\tserver/a.mjs\t\n"; BASE=master CHECKED_BASES='^wave/' t "need=go" "checked does not merge into the main branch"

# ---- ops-vault: the door tests are lock files too ----
OV_LOCKS="$LOCKS|^scripts/test-(doors-policy|host-log)\.mjs$"
mk "go" "modified\tserver.mjs\t\nmodified\tdoors.mjs\t\nmodified\tREADME.md\t\n"; LOCKS="$OV_LOCKS" t "ok=true why=label go on" "ops-vault: the server and the doors merge with go"
mk "go" "modified\tdoors.mjs\t\nmodified\tscripts/test-doors-policy.mjs\t\n"; LOCKS="$OV_LOCKS" t "need=owner-go" "ops-vault: a change to the door tests waits for owner-go"
mk "go" "removed\tscripts/test-host-log.mjs\t\n"; LOCKS="$OV_LOCKS" t "need=owner-go" "ops-vault: deleting the live-server door test waits for owner-go"
mk "go" "modified\tscripts/test-doors.mjs\t\nmodified\tpackage.json\t\n"; LOCKS="$OV_LOCKS" t "ok=true why=label go on" "ops-vault: the other tests and build files merge with go"
echo; [ "$fails" = 0 ] && echo "all passed" || echo "$fails FAILED"; exit "$fails"
