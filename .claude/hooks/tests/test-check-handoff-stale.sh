#!/bin/bash
# check-handoff-stale.sh の振る舞いテスト。実行: bash ~/.claude/hooks/tests/test-check-handoff-stale.sh
# hook は常に終了コード 0 で、通知は stdout に出る。

hook="$(cd "$(dirname "$0")/.." && pwd)/check-handoff-stale.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
failures=0

# 引数: テスト名 / stdout に含まれるべき文字列(空なら stdout も空を期待) / stdout に含まれてはならない文字列(空なら検査しない) / HANDOFF.md の本文(空文字なら HANDOFF.md を置かない) / commit するか(yes|no)
run_case() {
  local name="$1" expected="$2" forbidden="$3" handoff="$4" commit="${5:-yes}"
  local repo="$work_dir/$name"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
  if [ -n "$handoff" ]; then
    printf '%s\n' "$handoff" > "$repo/HANDOFF.md"
    if [ "$commit" = "yes" ]; then
      git -C "$repo" add HANDOFF.md
      git -C "$repo" -c user.name=t -c user.email=t@example.com commit -q -m handoff
    fi
  fi

  local stdout
  stdout="$(cd "$repo" && bash "$hook")"
  local actual_code=$?

  if [ "$actual_code" -ne 0 ]; then
    echo "FAIL $name: exit=$actual_code expected=0"; failures=$((failures + 1)); return
  fi
  if [ -z "$expected" ] && [ -n "$stdout" ]; then
    echo "FAIL $name: stdout should be empty but was: $stdout"; failures=$((failures + 1)); return
  fi
  if [ -n "$expected" ] && ! printf '%s' "$stdout" | grep -q "$expected"; then
    echo "FAIL $name: stdout lacks '$expected' (was: $stdout)"; failures=$((failures + 1)); return
  fi
  if [ -n "$forbidden" ] && printf '%s' "$stdout" | grep -q "$forbidden"; then
    echo "FAIL $name: stdout must not contain '$forbidden' (was: $stdout)"; failures=$((failures + 1)); return
  fi
  echo "ok   $name"
}

header=$'# HANDOFF\n\n<!--\n  ## 要確認(ユーザー判断待ち)\n  - [回収: T<n> 着手前 | 次の /follow-up] （なければ「なし」）\n-->\n\n## 次セッションの最初の一手\n\n- T3\n'

run_case "silent_without_handoff" "" "" ""
run_case "silent_when_pending_section_says_none" "" "" \
  "${header}"$'\n## 要確認(ユーザー判断待ち)\n\n- なし'
run_case "silent_when_template_comment_is_the_only_list" "" "" "${header}"
run_case "reports_count_of_anchored_items" "要確認が 2 件" "回収点が無く" \
  "${header}"$'\n## 要確認(ユーザー判断待ち)\n\n- [回収: T7 着手前] 期限切れ時の契約を設計書へ追記するか\n- [回収: 次の /follow-up] 自動生成ブロックを保持するか'
run_case "reports_items_without_collection_point" "うち 1 件は回収点が無く" "" \
  "${header}"$'\n## 要確認（ユーザー判断待ち）\n\n- [回収: T7 着手前] 期限切れ時の契約を設計書へ追記するか\n- 急がない: 追記専用規約の変更が利用者決定だったかの確認'
run_case "does_not_count_items_of_following_section" "要確認が 1 件" "" \
  "${header}"$'\n## 要確認(ユーザー判断待ち)\n\n- [回収: 次の /follow-up] 一件だけ\n\n## 付記\n\n- これは要確認ではない'
run_case "warns_on_uncommitted_handoff" "未コミットの変更" "" \
  "${header}"$'\n## 要確認(ユーザー判断待ち)\n\n- なし' no

if [ "$failures" -eq 0 ]; then echo "PASS"; else echo "FAILED: $failures"; exit 1; fi
