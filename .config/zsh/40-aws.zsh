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
  ANTHROPIC_MODEL="${CLAUDE_BEDROCK_MODEL:-global.anthropic.claude-opus-4-6-v1}" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="global.anthropic.claude-opus-4-6-v1" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="jp.anthropic.claude-sonnet-4-6" \
  CLAUDE_CODE_EFFORT_LEVEL="high" \
  AGMSG_ACTAS="${AGMSG_ACTAS:-}" \
  claude "$@"
}


# Summarize Bedrock usage for the current month (auto-resets when month changes)
bedrock-cost() {
  CLAUDE_CONFIG_DIR="$HOME/.claude-bedrock" \
  npx ccusage@latest monthly \
    --since "$(date +%Y%m01)" \
    --timezone Asia/Tokyo "$@"
}

