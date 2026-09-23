#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
codex_home="${2:-${CODEX_HOME:-$HOME/.codex}}"
backup_dir="${3:-$HOME/.dotfiles-backup/$(date +%Y%m%d_%H%M%S)/codex}"
worker_home="${4:-${CODEX_WORKER_HOME:-$HOME/.codex-worker}}"

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

backup_and_copy() {
  local source_path="$1" destination="$2"
  mkdir -p "$(dirname "$destination")"

  if [[ ! -L "$destination" && -f "$destination" ]] \
    && cmp -s "$source_path" "$destination"; then
    info "already copied: $destination"
    return
  fi

  if [[ -d "$destination" && ! -L "$destination" ]]; then
    printf '[codex] cannot replace directory with file: %s\n' "$destination" >&2
    return 1
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    local relative backup_path
    relative="${destination#"$codex_home"/}"
    backup_path="$(next_backup_path "$relative")"
    mv "$destination" "$backup_path"
    info "backed up: $destination -> $backup_path"
  fi

  cp "$source_path" "$destination"
  info "copied: $destination <- $source_path"
}

# 未作成の末尾を残したまま、実在する最も深い祖先までをシンボリックリンク解決済みの実体パスにする
# (最も深い祖先がファイルならその親ディレクトリを解決する。解決できなければ元のパスを返す)
physical_path() {
  local target="$1" tail="" resolved
  while [[ ! -e "$target" && "$target" != "/" ]]; do
    tail="/$(basename "$target")$tail"
    target="$(dirname "$target")"
  done
  if [[ ! -d "$target" ]]; then
    tail="/$(basename "$target")$tail"
    target="$(dirname "$target")"
  fi
  resolved="$(cd -P "$target" 2>/dev/null && pwd -P)" || { printf '%s\n' "$1"; return; }
  printf '%s%s\n' "${resolved%/}" "$tail"
}

# Codex の workspace-write は、書込許可パスにシンボリックリンクの要素があると sandbox 自体を起動できない
# ("symlinked writable roots are not supported")。~/.agents は dotfiles へのリンクなので、実体パスで書き出す。
resolve_writable_roots() {
  local config="$1" count index root resolved
  count="$(yq -p=toml -o=json '.sandbox_workspace_write.writable_roots // [] | length' "$config")"
  for ((index = 0; index < count; index++)); do
    root="$(yq -p=toml -o=json -r ".sandbox_workspace_write.writable_roots[$index]" "$config")"
    resolved="$(physical_path "$root")"
    [[ "$resolved" == "$root" ]] && continue
    RESOLVED_ROOT="$resolved" yq -i -p=toml -o=toml \
      ".sandbox_workspace_write.writable_roots[$index] = strenv(RESOLVED_ROOT)" "$config" || return 1
  done
}

# /execute-task の Codex worker 用ホーム。設定は worker-config.toml の複製、認証は通常ホームの auth.json への
# リンクで共有する(runner は起動ごとにリンクが保たれているかを検査する)。AGENTS.md・hooks・skills は置かない。
install_worker_home() {
  local destination="$worker_home/config.toml" auth="$worker_home/auth.json" backup_path
  mkdir -p "$worker_home"
  chmod 700 "$worker_home"

  # Codex は実行したプロジェクトの信頼設定([projects."<path>"])を config.toml に書き足す。その表は比較から除く
  # (除かないと install の度に差分ありとして置き換えが起きる)
  if [[ -f "$destination" && ! -L "$destination" ]] \
    && [[ "$(yq -p=toml -o=json 'del(.projects)' "$destination")" == "$(yq -p=toml -o=json 'del(.projects)' "$source_dir/worker-config.toml")" ]]; then
    info "worker config already copied: $destination"
  else
    if [[ -e "$destination" || -L "$destination" ]]; then
      backup_path="$(next_backup_path worker/config.toml)"
      mv "$destination" "$backup_path"
      info "backed up: $destination -> $backup_path"
    fi
    cp "$source_dir/worker-config.toml" "$destination"
    info "copied: $destination <- $source_dir/worker-config.toml"
  fi

  if [[ -L "$auth" && "$(readlink "$auth")" == "$codex_home/auth.json" ]]; then
    info "worker auth already linked: $auth"
    return
  fi
  if [[ -e "$auth" || -L "$auth" ]]; then
    backup_path="$(next_backup_path worker/auth.json)"
    mv "$auth" "$backup_path"
    info "backed up: $auth -> $backup_path"
  fi
  ln -s "$codex_home/auth.json" "$auth"
  info "linked: $auth -> $codex_home/auth.json"
}

# モデルの選択は、既に入っている値をテンプレートより優先する(テンプレートの値は新規インストールの既定だけに使う)。
# モデルは更新されるので、テンプレートに書いた版で install の度に実環境を古い版へ巻き戻さないため
RUNTIME_MODEL_KEYS=(.model .model_reasoning_effort .agents.default_subagent_model .agents.default_subagent_reasoning_effort)

preserve_runtime_models() {
  local current="$1" merged="$2" key value
  for key in "${RUNTIME_MODEL_KEYS[@]}"; do
    value="$(yq -p=toml -o=json -r "$key // \"\"" "$current")"
    [[ -z "$value" ]] && continue
    RUNTIME_VALUE="$value" yq -i -p=toml -o=toml "$key = strenv(RUNTIME_VALUE)" "$merged" || return 1
  done
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

  if ! resolve_writable_roots "$rendered"; then
    rm -f "$current" "$rendered" "$merged"
    return 1
  fi

  if [[ -s "$current" ]]; then
    if ! yq eval-all -p=toml -o=toml \
      '(select(fileIndex == 0) * select(fileIndex == 1)) | del(.agents.advisor)' \
      "$current" "$rendered" > "$merged"; then
      rm -f "$current" "$rendered" "$merged"
      return 1
    fi
  else
    if ! yq eval -p=toml -o=toml 'del(.agents.advisor)' \
      "$rendered" > "$merged"; then
      rm -f "$current" "$rendered" "$merged"
      return 1
    fi
  fi

  if [[ -s "$current" ]] && ! preserve_runtime_models "$current" "$merged"; then
    rm -f "$current" "$rendered" "$merged"
    return 1
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

retire_deprecated_agent() {
  local filename="$1" destination backup_path
  destination="$codex_home/agents/$filename"
  [[ -e "$destination" || -L "$destination" ]] || return 0

  backup_path="$(next_backup_path "agents/$filename")"
  mv "$destination" "$backup_path"
  info "retired deprecated agent: $destination -> $backup_path"
}

mkdir -p "$codex_home" "$codex_home/agents" "$codex_home/hooks" "$codex_home/skills"

for name in AGENTS.md; do
  backup_and_link "$source_dir/$name" "$codex_home/$name"
done

backup_and_link "$source_dir/user-hooks.json" "$codex_home/hooks.json"

install_user_config
install_worker_home
retire_deprecated_agent "advisor.toml"

for source_path in "$source_dir"/agents/*.toml; do
  [[ -e "$source_path" ]] || continue
  backup_and_copy "$source_path" "$codex_home/agents/$(basename "$source_path")"
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
