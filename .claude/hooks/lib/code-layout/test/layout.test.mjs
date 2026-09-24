import assert from "node:assert/strict";
import { test } from "node:test";
import { languageFor } from "../languages.mjs";
import { displayWidth, findLayoutIssues, MAX_COLUMNS, MAX_RUN_STATEMENTS } from "../layout.mjs";

const ts = languageFor("a.ts");
const py = languageFor("a.py");
const rb = languageFor("a.rb");
const lua = languageFor("a.lua");

const kinds = (source, language) => findLayoutIssues(source, language).map((issue) => issue.kind);

test("languageFor: 対象外の拡張子は null", () => {
  assert.equal(languageFor("README.md"), null);
  assert.equal(languageFor("data.json"), null);
  assert.equal(languageFor("Makefile"), null);
});

test("displayWidth: 全角文字は 2 桁、タブは 4 桁で数える", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("企業名"), 6);
  assert.equal(displayWidth("\tx"), 5);
});

test("width: 100 桁を超える行を指摘し、100 桁ちょうどは通す", () => {
  const ok = `let t = ${Array(19).fill("ab").join(" + ")}`;
  const long = `${ok}c`;

  assert.equal(displayWidth(ok), MAX_COLUMNS);
  assert.deepEqual(kinds(ok, ts), []);
  assert.deepEqual(kinds(long, ts), ["width"]);
});

test("width: URL・長い ASCII のトークン・文字列リテラルだけの行は折り返せないので通す", () => {
  const url = `// see https://example.com/${"a".repeat(120)}`;
  const token = `const digest = "${"f".repeat(96)}";`;
  const literal = `    "${"長".repeat(60)}",`;

  assert.deepEqual(kinds(url, ts), []);
  assert.deepEqual(kinds(token, ts), []);
  assert.deepEqual(kinds(literal, ts), []);
});

test("width: 全角文字だけで 100 桁を超える行を指摘する", () => {
  const line = `throw new ValidationError("${"企".repeat(40)}") + value + other;`;

  assert.deepEqual(kinds(line, ts), ["width"]);
});

test("glued-block: 閉じたブロックの直後に空行なしで次の文が続けば指摘する", () => {
  const source = [
    "function f(x) {",
    "  if (x) {",
    "    run(x);",
    "  }",
    "  finish();",
    "}",
  ].join("\n");

  const issues = findLayoutIssues(source, ts);

  assert.deepEqual(issues.map((issue) => [issue.kind, issue.startLine]), [["glued-block", 4]]);
});

