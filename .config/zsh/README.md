# zsh configuration fragments

`~/.config/zsh` is a symlink to this directory. `~/.zshrc` sources `~/.zshrc.local`,
which sources every `*.zsh` file here in lexical order:

```sh
for file in "$HOME"/.config/zsh/*.zsh(N); do
  source "$file"
done
```

The numeric prefix is therefore the load order, and the order matters: some files
prepend to `PATH`, and others probe `PATH` to decide whether to configure anything.

## Number bands

| Band | Purpose |
| ---- | ------- |
| 00-09 | Bootstrap: the base `PATH`, so later files can find their binaries |
| 10-19 | General shell settings that touch no tool and no `PATH` |
| 20-89 | Per-tool configuration, one file per tool |
| 90-99 | Tools that finalize `PATH`, read last |

## Files

| File | Band | What it does |
| ---- | ---- | ------------ |
| `00-path.zsh` | Bootstrap | Homebrew, `~/.local/bin`, Ghostty |
| `10-editor.zsh` | General | `EDITOR` / `VISUAL` |
| `11-aliases.zsh` | General | Command aliases |
| `20-rust.zsh` | Tool | Sources `~/.cargo/env`, which prepends `~/.cargo/bin` |
| `30-node.zsh` | Tool | Sets `PNPM_HOME` and prepends it |
| `40-aws.zsh` | Tool | AWS CLI completion, profile, helper functions |
| `50-peco.zsh` | Tool | `cdr` setup and the `Ctrl-R` / `Ctrl-]` widgets |
| `99-mise.zsh` | Finalize | Activates mise — must stay last |

## Why the bootstrap band is first

`40-aws.zsh` and `50-peco.zsh` check whether their binary exists before configuring
anything (`command -v aws_completer`, `(( $+commands[peco] ))`). Those binaries come
from Homebrew, so the Homebrew prefix has to be on `PATH` before the check runs.
Put anything that establishes the base `PATH` in the 00-09 band.

## Why mise is last

mise resolves the tools it manages against whatever `PATH` exists when it is
activated, and prepends its own directories to that. Anything that prepends to `PATH`
*after* mise therefore overtakes it.

This is not theoretical. While mise was activated before `20-rust.zsh`, `~/.cargo/bin`
ended up ahead of mise's entries, so `rust-analyzer` resolved to the rustup proxy
rather than the version mise pins. The rustup proxy exits immediately with
`Unknown binary 'rust-analyzer' in official toolchain` because that component is not
installed, which broke the language server in Neovim. The same hazard applies to
`PNPM_HOME` in `30-node.zsh`.

The 90-99 band is reserved for this. A new file that prepends to `PATH` belongs in the
20-89 band, never in 90-99 and never after `99-mise.zsh`.

## Checking the order

Run a login shell from a clean environment and confirm a mise-managed tool resolves
to the mise install rather than to another copy on `PATH`:

```sh
env -i HOME="$HOME" USER="$USER" TERM=xterm-256color SHELL=/bin/zsh \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin zsh -lic 'command -v rust-analyzer'
```

`env -i` matters: an inherited `PATH` that already contains `~/.cargo/bin` makes
`~/.cargo/env` skip its own prepend, which hides the problem.
