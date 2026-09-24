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
   | `plan.md`(ルート直下) | 全体構想・フェーズ構造(最上位の why/what) | ゼロ。壁打ちで作り、全体に関わる決定時のみ更新。`/elaborate` が読み、`/breakdown`・`/amend`・`/follow-up` は該当フェーズの抜粋を照合に使う |
   | `HANDOFF.md`(ルート直下) | 今の状態・仕掛かり中・次の一手 | 40 行以内。状態が変わった時だけ **全体上書き**(追記しない) |
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
   (`/elaborate` が行を足し、`/breakdown` が `T` 列を埋め(タスクを足した `/amend` も直す)、`/follow-up` の機械チェック⑩が
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
7. **更新トリガーは配線する** — 「状態が変わった時に更新する」と規約に書くだけでは形骸化
   する。実際、旧 `.claude/handoff.md` は規約はあったが実行を強制する手順が無く、更新
   されなくなった。実体は `skeletons/todo.md` の §0 セッションプロトコルに埋め込んである。
   さらにプロンプト側の配線が破られた時(セッション異常終了等)の安全網として、
   SessionStart hook(`hooks/check-handoff-stale.sh`)が次セッション起動時に HANDOFF.md の
   未コミット変更を機構側で検知して警告する。同じ hook が、未決の要確認の件数と、回収点を持たない行の件数も
   起動時に知らせる(`/execute-task` の着手前の関門を通らずに着手するセッションへの安全網)。状態が変わらないセッションでは更新しないため、
   最新コミットからの距離は陳腐化の根拠にしない
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
   `/follow-up` が節目の総点検時に実ツリーとの乖離を機械検査、機構側の安全網として
   `hooks/check-new-directory.sh`(PreToolUse)が新規ディレクトリ作成時に確認を促す
   (Write 経由のみ検知。`mkdir` 等はプロンプト側の配線が一次的な強制手段であり、これは既知の限界)
11. **委任の境界は役割で分け、機構で縛る** — CLAUDE.md の Delegation 節が挙げる 5 役割を
    `agents/` の 5 定義に分解した。役割ごとに必要な権限が違うためで、実際
    Write/Edit を禁じて無害なのは 4 役割、`parallel-implementer` だけは禁じると成立しない。
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
    書き直し→通過のサイクルを繰り返す。1回きりの静的ルールでは届かない「書いた瞬間」に効く)。
    同じゲートの第 1 段で、聞く必要があるか・「推奨」の向きが正しいかも点検する(2026-09-18 追加)。
    エージェントが手直しの少ない方に「推奨」を付け、優劣の分かる判断まで聞く傾向が続いたため。
    比べる軸は仕組みとしての完成度で、判断でき可逆なら質問を取りやめて自律的に決めて実行する。
    規則の正は `CLAUDE.md` の Rules「Decision」。auto memory では効かなかった。取りやめが正当な
    出口になり素通しの機会が増えるため、再呼び出しを通すマーカーの失効を 30 分から 10 分に縮めた
13. **Markdown の装飾規則は formatter/linter で決定論的に保証** — `templates/rules/markdown.md`
    のうち機械判定できる規則(装飾の外側スペース・code fence の backtick 数)を、プロンプト遵守に
    頼らず PostToolUse hook(`hooks/format-markdown.sh` → `hooks/lib/markdown-format/`、
    依存ゼロ・ビルドなし)が Write/Edit 保存のたびに適用する。hook は編集行のみに限定し
    (未編集の逐語引用・既存箇所への波及を防ぐ)、ファイル全体への適用は `/markdown-cleanup`
    コマンドが単独コミットとして担う。適用範囲はプロジェクト側の `.claude/rules/markdown.md` の
    `paths:` frontmatter で判定するため、規約を配布していないプロジェクトでは no-op
