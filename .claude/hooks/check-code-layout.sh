#!/bin/bash
# PostToolUse(Write|Edit) hook: コードのレイアウトの最低限(coding-principles.md §14)を検査する
#
# 規約 .claude/templates/rules/coding-principles.md §14(Layout)のうち、機械で決められる位置
# (100 桁を超える行・閉じたブロックに続く文・文に続く閉じの return・空行なしで 8 文以上続く箇所)を、
# モデルの遵守に頼らず検査する CLI(.claude/hooks/lib/code-layout/。依存ゼロ・ビルドなし、
# 詳細は同所の README.md)を、Write/Edit で保存されたコードのファイルに対して呼び出す。
# 整形ツールは行を折り返すが空行を入れないので、段落の抜けはこの検査でしか拾えない。
#
# 適用範囲は CLI 自身が判定する: プロジェクトが .claude/rules/coding-principles.md を持つ時だけ
# 動き、対象の拡張子は CLI の言語の表(languages.mjs)で決まる。規約を配布していない
# リポジトリでは何もしない(他人のコードに指摘を出さない)。
#
# 出力規約: format-markdown.sh と同じく、指摘は stderr に出して exit 2 に一本化する
# (PostToolUse の exit 2 は stderr が Claude に見える、と文書化された唯一の確実な経路)。
# ファイルは書き換えない。どこで段落を切るかは Claude に判断させるため。
# 対象外・異常時は何も出力せず exit 0(フェイルオープン)。
#
# Codex CLI のセッションでは .codex/hooks/check-code-layout.mjs(apply_patch の追加行を同じ CLI に通す
# アダプター)が同じ検査を行う。
#
# 既知の限界: Bash 経由のファイル変更は Write/Edit を経由しないため捕捉できない。

input="$(cat)"

tool_name="$(echo "$input" | jq -r '.tool_name // empty')"
case "$tool_name" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

file_path="$(echo "$input" | jq -r '.tool_input.file_path // empty')"
[ -n "$file_path" ] || exit 0

project_root="${CLAUDE_PROJECT_DIR:-}"
[ -n "$project_root" ] || exit 0

node_bin="$(command -v node 2>/dev/null)"
if [ -z "$node_bin" ] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null)"
fi

[ -n "$node_bin" ] && [ -x "$node_bin" ] || exit 0

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$hook_dir/lib/code-layout/cli.mjs"
[ -f "$cli" ] || exit 0

err_file="$(mktemp)" || exit 0
printf '%s' "$input" | "$node_bin" "$cli" "$file_path" "$project_root" 2>"$err_file"
status=$?
err="$(cat "$err_file" 2>/dev/null)"
rm -f "$err_file"

if [ "$status" -eq 2 ] && [ -n "$err" ]; then
  echo "$err" >&2
  exit 2
fi

exit 0
