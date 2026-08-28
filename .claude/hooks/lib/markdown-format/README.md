# markdown-format

`templates/rules/markdown.md` の規則のうち機械的に直せるものを、LLM の遵守に頼らず
保証する formatter/linter。PostToolUse hook(`hooks/format-markdown.sh`)から
`node cli.mjs <file> <project-root>` として呼ばれる。

**依存ゼロ**: Node 標準モジュール(`node:fs` / `node:path` / `node:os` / `node:test`)と
RegExp の Unicode property escape のみ。npm・ビルド工程・node_modules は無い。
最小 Node バージョンは 20(`node --test` の安定化ライン。開発時は mise 管理の Node 24)。

## 何をするか

自動修正(formatter):

- 装飾(`**` `*` `_` `~~` `~` inline code・inline math)の外側に、隣接文字が
  かな・漢字・半角英数のときだけ半角スペースを挿入(全角約物側には触れない)
- backtick fence の 4 本以上への昇格と開始・終了本数の一致
  (内容の最長 backtick run + 1 以上。blockquote 外・絶対インデント 3 以下のみ)
- トップレベル fence の前後に空行を挿入

検出のみ(linter、修正は Claude に委ねる):

- 閉じの無い・不整形な fence
- 地の文に残った `**` / `~~` らしき記号(glob `**/…` は除外)
- 長すぎる・複雑な table cell(表示テキスト 40 文字超、または link/image 入り)
- 3 階層以上の list ネスト

## 構成

| ファイル | 責務 |
| --- | --- |
| `cli.mjs` | エントリポイント。gate → format → 書き戻し → lint → stderr + exit 2 |
| `gate.mjs` | プロジェクト/ユーザーの `.claude/rules/markdown.md` の `paths:` にマッチする場合のみ動く |
| `scan.mjs` | 行単位のブロック走査器(frontmatter / fence / table / list 深さ / blockquote) |
| `inline.mjs` | インライン走査器(code span / math / emphasis の flanking 判定) |
| `format.mjs` | scan/inline の結果を編集(スペース挿入・fence 昇格・空行)へ変換 |
| `lint.mjs` | 検出 4 ルール |
| `glob.mjs` | `paths:` 用の最小 glob マッチャ(micromatch 代替) |
| `text-util.mjs` | isWordChar(かな・漢字・半角英数)と編集の一括適用 |

テスト: `node --test test/*.test.mjs`(このディレクトリで実行)。

## 経緯と、remark 版との意図的差分

初版(2026-08-28)は remark/unified + esbuild バンドルで実装したが、npm の
ライフサイクル(依存更新・audit・ビルド工程・469KB 成果物)を dotfiles に
持ち込まないため、必要な範囲だけの自前走査器に書き直した。旧実装のソースは
`test/fixtures/reference-remark-impl/` に参照資料として保存してある
(実行しない。git 履歴には無いためここが唯一のコピー)。

書き直し時、リポジトリの自前コンテンツ全 `.md`(gitignore された plugin 等を除く
54 ファイル)へ新旧を同時適用して比較し、実ファイル上の差分が下記 2 に該当する
1 件のみであることを確認した。意図的に変えたのは次の 5 点(いずれもテストで固定済み):

1. blockquote 内の閉じた fence への lint 誤検出を解消(旧実装のバグ)
2. 深いインデントの list 内で閉じた fence への lint 誤検出を解消(同上)
3. トップレベルのインデント式 code block へ空行を挿入しない(fence 式のみ対象。
   コンテナ文脈の完全パースなしでは誤爆リスクの方が大きい)
4. 複数行にまたがる strong は対象外(行単位走査のため。触らない = 安全側)
5. 隣接する 2 つの fence の間に入れる空行は 1 行(旧実装は「後に空行」と
   「前に空行」の重複で 2 行入れていた)

このほか、成立条件の細部にも安全側(触らない・検出しない方向)にのみ倒れる差分が
ある。再照合で実測済みのもの: 閉じ `$` の直前が空白の `$…$` は inline math として
拾わない(例 `価格は$5 と $6です` — remark-math はこれを math 扱いしていた)、
backslash エスケープ済みの `\*\*…\*\*` は lint が検出しない(remark は text node に
残った `**` として検出していた)。なお旧実装の挙動確認は削除済みバンドルでは
再現できず、npm の現行 remark に対する実測である(下記の再照合手順も同じ限界を持つ)。

その他の既知の簡略化(同じく safe 側 = 「触らない」方向にのみ倒れる): CRLF 非対応、
タブは 1 文字換算、`<…>` 内は一律保護、remark の delimiter stack(rule of 3 等)は
非再現で run 長不一致の対は放置、段落の lazy continuation は list を閉じる扱い、
ユーザーレベル rules の参照先は `~/.claude/rules/markdown.md` 固定
(`CLAUDE_CONFIG_DIR` の別プロファイルには追従しない。旧実装と同一)。

## 規則を追加するとき

順序は必ず「テスト先行 → 実装」。回帰は `test/corpus.test.mjs`(下記)が防ぐ。

1. **検出だけ**なら `lint.mjs` に、`scanDocument()` / `scanInline()` の結果を消費する
   check 関数を 1 つ追加する
2. **自動修正**なら `format.mjs` に edit(`{start, end, replacement}`)生成関数を追加する
3. 新しい構文要素の認識が必要な場合のみ `scan.mjs` / `inline.mjs` に手を入れる。
   パーサ変更時はコーパステストの再照合を必ず通すこと

## 回帰防止コーパス(`test/fixtures/corpus/`)

`<name>.input.md` → `<name>.expected.md`(format 結果)+ `<name>.findings.json`
(lint 結果)。新旧差分検証を終えた 2026-08-28 時点の挙動を焼き込んだもので、
境界ケース集(`boundary-cases`)と実リポジトリからのサンプル 2 件を含む。
挙動を意図的に変えたときは期待値を再生成し、変更点を本 README の差分リストへ追記する。

## remark と再照合したくなったら

一時ディレクトリで(リポジトリには何も持ち込まない):

````sh
mkdir -p /tmp/mdfmt-recheck && cd /tmp/mdfmt-recheck
npm install unified remark-parse remark-gfm remark-math remark-frontmatter micromatch
cp <このディレクトリ>/test/fixtures/reference-remark-impl/*.mjs .
# format.mjs / lint.mjs を import して、新実装と同一入力での出力を比較する
````

## 退役条件

この仕組みの存在理由は「CJK 文字・約物に隣接した emphasis デリミタが
CommonMark の flanking rule により解釈されない」というレンダラー挙動にある。
CommonMark には CJK 向けの flanking 改善提案(markdown-cjk-friendly 系の実装が
既にある)が存在し、主要レンダラー(GitHub、Claude Code の表示系)がこれを
取り込んだら、装飾スペース規則とこの formatter 自体の退役を検討する。
仕様参照: CommonMark 0.31(<https://spec.commonmark.org/0.31.2/>)、
GFM(<https://github.github.com/gfm/>)。
