#!/bin/bash
# PostToolUse(Write|Edit) hook: Markdown ファイルを formatter/linter に通す
#
# .claude/templates/rules/markdown.md のうち、決定論的に直せる規則(装飾の外側スペース・
# code fence の backtick 数)を LLM の遵守に頼らず保証するための CLI
# (.claude/hooks/lib/markdown-format/。依存ゼロ・ビルドなし、詳細は同所の README.md)
# を、Write/Edit で保存された .md ファイルに対して呼び出す。
#
# 適用範囲は CLI 自身が判定する: プロジェクト(優先)またはユーザーレベルの
# `.claude/rules/markdown.md` が存在し、その `paths:` frontmatter が対象ファイルに
# マッチする場合にのみ動作する。rules を配布していないプロジェクトでは何もしない
# (no-op)ため、他人のリポジトリで無関係な diff を生む事故を構造的に避ける。
#
# 出力規約: PostToolUse hook は decision:block 等でツール実行を取り消せない
# (ツールは既に実行済み)。ドキュメント上唯一確実な経路は「exit 2 で stderr が
# Claude に見える」ことなので、これに一本化する
# (https://code.claude.com/docs/en/hooks.md の Exit code 2 behavior per event、
# 2026-08-28 に claude-code-guide 経由で確認)。formatter がファイルを書き換えた場合は
# 再読み込みを促す文、linter が検出した場合は検出内容を、まとめて stderr に出し exit 2。
# 対象外・異常時は何も出力せず exit 0(フェイルオープン)。
#
# 既知の限界: .md のみが対象(.mdx は対象外)。Bash 経由のファイル変更(heredoc・
# シェルリダイレクト等)は Write/Edit を経由しないため捕捉できない。

input="$(cat)"

tool_name="$(echo "$input" | jq -r '.tool_name // empty')"
case "$tool_name" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

file_path="$(echo "$input" | jq -r '.tool_input.file_path // empty')"
[ -n "$file_path" ] || exit 0
case "$file_path" in
  *.md) ;;
  *) exit 0 ;;
esac

node_bin="$(command -v node 2>/dev/null)"
if [ -z "$node_bin" ] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null)"
fi
[ -n "$node_bin" ] && [ -x "$node_bin" ] || exit 0

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$hook_dir/lib/markdown-format/cli.mjs"
[ -f "$cli" ] || exit 0

project_root="${CLAUDE_PROJECT_DIR:-}"

err_file="$(mktemp)" || exit 0
"$node_bin" "$cli" "$file_path" "$project_root" 2>"$err_file"
status=$?
err="$(cat "$err_file" 2>/dev/null)"
rm -f "$err_file"

if [ "$status" -eq 2 ] && [ -n "$err" ]; then
  echo "$err" >&2
  exit 2
fi

exit 0
