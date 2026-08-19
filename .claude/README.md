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
| `.claude/rules/*.md`(`paths:` なし) | 毎セッション起動時(CLAUDE.md と同等) |
| サブディレクトリの `CLAUDE.md` | その配下を操作した時のみ(遅延ロード) |
| commands / skills | 起動時は description のみ。本文は呼び出し時 |
| auto memory(`MEMORY.md` 先頭 200 行) | 毎セッション起動時 |
| `HANDOFF.md` / `TODO.md` | 自動ロードではない。セッション運用の指示により開始時に読む |
| `docs/`・`.claude/archive/` | 自動ロードされない。必要時のみ明示的に読む |

この前提から導かれる型:

1. **CLAUDE.md はポインタ型**(50 行以内)— 規約の中身を書かず、「どこに何があるか」と
   セッション運用だけを書く。規約本体は path-scoped な rules に置き、必要時のみロードさせる
2. **ハンドオフは四層** — 役割を分けて、常時ロードされる層を最小に保つ(BLUEPRINT §6)

   | 層 | 担当 | コンテキストコスト |
   | -- | ---- | ------------------ |
   | auto memory | 個人的な学び・環境固有の事実 | 組み込み。何も作らない |
   | `HANDOFF.md`(ルート直下) | 今の状態・仕掛かり中・次の一手 | 40 行以内。毎セッション終了時に**全体上書き**(追記しない) |
   | git log | 何を依頼され・どう対応したか(逐語) | ゼロ。**1 タスク完了 = 1 コミット**、検索で必要箇所のみ引く |
   | `docs/decisions.md` | 仕様解釈・逸脱・ユーザー決定(1 行/件) | ゼロ。append-only |
   | `.claude/archive/` | TODO 等の予算超過分の逐語退避 | ゼロ。初回ローテーション時に生成 |

   **タスクID `T<n>` が四層をつなぐ接続キー**。TODO.md が定義し、コミット要約に含め
   (境界付き `git log -E --grep='T7([^0-9]|$)'` でタスク単位の全作業を引ける。裸の
   `--grep='T7'` は T70 等に誤マッチする)、decisions.md のタスクID列と
   HANDOFF.md の仕掛かり中が参照する。通し番号・再利用禁止
3. **計画は /breakdown で着地させる** — plan mode のプランファイルは `~/.claude/plans/` にあり
   **repo 外・揮発性**で、しかも会話の検討過程を要約した骨子に過ぎない。承認直後の同一
   セッションで `docs/design/<slug>.md`(why/what。状態を書かない)と `TODO.md`(実行状態)へ
   落とす。行間が生きているのは承認直後だけなので、後回しにしない
4. **ロール指示は遅延ロード** — マルチエージェント(agmsg)のロール定義は
   プロジェクト内 `agents/<role>/CLAUDE.md` に置く。その配下で作業するセッションにしか
   ロードされないため、他セッションを汚染しない
5. **副作用コマンドは隠蔽** — `/initialize` のような設定変更コマンドは
   `disable-model-invocation: true` で手動起動限定にし、起動時コンテキストからも消す
6. **成長型ファイルは逐語アーカイブローテーション** — TODO・changelog 等が行数予算を
   超えたら、要約(情報欠落)ではなく `.claude/archive/` へ一字一句そのまま退避し、
   移動後に diff で無損失を検証する(`rules/growing-docs.md`)。HANDOFF.md は全体上書きが
   前提のためローテーション対象外
7. **更新トリガーは配線する** — 「セッション終了時に更新する」と規約に書くだけでは形骸化
   する。実際、旧 `.claude/handoff.md` は規約はあったが実行を強制する手順が無く、更新
   されなくなった。実体は `skeletons/todo.md` の §0 セッションプロトコルに埋め込んである。
   さらにプロンプト側の配線が破られた時(セッション異常終了等)の安全網として、
   SessionStart hook(`hooks/check-handoff-stale.sh`)が次セッション起動時に HANDOFF.md の
   未コミット変更・最新コミットからの遅れを機構側で検知して警告する
8. **修正指摘は再発判定してルール化** — その場しのぎの修正で終えず、スコープに応じて
   ファイル内規約 / `.claude/rules/` / templates への還元 / auto memory へ振り分ける
   (BLUEPRINT §10)

## ディレクトリ構成

```
~/.claude/
├── CLAUDE.md                    # グローバル指針(思想レベルのみ、78 行)
├── README.md                    # このファイル
├── settings.json                # 中核設定 — model / effortLevel / autoMode / qmd プラグイン(github: tobi/qmd)有効化
├── statusline.sh                # ステータスライン用スクリプト
├── hooks/
│   └── check-handoff-stale.sh   # SessionStart hook — HANDOFF.md 陳腐化の起動時検知(設計方針 7)
├── commands/
│   ├── initialize.md            # /initialize — プロジェクト初期化(下記)
│   ├── breakdown.md             # /breakdown — 承認済みプランを設計書+TODO へ着地
│   ├── agmsg.md                 # /agmsg — マルチエージェントメッセージング
│   └── ingest.md, lint.md, query.md   # LLM Wiki 用(Wiki ディレクトリ内でのみ動く)
└── templates/                   # /initialize と /breakdown が読むテンプレート群
    ├── BLUEPRINT.md             # 初期化設計書 — 判断基準と手順のすべてはここ
    ├── skeletons/               # 機械的に穴埋め・コピーする雛形(5 ファイル)
    │   ├── CLAUDE.project.md    # プロジェクト CLAUDE.md 雛形(ポインタ型)
    │   ├── handoff.md           # HANDOFF.md 雛形(書式規約をコメントで同梱)
    │   ├── todo.md              # TODO.md 雛形(§0 セッションプロトコル+タスクID規約)
    │   ├── design.md            # docs/design/<slug>.md 雛形
    │   └── decisions.md         # docs/decisions.md 雛形
    ├── rules/                   # コーディング規約+成長型ドキュメント規約(12 ファイル。原則 paths: 付き、
    │                            #   paths なし=常時ロードは coding-principles/testing の 2 件のみ — BLUEPRINT §1)
    └── roles/                   # ロール定義カタログ(計 9。目的に応じて選定・不足時は新規起草)
```