14. **advisor は無効化し、レビュー役は `agents/` の subagent に統一** — advisor を含む API 応答の
    usage は本体 2 回分を合算した約 2 倍で記録され、Claude Code はその値でコンテキスト残量と
    自動 compact を判定する(2026-09-10 実測: 1 プロジェクトの auto compact 4 件が全件、
    実コンテキスト 49〜58% の時点での advisor 呼び出し直後。うち 3 件は `/follow-up` の外)。
    モデル自身はコンテキスト使用率を観測できないため「使用率が高い時は呼ばない」という条件付き
    回避は成立せず、自動 compact を切る設定も機能しないため、`settings.json` から
    `advisorModel` を外してツール自体を無くした。`/advisor <model>` は user settings に
    再保存されるので打たない。代わりに `proposal-reviewer`(提案・完了判断の反証)を追加し、
    `/follow-up` 手順 7・`/elaborate`・`/breakdown` の生成前レビューをそこへ向けた。
    副次効果として、Bedrock プロファイルの advisor 読み替え節が不要になり、advisor が会話全文を
    毎回 uncached で読んでいた分(実測で本体の uncached 入力を上回る量)が消える。
    2 本のレビューの分担は **依存先の境界** で切る: `diff-reviewer`(手順 4)の入力は基準の原文と
    diff だけにして手順 2 の直後に非同期で起動し機械チェックと並走させる。着地物の更新後でなければ
    成立しない検査(次の一手に着手できるか・diff の情報の未反映・撤回済み記述の残存)は
    `proposal-reviewer`(手順 7)へ寄せる。当初は後者を手順 4 に束ねていたため「手順 2 直後に起動」が
    四層モードでは手順 4 自身の入力定義と矛盾し、実運用で並走が成立しなかった(2026-09-10)
15. **コマンド本文に出典ポインタを置かない** — `commands/*.md` の本文はモデルへの実行指示であり、
    「意図・経緯は〜にある」は保守者向けの情報で実行には不要。私的プロジェクトのパスは他環境で
    解決できず、公開リポジトリに個人環境の情報を載せない方針にも反する。経緯は git 履歴
    (削除コミットの本文に要旨を移した)と本 README に置く
16. **モデルはタスクではなく役割へ割り当てる** — 通常実装、難しい実装、節目の横断総点検、
    計画への差し戻しに役割を分ける。モデル間の対応は性能等価ではなくワークフロー上の対応であり、
    個々のTへ予定モデルを固定しない。モデル名とエスカレーション順の正本は
    `templates/model-routing.md`。分業の目的は上位モデルの利用枠を設計と計画に充てることで、
    `/elaborate`・`/breakdown`・`/amend` は通常実装のモデルが上位モデルの判断なしに走り切れる設計書と
    タスクを書く(設計書の「実行者の裁量と停止条件」で固定と裁量の境界を引き、`TODO.md` の計画ごとの
    「共通の前提」から名指しする。足りないのが記述ならタスクを割らない)。Claude Code の `/execute-task` は
    Opus が監督と受け入れを担い、実装は Codex worker へ実装ステップごとに委譲する(実装者と受け入れ役を分け、
    worker 1 回の文脈を小さく保つ。worker には設計の意図を渡さず、規約だけを渡す。正は `templates/codex-worker.md`)
