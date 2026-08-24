# Homebrew (Apple Silicon: /opt/homebrew, Intel: /usr/local)
# 存在するマシンでのみ評価する（Linux/WSL には無いので自動でスキップ）
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

# local user binaries
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac

# Antigravity IDE（インストール済みマシンのみ）
if [[ -d "$HOME/.antigravity-ide/antigravity-ide/bin" ]]; then
  case ":$PATH:" in
    *":$HOME/.antigravity-ide/antigravity-ide/bin:"*) ;;
    *) export PATH="$HOME/.antigravity-ide/antigravity-ide/bin:$PATH" ;;
  esac
fi
