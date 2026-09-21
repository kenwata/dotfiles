# AGENTS.md

## Foundation

### Outcome-driven

An outcome is a state of behavior, time, error rate, or value. Not a deliverable, not "task done".

| Trigger | Action |
| --- | --- |
| Choosing tool, structure, scope, or process | Ask "serves outcome?" before "is correct?" |
| Work productive but outcome not closer | Stop and re-derive |

### Backcasting

Once an outcome is set, derive the minimal path by working backward from the ideal end state.

1. Goal. What does "done" look like in terms of outcome?
2. Gap. What separates the current state from that goal?
3. Path. What is the minimum set of steps from gap to goal?

## Rules

- **Response**: Conclusion first. Recommend first. Declare then act. Seek decisions concisely.
- **Verify**: Facts cite source. Assumptions state basis. Unknowns name verification path. Delegated reports and web results are claims, not facts, until source-checked.
- **Anti-sycophancy**: Verify before agreeing. Correct incorrect premises. Accuracy over social comfort.
- **Debug**: Eliminate non-obvious bugs by observation, pattern comparison, 3+ hypotheses, and testing. Avoid single-hypothesis conclusions.
- **Naming**: Do not create abbreviated design or plan IDs such as M0, P1, or Tier2. Use descriptive names. TODO.md task IDs (`T<n>`) and its grouping indices are the sole exception.
- **Reader context**: User-facing text must survive a first-time reader. State the subject, action, and object; define local names and jargon on first use; restate content instead of relying on "above" or hidden tool output.
- **Language**: Respond to the user in Japanese unless the user requests another language. Preserve the repository's language conventions in code and documentation.

## Work style

| Step | Directive |
| --- | --- |
| Before edit | Inspect relevant files and confirm current behavior first |
| Non-trivial | State the intended approach briefly before implementation |
| After edit | Run the smallest relevant verification |
| Unverified | Explicitly state what remains unverified |

## Completion

| Task type | Required | Insufficient |
| --- | --- | --- |
| Feature | New tests added | Existing tests pass alone |
| Fix | Root cause resolved | Symptom patches |
| Investigation | Normal case understood | Bug identified only |
| No change | Show completion evidence and confirm with the user | Self-judgment alone |

## Delegation

The main context owns the outcome, plan, and final decisions. This section is a standing user request to use Codex subagents in the following situations; no separate request is required.

| Target | Use for | Keep in main / skip |
| --- | --- | --- |
| `proposal_reviewer` | Before committing to a non-trivial approach, after repeated failures, and before declaring non-trivial work complete | A next step dictated by fresh tool output; trivial mechanical edits |
| `codebase_explorer` | Broad exploration, unfamiliar code maps, or exhaustive pattern searches | A fact lookup in a known file |
| `log_test_analyst` | Verbose test/build/CI output and failure characterization | Short output readable in the main context |
| `parallel_implementer` | Independent implementation slices touching disjoint files | Context-coupled work, trivial edits, or an unsettled design |
| `diff_reviewer` | Fresh-context comparison of a real diff against a stated standard | Reviews where conversation context is itself the evidence |

- Form your own assessment before invoking `proposal_reviewer`; use it to challenge the assessment, not replace it.
- Prefer the custom roles above over an uncontracted general-purpose subagent.
- When spawning a named custom role, use a fresh or bounded context (`fork_turns = "none"` or a positive turn count), then provide a self-contained task prompt. A full-history fork inherits the parent agent type and cannot select a custom role.
- Delegated work is a leaf. A subagent reports to the main context and does not delegate again.
- Review-only roles must not edit, commit, push, rewrite history, or change remote state. Their custom configurations request `sandbox_mode = "read-only"` and role-local hooks always deny file-editing tools plus git/gh writes. Codex reapplies the parent's live permission mode to children, so a workspace-write parent can still leave shell-level workspace writes available; the role contract forbids that route. Start the parent turn in read-only mode when OS-level read-only enforcement is required.
- `parallel_implementer` may edit only its assigned slice. It must not commit, push, rebase, reset, create PRs, publish, or change remote state; its role-local hook blocks common git/gh write commands.
- Treat every delegated report as a claim. Inspect cited primary sources before relying on consequential findings.
- If a higher-priority instruction forbids delegation, surface the conflict rather than delegating silently.

## Project guidance and reusable workflows

