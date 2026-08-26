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

# Claude Code via Bedrock (override model with CLAUDE_BEDROCK_MODEL; default: opusplan)
claude-bedrock() {
  # Clear screen only for interactive terminals (guard with -t to avoid breaking pipes)
  [[ -t 1 ]] && command clear
  AWS_PROFILE=bedrock-dev \
  AWS_REGION=ap-northeast-1 \
  AWS_DEFAULT_REGION=ap-northeast-1 \
  CLAUDE_CODE_USE_BEDROCK=1 \
  CLAUDE_CONFIG_DIR="$HOME/.claude-bedrock" \
  CLAUDE_CODE_EFFORT_LEVEL="high" \
  AGMSG_ACTAS="${AGMSG_ACTAS:-}" \
  claude "$@"
}


# Summarize Bedrock usage for the current month (auto-resets when month changes)
#
# ~/.claude/projects が会話履歴の実体で、~/.claude-bedrock/projects はそこへの
# symlink(Anthropic 直/Bedrock 経由で memory と履歴を共有するため)。よって
# ccusage にそのまま渡すと Anthropic 直の利用分まで混ざる。Bedrock 発行分は
# message.id が msg_bdrk_ で始まり requestId が null になる(Anthropic 直は
# msg_01.../req_...)ので、その行だけを一時ディレクトリへ抽出してから渡す。
bedrock-cost() {
  local src="$HOME/.claude/projects"
  local tmp
  tmp="$(mktemp -d)" || return 1

  local f rel dest
  for f in $(rg -l 'msg_bdrk_' -g '*.jsonl' "$src" 2>/dev/null); do
    rel="${f#$src/}"
    dest="$tmp/projects/$rel"
    mkdir -p "$(dirname "$dest")"
    jq -c 'select((.message.id // "") | startswith("msg_bdrk_"))' "$f" > "$dest"
    [[ -s "$dest" ]] || rm -f "$dest"
  done

  CLAUDE_CONFIG_DIR="$tmp" \
  npx ccusage@latest monthly \
    --since "$(date +%Y%m01)" \
    --timezone Asia/Tokyo "$@"
  local exit_code=$?

  rm -rf "$tmp"
  return $exit_code
}