test("glued-block: 空行で区切られていれば通す", () => {
  const source = ["if (x) {", "  run(x);", "}", "", "finish();"].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-block: else・catch などの続きの節と、閉じの連続は通す", () => {
  const source = [
    "try {",
    "  if (x) {",
    "    run(x);",
    "  } else {",
    "    skip();",
    "  }",
    "} catch (e) {",
    "  log(e);",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-block: 複数行のオブジェクトリテラルや呼び出しの閉じはブロックとみなさない", () => {
  const source = [
    "const config = {",
    "  a: 1,",
    "};",
    "call(",
    "  config,",
    ");",
    "next();",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-block: 本体が 1 文のガード節が並ぶ場合は 1 段落として通す", () => {
  const source = [
    "if (!a) {",
    "  return null;",
    "}",
    "if (!b) {",
    "  throw new Error();",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-block: クロージャ(=> {)の閉じ `});` はブロックとして扱う", () => {
  const source = ["items.forEach((item) => {", "  use(item);", "});", "done();"].join("\n");

  assert.deepEqual(kinds(source, ts), ["glued-block"]);
});

test("glued-block: Python はインデントの戻りでブロックの閉じを判定する", () => {
  const source = [
    "def f(x):",
    "    for item in x:",
    "        use(item)",
    "    done()",
  ].join("\n");

  assert.deepEqual(kinds(source, py), ["glued-block"]);
});

test("glued-block: Python の elif・else・except は続きの節として通す", () => {
  const source = [
    "def f(x):",
    "    try:",
    "        if x:",
    "            a()",
    "        else:",
    "            b()",
    "    except ValueError:",
    "        c()",
  ].join("\n");

  assert.deepEqual(kinds(source, py), []);
});

test("glued-block: Python の複数行の呼び出しの閉じはブロックとみなさない", () => {
  const source = ["def f():", "    x = call(", "        1,", "    )", "    use(x)"].join("\n");

  assert.deepEqual(kinds(source, py), []);
});

test("glued-block: Ruby と Lua は end でブロックの閉じを判定する", () => {
  const ruby = ["def f(x)", "  x.each do |i|", "    use(i)", "  end", "  finish", "end"].join("\n");
  const luaSource = [
    "local function f(x)",
    "  for _, i in ipairs(x) do",
    "    use(i)",
    "  end",
    "  finish()",
    "end",
  ].join("\n");

  assert.deepEqual(kinds(ruby, rb), ["glued-block"]);
  assert.deepEqual(kinds(luaSource, lua), ["glued-block"]);
});

test("glued-return: 2 文以上の直後に空行なしで続く閉じの return を指摘する", () => {
  const source = [
    "function f(x) {",
    "  const a = load(x);",
    "  const b = shape(a);",
    "  return b;",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), ["glued-return"]);
});

test("glued-return: 宣言 1 つに続く return と、ブロック先頭の return は通す", () => {
  const source = [
    "function f(x) {",
    "  if (!x) {",
    "    return null;",
    "  }",
    "",
    "  const a = load(x);",
    "  return a;",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-return: Python でも同じ判定をする", () => {
  const source = ["def f(x):", "    a = load(x)", "    b = shape(a)", "    return b"].join("\n");

  assert.deepEqual(kinds(source, py), ["glued-return"]);
});

test("long-run: 空行なしで 8 文以上続けば指摘し、7 文は通す", () => {
  const body = (n) => Array.from({ length: n }, (_, i) => `  step${i}();`);
  const long = ["function f() {", ...body(MAX_RUN_STATEMENTS), "}"].join("\n");
  const short = ["function f() {", ...body(MAX_RUN_STATEMENTS - 1), "}"].join("\n");

  assert.deepEqual(kinds(long, ts), ["long-run"]);
  assert.deepEqual(kinds(short, ts), []);
});

test("long-run: import・コメント・`,` で終わる行・複数行の引数は数えない", () => {
  const source = [
    ...Array.from({ length: 10 }, (_, i) => `import { m${i} } from "./m${i}";`),
    "// comment",
    "// comment",
    "const table = [",
    ...Array.from({ length: 10 }, (_, i) => `  ${i},`),
    "];",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("long-run: Python の docstring の中は数えない", () => {
  const source = [
    "def f():",
    '    """Summary.',
    ...Array.from({ length: 10 }, (_, i) => `    line ${i}`),
    '    """',
    "    return 1",
  ].join("\n");

  assert.deepEqual(kinds(source, py), []);
});

test("ブロックコメントの中の `}` はブロックの閉じとして扱わない", () => {
  const source = ["/*", " * }", " */", "run();"].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("同じ行への指摘は 1 件にまとめる(ブロックの直後の return)", () => {
  const source = [
    "function f(x) {",
    "  const a = 1;",
    "  if (x) {",
    "    run(x);",
    "  }",
    "  return a;",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), ["glued-block"]);
});

// 以下は SpacialOchestrationResearch と VC_Analysis の既存コードで観測した誤検出の回帰

test("long-run: `|` `&` で始まる型の続きの行は数えない", () => {
  const source = [
    "export type Tag =",
    ...Array.from({ length: 10 }, (_, i) => `  | "tag-${i}"`),
    '  & { readonly brand: "Tag" };',
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("long-run: 1 行のガード節の連続は 1 文として数える", () => {
  const source = [
    "function decide(a, b, c, d, e, f) {",
    ...["a", "b", "c", "d", "e", "f"].map((name) => `  if (${name}) return "${name}";`),
    '  return "none";',
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-return: 1 行のガード節は閉じの return の前の文に数えない", () => {
  const source = [
    "function f(x) {",
    "  if (!x) return undefined;",
    "  const timer = start(x);",
    "  return timer;",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("glued-block: 条件が複数行のガード節と、本体の throw が複数行のガード節も連続を通す", () => {
  const source = [
    "if (",
    "  a ||",
    "  b",
    ") {",
    "  throw new InvalidError(",
    '    "message",',
    "  );",
    "}",
    "if (c) {",
    '  throw new InvalidError("other");',
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});

test("long-run: interface・引数の型リテラル・クラスのフィールドの並びは文として数えない", () => {
  const fields = (prefix) => Array.from({ length: 9 }, (_, i) => `${prefix}field${i}: string;`);
  const iface = ["export interface Check {", ...fields("  readonly "), "}"].join("\n");
  const param = ["export function make(input: {", ...fields("  readonly "), "}): void {}"]
    .join("\n");
  const pyFields = Array.from({ length: 9 }, (_, i) => `    field${i}: str`);
  const pyClass = ["class Record:", ...pyFields].join("\n");

  assert.deepEqual(kinds(iface, ts), []);
  assert.deepEqual(kinds(param, ts), []);
  assert.deepEqual(kinds(pyClass, py), []);
});

test("long-run: JSX のマークアップと `Readonly<{` の型メンバーは文として数えない", () => {
  const source = [
    "function Detail({ card }: Readonly<{",
    ...Array.from({ length: 9 }, (_, i) => `  field${i}: string;`),
    "}>): Element {",
    "  return (",
    "    <section>",
    ...Array.from({ length: 9 }, (_, i) => `      <p className="c${i}">{card.v${i}}</p>`),
    "      {card.footer}",
    "    </section>",
    "  );",
    "}",
  ].join("\n");

  assert.deepEqual(kinds(source, languageFor("a.tsx")), []);
});

test("long-run: シェルと Ruby のヒアドキュメントの中は数えない", () => {
  const body = Array.from({ length: 10 }, (_, i) => `${i}. prose line`);
  const shell = ["cat <<'EOF'", ...body, "EOF"].join("\n");
  const ruby = ["text = <<~TEXT", ...body, "TEXT"].join("\n");

  assert.deepEqual(kinds(shell, languageFor("a.sh")), []);
  assert.deepEqual(kinds(ruby, rb), []);
});

test("glued-block: 本体が `echo ...; return` の 1 行のシェルのガード節も連続を通す", () => {
  const source = [
    'if [ "$code" -ne 0 ]; then',
    '  echo "FAIL"; failures=$((failures + 1)); return',
    "fi",
    'if [ -z "$out" ]; then',
    '  echo "FAIL"; return',
    "fi",
  ].join("\n");

  assert.deepEqual(kinds(source, languageFor("a.sh")), []);
});

// 以下は diff-reviewer が再現した誤り(ある行の読み違いで、以降の行の検査が止まる・緩む)の回帰

test("Ruby の `<<` 追加演算子とシェルの `<<<` はヒアドキュメントとして扱わない", () => {
  const glued = ["if x", "  run", "end", "finish"];
  const ruby = ["result << item", ...glued].join("\n");
  const shell = ["read -r a <<< foo", "if [ -n \"$a\" ]; then", "  run", "fi", "finish"].join("\n");

  assert.deepEqual(kinds(ruby, rb), ["glued-block"]);
  assert.deepEqual(kinds(shell, languageFor("a.sh")), ["glued-block"]);
});

test("シェルの `<< EOF`(空白あり)と Ruby の `<<~TEXT` はヒアドキュメントとして読み飛ばす", () => {
  const body = Array.from({ length: 10 }, (_, i) => `${i}. prose line`);
  const shell = ["cat << EOF", ...body, "EOF"].join("\n");

  assert.deepEqual(kinds(shell, languageFor("a.sh")), []);
});

test("JS の通常の文字列の中のバッククォートは、テンプレートリテラルの開始として扱わない", () => {
  const glued = ["function g(x) {", "  if (x) {", "    run(x);", "  }", "  finish();", "}"];
  const source = ['const fence = "```";', "", ...glued].join("\n");

  assert.deepEqual(kinds(source, ts), ["glued-block"]);
});

test("width: 折り返せるメソッドチェーンは、長い ASCII のトークンを含んでも指摘する", () => {
  const chain = "const result = someObjectWithLongName.methodNumberOne(argumentOne)"
    + ".anotherMethod(argumentTwo).third();";

  assert.deepEqual(kinds(chain, ts), ["width"]);
});

test("glued-block: `export default {` はリテラルの開きとみなす", () => {
  const source = ["export default {", "  a: 1,", "};", "run();"].join("\n");

  assert.deepEqual(kinds(source, ts), []);
});