17. **compact の前に区切り、作業記録から再開する** — compact(コンテキストの自動要約)が起きてから止めると、
    引き継ぎを書く時点で情報が既に失われている。そこで `/execute-task` の実行中は hook
    (`hooks/context-budget.sh`)が使用率を測り、閾値(既定 Claude 70/80%・Codex 60/70%、設定は
    `~/.config/claude-task-loop/config.json`)で一段目「新しいステップを始めない」・二段目「作業記録と HANDOFF.md を
    書いてコミットせずにターンを終える」を差し込む。Thinking の本文は次のセッションに渡らないので、監督は
    ステップの境目ごとに結論(事実・決定と理由・捨てた仮説・次の意図)をリポジトリ外の作業記録
    (worklog。runner のタスク単位の置き場)へ書き、次の `/execute-task` が同じ T を照合してから再開する。
    複数の T は `hooks/lib/task-loop/` のループが、利用者の手動の `/clear` → `/execute-task` を herdr 経由で
    代行して回す。進む・再送する・止まるは成果物(TODO.md の `[x]`・T を含むコミット・clean)だけで決め、
    それ以外は止まって人へ渡す(2026-09-23。`claude -p` を使わないのは、最終応答の後にバックグラウンドの
    Bash が殺され Codex worker の待機と衝突するため)。穴の記録で止まった T には `/amend T<n>` を、次の一手が
    次の段階の分解なら `/breakdown` を同じループが送り、着地を成果物で確かめて続ける。`/elaborate` は送らない。
    問いの画面(blocked)では止まらず答えを待つ(2026-09-24。上限 24 時間)。ターンの途中・答え待ち・終了は
    hook(`hooks/loop-turn.sh`)が書くターンの状態を判定の主にし、herdr の画面の判定は待つ方向の証拠を足すだけにする
    (herdr が名前の罫線の下の問いの画面を idle と見逃し、/follow-up の問いの最中にループが終わった実例と、herdr の
    agent wait の失敗を読み違えて作業中の T の見張りを止めた実例による。同日)。herdr は送る手段として使い、長い待ち
    (agent wait)は使わない。引数なしの時に次に回す T は HANDOFF.md の次の一手だけで決め、
    1 回の起動は /follow-up の 1 区間で終える(同日。TODO.md の並びから凍結中の T を拾って止まった実例による)
18. **下流の各段は plan.md の該当フェーズに照らして反証する** — `plan.md` を読むのが `/elaborate` だけで、
    `/breakdown`・`/amend`・`/follow-up` は直前の中間文書(設計書・完了条件)だけに照らしていた。これでは
    段ごとに筋が通っていても目標からのずれが伝言のようにたまり、どの検査にも掛からない(2026-09-24 の振り返りで
    指摘)。3 コマンドは設計書の「全体構想」行が指すフェーズの本文と `plan.md` 冒頭の目標だけを読み、反証の
    入力に足す。タスクを起こす一次情報は設計書のまま変えず、ずれは自動で直さず利用者判断へ回す。正は
    `templates/BLUEPRINT.md` §6「目標への照合」

## ディレクトリ構成

