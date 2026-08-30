import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  changedMarkdownRuns,
  findProjectRoot,
  occursExactlyOnce,
} from "../hooks/format-markdown.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const hookPath = join(testDir, "..", "hooks", "format-markdown.mjs");
const repoRoot = join(testDir, "..", "..");

// The adapter resolves the shared CLI through os.homedir(), and the shared gate also
// consults user-level `~/<rules-dir>/rules/markdown.md`. Left alone, these tests would
// depend on the running machine's real home: a user-level `.claude` rule would format
// the fixture even if the adapter stopped passing --rules-dir, silently turning the
// .codex-native test into a no-op guard. Point HOME at a fixture home that symlinks
// only `.claude/hooks`, so the CLI still resolves while no user-level rules exist.
const FIXTURE_HOME = mkdtempSync(join(tmpdir(), "codex-hook-home-"));
mkdirSync(join(FIXTURE_HOME, ".claude"), { recursive: true });
symlinkSync(join(repoRoot, ".claude", "hooks"), join(FIXTURE_HOME, ".claude", "hooks"));
const INSTALLED_HOOK_DIR = join(FIXTURE_HOME, ".codex", "hooks");
mkdirSync(INSTALLED_HOOK_DIR, { recursive: true });
symlinkSync(
  join(repoRoot, ".codex", "hooks", "format-markdown.sh"),
  join(INSTALLED_HOOK_DIR, "format-markdown.sh"),
);
symlinkSync(
  join(repoRoot, ".codex", "hooks", "format-markdown.mjs"),
  join(INSTALLED_HOOK_DIR, "format-markdown.mjs"),
);

function runHook(input) {
  return spawnSync(process.execPath, [hookPath], {
    input,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME },
  });
}

function runInstalledHook(input) {
  return spawnSync("bash", [join(INSTALLED_HOOK_DIR, "format-markdown.sh")], {
    input,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME },
  });
}

test("extracts only added Markdown runs from apply_patch", () => {
  const patch = `*** Begin Patch
*** Update File: docs/a.md
@@
 old
-removed
+first
+second
 context
*** Update File: src/a.js
@@
+ignored
*** Add File: docs/new.md
+# Title
+
+Body
*** End Patch`;

  assert.deepEqual(changedMarkdownRuns(patch), [
    { file: "docs/a.md", text: "first\nsecond" },
    { file: "docs/new.md", text: "# Title\n\nBody" },
  ]);
});

test("ignores removed-only and non-Markdown changes", () => {
  const patch = `*** Begin Patch
*** Update File: docs/a.md
@@
-removed
*** Update File: src/a.js
@@
+added
*** End Patch`;

  assert.deepEqual(changedMarkdownRuns(patch), []);
});

test("detects whether an added run has a unique location", () => {
  assert.equal(occursExactlyOnce("before\nTARGET\nafter\n", "TARGET"), true);
  assert.equal(occursExactlyOnce("TARGET\nother\nTARGET\n", "TARGET"), false);
  assert.equal(occursExactlyOnce("before\nafter\n", "TARGET"), false);
});

test("finds a project root from a nested session directory", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-project-root-"));
  try {
    mkdirSync(join(root, ".git"));
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    assert.equal(findProjectRoot(nested), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formats only the lines added by a Codex apply_patch", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-markdown-hook-"));
  try {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "rules", "markdown.md"),
      ["---", "paths:", '  - "**/*.md"', "---", "", "# Rule"].join("\n"),
    );
    const target = join(root, "a.md");
    writeFileSync(target, "既存**A**既存\n追加**B**追加\n");

    const input = JSON.stringify({
      cwd: root,
      tool_name: "apply_patch",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: a.md",
          "@@",
          "+追加**B**追加",
          "*** End Patch",
        ].join("\n"),
      },
    });
    const result = runHook(input);

    assert.equal(result.status, 0);
    assert.match(
      JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
      /markdown formatter/,
    );
    assert.equal(readFileSync(target, "utf8"), "既存**A**既存\n追加 **B** 追加\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formats Codex-native rules when the session starts below the project root", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-markdown-hook-"));
  try {
    mkdirSync(join(root, ".codex", "rules"), { recursive: true });
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(root, ".codex", "rules", "markdown.md"),
      ["---", "paths:", '  - "**/*.md"', "---", "", "# Rule"].join("\n"),
    );
    const target = join(nested, "a.md");
    writeFileSync(target, "追加**B**追加\n");

    const input = JSON.stringify({
      cwd: nested,
      tool_name: "apply_patch",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: a.md",
          "@@",
          "+追加**B**追加",
          "*** End Patch",
        ].join("\n"),
      },
    });
    const result = runHook(input);

    assert.equal(result.status, 0);
    assert.match(
      JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
      /markdown formatter/,
    );
    assert.equal(readFileSync(target, "utf8"), "追加 **B** 追加\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installed symlink chain formats relative, absolute, and added Markdown files", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-installed-markdown-hook-"));
  try {
    mkdirSync(join(root, ".codex", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".codex", "rules", "markdown.md"),
      ["---", "paths:", '  - "**/*.md"', "---", "", "# Rule"].join("\n"),
    );
    const relativeTarget = join(root, "relative.md");
    const absoluteTarget = join(root, "absolute.md");
    const addedTarget = join(root, "added.md");
    writeFileSync(relativeTarget, "相対**R**相対\n");
    writeFileSync(absoluteTarget, "絶対**A**絶対\n");
    writeFileSync(addedTarget, "新規**N**新規\n");

    const input = JSON.stringify({
      cwd: root,
      tool_name: "apply_patch",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: relative.md",
          "@@",
          "+相対**R**相対",
          `*** Update File: ${absoluteTarget}`,
          "@@",
          "+絶対**A**絶対",
          "*** Add File: added.md",
          "+新規**N**新規",
          "*** End Patch",
        ].join("\n"),
      },
    });
    const result = runInstalledHook(input);

    assert.equal(result.status, 0);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /relative\.md/);
    assert.match(context, /absolute\.md/);
    assert.match(context, /added\.md/);
    assert.equal(readFileSync(relativeTarget, "utf8"), "相対 **R** 相対\n");
    assert.equal(readFileSync(absoluteTarget, "utf8"), "絶対 **A** 絶対\n");
    assert.equal(readFileSync(addedTarget, "utf8"), "新規 **N** 新規\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("leaves both copies unchanged when an added Markdown run is ambiguous", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-markdown-hook-"));
  try {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "rules", "markdown.md"),
      ["---", "paths:", '  - "**/*.md"', "---", "", "# Rule"].join("\n"),
    );
    const target = join(root, "a.md");
    const duplicated = "同じ**A**行\n別の行\n同じ**A**行\n";
    writeFileSync(target, duplicated);

    const input = JSON.stringify({
      cwd: root,
      tool_name: "apply_patch",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: a.md",
          "@@",
          "+同じ**A**行",
          "*** End Patch",
        ].join("\n"),
      },
    });
    const result = runHook(input);

    assert.equal(result.status, 0);
    assert.equal(readFileSync(target, "utf8"), duplicated);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
