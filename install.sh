#!/usr/bin/env bash
# install.sh — dotfiles 環境移行スクリプト
#
# Usage:
#   bash install.sh
#
# 対応: macOS (Apple Silicon / Intel), Ubuntu / WSL
# 冪等: 再実行しても安全（既存設定はバックアップ後に置き換え）
#
# 実行順序:
#   1. 基本パッケージ (Homebrew / apt)
#   2. zsh インストール + ログインシェル設定
#   3. Prezto インストール + zpreztorc 設定
#   4. dotfiles symlink 配置
#   5. peco インストール
#   6. 言語ランタイム (mise / python / node / uv / pnpm)
#   7. CLI ツール (gh / neovim / ripgrep / fd / jq / fzf / tree / tmux)
#   8. Claude Code
#   9. agmsg (multi-agent messaging)
#  10. サマリ

set -euo pipefail

# ============================================================
# グローバル変数
# ============================================================
DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.dotfiles-backup/$(date +%Y%m%d_%H%M%S)"
MISE_BIN="$HOME/.local/bin/mise"

# ---------- OS / ARCH 判定 ----------
case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux)  OS=linux ;;
  *)      printf 'Unsupported OS: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64)        ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *)             ARCH="$(uname -m)" ;;
esac

IS_WSL=false
if [[ "$OS" == "linux" ]] && grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi

# ============================================================
# ヘルパー関数
# ============================================================
info() { printf '\033[1;32m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

ensure_mikefarah_yq() {
  if have yq && yq --version 2>&1 | grep -q 'mikefarah/yq'; then
    return
  fi

  if [[ "$OS" == "mac" ]]; then
    brew install yq
    return
  fi

  local yq_tmp
  case "$ARCH" in
    amd64|arm64) ;;
    *) warn "  yq installation failed: unsupported architecture $ARCH"; return 1 ;;
  esac
  yq_tmp="$(mktemp)"
  if ! curl -fsSL "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${ARCH}" \
    -o "$yq_tmp"; then
    rm -f "$yq_tmp"
    return 1
  fi
  sudo install -m 0755 "$yq_tmp" /usr/local/bin/yq
  rm -f "$yq_tmp"
  info "  Installed mikefarah/yq v4"
}

# シンボリックリンクを安全に貼る
#   - 既存 symlink → 削除して張り直し
#   - 既存実体ファイル / ディレクトリ → $BACKUP_DIR へ退避してから張る
backup_and_link() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    mkdir -p "$BACKUP_DIR"
    info "  Backup: $dest → $BACKUP_DIR/"
    mv "$dest" "$BACKUP_DIR/"
  fi
  ln -s "$src" "$dest"
  info "  Linked: $dest → $src"
}

# ============================================================
# Step 1: 基本パッケージ / Homebrew
# ============================================================
step1_prerequisites() {
  info "=== Step 1: Prerequisites ==="
  if [[ "$OS" == "mac" ]]; then
    if ! have brew; then
      info "Installing Homebrew..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    # Apple Silicon / Intel 両対応で brew を PATH に追加
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    brew update --quiet
  else
    info "Updating apt and installing base packages..."
    sudo apt update -q
    sudo apt install -y \
      curl git unzip build-essential ca-certificates \
      ripgrep fd-find jq fzf tree less zsh neovim tmux sqlite3
    mkdir -p "$HOME/.local/bin"
    # fd-find のみ存在し fd が無ければ symlink を作成
    if have fdfind && ! have fd; then
      ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
      info "  Created: fd → fdfind"
    fi
  fi
}

# ============================================================
# Step 2: zsh インストール + ログインシェル設定
# ============================================================
step2_zsh() {
  info "=== Step 2: zsh ==="
  if [[ "$OS" == "mac" ]] && ! have zsh; then
    brew install zsh
  fi
  local zsh_path
  zsh_path="$(command -v zsh)"
  if [[ "$SHELL" == "$zsh_path" ]]; then
    info "Login shell is already zsh, skipping chsh"
    return
  fi
  # /etc/shells に zsh が無ければ追加（Homebrew インストール版などに必要）
  if ! grep -qxF "$zsh_path" /etc/shells 2>/dev/null; then
    info "  Adding $zsh_path to /etc/shells"
    echo "$zsh_path" | sudo tee -a /etc/shells >/dev/null
  fi
  info "Setting login shell to $zsh_path (password may be required)"
  chsh -s "$zsh_path"
}

