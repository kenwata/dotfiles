#!/bin/bash
# SessionStart hook: HANDOFF.md の未コミット変更検知
#
# 前セッションが状態を更新したのにコミットしないまま終わった場合、次セッションが
# 未着地の引き継ぎを読むことになる。これを起動時に検知して警告する。
# HANDOFF.md は状態が変わった時だけ更新するため、最終更新コミットからの距離は
# 陳腐化の根拠にしない。
#
# 出力規約: 問題なしなら何も出力しない。警告は stdout へ 1 行
# (SessionStart hook の stdout はセッションのコンテキストに追加される)。
# いかなる場合も exit 0(セッション開始をブロックしない)。

# 対象外: git repo 外 / HANDOFF.md 運用をしていない / コミットゼロ
# HANDOFF.md はリポジトリルート直下が定位置のため、サブディレクトリ起動
# (ロールセッション: cd agents/<role> && claude)でも検知できるようルートへ移動する
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
cd "$(git rev-parse --show-toplevel)" || exit 0
[ -f HANDOFF.md ] || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

if [ -n "$(git status --porcelain -- HANDOFF.md 2>/dev/null)" ]; then
  echo "⚠ HANDOFF.md に未コミットの変更があります。内容が現状と整合するか確認し、軽量終了処理の変更としてコミットしてから着手すること。"
fi
exit 0
