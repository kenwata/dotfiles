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
  ANTHROPIC_MODEL="${CLAUDE_BEDROCK_MODEL:-opusplan}" \
  ANTHROPIC_DEFAULT_OPUS_MODEL="jp.anthropic.claude-opus-4-8" \
  ANTHROPIC_DEFAULT_SONNET_MODEL="jp.anthropic.claude-sonnet-4-6" \
  CLAUDE_CODE_EFFORT_LEVEL="high" \
  AGMSG_ACTAS="${AGMSG_ACTAS:-}" \
  claude "$@"
}

# Per-role wrappers for agmsg team collaboration.
# Injects the role instruction file via --append-system-prompt-file.
# Resolution order: cwd .claude/roles/<role>.md (project-local override)
#                 → ~/.claude/roles/<role>.md (global canonical)
_claude_role_file() {
  local f="$PWD/.claude/roles/$1.md"
  [[ -f "$f" ]] || f="$HOME/.claude/roles/$1.md"
  [[ -f "$f" ]] && print -r -- "$f"
}

claude-coder() {
  local -a args
  local role; role="$(_claude_role_file coder)"
  [[ -n "$role" ]] && args=(--append-system-prompt-file "$role")
  AGMSG_ACTAS=coder CLAUDE_BEDROCK_MODEL="jp.anthropic.claude-sonnet-4-6" claude-bedrock "${args[@]}" "$@"
}

claude-reviewer() {
  local -a args
  local role; role="$(_claude_role_file reviewer)"
  [[ -n "$role" ]] && args=(--append-system-prompt-file "$role")
  AGMSG_ACTAS=reviewer CLAUDE_BEDROCK_MODEL="jp.anthropic.claude-opus-4-8" claude-bedrock "${args[@]}" "$@"
}

claude-planner() {
  local -a args
  local role; role="$(_claude_role_file planner)"
  [[ -n "$role" ]] && args=(--append-system-prompt-file "$role")
  AGMSG_ACTAS=planner claude --model opus "${args[@]}" "$@"
}

# Compose the planner/coder/reviewer devteam in the current directory.
# Usage: claude-devteam-init [team]   (default: devteam-<dirname>)
# join.sh is idempotent — safe to re-run even if already registered
claude-devteam-init() {
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
# Backward-compat alias — existing invocations and README references keep working
alias claude-team-init=claude-devteam-init

# --- Shared helpers for design-team role wrappers ---
# Bedrock role wrapper: _claude_bedrock_role <role> <model> [args...]
_claude_bedrock_role() {
  local role="$1" model="$2"; shift 2
  local -a args; local f; f="$(_claude_role_file "$role")"
  [[ -n "$f" ]] && args=(--append-system-prompt-file "$f")
  AGMSG_ACTAS="$role" CLAUDE_BEDROCK_MODEL="$model" claude-bedrock "${args[@]}" "$@"
}

# Subscription role wrapper: _claude_sub_role <role> [args...]  (regular API, ~/.claude)
_claude_sub_role() {
  local role="$1"; shift
  local -a args; local f; f="$(_claude_role_file "$role")"
  [[ -n "$f" ]] && args=(--append-system-prompt-file "$f")
  AGMSG_ACTAS="$role" claude --model opus "${args[@]}" "$@"
}

# --- design-team launch wrappers (6 roles) ---
# Orchestrator: subscription Opus (Monitor receive + WebSearch available)
claude-orchestrator()      { _claude_sub_role     orchestrator "$@"; }
# Content Architect / Layout Designer / Renderer: Bedrock Sonnet
claude-content-architect() { _claude_bedrock_role content-architect jp.anthropic.claude-sonnet-4-6 "$@"; }
claude-layout-designer()   { _claude_bedrock_role layout-designer   jp.anthropic.claude-sonnet-4-6 "$@"; }
claude-renderer()          { _claude_bedrock_role renderer          jp.anthropic.claude-sonnet-4-6 "$@"; }
# Diagram Architect / design-reviewer: Bedrock Opus
claude-diagram-architect() { _claude_bedrock_role diagram-architect jp.anthropic.claude-opus-4-8   "$@"; }
claude-design-reviewer()   { _claude_bedrock_role design-reviewer   jp.anthropic.claude-opus-4-8   "$@"; }

# Compose the 6-role design-team in the current directory.
# Usage: claude-design-team-init [team]   (default: designteam-<dirname>)
# join.sh is idempotent — safe to re-run even if already registered
claude-design-team-init() {
  local agmsg="$HOME/.agents/skills/agmsg/scripts"
  local team="${1:-designteam-${PWD:t}}"
  local role
  for role in orchestrator content-architect diagram-architect layout-designer renderer design-reviewer; do
    "$agmsg/join.sh" "$team" "$role" claude-code "$PWD" || return 1
  done
  "$agmsg/delivery.sh" set monitor claude-code "$PWD" || return 1
  echo "--- team: $team"
  "$agmsg/team.sh" "$team"
  "$agmsg/delivery.sh" status claude-code "$PWD"
}

# Disband the design-team in the current directory.
# Usage: claude-design-team-teardown [team] [--yes]   (default: designteam-<dirname>)
claude-design-team-teardown() {
  local agmsg="$HOME/.agents/skills/agmsg/scripts"
  local team="${1:-designteam-${PWD:t}}"
  shift 2>/dev/null || true
  "$agmsg/disband.sh" "$team" "$@"
}

# Disband the planner/coder/reviewer devteam in the current directory.
# Removes team registration, agmsg message history, and actas locks.
# Usage: claude-team-teardown [team] [--yes]   (default: devteam-<dirname>)
# --yes skips the confirmation prompt.
claude-team-teardown() {
  local agmsg="$HOME/.agents/skills/agmsg/scripts"
  local team="${1:-devteam-${PWD:t}}"
  shift 2>/dev/null || true
  "$agmsg/disband.sh" "$team" "$@"
}

# Summarize Bedrock usage for the current month (auto-resets when month changes)
bedrock-cost() {
  CLAUDE_CONFIG_DIR="$HOME/.claude-bedrock" \
  npx ccusage@latest monthly \
    --since "$(date +%Y%m01)" \
    --timezone Asia/Tokyo "$@"
}

