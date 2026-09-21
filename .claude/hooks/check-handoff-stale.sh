#!/bin/bash
# SessionStart hook: HANDOFF.md の未コミット変更検知と、未決の要確認の通知
#
# 前セッションが状態を更新したのにコミットしないまま終わった場合、次セッションが
# 未着地の引き継ぎを読むことになる。これを起動時に検知して警告する。
# HANDOFF.md は状態が変わった時だけ更新するため、最終更新コミットからの距離は
# 陳腐化の根拠にしない。
#
# 要確認(ユーザー判断待ち)は /execute-task の着手前の関門と /follow-up の冒頭が回収するが、
# それらを通らずに「次の一手」から直接着手するセッションでは拾われない。件数と、回収点
# ([回収: T<n> 着手前] / [回収: 次の /follow-up])を持たない行の件数を起動時に知らせる。
# 書式の正は ~/.claude/templates/skeletons/handoff.md 冒頭の規約。
#
# 出力規約: 問題なしなら何も出力しない。警告は 1 件につき stdout へ 1 行
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

# 要確認の節(見出しから次の見出しまで)の箇条書きを数える。規約コメント内の雛形は除く
pending_items="$(sed '/^<!--/,/-->/d' HANDOFF.md \
  | awk '/^## *要確認/{in_section=1; next} /^## /{in_section=0} in_section && /^- /' \
  | grep -Ev '^- *(なし|（なければ)')"
if [ -n "$pending_items" ]; then
  pending_count="$(printf '%s\n' "$pending_items" | wc -l | tr -d ' ')"
  unanchored_count="$(printf '%s\n' "$pending_items" | grep -Evc '^- *\[回収: (T[0-9]+ 着手前|次の /follow-up)\]')"
  message="ℹ HANDOFF.md の要確認が ${pending_count} 件あります。着手するタスクを回収点([回収: T<n> 着手前])に持つ項目は、着手前に利用者へ問うこと。"
  if [ "$unanchored_count" -gt 0 ]; then
    message="${message} うち ${unanchored_count} 件は回収点が無く、次の /follow-up で全件が回収対象になります。"
  fi
  echo "$message"
fi
exit 0
