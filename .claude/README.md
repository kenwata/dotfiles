# ~/.claude 環境設計

自分用の Claude Code 環境の方針と使い方のメモ。このファイルは人間向けであり、
Claude Code には自動ロードされない(コンテキストコストゼロ)。

## 設計方針

**起動時コンテキストの最小化** がすべての配置判断の基準。
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
2. **ハンドオフは五層** — 役割を分けて、常時ロードされる層を最小に保つ(BLUEPRINT §6)

   | 層 | 担当 | コンテキストコスト |
   | -- | ---- | ------------------ |
   | auto memory | 個人的な学び・環境固有の事実 | 組み込み。何も作らない |
   | `plan.md`(ルート直下) | 全体構想・フェーズ構造(最上位の why/what) | ゼロ。壁打ちで作り、全体に関わる決定時のみ更新。`/elaborate` が読む |
   | `HANDOFF.md`(ルート直下) | 今の状態・仕掛かり中・次の一手 | 40 行以内。毎セッション終了時に **全体上書き**(追記しない) |
   | git log | 何を依頼され・どう対応したか(逐語) | ゼロ。**1 タスク完了 = 1 コミット**(変更ゼロのタスクは `--allow-empty`)、検索で必要箇所のみ引く |
   | `docs/decisions.md` | 仕様解釈・逸脱・ユーザー決定(1 行/件) | ゼロ。append-only |
   | `.claude/archive/` | TODO 等の予算超過分の逐語退避 | ゼロ。初回ローテーション時に生成 |

   **タスクID `T<n>` が五層をつなぐ接続キー**。TODO.md が定義し、コミット要約に含め
   (境界付き `git log -E --grep='T7([^0-9]|$)'` でタスク単位の全作業を引ける。裸の
   `--grep='T7'` は T70 等に誤マッチする)、decisions.md のタスクID列と
   HANDOFF.md の仕掛かり中が参照する。通し番号・再利用禁止
3. **計画は /elaborate で設計書に、/breakdown で TODO に着地させる** — 壁打ちで作った
   `plan.md`(repo 内の全体構想)は 1 フェーズずつ `/elaborate` で対話的に詳細化して
   `docs/design/<slug>.md`(why/what。状態を書かない)へ、設計書は `/breakdown` で `TODO.md`
   (実行状態)へ落とす。plan mode のプランファイルは `~/.claude/plans/` にあり **repo 外・揮発性**
   で骨子に過ぎないので、承認直後の同一セッションで `/elaborate` に合流させる(行間が生きているのは
   承認直後だけ)。**タスク `T<n>` を実行するための plan mode には両コマンドを走らせない**
   (タスクの実行計画がさらにタスクを産む暴走の防止。判定基準は `TODO.md` §0)。
   設計書が増えるとファイル名から作成順が追えず、名前の似た設計書の内容も判別できなくなるため、
   `docs/design/index.md`(作成日 / フェーズ / 設計書 / 表題 / タスクID範囲の索引)を併せて持つ。
   索引は設計書の実体と git の追加履歴から起こす **派生ビュー** であり正ではない
   (`/elaborate` が行を足し、`/breakdown` が `T` 列を埋め、`/follow-up` の機械チェック⑩が
   漏れと食い違いを検出する)
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
9. **TODO.md は2階層テーブル** — 計画テーブル(大分類)+計画ごとのタスクテーブル(小分類)に分ける。
   ID は走査・グルーピング用の表示専用インデックス `#<n>`/`#<n>-<m>`(章・節番号相当)と、
   タスク管理・外部参照の接続キー `T<n>` の二本立て。前者は密に保たれ再breakdownでも飛ばないが、
   後者(接続キー)は従来どおり再利用禁止のため飛びうる。完了条件は表のセルではなく直下の
   ブロックへ展開し、列崩れを防ぐ(BLUEPRINT §6)
10. **構造は文書化して配線する** — ディレクトリ配置規約の実体は `rules/coding-principles.md` §13
   (常時ロード枠)。プロジェクトごとの適用結果は `docs/architecture.md`(初期化時に生成。
   新規プロジェクトは検出言語の標準レイアウトから、既存プロジェクトは実ツリーから起こす)に記録し、
   実態と同期させ続ける。配線は 3 段構え: `/elaborate` が新規ディレクトリを設計時に反映、
   `/follow-up` がセッション終了時に実ツリーとの乖離を機械検査、機構側の安全網として
   `hooks/check-new-directory.sh`(PreToolUse)が新規ディレクトリ作成時に確認を促す
   (Write 経由のみ検知。`mkdir` 等はプロンプト側の配線が一次的な強制手段であり、これは既知の限界)
