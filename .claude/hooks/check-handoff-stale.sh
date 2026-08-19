#!/bin/bash
# SessionStart hook: HANDOFF.md の陳腐化検知
#
# 前セッションが終了手順(HANDOFF.md の全体上書き+コミット)を完了しないまま
# 終わった場合、次セッションが古い「次の一手」を読んでしまう。これを起動時に
# 機構側で検知して警告する(README 設計方針「更新トリガーは配線する」の安全網)。
#
# 出力規約: 問題なしなら何も出力しない。警告は stdout へ 1 行
# (SessionStart hook の stdout はセッションのコンテキストに追加される)。
# いかなる場合も exit 0(セッション開始をブロックしない)。

# 対象外: HANDOFF.md 運用をしていない / git repo 外 / コミットゼロ
[ -f HANDOFF.md ] || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

if [ -n "$(git status --porcelain -- HANDOFF.md 2>/dev/null)" ]; then
  echo "⚠ HANDOFF.md に未コミットの変更があります(前セッションの終了手順④コミットが未完の可能性)。内容が現状と整合するか確認してからコミットし、そのうえで着手すること。"
  exit 0
fi

last_handoff_commit=$(git log -1 --format=%H -- HANDOFF.md 2>/dev/null)
if [ -z "$last_handoff_commit" ]; then
  # 追跡済みだが一度もコミットされていない状態は porcelain 側で検知済みのため、
  # ここに来るのは grafted 等の特殊ケースのみ。誤警告を避けて沈黙する
  exit 0
fi

behind=$(git rev-list --count "${last_handoff_commit}..HEAD" 2>/dev/null)
if [ "${behind:-0}" -gt 0 ]; then
  echo "⚠ HANDOFF.md は最新コミットより ${behind} コミット古い可能性があります(前セッションが終了手順を完了しなかった疑い)。git log --oneline -5 で直近の作業を確認し、HANDOFF.md の内容が古ければ再構成・コミットしてから着手すること。"
fi
exit 0
