#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function patchTargets(patch) {
  const targets = [];
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
    if (match) targets.push(match[1]);
  }
  return [...new Set(targets)];
}

function gitRoot(ancestor) {
  try {
    return execFileSync("git", ["-C", ancestor, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (input.tool_name !== "apply_patch") process.exit(0);

const cwd = input.cwd || process.cwd();
const warnings = [];
for (const target of patchTargets(input.tool_input?.command || "")) {
  const absolute = path.resolve(cwd, target);
  const parent = path.dirname(absolute);
  if (fs.existsSync(parent)) continue;

  let ancestor = parent;
  while (!fs.existsSync(ancestor)) {
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }

  const root = gitRoot(ancestor);
  if (!root || !fs.existsSync(path.join(root, "docs", "architecture.md"))) continue;
  const display = path.relative(root, parent) || ".";
  warnings.push(
    `新規ディレクトリ \`${display}\` を作成しようとしています。` +
      "docs/architecture.md の置き場の決定表を確認し、記載がなければ同じ変更で追記してください。" +
      "配置規約は .codex/rules/coding-principles.md、移行中のプロジェクトでは .claude/rules/coding-principles.md §13 です。",
  );
}

if (warnings.length > 0) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: warnings.join("\n"),
      },
    }),
  );
}