# ============================================================
# Step 3: Prezto インストール + zpreztorc 設定
# ============================================================
step3_prezto() {
  info "=== Step 3: Prezto ==="
  local zprezto="${ZDOTDIR:-$HOME}/.zprezto"

  if [[ ! -d "$zprezto" ]]; then
    info "Cloning Prezto..."
    git clone --recursive https://github.com/sorin-ionescu/prezto.git "$zprezto"
  else
    info "Prezto already present at $zprezto"
  fi

  # 既存の非 symlink runcom をバックアップ
  local f
  for f in ~/.zlogin ~/.zlogout ~/.zpreztorc ~/.zprofile ~/.zshenv; do
    if [[ -e "$f" && ! -L "$f" ]]; then
      mkdir -p "$BACKUP_DIR"
      info "  Backup runcom: $f → $BACKUP_DIR/"
      mv "$f" "$BACKUP_DIR/"
    fi
  done

  # Prezto runcom を symlink
  # ※ zshrc は step4 で dotfiles 版を張るため除外
  shopt -s nullglob
  local rcfile name dest
  for rcfile in "$zprezto/runcoms/"*; do
    name="${rcfile##*/}"
    [[ "$name" == "README.md" ]] && continue
    [[ "$name" == "zshrc" ]]     && continue
    dest="$HOME/.$name"
    if [[ ! -e "$dest" && ! -L "$dest" ]]; then
      ln -s "$rcfile" "$dest"
      info "  Runcom linked: $dest → $rcfile"
    fi
  done
  shopt -u nullglob

  # zpreztorc にモジュール + テーマ設定を追記（未設定時のみ）
  local zpreztorc="$HOME/.zpreztorc"
  if [[ -f "$zpreztorc" ]] && grep -q 'syntax-highlighting' "$zpreztorc" 2>/dev/null; then
    info "  zpreztorc: syntax-highlighting already configured, skipping"
  else
    info "  Appending module config to zpreztorc..."
    cat >> "$zpreztorc" <<'ZPREZTORC'

# --- dotfiles セットアップ: modules + prompt theme (auto-appended by install.sh) ---
zstyle ':prezto:load' pmodule \
  'environment' \
  'terminal' \
  'editor' \
  'history' \
  'directory' \
  'spectrum' \
  'utility' \
  'completion' \
  'git' \
  'syntax-highlighting' \
  'history-substring-search' \
  'prompt'
zstyle ':prezto:module:prompt' theme 'sorin'
ZPREZTORC
    info "  zpreztorc updated"
  fi
}