````
~/.claude/
├── CLAUDE.md                    # グローバル指針(思想レベルのみ、83 行)
├── README.md                    # このファイル
├── settings.json                # 中核設定 — model / effortLevel / autoMode / qmd プラグイン(github: tobi/qmd)有効化
├── statusline.sh                # ステータスライン用スクリプト(受け取った使用量を予算停止の hook 用にサイドファイルへ書き出す。設計方針 17)
├── hooks/
│   ├── check-handoff-stale.sh   # SessionStart hook — HANDOFF.md の未コミット変更と、未決の要確認(件数・回収点の無い行)を通知(設計方針 7)
│   ├── check-stop-question.sh   # Stop hook — 問いかけ・依頼で応答を終えようとしたら 1 回だけ差し戻す自律判断ゲート(task-loop が駆動するセッションは素通し)
│   ├── context-budget.sh/.mjs   # PostToolUse + Stop + PostCompact + SessionStart hook — /execute-task の実行中、compact の前に作業記録を書かせてターンを終えさせる予算停止(Codex と本体を共有。設計方針 17)
│   ├── loop-turn.sh/.mjs        # UserPromptSubmit + PreToolUse(AskUserQuestion) + PermissionRequest + PostToolUse(+Failure) + Stop(+Failure) hook — task-loop が駆動するセッションのターンの状態(実行中・答え待ち・終了)を記録する。ループの待ち方の判定の主で、herdr の画面の判定は補助(設計方針 17)
│   ├── check-new-directory.sh   # PreToolUse(Write) hook — 新規ディレクトリ作成時の確認促し(設計方針 10)
│   ├── check-task-scope.sh/.mjs # UserPromptSubmit + PreToolUse(Write|Edit) + SubagentStart/Stop hook — /execute-task 実行中に TODO.md の対象パス外への編集を拒否し、レビュー役の返答待ち中は主文脈の編集を、Codex worker の実行中はそのリポジトリへの編集を拒否(Codex と本体を共有)
│   ├── check-question-legibility.sh  # PreToolUse(AskUserQuestion) hook — 確認の要否・推奨の向き・可読性のゲート(呼び出しごとに1回 deny→取りやめ or 書き直し。設計方針 12)
│   ├── deny-subagent-git-write.sh  # PreToolUse(Bash) hook — サブエージェントの git 履歴・リモート変更を拒否(設計方針 11)
│   ├── format-markdown.sh       # PostToolUse(Write|Edit) hook — 保存された .md を markdown-format CLI に通す(編集行のみ。全体整形は /markdown-cleanup)
│   ├── check-code-layout.sh     # PostToolUse(Write|Edit) hook — 保存されたコードを code-layout CLI に通し、coding-principles.md §14 の最低限(行幅 100・段落の空行)の抜けを差し戻す(編集行のみ。Codex と本体を共有)
│   ├── lib/codex-worker/        # /execute-task が実装ステップを Codex worker へ委譲する runner(ステップ計画(plan・show)・起動・範囲のゲート・restore・監督の検証(verify)・規約の添付・実行中の状態行・タスク単位の作業記録(worklog・note・resume)。node。テストは test/)
│   ├── lib/task-loop/           # /execute-task の連続実行ループ(herdr 経由で /clear → /execute-task を送り、成果物で進む・再送・停止を決める)と予算停止の計算・セッションの状態(node。テストは test/。設計方針 17)
│   ├── lib/mainline-gauge/      # 本流の計器(/breakdown が支線の分解の前に呼ぶ。node。テストは test/)
│   ├── lib/code-layout/         # check-code-layout.sh が呼ぶレイアウト検査の本体(依存ゼロ・ビルドなし。言語の表 + test/。詳細は同所の README.md)
│   └── lib/markdown-format/     # format-markdown.sh が呼ぶ formatter/linter 本体(依存ゼロ・ビルドなし。cli/format/lint/scope 等 + test/。詳細は同所の README.md)
├── agents/                      # サブエージェント定義(全プロジェクト共通。CLAUDE.md を継承する。設計方針 11)
│   ├── codebase-explorer.md     # 広域探索 — 読み取り専用
│   ├── log-test-analyst.md      # ログ・テスト出力の解析 — 読み取り専用
│   ├── parallel-implementer.md  # 独立した実装スライス — 唯一 Write/Edit を持つ
│   ├── diff-reviewer.md         # 差分の外部レビュー(/follow-up 手順 4)— 読み取り専用
│   └── proposal-reviewer.md     # 提案・完了判断の反証レビュー(/follow-up 手順 7、/elaborate・/breakdown の生成前、/amend の改訂案の提示前。設計方針 14)— 読み取り専用
├── commands/
│   ├── initialize.md            # /initialize — プロジェクト初期化(下記)
│   ├── elaborate.md             # /elaborate — 計画(plan.md の 1 フェーズ / plan mode)を対話で詳細化し設計書へ
│   ├── breakdown.md             # /breakdown — 設計書を TODO へ分解(設計書だけを入力)
│   ├── execute-task.md           # /execute-task T<n> — 既存タスクを実装・検証・コミットまで閉じる
│   ├── amend.md                 # /amend T<n> — 設計書の一部と未着手タスクを一回で改訂(設計の穴・単発の追加。新しい計画行は作らない)
│   ├── follow-up.md             # /follow-up — checkpoint間の複数タスクを横断して総点検
│   ├── agmsg.md                 # /agmsg — マルチエージェントメッセージング
│   └── markdown-cleanup.md      # /markdown-cleanup — markdown-format CLI をファイル全体モードで適用し単独コミット
└── templates/                   # /initialize・/elaborate・/breakdown が読むテンプレート群
    ├── BLUEPRINT.md             # 初期化設計書 — 判断基準と手順のすべてはここ
    ├── model-routing.md          # 設計済みタスクのモデル役割・停止・エスカレーション規約
    ├── codex-worker.md           # /execute-task の監督が Codex worker へ実装を委譲する手順(ステップの切り方・packet・report の読み方)
    ├── skeletons/               # 機械的に穴埋め・コピーする雛形(7 ファイル)
    │   ├── CLAUDE.project.md    # プロジェクト CLAUDE.md 雛形(ポインタ型)
    │   ├── handoff.md           # HANDOFF.md 雛形(書式規約をコメントで同梱)
    │   ├── todo.md              # TODO.md 雛形(§0 セッションプロトコル+タスクID規約)
    │   ├── design.md            # docs/design/<slug>.md 雛形(「全体構想」行の書式規約を同梱)
    │   ├── design-index.md      # docs/design/index.md 雛形(索引。作成日 / フェーズ / 設計書 / 表題 / T)
    │   ├── decisions.md         # docs/decisions.md 雛形
    │   └── architecture.md      # docs/architecture.md 雛形(構造の記録。ディレクトリ配置規約はここに書かず coding-principles.md §13 を参照)
    ├── rules/                   # コーディング規約+成長型ドキュメント規約(14 ファイル。原則 paths: 付き、
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
`CLAUDE.md` は `@../.claude/CLAUDE.md` を import し、差分節には Bedrock 固有の 2 点
(定義を使わず起動する subagent の `model: "fable"` 明示、hook の配線)だけを持つ
(advisor は主プロファイルでも無効化したため読み替えは不要になった。設計方針 14)。
**hook スクリプトの実体は symlink で共有されるが、その配線は `settings.json` にあり
bedrock は独自の実体を持つため、hook を足したときは両方の `settings.json` に登録する**
(片方だけだと、そのプロファイルでは hook が存在するのに発火しない)。予算停止の hook は
`check-task-scope` が置く「/execute-task の実行中」の状態で発火するので、bedrock にも `check-task-scope` を
登録している(2026-09-23)。task-loop の待ち方の判定の主である `loop-turn` も同じ理由で両方に登録する
(2026-09-24。bedrock だけ登録が漏れ、Claude でも herdr の画面の判定だけで待っていた)。

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
   計画セクションのタスク表の後ろに「共通の前提」(読む設計書の項と停止の規則)を 1 回だけ書き、各タスクは項を名指しする。
   1 回に分解するのは設計書の最初の未分解の 1 段階だけ。支線の設計書なら、分解の前に本流の計器
   (hooks/lib/mainline-gauge/)を示し、本流が進まないままの積み増しなら続行・削減・本流復帰を利用者に選ばせる
