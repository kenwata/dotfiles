#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
codex_home="${2:-${CODEX_HOME:-$HOME/.codex}}"
backup_dir="${3:-$HOME/.dotfiles-backup/$(date +%Y%m%d_%H%M%S)/codex}"

info() { printf '[codex] %s\n' "$*"; }

next_backup_path() {
  local relative="$1" candidate
  candidate="$backup_dir/$relative"
  mkdir -p "$(dirname "$candidate")"
  if [[ -e "$candidate" || -L "$candidate" ]]; then
    candidate="$candidate.$(date +%s)"
  fi
  printf '%s\n' "$candidate"
}

backup_and_link() {
  local source_path="$1" destination="$2"
  mkdir -p "$(dirname "$destination")"

  if [[ -L "$destination" && "$(readlink "$destination")" == "$source_path" ]]; then
    info "already linked: $destination"
    return
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    local relative backup_path
    relative="${destination#"$codex_home"/}"
    backup_path="$(next_backup_path "$relative")"
    mv "$destination" "$backup_path"
    info "backed up: $destination -> $backup_path"
  fi

  ln -s "$source_path" "$destination"
  info "linked: $destination -> $source_path"
}

install_user_config() {
  local template="$source_dir/user-config.toml"
  local destination="$codex_home/config.toml"
  local current rendered merged backup_path

  command -v yq >/dev/null 2>&1 || {
    printf '[codex] yq v4 is required to merge user-config.toml without losing runtime state\n' >&2
    return 1
  }
  yq --version 2>&1 | grep -q 'mikefarah/yq' || {
    printf '[codex] mikefarah/yq v4 is required to merge Codex TOML safely\n' >&2
    return 1
  }

  current="$(mktemp)"
  rendered="$(mktemp)"
  merged="$(mktemp)"
  if [[ -e "$destination" || -L "$destination" ]]; then
    cp -L "$destination" "$current"
  else
    : > "$current"
  fi

  if ! CODEX_CONFIG_HOME="$HOME" yq eval -p=toml -o=toml \
    '(.. | select(tag == "!!str")) |= sub("\\{\\{HOME\\}\\}"; strenv(CODEX_CONFIG_HOME))' \
    "$template" > "$rendered"; then
    rm -f "$current" "$rendered" "$merged"
    return 1
  fi

  if [[ -s "$current" ]]; then
    if ! yq eval-all -p=toml -o=toml \
      'select(fileIndex == 0) * select(fileIndex == 1)' \
      "$current" "$rendered" > "$merged"; then
      rm -f "$current" "$rendered" "$merged"
      return 1
    fi
  else
    cp "$rendered" "$merged"
  fi

  if [[ ! -L "$destination" && -f "$destination" ]] && cmp -s "$destination" "$merged"; then
    rm -f "$current" "$rendered" "$merged"
    info "user config already merged: $destination"
    return
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    backup_path="$(next_backup_path config.toml)"
    cp -L "$destination" "$backup_path"
    rm "$destination"
    info "backed up user config: $destination -> $backup_path"
  fi
  mv "$merged" "$destination"
  chmod 600 "$destination"
  rm -f "$current" "$rendered"
  info "merged: $template -> $destination (runtime-only keys preserved)"
}

mkdir -p "$codex_home" "$codex_home/agents" "$codex_home/hooks" "$codex_home/skills"

for name in AGENTS.md; do
  backup_and_link "$source_dir/$name" "$codex_home/$name"
done

backup_and_link "$source_dir/user-hooks.json" "$codex_home/hooks.json"

install_user_config

for source_path in "$source_dir"/agents/*.toml; do
  [[ -e "$source_path" ]] || continue
  backup_and_link "$source_path" "$codex_home/agents/$(basename "$source_path")"
done

for source_path in "$source_dir"/hooks/*; do
  [[ -f "$source_path" ]] || continue
  backup_and_link "$source_path" "$codex_home/hooks/$(basename "$source_path")"
done

for source_path in "$source_dir"/skills/*; do
  [[ -d "$source_path" ]] || continue
  backup_and_link "$source_path" "$codex_home/skills/$(basename "$source_path")"
done

info "declarative Codex configuration installed; runtime state under $codex_home was preserved"