# ============================================================
# Step 4: dotfiles symlink 配置
# ============================================================
step4_symlinks() {
  info "=== Step 4: Symlinking dotfiles ==="
  mkdir -p "$HOME/.config"

  # ファイル単体
  backup_and_link "$DOTFILES/.zshrc"       "$HOME/.zshrc"
  backup_and_link "$DOTFILES/.zshrc.local" "$HOME/.zshrc.local"
  backup_and_link "$DOTFILES/.tmux.conf"   "$HOME/.tmux.conf"

  # ディレクトリ
  # .agents は意図的に symlink しない。step_agmsg は $DOTFILES/.agents/patches を
  # 直接参照するので symlink は不要で、~/.agents が実体ディレクトリのマシンでは
  # backup_and_link が db/ と teams/ ごとバックアップへ退避させてしまう。
  # (このマシンの ~/.agents は手動で張られた $DOTFILES/.agents への symlink。
  #  結果として agmsg の実体が repo 内に置かれるが、.gitignore で追跡外にしてある)
  backup_and_link "$DOTFILES/.claude"         "$HOME/.claude"
  backup_and_link "$DOTFILES/.claude-bedrock" "$HOME/.claude-bedrock"
  backup_and_link "$DOTFILES/.tmux"           "$HOME/.tmux"

  # Codex は auth/session/history/cache も ~/.codex に保存するため、ディレクトリ
  # 全体を symlink しない。宣言的ファイル・custom agents・hooks・skills だけを
  # 個別に配線し、runtime state は実体ディレクトリに残す。
  ensure_mikefarah_yq
  bash "$DOTFILES/.codex/install.sh" \
    "$DOTFILES/.codex" "$HOME/.codex" "$BACKUP_DIR/codex"

  # .claude/projects は会話履歴・memory の実体で .gitignore 対象のため、clone 直後は
  # 存在しない。.claude-bedrock/projects はそこへの symlink(Anthropic 直/Bedrock 経由で
  # 履歴・memory を共有するため)なので、先に作っておかないと dangling symlink になる。
  mkdir -p "$DOTFILES/.claude/projects"

  # ~/.config 配下
  backup_and_link "$DOTFILES/.config/mise" "$HOME/.config/mise"
  backup_and_link "$DOTFILES/.config/nvim" "$HOME/.config/nvim"
  backup_and_link "$DOTFILES/.config/peco" "$HOME/.config/peco"
  backup_and_link "$DOTFILES/.config/zsh"  "$HOME/.config/zsh"

  # git submodule 初期化（tpm など）
  info "  Initializing git submodules..."
  git -C "$DOTFILES" submodule update --init --recursive

  # JSON 正規化 clean filter の登録
  # Claude Code は /model や /theme の操作のたびに settings.json を丸ごと書き戻し、
  # その際キーの並び順が変わる。値が同じでも git 上は差分になり、worktree が汚れて
  # git pull が "local changes would be overwritten by merge" で止まる。
  # 対象は .gitattributes、フィルタ本体は .git/config（= リポジトリに含められない）に
  # 置く必要があるため、マシンごとにここで登録する。
  #
  # required=true が必須:
  #   git は would_convert_to_git_filter_fd() で required 未設定のフィルタを
  #   status/merge の内容比較時に適用しない。required=true にすると git は
  #   smudge 側も定義済みであることを要求するため、恒等変換の cat を指定する。
  #   フィルタ本体は jq 不在・不正 JSON でも原文を素通しして必ず成功する実装。
  info "  Registering git clean filter (json-normalize)..."
  chmod +x "$DOTFILES/.config/git/json-normalize.sh"
  git -C "$DOTFILES" config filter.json-normalize.clean "$DOTFILES/.config/git/json-normalize.sh"
  git -C "$DOTFILES" config filter.json-normalize.smudge cat
  git -C "$DOTFILES" config filter.json-normalize.required true

  # 既存 index を正規化済みの内容に揃える（未実行だと恒久的な差分として残る）
  git -C "$DOTFILES" add --renormalize .claude/settings.json .claude-bedrock/settings.json 2>/dev/null || true

  # `git sync` = stat キャッシュを直してから pull するエイリアス。
  # 書き戻しでファイルサイズまで変わると git は内容比較を短絡して "変更あり" と
  # 誤判定する（ie_modified() の DATA_CHANGED 早期 return）。内容差が無いときだけ
  # --renormalize で stat を更新してから pull することで、この誤判定を回避する。
  git -C "$DOTFILES" config alias.sync '!f() { \
      for p in .claude/settings.json .claude-bedrock/settings.json; do \
        git diff --quiet -- "$p" 2>/dev/null && git add --renormalize -- "$p" >/dev/null 2>&1; \
      done; \
      git pull "$@"; \
    }; f'
}

