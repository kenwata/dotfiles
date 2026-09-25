import assert from "node:assert/strict";
import test from "node:test";

import { checkPacketDesignRefs, checkPacketUserVisibleText } from "../packet.mjs";

test("checkPacketUserVisibleText は完全一致する見出しが無いか本文が空白ならエラーを返す", () => {
  assert.equal(checkPacketUserVisibleText("## 目的\n実装\n").length, 1);
  assert.equal(checkPacketUserVisibleText("## 利用者に見える文\n \t\n## 入口\nx\n").length, 1);
  assert.deepEqual(checkPacketUserVisibleText("## 利用者に見える文\n該当なし: 文は増えない\n"), []);
  assert.equal(checkPacketUserVisibleText("### 利用者に見える文\nx\n").length, 1);
  assert.equal(checkPacketUserVisibleText("## 利用者に見える文 は後で\nx\n").length, 1);
});

test("checkPacketDesignRefs は完了基準と契約の節にある未存在参照だけを返す", () => {
  const packet = [
    "## 完了の基準(逐語)",
    "- `docs/design/missing.md` を含む",
    "## 守る契約(逐語)",
    "- docs/design/also-missing.md を読む",
    "## 入口",
    "docs/design/outside.md",
  ].join("\n");
  const errors = checkPacketDesignRefs(packet, (relativePath) => relativePath === "docs/design/outside.md");

  assert.equal(errors.length, 1);
  assert.match(errors[0], /docs\/design\/missing\.md/);
  assert.match(errors[0], /docs\/design\/also-missing\.md/);
  assert.match(errors[0], /基準と契約は逐語で写す/);
});

test("checkPacketDesignRefs は存在する参照を通し無関係な節の参照を無視する", () => {
  const packet = [
    "## 完了の基準(逐語)",
    "- docs/design/exists.md",
    "## 入口",
    "docs/design/not-checked.md",
  ].join("\n");

  assert.deepEqual(checkPacketDesignRefs(packet, () => true), []);
  assert.deepEqual(checkPacketDesignRefs(packet, () => false).map((error) => error.includes("not-checked")), [false]);
});

test("checkPacketDesignRefs は未存在の参照を重複排除する", () => {
  const packet = "## 守る契約\ndocs/design/missing.md docs/design/missing.md\n";

  const errors = checkPacketDesignRefs(packet, () => false);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].match(/docs\/design\/missing\.md/g)?.length, 1);
});