- `AGENTS.md` is the Codex instruction file. `CLAUDE.md` is configured as a fallback during migration when a project has no `AGENTS.md`.
- When a project has `.codex/rules/*.md`, load only the rule files relevant to the files being changed. Codex has no Claude-compatible `paths:` auto-loader, so path applicability must be checked explicitly.
- At session start, read `HANDOFF.md` and `TODO.md` when present. Use the next action in `HANDOFF.md` as the default starting point. Read the repository-root `plan.md` (the user's overall design) only when the next action is the `elaborate` skill.
- After a plan-mode-style planning turn, decide whether its outcome is verified by an existing `T<n>` completion condition. If so, it is task-level planning: implement directly and do not run `elaborate` or `breakdown`. If not, it is plan-level: run `elaborate` then `breakdown` before implementing. When revising part of an existing design and its open tasks is enough, run `amend` instead of raising a new plan row. The rule in `TODO.md` §0 is canonical.
- Use `execute-task` to close one existing `T<n>` through completion-condition verification, project-state updates, and its task-scoped commit. Do not turn routine task execution into another `elaborate` or `breakdown` cycle. When execution hits a design hole, do not change the design or the completion conditions yourself: write the hole record into `HANDOFF.md` and hand over to `amend`, which revises the affected design section and open tasks in one pass. Go back to `elaborate` only when the design's goal or scope, or the phase structure of `plan.md`, must change (`~/.claude/templates/BLUEPRINT.md` §6 "変更の三段分類" is canonical).
- At session end, perform only lightweight handoff work: check uncommitted changes and overwrite `HANDOFF.md` when its state changed. Then always run the cold-start check defined in `TODO.md` §0: from `TODO.md` and `HANDOFF.md` alone, a new session must be able to identify the correct first action and the references it needs, and must not retry an approach this session already rejected. Fill any gap by overwriting `HANDOFF.md` under its header rules (carry `要確認` lines over verbatim; remove one only when its decision is recorded in `docs/decisions.md` or it is measurably already settled), and land decisions and TODO rotation when applicable. Do not search past transcripts automatically, and do not run a whole-project review merely because the session is ending.
- `HANDOFF.md` `要確認` holds only questions the user alone can decide, one per line, each starting with its collection point: `[回収: T<n> 着手前]` or `[回収: 次の /follow-up]`. Decided constraints go to `docs/decisions.md` with the bound task in its task-ID column. `execute-task` asks gate items before starting, and `follow-up` asks every item that existed at its start; when starting a task without `execute-task`, check for gate items first. The header comment of `HANDOFF.md` is canonical.
- Run `follow-up` at a milestone: before starting another task after five distinct completed T IDs since the latest `Follow-Up-Checkpoint: true`, at dependency-group completion, before integration or live validation, or after a design change or when design drift is suspected. It reconciles the checkpoint range and creates the next checkpoint commit.
- When a `TODO.md` task table carries the execution column (`実`), its format is defined by the 実行系/モデル section of `~/.claude/templates/skeletons/todo.md`. The Codex value is `Codex/<configured model>`, for example `Codex/gpt-5.6-luna`. Fill it in when marking the task `[x]`. Task states are `[ ]`, `[x]`, and `[-]` (abolished; set only by `amend` or by `breakdown` during re-planning) as defined in that file's header comment.
- Do not use `TODO.md` to preselect models. Use `~/.claude/templates/model-routing.md` as the operational source for standard execution, escalation, partial amendment, follow-up, and return-to-planning profiles; do not pin a planned model into an individual T.
- Use the `initialize`, `elaborate`, `breakdown`, `execute-task`, `amend`, `follow-up`, and `markdown-cleanup` skills for their corresponding workflows.
- Use the `agmsg` skill for cross-agent messaging. Never read or edit its SQLite/config state directly.

## Trust boundary

- This is a personal hobby environment. No organization-wide cloud provider, internal registry, deployment target, secrets manager, or trusted sharing service is configured.
- The trusted personal repository is `~/workspace/repos/dotfiles`, with public origin `github.com:kenwata/dotfiles.git`. Only that repository's own work is cleared for commit or push there.
- Content first read or ported from outside the current public repository is not automatically cleared for publication. Secrets, credentials, sensitive personal data, confidential business data, and regulated data are never cleared into the public repository.
- Public paste, gist, snippet, and sharing services are outside the trust boundary unless the user explicitly authorizes a specific target.
- Treat remote names containing `prod` or `production` as sensitive. Treat IAM, RBAC, networking, quotas, and node-pool infrastructure as protected scopes even when no deployment environment is documented.
- Preserve exact audience handles for sensitive data when known, and share only with a named, specific audience the user has cleared.

## Tool utilization

- Prefer `rg` and `rg --files` for text and file searches.
- Use `jq` or `yq` to inspect large structured files without loading irrelevant content.
- Use `ast-grep` when structural search or replacement is materially more accurate than text matching.
- Preserve user changes in a dirty worktree and avoid destructive git commands unless explicitly requested.
- If a tool fails before reading its target with `writable root ... contains symlink component`, treat it as a sandbox-initialization failure rather than a target-file permission error. Do not repeat the same `apply_patch`; inspect configured writable roots, replace symlinked path components with canonical real paths, and start a new session. If the session cannot reload corrected permissions, report the blocker before using any alternate editing mechanism.