# ============================================================
# Step 5: peco インストール
# ============================================================
step5_peco() {
  info "=== Step 5: peco ==="
  if have peco; then
    info "peco already installed: $(peco --version 2>&1 | head -1)"
    return
  fi

  if [[ "$OS" == "mac" ]]; then
    brew install peco
  else
    # Linux/WSL: apt 版は古く WSL で文字化けするため GitHub releases バイナリを使用
    info "Fetching latest peco binary from GitHub releases..."
    mkdir -p "$HOME/.local/bin"

    local ver
    ver=$(curl -fsSL https://api.github.com/repos/peco/peco/releases/latest \
      | grep '"tag_name"' | cut -d'"' -f4)
    local ver_num="${ver#v}"   # v0.6.0 → 0.6.0

    local tmpdir
    tmpdir=$(mktemp -d)
    # v0.6.0+ のファイル名形式: peco_<ver>_linux_<arch>.tar.gz
    curl -fsSL \
      "https://github.com/peco/peco/releases/download/${ver}/peco_${ver_num}_linux_${ARCH}.tar.gz" \
      | tar xz -C "$tmpdir"

    # v0.6.0+: バイナリ直置き / v0.5.x: サブディレクトリ内
    if [[ -f "$tmpdir/peco" ]]; then
      mv "$tmpdir/peco" "$HOME/.local/bin/peco"
    else
      local subdir
      subdir=$(find "$tmpdir" -mindepth 1 -maxdepth 1 -type d | head -1)
      mv "$subdir/peco" "$HOME/.local/bin/peco"
    fi
    chmod +x "$HOME/.local/bin/peco"
    rm -rf "$tmpdir"
    info "peco installed: $("$HOME/.local/bin/peco" --version 2>&1 | head -1)"
  fi
}

# ============================================================
# Step 6: 言語ランタイム (mise / python / node / uv / pnpm)
# ============================================================
step6_runtimes() {
  info "=== Step 6: Language runtimes ==="
  local mise_cmd

  # mise インストール
  if have mise; then
    mise_cmd="mise"
    info "mise already installed: $(mise --version)"
  elif [[ -x "$MISE_BIN" ]]; then
    mise_cmd="$MISE_BIN"
    info "mise found at $MISE_BIN"
  else
    info "Installing mise..."
    if [[ "$OS" == "mac" ]]; then
      brew install mise
      mise_cmd="mise"
    else
      curl https://mise.run | sh
      mise_cmd="$MISE_BIN"
    fi
  fi

  # mise shims を PATH に追加（以降のコマンドが使えるように）
  export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"

  # python + node
  info "  Installing python@3.12 and node@lts via mise..."
  "$mise_cmd" use -g python@3.12 || warn "  python@3.12 install skipped"
  "$mise_cmd" use -g node@lts    || warn "  node@lts install skipped"
  "$mise_cmd" reshim 2>/dev/null || true

  # uv
  if ! have uv; then
    info "  Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
  else
    info "  uv already installed"
  fi

  # pnpm via corepack (node が利用可能になった後)
  if ! have pnpm; then
    info "  Enabling pnpm via corepack..."
    if "$mise_cmd" exec -- corepack enable pnpm 2>/dev/null; then
      "$mise_cmd" reshim 2>/dev/null || true
      info "  pnpm enabled"
    else
      warn "  pnpm setup skipped - run 'corepack enable pnpm' after shell reload"
    fi
  else
    info "  pnpm already installed"
  fi
}

# ============================================================
# Step 7: CLI ツール
# ============================================================
step7_cli_tools() {
  info "=== Step 7: CLI tools ==="
  if [[ "$OS" == "mac" ]]; then
    # brew は既インストール済みのものは自動スキップ
    brew install ripgrep fd jq fzf tree neovim tmux gh
  else
    # GitHub CLI: apt に無ければ公式リポジトリを追加
    if ! have gh; then
      info "  Installing GitHub CLI..."
      if apt-cache show gh >/dev/null 2>&1; then
        sudo apt install -y gh
      else
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
          | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
          | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
        sudo apt update -q && sudo apt install -y gh
      fi
    else
      info "  gh already installed"
    fi
  fi
}

# ============================================================
# Step 8: Claude Code
# ============================================================
step8_claude_code() {
  info "=== Step 8: Claude Code ==="
  if have claude; then
    info "Claude Code already installed: $(claude --version 2>&1 | head -1)"
  else
    info "Installing Claude Code..."
    curl -fsSL https://claude.ai/install.sh | bash
  fi
}