6. /execute-task T<n> → 1 タスク = 1 コミット。セッション終了時は軽量な引き継ぎ(状態変化かコールドスタート確認の不足がある場合だけ HANDOFF を上書き)
   設計の穴を見つけたら: 穴の記録を HANDOFF に残して停止 → /amend T<n>(設計書の該当節と未着手タスクを改訂)→ 6 へ戻る。
   設計書の目的・スコープが変わる時だけ 4 へ戻る(分類の正は BLUEPRINT §6「変更の三段分類」)
   コンテキストが閾値に達したら(予算停止): 作業記録と HANDOFF を書いてコミットせずに終える → /clear → /execute-task T<n>(同じ T を作業記録から再開)。
   複数の T は、herdr のペインの端末でプロジェクトのディレクトリから `task-loop`(zsh の alias。引数なしで HANDOFF.md の次の一手から、
   `task-loop T12..T16` で範囲)と打てば続けて回せる。1 回の起動は /follow-up の 1 区間で、checkpoint 以後の完了が 5 件に達したら
   (回す作業が尽きた時も含めて)/follow-up を送り、checkpoint が増えたらそこで終える。送る先は同じプロジェクトで入力待ちのペインを自動で選び、無ければ
   隣に作って起動する(T ごとに /clear。引数なしの時は工程を 1 つ終えるたびに HANDOFF.md の次の一手を読み直し、TODO.md の並びからは選ばない。
   穴の記録なら /amend T<n> を送って次の一手の T へ戻る。次の一手が /breakdown なら送って続ける(/breakdown は引数なしの時だけ)。
   承認・関門・要確認の問いは答えるまで待つ(上限は --answer-timeout-hours、既定 24 時間)。次の一手が /elaborate・コマンド無し・済んだ T、同じ T で 2 回目の穴・依存の未完了・compact などで止まり、
   理由と次の一手を JSON で出す)。
   Claude のペインは窓の題名で何をしているか分かるよう、起動時に `--name "<計画> loop"`、/clear の後に毎回
   `/rename <計画> T<n>`(/follow-up の前は `<計画> follow-up`、/amend は `<計画> T<n> amend`、/breakdown は `<設計書の slug> breakdown`)で名前を付け直す。<計画> は T が属する TODO.md の
   `## #<n> <slug>` の slug で、無ければリポジトリのディレクトリ名。Codex のペインには名前を付けない