11. **委任の境界は役割で分け、機構で縛る** — CLAUDE.md の Delegation 節が挙げる 4 役割を
    `agents/` の 4 定義に分解した。役割ごとに必要な権限が違うためで、実際
    Write/Edit を禁じて無害なのは 3 役割、`parallel-implementer` だけは禁じると成立しない。
    単一の汎用エージェントのままでは「実装もでき検査もできる」最大公約数の権限しか与えられない。
    加えて **PreToolUse hook(`hooks/deny-subagent-git-write.sh`)が、サブエージェントからの
    git 履歴・リモート変更操作(commit / push / reset / rebase / gh の書き込み系ほか)を拒否する**。
    契機は 2026-08-26、検査だけを依頼したサブエージェントが自分で編集し commit・push まで
    実行した事故で、委任の境界がプロンプト文面という軟らかい制約にしか載っていなかったこと。
    hook は各定義の frontmatter ではなく `settings.json` に置いてある — 事故は built-in の
    `general-purpose` で起きており、frontmatter 側では built-in を覆えないため。
    メインセッションは入力 JSON に `agent_id` が無いことで判別して素通しする。
    既知の限界: コマンド文字列の解析はヒューリスティックで、`eval` や内部で `git push` する
    スクリプトの実行は検知できない。サンドボックスではなく「事故を防ぐ高さ」である
12. **確認文の可読性は書く瞬間に介入** — CLAUDE.md の Reader-context 規約は常時ロードされていても、
    AskUserQuestion を書く瞬間には想起されず、主語・述語・目的語の省略や内輪の略称の再発が
    止まらなかった。PreToolUse hook(`hooks/check-question-legibility.sh`)が呼び出しごとに
    1回 deny してチェックリストで書き直しを強制する(セッション中に何度呼ばれても deny→
    書き直し→通過のサイクルを繰り返す。1回きりの静的ルールでは届かない「書いた瞬間」に効く)
13. **Markdown の装飾規則は formatter/linter で決定論的に保証** — `templates/rules/markdown.md`
    のうち機械判定できる規則(装飾の外側スペース・code fence の backtick 数)を、プロンプト遵守に
    頼らず PostToolUse hook(`hooks/format-markdown.sh` → `hooks/lib/markdown-format/`、
    依存ゼロ・ビルドなし)が Write/Edit 保存のたびに適用する。hook は編集行のみに限定し
    (未編集の逐語引用・既存箇所への波及を防ぐ)、ファイル全体への適用は `/markdown-cleanup`
    コマンドが単独コミットとして担う。適用範囲はプロジェクト側の `.claude/rules/markdown.md` の
    `paths:` frontmatter で判定するため、規約を配布していないプロジェクトでは no-op

## ディレクトリ構成

