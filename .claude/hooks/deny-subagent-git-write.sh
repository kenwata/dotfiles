#!/bin/bash
# PreToolUse(Bash) hook: サブエージェントによる git 履歴・リモート変更操作を拒否する
#
# 2026-08-26、/follow-up の検査用に起動したサブエージェント(built-in の general-purpose)が
# 「検査して指摘を報告するだけ」という依頼を越えて自分でファイルを編集し、git commit・git push
# まで独断で実行した。委任の境界がプロンプト文面という軟らかい制約にしか載っていなかったことが
# 原因であり、本 hook はそれを構造的な制約へ移すためのものである。
# コミットと push は主文脈(メインセッション)の責任とし、委任先には渡さない。
#
# 適用範囲: 入力 JSON に agent_id があるとき(= サブエージェント内)のみ発火する。
# メインセッションには一切影響しない(1 タスク = 1 コミットの運用はそのまま)。
# ~/.claude/agents/ のカスタム定義だけでなく built-in の general-purpose / Explore / Plan にも効く。
# frontmatter ではなく settings.json に置いているのはそのためである(事故は built-in で起きた)。
#
# 既知の限界:
# - Bash ツールにのみ発火する。他ツール経由で git に到達する経路は検知しない。
# - コマンド文字列の解析はヒューリスティックである。eval・エイリアス・内部で git push する
#   スクリプトファイルの実行は検知できない。サンドボックスではなく「事故を防ぐ高さ」である。
# - git tag -l / git remote -v のような読み取り専用の形も巻き添えでブロックする。
#   委任先の 4 役割(~/.claude/agents/)のいずれもこれらを必要としないため、過剰ブロック側に倒した。
#
# 出力規約: 対象外なら何も出力せず exit 0。該当時のみ stderr へ理由を出し exit 2 でブロックする。
# 既存の 2 hook(check-new-directory.sh・check-handoff-stale.sh)は「いかなる場合も exit 0」だが、
# 本 hook は拒否が目的であるため、そこだけ意図的に異なる。

# コマンド文字列を単語分割する際にグロブ展開が起きると、`*` がカレントのファイル名へ
# 化けて判定対象がずれる。分割前に無効化しておく
set -f

input="$(cat)"

# 対象外: メインセッション(agent_id はサブエージェント内でのみ入力 JSON に現れる)
agent_id="$(echo "$input" | jq -r '.agent_id // empty')"
[ -n "$agent_id" ] || exit 0

# 対象外: Bash 以外のツール
tool_name="$(echo "$input" | jq -r '.tool_name // empty')"
[ "$tool_name" = "Bash" ] || exit 0

command_str="$(echo "$input" | jq -r '.tool_input.command // empty')"
[ -n "$command_str" ] || exit 0

# ブロック時の共通処理。エージェントには理由と代替(主文脈へ返す)が見える必要がある
deny() {
  echo "Blocked: サブエージェントは git の履歴・リモートを変更できない(検出: $1)。" >&2
  echo "コミット・push・履歴の書き換えは主文脈(メインセッション)の責任である。" >&2
  echo "変更が必要なら、その旨を報告に含めて主文脈に判断を返すこと。" >&2
  echo "読み取り(show/diff/log/status/ls-files 等)は制限されていない。" >&2
  exit 2
}

# git のサブコマンドを判定する。$@ には `git` の次のトークン以降が入る。
# 部分文字列一致にすると `git log --grep=commit` を誤ってブロックするため、
# グローバルフラグを読み飛ばしてサブコマンドトークンを取り出してから照合する
check_git() {
  local sub=""
  while [ $# -gt 0 ]; do
    case "$1" in
      # 値を別トークンで取るグローバルフラグ
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)
        shift || return 0
        shift || return 0
        ;;
      # 値を = で連結するグローバルフラグ、および値を取らないフラグ
      -*)
        shift || return 0
        ;;
      *)
        sub="$1"
        shift
        break
        ;;
    esac
  done
  [ -n "$sub" ] || return 0

  case "$sub" in
    # 無条件にブロック: 履歴・リモート・作業ツリーを変える操作。
    # switch/restore/checkout を含めるのは、サブエージェントは主文脈と作業ツリーを共有しており、
    # ブランチ切り替えがメインセッションの足元を変えてしまうため(commit より実害が大きい)
    commit|push|reset|clean|rebase|merge|cherry-pick|revert|tag|remote|filter-branch|update-ref|switch|restore|checkout)
      deny "git $sub"
      ;;
    # 条件付き: ブランチの削除・改名のみブロック(一覧・作成は通す)
    branch)
      local arg
      for arg in "$@"; do
        case "$arg" in
          -d|-D|-m|-M|--delete|--move|--force|-f) deny "git branch $arg" ;;
        esac
      done
      ;;
    # 条件付き: 参照の読み取り(list/show)以外をブロック
    stash)
      case "${1:-}" in
        list|show) ;;
        *) deny "git stash ${1:-<default=push>}" ;;
      esac
      ;;
    # 条件付き: 書き込み形のみブロック。
    # リポジトリによっては clean/smudge フィルタ(例: ノートブックの出力除去)の有効化を
    # git config --local include.path に依存しており、これを外されるとフィルタが
    # 掛からないまま素通しでコミットされうる
    config)
      local is_read=1
      local arg
      for arg in "$@"; do
        case "$arg" in
          --get|--get-all|--get-regexp|--get-urlmatch|--list|-l) is_read=0 ;;
        esac
      done
      [ "$is_read" -eq 0 ] || deny "git config(書き込み形)"
      ;;
    # 条件付き: 他エージェントの隔離 worktree を壊せるため list 以外をブロック
    worktree)
      case "${1:-}" in
        list) ;;
        *) deny "git worktree ${1:-}" ;;
      esac
      ;;
  esac
}

