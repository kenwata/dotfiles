import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { formatMarkdown } from "../format.mjs";
import { lintMarkdown } from "../lint.mjs";

// 回帰防止コーパス: remark 版(旧実装)との全リポジトリ差分検証を終えた時点の
// 入出力を fixtures/corpus/ に焼き込んである(2026-08-28)。
// <name>.input.md → format 結果が <name>.expected.md、その lint 結果が
// <name>.findings.json に一致することを全件照合する。
// 意図的な挙動差分(インデント式 code への blank-line 廃止、複数行 strong 非対応、
// blockquote・深いインデント list 内の閉じ fence への lint 誤検出の解消)は
// 新仕様側の期待値で焼き込み済み。詳細は ../../README.md を参照。
const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "corpus");

for (const file of readdirSync(corpusDir)) {
  if (!file.endsWith(".input.md")) continue;
  const name = file.slice(0, -".input.md".length);

  test(`corpus: ${name}`, () => {
    const src = readFileSync(join(corpusDir, file), "utf8");
    const expected = readFileSync(join(corpusDir, `${name}.expected.md`), "utf8");
    const expectedFindings = JSON.parse(
      readFileSync(join(corpusDir, `${name}.findings.json`), "utf8"),
    );

    const { text } = formatMarkdown(src);
    assert.equal(text, expected);
    assert.deepEqual(lintMarkdown(text), expectedFindings);

    // formatter は冪等であること(2 回目の適用で変化しない)
    const second = formatMarkdown(text);
    assert.equal(second.changed, false);
  });
}
