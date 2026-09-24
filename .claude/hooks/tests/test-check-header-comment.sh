#!/bin/bash
# check-header-comment.sh の振る舞いテスト。実行: bash ~/.claude/hooks/tests/test-check-header-comment.sh
# 冒頭に規約コメントを持つ .md(HANDOFF.md・TODO.md・設計書など)を、本文の編集で壊す Write / Edit /
# apply_patch を拒否し、それ以外(本文だけ・コメントだけ・対象外のファイル)を通すことを確かめる。

hook="$(cd "$(dirname "$0")/.." && pwd)/check-header-comment.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
failures=0

# 雛形行「  ## 見出し」がコメントの中にあり、本文にも同じ見出しがある(HANDOFF.md と同じ構造)
guarded="$work_dir/guarded.md"
cat > "$guarded" <<'MD'
<!--
規約: このコメントは消さない。
テンプレート:
  ## 見出し
  - (要約)
-->

# Title

## 見出し

- body
MD

# 見出しがコメントより前にある形(HANDOFF.md)
handoff="$work_dir/HANDOFF.md"
cat > "$handoff" <<'MD'
# HANDOFF(最終更新: 2026-09-25)

<!--
規約: 全体上書きしてコミットする。
テンプレート:
  # HANDOFF(最終更新: YYYY-MM-DD)
  目標: (1行で)
  ## 最後に完了したタスク
  - (要約)
-->

目標: 壁時計時間を短くする

## 最後に完了したタスク

- T10
MD

plain="$work_dir/plain.md"
printf '# Plain\n\nbody\n' > "$plain"
code="$work_dir/code.mjs"
printf '// <!-- not a guarded file -->\nexport const x = 1;\n' > "$code"

# 引数: テスト名 / 期待(deny|silent) / 入力 JSON
run_case() {
  local name="$1" expected="$2" input="$3"
  local out
  out="$(printf '%s' "$input" | bash "$hook" 2>/dev/null)"
  local code=$?
  if [ "$code" -ne 0 ]; then echo "FAIL $name: exit=$code"; failures=$((failures + 1)); return; fi
  local actual="silent"
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then actual="deny"; fi
  if [ "$actual" != "$expected" ]; then echo "FAIL $name: got $actual expected $expected: $out"; failures=$((failures + 1)); return; fi
  echo "ok   $name"
}

write_input() { jq -nc --arg f "$1" --arg c "$2" --arg d "$work_dir" '{hook_event_name:"PreToolUse",cwd:$d,tool_name:"Write",tool_input:{file_path:$f,content:$c}}'; }
edit_input() { jq -nc --arg f "$1" --arg o "$2" --arg n "$3" --argjson a "${4:-false}" --arg d "$work_dir" '{hook_event_name:"PreToolUse",cwd:$d,tool_name:"Edit",tool_input:{file_path:$f,old_string:$o,new_string:$n,replace_all:$a}}'; }
patch_input() { jq -nc --arg p "$1" --arg d "$work_dir" '{hook_event_name:"PreToolUse",cwd:$d,tool_name:"apply_patch",tool_input:{command:$p}}'; }

comment_of() { awk '/^-->$/{print; exit} {print}' "$1"; }

# Write: 全体上書き
run_case "write_keeps_comment_and_changes_body" silent \
  "$(write_input "$guarded" "$(comment_of "$guarded")

# Title

## 見出し

- new body
")"
run_case "write_cut_at_template_line_is_denied" deny \
  "$(write_input "$guarded" "$(sed -n '1,3p' "$guarded")
## 見出し

- new body
")"
run_case "write_without_comment_is_denied" deny "$(write_input "$guarded" "# Title

## 見出し

- new body
")"
run_case "write_unchanged_comment_only_edit_is_allowed" silent \
  "$(write_input "$guarded" "$(comment_of "$guarded" | sed 's/消さない/消さない(改訂)/')

# Title

## 見出し

- body
")"
run_case "write_changing_comment_and_body_is_denied" deny \
  "$(write_input "$guarded" "$(comment_of "$guarded" | sed 's/消さない/消さない(改訂)/')

# Title

## 見出し

- new body
")"
run_case "handoff_write_cut_in_template_is_denied" deny \
  "$(write_input "$handoff" "$(sed -n '1,8p' "$handoff")

- T11
")"
run_case "handoff_write_keeps_comment" silent \
  "$(write_input "$handoff" "# HANDOFF(最終更新: 2026-09-26)

$(sed -n '3,10p' "$handoff")

目標: 壁時計時間を短くする

## 最後に完了したタスク

- T11
")"

# Edit: 部分置換
run_case "edit_body_only_is_allowed" silent "$(edit_input "$guarded" "- body" "- body2")"
run_case "edit_comment_only_is_allowed" silent "$(edit_input "$guarded" "規約: このコメントは消さない。" "規約: 消さない。")"
run_case "edit_removing_close_tag_is_denied" deny "$(edit_input "$guarded" "-->

# Title" "# Title")"
run_case "edit_spanning_comment_and_body_is_denied" deny "$(edit_input "$guarded" "  - (要約)
-->

# Title" "  - (要約。改訂)
-->

# Title2")"
run_case "edit_spanning_but_comment_unchanged_is_allowed" silent "$(edit_input "$guarded" "  - (要約)
-->

# Title" "  - (要約)
-->

# Title2")"
run_case "edit_with_nonunique_old_string_fails_open" silent "$(edit_input "$guarded" "## 見出し" "## 別の見出し")"
run_case "edit_replace_all_in_body_is_allowed" silent "$(edit_input "$guarded" "body" "text" true)"

# 対象外
run_case "plain_markdown_without_comment_is_ignored" silent "$(write_input "$plain" "# Plain

new
")"
run_case "non_markdown_is_ignored" silent "$(write_input "$code" "export const x = 2;
")"
run_case "new_file_is_ignored" silent "$(write_input "$work_dir/new.md" "# New
")"

# Codex apply_patch
run_case "apply_patch_body_only_is_allowed" silent "$(patch_input "*** Begin Patch
*** Update File: guarded.md
@@
-- body
+- patched body
*** End Patch")"
run_case "apply_patch_removing_close_tag_is_denied" deny "$(patch_input "*** Begin Patch
*** Update File: guarded.md
@@
   - (要約)
--->
-
-# Title
+# Title
*** End Patch")"
run_case "apply_patch_comment_only_is_allowed" silent "$(patch_input "*** Begin Patch
*** Update File: guarded.md
@@
-規約: このコメントは消さない。
+規約: 消さない。
*** End Patch")"
run_case "apply_patch_unlocatable_hunk_fails_open" silent "$(patch_input "*** Begin Patch
*** Update File: guarded.md
@@
-no such line
+x
*** End Patch")"

if [ "$failures" -ne 0 ]; then echo "$failures failure(s)"; exit 1; fi
echo "all passed"
