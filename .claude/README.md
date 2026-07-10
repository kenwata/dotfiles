# ~/.claude 環境設計

自分用の Claude Code 環境の方針と使い方のメモ。このファイルは人間向けであり、
Claude Code には自動ロードされない(コンテキストコストゼロ)。

## 設計方針

**起動時コンテキストの最小化**がすべての配置判断の基準。
「何がいつロードされるか」を前提に、常時ロードされるものを極限まで薄くする。

| 対象 | ロードタイミング |
| ---- | ---------------- |
| `~/.claude/CLAUDE.md` / プロジェクトの `CLAUDE.md` | 毎セッション起動時 |
| `.claude/rules/*.md`(`paths:` frontmatter あり) | 該当ファイルを操作した時のみ |
| サブディレクトリの `CLAUDE.md` | その配下を操作した時のみ(遅延ロード) |
| skills | 起動時は description のみ。本文は呼び出し時 |
| auto memory(`MEMORY.md` 先頭 200 行) | 毎セッション起動時 |

この前提から導かれる型:

1. **CLAUDE.md はポインタ型**(50 行以内)— 規約の中身を書かず、「どこに何があるか」と
   セッション運用だけを書く。規約本体は path-scoped な rules に置き、必要時のみロードさせる
2. **ハンドオフは二層** — タスク状態・TODO は git 管理の `.claude/handoff.md`
   (60 行上限・完了欄は次回更新で削除・パス参照のみ)、個人的な学びは Claude Code
   組み込みの auto memory に任せて何も作らない。次セッションは handoff 1 ファイルを
   読むだけで着手でき、完了済みタスクのための再読込が発生しない
3. **ロール指示は遅延ロード** — マルチエージェント(agmsg)のロール定義は
   プロジェクト内 `agents/<role>/CLAUDE.md` に置く。その配下で作業するセッションにしか
   ロードされないため、他セッションを汚染しない
4. **副作用コマンドは隠蔽** — `/initialize` のような設定変更コマンドは
   `disable-model-invocation: true` で手動起動限定にし、起動時コンテキストからも消す
5. **成長型ファイルは逐語アーカイブローテーション** — handoff・TODO・changelog 等が
   行数予算を超えたら、要約(情報欠落)ではなく `.claude/archive/` へ一字一句そのまま
   退避する。archive は自動ロードされないため起動コストもゼロ(`rules/growing-docs.md`)
6. **修正指摘は再発判定してルール化** — その場しのぎの修正で終えず、スコープに応じて
   ファイル内規約 / `.claude/rules/` / templates への還元 / auto memory へ振り分ける
   (BLUEPRINT §10)

## ディレクトリ構成

```
~/.claude/
├── CLAUDE.md                    # グローバル指針(思想レベルのみ、59 行)
├── README.md                    # このファイル
├── commands/
│   ├── initialize.md            # /initialize — プロジェクト初期化(下記)
│   ├── agmsg.md                 # /agmsg — マルチエージェントメッセージング
│   └── ingest.md, lint.md, query.md   # LLM Wiki 用(Wiki ディレクトリ内でのみ動く)
└── templates/                   # /initialize が読むテンプレート群(プロジェクトへは選択コピー)
    ├── BLUEPRINT.md             # 初期化設計書 — 判断基準と手順のすべてはここ
    ├── skeletons/               # 機械的に穴埋め・コピーする雛形
    │   ├── CLAUDE.project.md    # プロジェクト CLAUDE.md 雛形(ポインタ型)
    │   └── handoff.md           # ハンドオフ雛形(書式規約をコメントで同梱)
    ├── rules/                   # コーディング規約+成長型ドキュメント規約(paths: 付き、12 ファイル)
    └── roles/                   # ロール定義カタログ(計 11。目的に応じて選定・不足時は新規起草)
```

## プロジェクトの始め方

```
cd <新規 or 既存プロジェクト>
claude
> /initialize
```

質問は 1 回だけ(最大 3 問): ①言語構成の確認(自動検出済みを確認するだけ)
②目的とロール構成(README 等から目的を推測できればロールセットを提案、
できなければ「ロールなし/開発/調査系/文書系」から選択。自由記述も可)
③一行説明(README が無い時のみ)。

生成されるもの:

```
<project>/
├── CLAUDE.md              # ポインタ型(30-50 行)。コマンド表・ポインタ・セッション運用
├── .claude/
│   ├── rules/             # 検出言語に応じた規約のみコピー(常時は coding-principles/testing/markdown/growing-docs)
│   └── handoff.md         # git コミット対象
└── agents/                # ロール配置ありの時のみ(構成は目的に応じて選定)
```

冪等なので既存プロジェクトで実行しても安全(既存ファイルは上書きせず全スキップ報告。
既存 CLAUDE.md には不足節のみ承認付きで追記提案)。言語が増えたら再実行すればよい。
`.claude/archive/` は初期化時には作られず、handoff 等が行数予算を超えた初回
ローテーション時に生成される(溢れた分は逐語移動・要約禁止)。

## セッションの回し方

- **開始時**: `.claude/handoff.md` の「次の一手」から着手する
- **複数ターンのタスク**: `/goal <検証可能な完了条件>, or stop after 20 turns` で
  完了まで自動駆動する(状態確認は `/goal`、解除は `/goal clear`)
- **終了時**: handoff.md を更新してコミットに含める。完了項目は「完了」欄へ移し、
  前回の完了欄は削除する(履歴は git が持つ)。60 行を超える分は
  `.claude/archive/handoff.md` へ逐語退避する
- **ロールセッション**(agmsg): `cd agents/planner && claude` で起動。
  ルートの CLAUDE.md + そのロールの CLAUDE.md だけがロードされる

## メンテナンス

- 規約を足す/直す: `~/.claude/templates/rules/` を編集(必ず `paths:` frontmatter を付ける)。
  既存プロジェクトへは該当ファイルを手動 `cp` か `/initialize` 再実行
- 規約の還元: セッション中に「全プロジェクト共通」と判定された規約は、確認のうえ
  `templates/rules/` へ還元される(再発ミスのルール化 — BLUEPRINT §10)
- ロールを足す: `~/.claude/templates/roles/` に追加。ここは**カタログ**であり、
  `/initialize` は目的に合うロールだけを選定・提案する(選定原則は
  `templates/BLUEPRINT.md` §7)。カタログに無いロールは初期化時に新規起草され、
  汎用性があればカタログへ還元される
- 初期化の挙動を変える: `templates/BLUEPRINT.md` が唯一の真実。
  `commands/initialize.md` は BLUEPRINT を読んで従うだけの薄いコマンド