````
~/.claude/
├── CLAUDE.md                    # グローバル指針(思想レベルのみ、83 行)
├── README.md                    # このファイル
├── settings.json                # 中核設定 — model / effortLevel / autoMode / qmd プラグイン(github: tobi/qmd)有効化
├── statusline.sh                # ステータスライン用スクリプト
├── hooks/
│   ├── check-handoff-stale.sh   # SessionStart hook — HANDOFF.md 陳腐化の起動時検知(設計方針 7)
│   ├── check-new-directory.sh   # PreToolUse(Write) hook — 新規ディレクトリ作成時の確認促し(設計方針 10)
│   ├── check-question-legibility.sh  # PreToolUse(AskUserQuestion) hook — 確認文の可読性ゲート(呼び出しごとに1回 deny→書き直し)
│   ├── deny-subagent-git-write.sh  # PreToolUse(Bash) hook — サブエージェントの git 履歴・リモート変更を拒否(設計方針 11)
│   ├── format-markdown.sh       # PostToolUse(Write|Edit) hook — 保存された .md を markdown-format CLI に通す(編集行のみ。全体整形は /markdown-cleanup)
│   └── lib/markdown-format/     # 上記 hook が呼ぶ formatter/linter 本体(依存ゼロ・ビルドなし。cli/format/lint/scope 等 + test/。詳細は同所の README.md)
├── agents/                      # サブエージェント定義(全プロジェクト共通。CLAUDE.md を継承する。設計方針 11)
│   ├── codebase-explorer.md     # 広域探索 — 読み取り専用
│   ├── log-test-analyst.md      # ログ・テスト出力の解析 — 読み取り専用
│   ├── parallel-implementer.md  # 独立した実装スライス — 唯一 Write/Edit を持つ
│   └── diff-reviewer.md         # 差分の外部レビュー(/follow-up 手順 4)— 読み取り専用
├── commands/
│   ├── initialize.md            # /initialize — プロジェクト初期化(下記)
│   ├── elaborate.md             # /elaborate — 計画(plan.md の 1 フェーズ / plan mode)を対話で詳細化し設計書へ
│   ├── breakdown.md             # /breakdown — 設計書を TODO へ分解(設計書だけを入力)
│   ├── follow-up.md             # /follow-up — 終了時に計画と成果の差分を検査・是正
│   ├── agmsg.md                 # /agmsg — マルチエージェントメッセージング
│   └── markdown-cleanup.md      # /markdown-cleanup — markdown-format CLI をファイル全体モードで適用し単独コミット
└── templates/                   # /initialize・/elaborate・/breakdown が読むテンプレート群
    ├── BLUEPRINT.md             # 初期化設計書 — 判断基準と手順のすべてはここ
    ├── skeletons/               # 機械的に穴埋め・コピーする雛形(7 ファイル)
    │   ├── CLAUDE.project.md    # プロジェクト CLAUDE.md 雛形(ポインタ型)
    │   ├── handoff.md           # HANDOFF.md 雛形(書式規約をコメントで同梱)
    │   ├── todo.md              # TODO.md 雛形(§0 セッションプロトコル+タスクID規約)
    │   ├── design.md            # docs/design/<slug>.md 雛形(「全体構想」行の書式規約を同梱)
    │   ├── design-index.md      # docs/design/index.md 雛形(索引。作成日 / フェーズ / 設計書 / 表題 / T)
    │   ├── decisions.md         # docs/decisions.md 雛形
    │   └── architecture.md      # docs/architecture.md 雛形(構造の記録。ディレクトリ配置規約はここに書かず coding-principles.md §13 を参照)
    ├── rules/                   # コーディング規約+成長型ドキュメント規約(12 ファイル。原則 paths: 付き、
    │                            #   paths なし=常時ロードは coding-principles/testing の 2 件のみ — BLUEPRINT §1)
    └── roles/                   # ロール定義カタログ(計 9。目的に応じて選定・不足時は新規起草)
````

LLM Wiki 用の `/ingest` `/query` `/lint` はここには置かない。2026-08-20 に LLM Wiki
リポジトリ側の `.claude/skills/` へ移設した(そこでしか使わないコマンドであり、
personal スコープに置くと無関係なプロジェクトでも候補に出るうえ、personal が project を
上書きするためリポジトリ側に置いた実体が効かなくなるため)。

dotfiles リポジトリには第 2 プロファイル `.claude-bedrock/` もあり(`install.sh` が
`~/.claude-bedrock` へ symlink)、実体を持つのは `settings.json` と `CLAUDE.md` のみで、
`commands/`・`statusline.sh`・`hooks/`・`agents/` は `../.claude/` への symlink で共有する。
`CLAUDE.md` は `@../.claude/CLAUDE.md` を import し、Advisor tool が使えない
Bedrock 環境向けの読み替え差分節(Advisor → fresh-context subagent)だけを持つ。
**hook スクリプトの実体は symlink で共有されるが、その配線は `settings.json` にあり
bedrock は独自の実体を持つため、hook を足したときは両方の `settings.json` に登録する**
(片方だけだと、そのプロファイルでは hook が存在するのに発火しない)。

`projects/`(会話履歴・auto memory の実体)も同じ理由で `../.claude/projects` への
symlink で共有する。設定(モデル ID・permissions・effort)は分離を維持したまま、
プロジェクト単位の学習内容は両プロファイルで引き継がれる。ただし:

- `--continue` は他方のプロファイルで直近に開いたセッションを開くことがある(共有の代償)
- Bedrock 利用料の集計(`bedrock-cost`、`.config/zsh/40-aws.zsh`)は共有履歴から
  Bedrock 発行分(`message.id` が `msg_bdrk_` 始まり)だけを抽出して行う。ラッパーの
  抽出条件を変えずに履歴の形式が変わった場合は、抽出結果が空にならないか要確認
- `history.jsonl`(↑キーのプロンプト履歴)・`file-history/`・`sessions/` は共有せず
  分離のまま(同時起動時の追記競合を避けるため)

雛形は **他ファイルを参照させず自己完結** させる。書式規約は雛形冒頭のコメントに実体ごと
同梱する(「テンプレートは A 参照」「A はテンプレート参照」の循環参照で実体がどこにも
無くなった実例があるため)。

## プロジェクトの始め方

````
cd <新規 or 既存プロジェクト>
claude
> /initialize
````