dotfiles リポジトリには第 2 プロファイル `.claude-bedrock/` もあり(`install.sh` が
`~/.claude-bedrock` へ symlink)、`settings.json` のみ実体を持ち、`commands/`・
`statusline.sh`・`hooks/` は `../.claude/` への symlink で共有する。

雛形は**他ファイルを参照させず自己完結**させる。書式規約は雛形冒頭のコメントに実体ごと
同梱する(「テンプレートは A 参照」「A はテンプレート参照」の循環参照で実体がどこにも
無くなった実例があるため)。

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
├── HANDOFF.md             # 今の状態(40 行以内)。git コミット対象
├── docs/
│   └── decisions.md       # なぜの記録(append-only)。git コミット対象
├── .claude/
│   └── rules/             # 検出言語別の規約+言語を問わず常時コピーの 4 件(coding-principles/testing/
│                          #   markdown/growing-docs)。常時ロードは前 2 件のみ、後 2 件は path-scoped(BLUEPRINT §5)
└── agents/                # ロール配置ありの時のみ(構成は目的に応じて選定)
```

`TODO.md` と `docs/design/<slug>.md` は初期化時には作らない。plan mode で計画を立て、
`/breakdown` を実行した時に生成される。`.claude/archive/` も初期化時には作られず、
TODO 等が行数予算を超えた初回ローテーション時に生成される(溢れた分は逐語移動・要約禁止)。

冪等なので既存プロジェクトで実行しても安全(既存ファイルは上書きせず全スキップ報告。
既存 CLAUDE.md には不足節のみ承認付きで追記提案)。言語が増えたら再実行すればよい。

## セッションの回し方

ライフサイクルの標準形:

```
/initialize(下地)→ plan mode(計画)→ /breakdown(着地)→ 実行(1 タスク = 1 コミット)
```

- **開始時**: `HANDOFF.md` と `TODO.md` の 2 つを読む。着手点は HANDOFF.md の「次の一手」
- **タスク完了ごと**: ①TODO.md の該当タスクを `[x]` に更新 ②コミット(要約に `T<n>` を含める)
- **複数ターンのタスク**: `/goal <検証可能な完了条件>, or stop after 20 turns` で
  完了まで自動駆動する(状態確認は `/goal`、解除は `/goal clear`)
- **終了時**: ①チェックボックス更新の確認 ②`HANDOFF.md` を**全体上書き**(追記しない)
  ③該当あれば `docs/decisions.md` へ 1 行追記
- **過去を辿る時**: `git log`(引数なし)の全件読み込みはしない。
  `git log --oneline -- <path>` → `git log --grep=<語>`(タスクIDは境界付き
  `-E --grep='T7([^0-9]|$)'` 形式)→ `git show <sha>` の順に絞る
- **ロールセッション**(agmsg): `cd agents/planner && claude` で起動。
  ルートの CLAUDE.md + そのロールの CLAUDE.md だけがロードされる

## メンテナンス

- 規約を足す/直す: `~/.claude/templates/rules/` を編集(原則 `paths:` frontmatter を付ける。
  paths なし=常時ロードは coding-principles/testing の 2 件までと BLUEPRINT §1 が定める)。
  既存プロジェクトへは該当ファイルを手動 `cp` か `/initialize` 再実行
  (`/initialize` は `cp -n` なので既存ファイルは上書きされない — 更新は手動 `cp` が必要)
- 規約の還元: セッション中に「全プロジェクト共通」と判定された規約は、確認のうえ
  `templates/rules/` へ還元される(再発ミスのルール化 — BLUEPRINT §10)。
  どの規約の正がどこにあり、どこへ同梱されるかは BLUEPRINT 冒頭の
  「規約の正と同梱先(対応表)」が一覧している
- ロールを足す: `~/.claude/templates/roles/` に追加。ここは**カタログ**であり、
  `/initialize` は目的に合うロールだけを選定・提案する(選定原則は
  `templates/BLUEPRINT.md` §7)。カタログに無いロールは初期化時に新規起草され、
  汎用性があればカタログへ還元される。提案は 2〜4 ロールに抑え、
  「作る役」と「検証する役」の分離を基本形とする
- 初期化の挙動を変える: `templates/BLUEPRINT.md` が唯一の真実。
  `commands/initialize.md` は BLUEPRINT を読んで従うだけの薄いコマンド
