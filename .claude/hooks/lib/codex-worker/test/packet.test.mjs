import assert from "node:assert/strict";
import test from "node:test";

import {
  checkPacketDesignRefs,
  checkPacketRework,
  checkPacketUserVisibleText,
  packetReworkKind,
} from "../packet.mjs";

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

test("checkPacketRework は直すこと節が無い時に書式と種別の理由を返す", () => {
  const errors = checkPacketRework("## 目的\n直す\n");

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^節が無い/);
  assert.match(errors[0], /種別: \(defect\|supervisor\|spec\|environment\|replan\)/);
  assert.match(errors[0], /size_check/);
  assert.equal(packetReworkKind("## 目的\n直す\n"), null);
});

test("checkPacketRework は1行目の書式違反を返す", () => {
  const errors = checkPacketRework(
    "## 直すこと\n種別 defect\n既存テストとの整合: test/packet.test.mjs のテスト名。根拠\n",
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^1 行目/);
  assert.equal(packetReworkKind("## 直すこと\n種別 defect\n既存テストとの整合: 根拠\n"), null);
});

test("checkPacketRework は形が合っていても5値外の種別を拒否する", () => {
  const packet = "## 直すこと\n種別: other\n既存テストとの整合: 該当なし: 該当テストなし\n";
  const errors = checkPacketRework(packet);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^種別が 5 値の外/);
  assert.equal(packetReworkKind(packet), null);
});

test("checkPacketRework は2行目の書式違反を返す", () => {
  const packet = "## 直すこと\n種別: defect\n既存テストとの整合なし\n";
  const errors = checkPacketRework(packet);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^2 行目/);
  assert.equal(packetReworkKind(packet), null);
});

test("checkPacketRework は空行を読み飛ばし正しい節を通す", () => {
  const packet = [
    "## 直すこと",
    "  ",
    "種別: supervisor  ",
    "既存テストとの整合: test/packet.test.mjs の checkPacketRework は既存動作を確認する。根拠は入力形式のみの変更",
    "  ",
    "## 検証",
  ].join("\n");

  assert.deepEqual(checkPacketRework(packet), []);
  assert.equal(packetReworkKind(packet), "supervisor");
});

test("checkPacketRework は1行目と2行目の間に空行がある節を拒否する", () => {
  const packet = [
    "## 直すこと",
    "種別: defect",
    " ",
    "既存テストとの整合: test/packet.test.mjs のテスト名。根拠",
  ].join("\n");
  const errors = checkPacketRework(packet);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^2 行目の書式が合わない/);
  assert.equal(packetReworkKind(packet), null);
});