質問は 1 回だけ(最大 3 問): ①言語構成の確認(自動検出済みを確認するだけ)
②目的とロール構成(README 等から目的を推測できればロールセットを提案、
できなければ「ロールなし/開発/調査系/文書系」から選択。自由記述も可)
③一行説明(README が無い時のみ)。

生成されるもの:

````
<project>/
├── CLAUDE.md              # ポインタ型(30-50 行)。コマンド表・ポインタ・セッション運用
├── HANDOFF.md             # 今の状態(40 行以内)。git コミット対象
├── docs/
│   ├── decisions.md       # なぜの記録(append-only)。git コミット対象
│   └── architecture.md    # 今の形(ディレクトリ構成・置き場の決定表。80 行以内)。git コミット対象
├── .claude/
│   └── rules/             # 検出言語別の規約+言語を問わず常時コピーの 4 件(coding-principles/testing/
│                          #   markdown/growing-docs)。常時ロードは前 2 件のみ、後 2 件は path-scoped(BLUEPRINT §5)
└── agents/                # ロール配置ありの時のみ(構成は目的に応じて選定)
````

`TODO.md` と `docs/design/`(`<slug>.md`・`index.md`)は初期化時には作らない。設計書と索引は `/elaborate` を、
`TODO.md` は `/breakdown` を実行した時に生成される。`plan.md` は `/initialize` より前に
ユーザーが壁打ちで作る(無くてもよい。その場合は plan mode 起点になる)。`.claude/archive/` も初期化時には作られず、
TODO 等が行数予算を超えた初回ローテーション時に生成される(溢れた分は逐語移動・要約禁止)。

冪等なので既存プロジェクトで実行しても安全(既存ファイルは上書きせず全スキップ報告。
既存 CLAUDE.md には不足節のみ承認付きで追記提案)。言語が増えたら再実行すればよい。

## セッションの回し方

ライフサイクルの標準形(BLUEPRINT §6 が正):

````
1. 壁打ち(通常モード)→ plan.md(全体構想)をリポジトリ直下に作る
2. /initialize → 下地(rules / CLAUDE.md / HANDOFF.md / docs/decisions.md / docs/architecture.md /
   agents/<role>/)。plan.md があればロール構成の一次情報にし、HANDOFF の次の一手を /elaborate にする
3. 壁打ち続行(必要な分)→ 全体構想に関わる決定は plan.md を更新 + docs/decisions.md に 1 行
4. /elaborate → plan.md の 1 フェーズ(または plan mode の承認済みプラン+会話)を対話で詳細化し、
   docs/design/<slug>.md を生成 + docs/design/index.md に 1 行追記。
   新規ディレクトリが要るなら docs/architecture.md もここで更新
5. /breakdown docs/design/<slug>.md → TODO.md の計画 #n + タスク T<n>…(索引の T 列も埋める)。HANDOFF の次の一手 = T<n>
6. 実行(1 タスク = 1 コミット)→ /follow-up(終了時の検査と是正)→ 次フェーズは 4 へ戻る
````

plan mode は 4 の入口としてだけ `/elaborate` に合流する。**6 の実行中に `T<n>` を実行するための
plan mode を通っても、`/elaborate`・`/breakdown` は走らせない**(成果は既存 `T<n>` の完了条件で
検証される。判定基準は `TODO.md` §0)。

- **開始時**: `HANDOFF.md` と `TODO.md` の 2 つを読む。着手点は HANDOFF.md の「次の一手」
- **タスク完了ごと**: ①TODO.md の該当タスクを `[x]` に更新 ②コミット(要約に `T<n>` を含める。
  変更を生まないタスクは `git commit --allow-empty` で記録を残す)
- **複数ターンのタスク**: `/goal <検証可能な完了条件>, or stop after 20 turns` で
  完了まで自動駆動する(状態確認は `/goal`、解除は `/goal clear`)
- **終了時**: `/follow-up` を実行する — 計画と成果の差分を検査・是正した上で、
  ①チェックボックス更新 ②`HANDOFF.md` の **全体上書き** ③該当あれば
  `docs/decisions.md` ④コミット、まで行う(手順の実体は BLUEPRINT §6)
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
- ロールを足す: `~/.claude/templates/roles/` に追加。ここは **カタログ** であり、
  `/initialize` は目的に合うロールだけを選定・提案する(選定原則は
  `templates/BLUEPRINT.md` §7)。カタログに無いロールは初期化時に新規起草され、
  汎用性があればカタログへ還元される。提案は 2〜4 ロールに抑え、
  「作る役」と「検証する役」の分離を基本形とする
- 初期化の挙動を変える: `templates/BLUEPRINT.md` が唯一の真実。
  `commands/initialize.md` は BLUEPRINT を読んで従うだけの薄いコマンド
