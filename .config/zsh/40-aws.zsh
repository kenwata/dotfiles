# AWS CLI completion
if command -v aws_completer >/dev/null 2>&1; then
  autoload -Uz compinit
  compinit
  autoload -Uz bashcompinit
  bashcompinit
  complete -C "$(command -v aws_completer)" aws
fi

# Env val
export AWS_PROFILE=bedrock-dev
export AWS_REGION=ap-northeast-1
export AWS_DEFAULT_REGION=ap-northeast-1

# Claude Code via Bedrock（CLAUDE_BEDROCK_MODEL でモデル上書き可、既定 opusplan）
claude-bedrock() {
  # 対話端末のときだけ起動前に画面クリア（パイプ／非対話利用を壊さないよう -t でガード）
  [[ -t 1 ]] && command clear
  AWS_PROFILE=bedrock-dev \
  AWS_REGION=ap-northeast-1 \
  AWS_DEFAULT_REGION=ap-northeast-1 \
  CLAUDE_CODE_USE_BEDROCK=1 \
  CLAUDE_CONFIG_DIR="$HOME/.claude-bedrock" \
  ANTHROPIC_MODEL="${CLAUDE_BEDROCK_MODEL:-opusplan}" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="jp.anthropic.claude-opus-4-8" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="jp.anthropic.claude-sonnet-4-6" \
  CLAUDE_CODE_EFFORT_LEVEL="high" \
  claude "$@"
}

# agmsg 連携用ロール別ラッパー
# ロール指示ファイルを --append-system-prompt-file で注入する。
# 解決順: cwd の .claude/roles/<role>.md（プロジェクト固有の上書き）
#       → ~/.claude/roles/<role>.md（グローバル正本）
_claude_role_file() {
  local f="$PWD/.claude/roles/$1.md"
  [[ -f "$f" ]] || f="$HOME/.claude/roles/$1.md"
  [[ -f "$f" ]] && print -r -- "$f"
}

claude-coder() {
  local -a args
  local role; role="$(_claude_role_file coder)"
  [[ -n "$role" ]] && args=(--append-system-prompt-file "$role")
  CLAUDE_BEDROCK_MODEL="jp.anthropic.claude-sonnet-4-6" claude-bedrock "${args[@]}" "$@"
}

claude-reviewer() {
  local -a args
  local role; role="$(_claude_role_file reviewer)"
  [[ -n "$role" ]] && args=(--append-system-prompt-file "$role")
  CLAUDE_BEDROCK_MODEL="jp.anthropic.claude-opus-4-8" claude-bedrock "${args[@]}" "$@"
}

claude-planner() {
  local -a args
  local role; role="$(_claude_role_file planner)"
  [[ -n "$role" ]] && args=(--append-system-prompt-file "$role")
  claude --model opus "${args[@]}" "$@"
}

# カレントディレクトリで planner/coder/reviewer チームを組成する
# Usage: claude-team-init [チーム名]   （既定: devteam-<ディレクトリ名>）
# join.sh は冪等（既登録の registration は重複追加されない）なので再実行しても安全
claude-team-init() {
  local agmsg="$HOME/.agents/skills/agmsg/scripts"
  local team="${1:-devteam-${PWD:t}}"
  local role
  for role in planner coder reviewer; do
    "$agmsg/join.sh" "$team" "$role" claude-code "$PWD" || return 1
  done
  "$agmsg/delivery.sh" set monitor claude-code "$PWD" || return 1
  echo "--- team: $team"
  "$agmsg/team.sh" "$team"
  "$agmsg/delivery.sh" status claude-code "$PWD"
}

# カレントディレクトリの planner/coder/reviewer チームを解散する
# 登録・agmsg メッセージ履歴・actas ロックを削除する。
# Usage: claude-team-teardown [チーム名] [--yes]   （既定: devteam-<ディレクトリ名>）
# --yes を付けると確認プロンプトをスキップする。
claude-team-teardown() {
  local agmsg="$HOME/.agents/skills/agmsg/scripts"
  local team="${1:-devteam-${PWD:t}}"
  shift 2>/dev/null || true
  "$agmsg/disband.sh" "$team" "$@"
}

# 当月の Bedrock 利用だけを集計（月が変われば自動リセット）
bedrock-cost() {
  CLAUDE_CONFIG_DIR="$HOME/.claude-bedrock" \
  npx ccusage@latest monthly \
    --since "$(date +%Y%m01)" \
    --timezone Asia/Tokyo "$@"
}
