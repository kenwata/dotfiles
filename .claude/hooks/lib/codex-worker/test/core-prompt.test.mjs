import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../core.mjs";

test("機械検査節は許可パスの直後に run_dir 付きのコマンドを 1 行置く", () => {
  const prompt = buildPrompt({
    contract: "CONTRACT",
    allow: ["src/a/"],
    packet: "PACKET",
    rules: [],
    sizeCheck: { cli: "/runner/cli.mjs", runDir: "/runs/run-1" },
  });
  const command = "- `node '/runner/cli.mjs' size-check --run '/runs/run-1'`";
  const section = `- \`src/a/\`\n\n## 終える前の機械検査\n${command}\n\nPACKET`;

  assert.ok(prompt.includes(section));
  assert.ok(prompt.includes(command));
  assert.equal((prompt.match(/size-check --run/g) ?? []).length, 1);
});

test("機械検査コマンドは POSIX クォートし、任意の上限を指定できる", () => {
  const prompt = buildPrompt({
    contract: "CONTRACT",
    allow: [],
    packet: "PACKET",
    rules: [],
    sizeCheck: {
      cli: "/runner dir/cli's.mjs",
      runDir: "/runs/it's here",
      maxFileLines: 120,
    },
  });

  assert.ok(prompt.includes(
    "node '/runner dir/cli'\\''s.mjs' size-check --run '/runs/it'\\''s here' --max-file-lines 120",
  ));
});
