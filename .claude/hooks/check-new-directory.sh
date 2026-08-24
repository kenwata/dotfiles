#!/bin/bash
# PreToolUse(Write) hook: 新規ディレクトリ作成時に docs/architecture.md の確認を促す
#
# Agent が実装を始めると frontend/backend を切ってその直下にベタ置きする、src/ 直下に
# 全ファイルを並べる、生成物を直下に書き出す、といった配置の乱れが起きがちだった。
# これを防ぐ一次的な手段は .claude/rules/coding-principles.md §13 の配置規約と
# CLAUDE.md からのポインタ(プロンプト側の配線)であり、本 hook はその安全網に過ぎない。
#
# 既知の限界: PreToolUse(Write) にのみ発火する。Bash(mkdir ...) / シェルリダイレクト / cp /
# スキャフォールドコマンド(npm create, cargo new 等)経由のディレクトリ作成は検知できない。
# 全経路をカバーする機構ではなく、意図的にそう設計されている。
#
# 出力規約: 問題なし・対象外ならなにも出力しない。警告時のみ additionalContext を出す
# (ブロックしない)。いかなる場合も exit 0。

input="$(cat)"

tool_name="$(echo "$input" | jq -r '.tool_name // empty')"
[ "$tool_name" = "Write" ] || exit 0

file_path="$(echo "$input" | jq -r '.tool_input.file_path // empty')"
[ -n "$file_path" ] || exit 0

parent_dir="$(dirname "$file_path")"

# 対象外: 親ディレクトリが既に存在する(新規ディレクトリの作成ではない)
[ -d "$parent_dir" ] && exit 0

# git rev-parse を通すため、実在する祖先ディレクトリまで遡る
# (parent_dir 自体は上のチェックにより非存在が確定している)
existing_ancestor="$parent_dir"
while [ ! -d "$existing_ancestor" ]; do
  existing_ancestor="$(dirname "$existing_ancestor")"
done

# 対象外: git repo 外(スクラッチパッド・/tmp など)
repo_root="$(cd "$existing_ancestor" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || exit 0

# 対象外: docs/architecture.md を運用していないプロジェクト
[ -f "$repo_root/docs/architecture.md" ] || exit 0

# repo_root は git が実体パス(シンボリックリンク解決後)で返す一方、parent_dir は
# 与えられたパスそのまま(未解決)なので、単純な prefix 除去では一致しないことがある
# (例: macOS の /tmp -> /private/tmp)。existing_ancestor を実体パスへ解決してから
# parent_dir の残り部分(タイル)を付け直し、両者を同じ基準に揃えてから相対化する
tail_part="${parent_dir#$existing_ancestor}"
canonical_ancestor="$(cd "$existing_ancestor" && pwd -P)"
canonical_parent="${canonical_ancestor}${tail_part}"
display_path="${canonical_parent#$repo_root/}"

message="新規ディレクトリ \`${display_path}\` を作成しようとしています。docs/architecture.md の置き場の決定表に照らして妥当か確認し、記載が無ければ同じ変更で追記してから作成すること。配置規約の実体は .claude/rules/coding-principles.md §13。"

jq -n --arg msg "$message" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $msg}}'
exit 0
