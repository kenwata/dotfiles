# Codex configuration

This directory is the version-controlled source for personal Codex configuration. `~/.codex` remains a real runtime directory; `install.sh` links most declarative files, copies custom-agent role files, and merges `user-config.toml` into the writable runtime `config.toml`, so authentication, sessions, history, caches, system skills, plugins, hook trust, and local state survive dotfiles installation.

## Mapping from Claude Code

| Claude Code | Codex | Migration behavior |
| --- | --- | --- |
| `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` | Principles and delegation contract are translated |
| `settings.json` | `user-config.toml` | Model effort, project trust, fallback guidance, agents, hooks, and TUI fields are mapped; runtime-only keys are preserved during merge |
| `agents/*.md` | `agents/*.toml` | Four roles are ported and copied into `~/.codex/agents`; `advisor` is added as a fresh-context replacement for Claude Advisor |
| `commands/*.md` | `skills/*/SKILL.md` | The Claude command remains the detailed canonical procedure; the Codex skill supplies product-specific translations |
| `hooks/*.sh` | `hooks/*` and `user-hooks.json` | Shared logic is wrapped where payloads match; the user hook manifest is renamed so this dotfiles repo does not load it again as project-local hooks |
| command status line | `tui.status_line` | Codex supports ordered built-in fields, not an arbitrary status-line command |
| qmd Claude plugin | `skills/qmd` | The portable qmd CLI workflow is available as a Codex skill |

## Known behavioral differences

- Codex does not apply Claude `.claude/rules/*.md` `paths:` frontmatter automatically. Codex-native projects use `.codex/rules/`, and `AGENTS.md` tells the agent to load applicable files explicitly.
- Codex writes project trust, hook hashes, plugin state, and integrations back to its user `config.toml`. The tracked `user-config.toml` is therefore merged with `yq` v4 instead of being symlinked; this repository intentionally has no project-local `.codex/config.toml`.
- Custom-agent role TOML files are copied rather than symlinked. With Codex CLI 0.151.0 on macOS, a role whose `config_file` resolved to a symlink was listed as available but failed to spawn with `agent type is currently not available`. The same role spawned when `config_file` pointed directly to the real file, while an absolute path to the symlink still failed. Re-run `install.sh` after changing role files and fully restart Codex so the new regular files are loaded.
- Sandbox writable roots must not contain symlink path components. With Codex CLI 0.151.0 on macOS, writable roots below the symlinked `~/.agents` directory caused sandbox preparation to fail before unrelated target files were read; `apply_patch` reported `writable root ... contains symlink component`, and approval or an escalated parent command did not repair the helper sandbox initialization. Configure writable roots with canonical real paths and start a new Codex session. Until `user-config.toml` canonicalizes these paths, this remains a known issue on machines where `~/.agents` is a symlink.
- Machine-specific trusted-project entries stay in the runtime config. Portable writable roots use `{{HOME}}`, which the installer expands before merging.
- Codex also auto-loads `.codex/hooks.json` as project hooks. The tracked manifest is named `user-hooks.json` and linked only to `~/.codex/hooks.json`, preventing every hook from running twice while Codex works in this repository.
- `project_doc_fallback_filenames = ["CLAUDE.md"]` lets Codex read existing project instructions while they are gradually migrated. An `AGENTS.md` at the same level takes precedence.
- Review-only custom agents request `sandbox_mode = "read-only"` and have role-local hooks that deny file-editing tools and git/GitHub writes. Codex reapplies the parent's live permission mode to children, so a workspace-write parent can still expose shell-level writes; the role contract forbids that route, and OS-level read-only enforcement requires starting the parent turn read-only. The writable `parallel_implementer` keeps only the git/GitHub write guardrail.
- A named custom role must be spawned with a fresh or bounded fork. Codex rejects custom role selection on a full-history fork because that fork inherits the parent's agent type.
- The dotfiles JSON clean filter buffers its small settings payload in memory. This lets read-only custom agents run `git status` and `git diff` without needing `mktemp` write access.
- Codex `apply_patch` reports one patch string rather than Claude's `Write`/`Edit` file fields. The Markdown adapter extracts added runs and feeds only uniquely located runs to the shared formatter; an ambiguous duplicate run fails open so unchanged lines are not formatted.
- The question-legibility hook covers the `request_user_input` function. Plain-text questions cannot be intercepted by a tool hook, so the same rule is also present in `AGENTS.md`.
- The Claude qmd marketplace and Codex plugin systems are different. The shared outcome is provided through the qmd CLI skill; Claude marketplace installation state is not copied.
- Claude's notification toggles, dark-theme selector, and dangerous-mode confirmation bypass have no safe one-to-one user-config mapping here. Codex keeps its own notification/theme behavior and approval boundary; fullscreen maps to `tui.alternate_screen = "always"`.

## Hook maintenance invariants

- `install.sh` installs tracked hook files as symlinks under `~/.codex/hooks/`. An ESM entry point therefore must not decide whether it was run directly by comparing `import.meta.url` with `pathToFileURL(process.argv[1])`: Node resolves the former to the repository file while the latter can retain the installed symlink path. Canonicalize both sides with `fileURLToPath()` and `realpathSync()` (and guard a missing `process.argv[1]`) before comparing them.
- A hook test that invokes the repository `.mjs` file directly does not prove that the installed hook works. End-to-end coverage must reproduce the complete installed path—`.sh` wrapper to symlinked `.mjs`—and assert both the filesystem effect and any hook JSON written to stdout. Include relative and absolute `Update File` paths plus `Add File` when the adapter parses `apply_patch` envelopes.
- Keep shared behavior neutral at the caller boundary. The shared Markdown gate defaults to Claude Code's `.claude/rules/markdown.md`; only the Codex adapter opts into both `--rules-dir=.codex` and `--rules-dir=.claude`. Do not add `.codex` to the shared default, because Claude Code does not load those rules.
- Passing the shared unit suite and direct adapter tests is insufficient after changing hook installation, wrappers, or entry-point guards. Always run at least one installer-shaped smoke test; a broken direct-run guard can otherwise return exit 0 with no formatting and no `additionalContext`.

## Install and verify

```sh
bash .codex/install.sh
bash .codex/tests/run.sh
```

The first install backs up replaced declarative files under `~/.dotfiles-backup/<timestamp>/codex/`. Re-running against already-correct links is a no-op.

Start a new Codex session after installation. Codex may ask you to review the changed user-level hooks once; approve them only after the displayed paths match this directory. An already-running session keeps the instructions and skill catalog it loaded at startup.