# gh のサブコマンド対を判定する。$@ には `gh` の次のトークン以降が入る
check_gh() {
  local sub="" action=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -*) shift || return 0 ;;
      *) sub="$1"; shift; break ;;
    esac
  done
  [ -n "$sub" ] || return 0

  # api は動詞がサブコマンドではなくフラグ側にある。
  # gh は小文字のメソッド(-X post)も受け付けるため、小文字化してから照合する
  if [ "$sub" = "api" ]; then
    local arg lowered
    for arg in "$@"; do
      lowered="$(printf '%s' "$arg" | tr 'A-Z' 'a-z')"
      case "$lowered" in
        post|put|patch|delete|--method=post|--method=put|--method=patch|--method=delete)
          deny "gh api($arg)" ;;
      esac
    done
    return 0
  fi

  # サブコマンドの次の非フラグトークンが action
  while [ $# -gt 0 ]; do
    case "$1" in
      -*) shift || return 0 ;;
      *) action="$1"; break ;;
    esac
  done
  [ -n "$action" ] || return 0

  case "$sub" in
    # checkout を含めるのは git checkout と同じ理由(共有作業ツリーのブランチが切り替わる)
    pr)
      case "$action" in
        create|merge|close|edit|review|comment|ready|reopen|checkout) deny "gh pr $action" ;;
      esac ;;
    issue)
      case "$action" in
        create|close|edit|comment|reopen|delete) deny "gh issue $action" ;;
      esac ;;
    release)
      case "$action" in
        create|edit|delete|upload) deny "gh release $action" ;;
      esac ;;
    repo)
      case "$action" in
        create|delete|edit|fork|sync) deny "gh repo $action" ;;
      esac ;;
    gist)
      case "$action" in
        create|edit|delete) deny "gh gist $action" ;;
      esac ;;
    secret)
      case "$action" in
        set|delete) deny "gh secret $action" ;;
      esac ;;
    workflow)
      case "$action" in
        run|enable|disable) deny "gh workflow $action" ;;
      esac ;;
    run)
      case "$action" in
        rerun|cancel) deny "gh run $action" ;;
      esac ;;
    auth)
      case "$action" in
        login|logout|refresh) deny "gh auth $action" ;;
      esac ;;
  esac
}

# 区切り文字(; | & ( ) ` 改行)をすべて改行へ潰し、セグメントごとに判定する。
# `cd x && git push` や `$(git push)` のように、先頭以外に現れる git を取りこぼさないため。
# tr は set2 が短いとき最後の文字で埋めるので、すべて改行へ写る
segments="$(printf '%s' "$command_str" | tr ';|&()' '\n' | tr '\140' '\n')"

# パイプで while に渡すとサブシェルになり deny の exit 2 がスクリプトを抜けないため、
# here-string で現在のシェルのまま回す
while IFS= read -r segment; do
  [ -n "$segment" ] || continue

  # shellの単語分割で先頭トークンを取る(set -f によりグロブ展開は無効)
  set -- $segment
  [ $# -gt 0 ] || continue

  # 前置される環境変数代入・ラッパーコマンドを読み飛ばして実体のコマンド名まで進む
  while [ $# -gt 0 ]; do
    case "$1" in
      *=*) shift ;;
      sudo|env|command|nohup|time|builtin|exec|xargs) shift ;;
      *) break ;;
    esac
  done
  [ $# -gt 0 ] || continue

  # 絶対パス・相対パス指定(/usr/local/bin/git 等)も同じ扱いにする
  case "$1" in
    git|*/git) shift; check_git "$@" ;;
    gh|*/gh) shift; check_gh "$@" ;;
  esac
done <<< "$segments"

exit 0
