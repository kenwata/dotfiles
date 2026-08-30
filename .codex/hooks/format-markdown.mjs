#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function changedMarkdownRuns(patch) {
  const result = [];
  let current = null;
  let run = [];

  const flush = () => {
    if (current && run.length > 0) result.push({ file: current, text: run.join("\n") });
    run = [];
  };

  for (const line of patch.split(/\r?\n/)) {
    const header = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
    if (header) {
      flush();
      current = header[1].endsWith(".md") ? header[1] : null;
      continue;
    }
    if (line.startsWith("*** ") || line.startsWith("@@")) {
      flush();
      if (line.startsWith("*** ")) current = null;
      continue;
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      run.push(line.slice(1));
    } else {
      flush();
    }
  }
  flush();
  return result.filter(({ text }) => text.length > 0);
}

export function occursExactlyOnce(source, text) {
  const first = source.indexOf(text);
  return first !== -1 && source.indexOf(text, first + 1) === -1;
}

export function findProjectRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    if (
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, ".codex", "rules", "markdown.md")) ||
      fs.existsSync(path.join(current, ".claude", "rules", "markdown.md"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

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
  const cli = path.join(os.homedir(), ".claude", "hooks", "lib", "markdown-format", "cli.mjs");
  if (!fs.existsSync(cli)) return 0;

  const findings = [];
  for (const change of changedMarkdownRuns(input.tool_input?.command || "")) {
    const file = path.resolve(cwd, change.file);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    // The shared Edit scope intentionally covers every occurrence of
    // new_string. If an added run is duplicated, its exact post-patch location
    // cannot be recovered from Codex's patch payload without risking changes
    // to untouched lines, so fail open for that run.
    if (!occursExactlyOnce(source, change.text)) continue;
    const translated = {
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: "", new_string: change.text },
    };
    // Codex-native rules (.codex/rules/markdown.md) are opted in explicitly here.
    // The shared gate's default is Claude-only (.claude); this adapter is the one
    // caller allowed to widen it, so Claude Code's own invocation stays unaffected.
    const child = spawnSync(
      process.execPath,
      [cli, file, projectRoot, "--rules-dir=.codex", "--rules-dir=.claude"],
      { input: JSON.stringify(translated), encoding: "utf8" },
    );
    if (child.status === 2 && child.stderr.trim()) findings.push(child.stderr.trim());
  }

  if (findings.length > 0) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: findings.join("\n"),
        },
      })}\n`,
    );
  }
  return 0;
}

const executedPath = process.argv[1];
if (
  executedPath &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(executedPath)
) {
  process.exitCode = main();
}
