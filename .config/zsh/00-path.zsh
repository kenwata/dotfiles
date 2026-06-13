# Homebrew (Apple Silicon: /opt/homebrew)
eval "$(/opt/homebrew/bin/brew shellenv)"

# local user binaries
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac

# Antigravity IDE
case ":$PATH:" in
  *":$HOME/.antigravity-ide/antigravity-ide/bin:"*) ;;
  *) export PATH="$HOME/.antigravity-ide/antigravity-ide/bin:$PATH" ;;
esac
