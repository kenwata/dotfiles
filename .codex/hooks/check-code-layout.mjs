#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { changedRuns, findProjectRoot, occursExactlyOnce } from "./format-markdown.mjs";

// Codex adapter for the shared code-layout checker (~/.claude/hooks/lib/code-layout/cli.mjs),
// the Codex counterpart of ~/.claude/hooks/check-code-layout.sh. It enforces the mechanical floor
// of coding-principles.md §14 (line width, blank lines between steps) on the lines an apply_patch
// added. Each added run becomes an Edit-shaped input so the CLI reports only findings that touch
// those lines; a run that occurs more than once cannot be located and is skipped (fail open).
// Findings go back to Codex as additionalContext; the file is never rewritten.

function main() {
  let input;

  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return 0;
  }

  if (input.tool_name !== "apply_patch") return 0;

  const cwd = input.cwd || process.cwd();
  const projectRoot = findProjectRoot(cwd);
  const cli = path.join(os.homedir(), ".claude", "hooks", "lib", "code-layout", "cli.mjs");

  if (!fs.existsSync(cli)) return 0;

  const runs = changedRuns(input.tool_input?.command || "", (file) => !file.endsWith(".md"));
  const findings = runs.flatMap((change) => check(cli, cwd, projectRoot, change));

  if (findings.length > 0) {
    // 1 つの箇所に 2 つの追加の塊が触れると同じ行が 2 回返るので、行単位で重複を除く
    const lines = [...new Set(findings.join("\n").split("\n"))];
    const hookSpecificOutput = {
      hookEventName: "PostToolUse",
      additionalContext: lines.join("\n"),
    };

    process.stdout.write(`${JSON.stringify({ hookSpecificOutput })}\n`);
  }

  return 0;
}

function check(cli, cwd, projectRoot, change) {
  const file = path.resolve(cwd, change.file);

  if (!fs.existsSync(file)) return [];
  if (!occursExactlyOnce(fs.readFileSync(file, "utf8"), change.text)) return [];

  const translated = {
    tool_name: "Edit",
    tool_input: { file_path: file, old_string: "", new_string: change.text },
  };

  // Codex-native projects keep their rules in .codex/rules; unmigrated Claude projects in
  // .claude/rules.
  const child = spawnSync(
    process.execPath,
    [cli, file, projectRoot, "--rules-dir=.codex", "--rules-dir=.claude"],
    { input: JSON.stringify(translated), encoding: "utf8" },
  );

  return child.status === 2 && child.stderr.trim() ? [child.stderr.trim()] : [];
}

const executedPath = process.argv[1];

if (
  executedPath &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(executedPath)
) {
  process.exitCode = main();
}
