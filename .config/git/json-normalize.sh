#!/usr/bin/env bash
# git clean filter — JSON のキー順を正規化する。
#
# 目的:
#   Claude Code は /model や /theme などの操作のたびに settings.json を丸ごと
#   書き戻し、その際キーの並び順が変わる。値が同じでも git 上は差分になり、
#   worktree が汚れて `git pull` が "local changes would be overwritten" で
#   止まる。index に入る内容をキーソート済みに正規化することで、
#   「並べ替えだけの変更」を差分ゼロにする。
#
# 安全策:
#   jq が無い / 入力が不正 JSON の場合は原文をそのまま通す（内容を壊さない）。
#
# 登録は .git/config 側（install.sh が行う）。未登録なら git は素通しするため、
# フィルタ未設定のマシンでも壊れない。
set -uo pipefail

tmp="$(mktemp)"
out="$(mktemp)"
trap 'rm -f "$tmp" "$out"' EXIT

cat >"$tmp"

if command -v jq >/dev/null 2>&1 && jq -S . "$tmp" >"$out" 2>/dev/null; then
  cat "$out"
else
  cat "$tmp"
fi