# ============================================================
# Step 9: agmsg (multi-agent messaging)
# ============================================================
# ~/.agents/skills/agmsg は upstream installer が構築する成果物なので repo では
# 追跡しない (.gitignore)。repo が持つのはカスタマイズ差分だけ:
#   .agents/patches/agmsg/*.patch
# を pristine な upstream タグへ git apply --3way してから installer を回す。
#
# 2026-08-20 まではこれが「repo の .agents/skills/agmsg/ 配下で clone と差分が
# あるファイルを丸ごと上書きする」overlay 方式だった。上流が更新されると追跡済みの
# 古いファイルが新しい実装を無言で差し戻すため廃止した。パッチ方式なら、上流が
# 該当箇所を変えた時点で適用が失敗して気づける。
#
# パッチの内容・新マシンで手動になる手順・未確認事項は
# .agents/patches/agmsg/README.md を見ること。
# ============================================================
AGMSG_TAG="v1.2.2"

step_agmsg() {
  info "=== Step 9: agmsg ($AGMSG_TAG) ==="

  if ! have git; then
    warn "git not found, skipping agmsg setup"
    return
  fi
  if ! have sqlite3; then
    warn "sqlite3 not found (install via: apt install sqlite3), skipping agmsg setup"
    return
  fi

  local clone="$HOME/.cache/agmsg/src"
  mkdir -p "$(dirname "$clone")"

  if [[ -d "$clone/.git" ]]; then
    info "  Fetching agmsg $AGMSG_TAG..."
    git -C "$clone" fetch --depth 1 --force --quiet \
      origin "refs/tags/$AGMSG_TAG:refs/tags/$AGMSG_TAG" \
      || warn "  agmsg fetch failed (offline?), using cached checkout"
  else
    info "  Cloning fujibee/agmsg $AGMSG_TAG..."
    git clone --depth 1 --branch "$AGMSG_TAG" https://github.com/fujibee/agmsg.git "$clone"
  fi

  # パッチ適用前に必ず pristine なタグ状態へ戻す。前回適用した結果が残っていると
  # 同じパッチの再適用に失敗し、この関数が冪等でなくなる。
  info "  Resetting clone to $AGMSG_TAG..."
  git -C "$clone" checkout -f --quiet "$AGMSG_TAG"
  git -C "$clone" clean -fdq

  # カスタマイズを適用。失敗したら止める — 黙って素の上流を入れると、動いていた
  # はずの機能が消えたことに気づけないまま完了扱いになる。
  local patch_dir="$DOTFILES/.agents/patches/agmsg"
  local p
  for p in "$patch_dir"/*.patch; do
    [[ -e "$p" ]] || continue
    info "    applying: $(basename "$p")"
    if ! git -C "$clone" apply --3way "$p"; then
      warn "agmsg patch failed to apply: $p"
      warn "$AGMSG_TAG で該当箇所が変わった可能性がある。パッチを作り直すこと。"
      exit 1
    fi
  done

  # 既存インストール済みか確認（.agmsg マーカーファイルで判断）
  local upd_flag=""
  if [[ -f "$HOME/.agents/skills/agmsg/.agmsg" ]]; then
    upd_flag="--update"
    info "  Existing agmsg installation detected, using --update (DB/teams preserved)"
  fi

  # パッチ済み clone で upstream installer を実行
  # --cmd agmsg: ~/.agents/skills/agmsg/ を構築し、~/.claude/commands/agmsg.md を
  #              パッチ済みテンプレートから生成する
  info "  Running agmsg installer..."
  # shellcheck disable=SC2086
  bash "$clone/install.sh" --cmd agmsg $upd_flag

  # ~/.claude-bedrock 対応: upstream installer は ~/.claude のみ扱う。
  # 現環境では ~/.claude-bedrock/commands が ~/.claude/commands への symlink なので
  # 生成物をそのまま共有しており、この分岐は素通りする。symlink が無い環境向けの保険。
  local bedrock_cmd="$HOME/.claude-bedrock/commands/agmsg.md"
  if [[ ! -e "$bedrock_cmd" ]]; then
    mkdir -p "$(dirname "$bedrock_cmd")"
    sed 's/__SKILL_NAME__/agmsg/g' \
      "$clone/scripts/drivers/types/claude-code/template.md" > "$bedrock_cmd"
    info "  Generated: $bedrock_cmd"
  fi

  # 上流で削除されたファイルの掃除。
  # upstream installer の --update は `cp -R scripts/. $SKILL_DIR/scripts/` であって
  # 削除同期ではないため、上流から消えたスクリプトが古いまま残り続ける。実際
  # v1.0.x → v1.2.2 で hook.sh / disband.sh / init-db.sh / templates/ が残った。
  # 対象は installer が所有する scripts/ と旧 templates/ のみ。db/ teams/ run/
  # plugins/ には触れない（ユーザーのデータと opt-in した外部ドライバがある）。
  local skill_dir="$HOME/.agents/skills/agmsg"
  local rel
  while IFS= read -r rel; do
    info "    - removed (上流から削除済み): scripts/$rel"
    rm -f "$skill_dir/scripts/$rel"
  done < <(comm -23 \
    <(cd "$skill_dir/scripts" && find . -type f | sed 's|^\./||' | sort) \
    <(cd "$clone/scripts"     && find . -type f | sed 's|^\./||' | sort))
  find "$skill_dir/scripts" -type d -empty -delete 2>/dev/null || true
  # templates/ は v1.2.x で scripts/drivers/types/<type>/template.md へ移動した
  if [[ -d "$skill_dir/templates" && ! -d "$clone/templates" ]]; then
    rm -rf "$skill_dir/templates"
    info "    - removed (上流から削除済み): templates/"
  fi

  # 実行権限の確保（installer が設定するはずだが念のため）
  chmod +x "$HOME/.agents/skills/agmsg/scripts/"*.sh 2>/dev/null || true

  info "agmsg setup complete (version $("$HOME/.agents/skills/agmsg/scripts/version.sh" 2>/dev/null || echo unknown))"
}

# ============================================================
# Step 10: サマリ
# ============================================================
step9_summary() {
  info ""
  info "=== Setup complete! ==="
  printf '\n'
  printf '--- Installed versions ---\n'
  have zsh    && printf '  zsh:    %s\n' "$(zsh --version)"
  have tmux   && printf '  tmux:   %s\n' "$(tmux -V)"
  have peco   && printf '  peco:   %s\n' "$(peco --version 2>&1 | head -1)"
  have mise   && printf '  mise:   %s\n' "$(mise --version)"
  have python && printf '  python: %s\n' "$(python --version 2>&1)"
  have node   && printf '  node:   %s\n' "$(node -v)"
  have uv     && printf '  uv:     %s\n' "$(uv --version)"
  have pnpm   && printf '  pnpm:   %s\n' "$(pnpm -v)"
  have gh     && printf '  gh:     %s\n' "$(gh --version | head -1)"
  have nvim   && printf '  nvim:   %s\n' "$(nvim --version | head -1)"
  have rg     && printf '  rg:     %s\n' "$(rg --version | head -1)"
  have fd     && printf '  fd:     %s\n' "$(fd --version)"
  have jq     && printf '  jq:     %s\n' "$(jq --version)"
  have yq     && printf '  yq:     %s\n' "$(yq --version)"
  have fzf    && printf '  fzf:    %s\n' "$(fzf --version)"
  have claude && printf '  claude: %s\n' "$(claude --version 2>&1 | head -1)"
  printf '\n'

  if [[ -d "$BACKUP_DIR" ]]; then
    printf '  Backed up existing files: %s\n\n' "$BACKUP_DIR"
  fi

  printf 'Next steps:\n'
  printf '  1. Open a new terminal  (or run: exec zsh)\n'
  if [[ "$OS" == "linux" ]]; then
    printf '  2. WSL/Linux: log out and back in if chsh was run\n'
  fi
  printf '  3. claude auth login    (authenticate Claude Code)\n'
  printf '  4. In zsh: Ctrl-r (peco history search)  Ctrl-] (cdr)\n'
}

# ============================================================
# main
# ============================================================
main() {
  info "dotfiles install.sh  [OS=$OS  ARCH=$ARCH  WSL=$IS_WSL]"
  info "DOTFILES=$DOTFILES"
  printf '\n'

  # ~/.local/bin を PATH の先頭に追加（peco / mise 等が入るディレクトリ）
  mkdir -p "$HOME/.local/bin"
  export PATH="$HOME/.local/bin:$PATH"

  step1_prerequisites
  step2_zsh
  step3_prezto
  step4_symlinks
  step5_peco
  step6_runtimes
  step7_cli_tools
  step8_claude_code
  step_agmsg
  step9_summary
}

main "$@"