7. 節目で /follow-up → checkpoint以後の複数タスクを横断して総点検し、次フェーズは 4 へ戻る。
   HANDOFF の要確認は、/execute-task の着手前(対象 T を回収点に持つ項目)と /follow-up の冒頭(全項目)で利用者に問い、決着を decisions.md に書く
````

plan mode は 4 の入口としてだけ `/elaborate` に合流する。**6 の実行中に `T<n>` を実行するための
plan mode を通っても、`/elaborate`・`/breakdown` は走らせない**(成果は既存 `T<n>` の完了条件で
検証される。判定基準は `TODO.md` §0)。

- **開始時**: `HANDOFF.md` と `TODO.md` の 2 つを読む。着手点は HANDOFF.md の「次の一手」
- **タスク完了ごと**: ①TODO.md の該当タスクを `[x]` に更新 ②コミット(要約に `T<n>` を含める。
  変更を生まないタスクは `git commit --allow-empty` で記録を残す)。実行しないと決めたタスクは
  `/amend` が `[-]`(廃止)にする。状態の値域と未着手タスクの書き換え規約の正は `TODO.md` 冒頭コメント
- **長時間の実行**: 途中終了を避けたい場合などに `/goal <検証可能な完了条件>, or stop after 20 turns`
  を補助的に使う(状態確認は `/goal`、解除は `/goal clear`)
- **終了時**: 未コミット変更を確認する。中断状態・次の一手・要確認などが変わった場合は
  `HANDOFF.md` を全体上書きする。続けて毎回コールドスタート確認(`TODO.md` と `HANDOFF.md` だけで
  正しい最初の一手と参照先が分かり、棄却済みの経路を繰り返さないか)を行い、不足があれば補う。
  該当する判断記録とTODOローテーションを着地させる。過去の transcript は自動探索せず、
  設計書全体の再照合や独立レビューも行わない
- **節目**: 最新 `Follow-Up-Checkpoint: true` 以後に完了した異なるT番号が5件に達した時、
  依存グループ完了時、統合前、ライブ検証前、設計変更または不整合を検出した時は、
  次のTへ進む前に `/follow-up` を実行する。checkpointがまだ無い既存プロジェクトの初回だけ、
  明示した基準コミットを引数で渡す
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
