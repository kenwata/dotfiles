# Codex worker への実装の委譲(Claude Code の `/execute-task` 手順4)

この文書は、Claude Code の `/execute-task` が実装を Codex worker へ委譲する時の、監督の手順の正本である。
機構(起動・ゲート・restore・規約の添付・計測)は `~/.claude/hooks/lib/codex-worker/cli.mjs` が持ち、
この文書はそれをどう使うかを定める。Codex ホストで `$execute-task` を実行する時は適用しない(Codex は従来どおり
自分で実装する)。

## 役割

- **監督 — Claude Code(Opus high)**
  - 行うこと: 文書を読む、実装ステップに切る、packet を書く、report と差分を照合する、試験を再実行する、
    参照の訂正、穴の記録、`TODO.md`・`HANDOFF.md`・`docs/decisions.md` の更新、コミット
  - 行わないこと: 対象パス内のコードを自分で編集する
- **worker — Codex(通常実装のモデル)**
  - 行うこと: 1 つの実装ステップの範囲でのコード調査・実装・試験
  - 行わないこと: 許可パス外の変更、完了の基準の変更、状態文書・設計書の編集、git の書込

監督が対象パスのコードを自分で書かないのは、実装者と受け入れ役を分けて「実装者自身が、自分の実装に合わせて
完了条件を緩めない」を構造で保つためである。worker が 1 回で閉じないステップは、監督が書き足すのではなく、
ステップを切り直して再起動する。

## 文脈の取捨

worker に渡す文脈は、実装に要る最低限に絞る。多いほど良いわけではない。

- **渡さない — 「意図」の層**: 設計書の背景・理由、兄弟タスク、将来の計画、`HANDOFF.md`、`TODO.md` の他の行。
  与えるほど worker は構想を先回りして完成させようとし、範囲の外へ実装を広げる(2026-09-22 の T43 は、設計の
  意図を読んだ上で入力契約の変更を呼び出し元まで連鎖させた)。範囲外が要るかの判断は、全体を知る監督が worker の
  `blocked` を受けて行う。worker に兄弟タスクの担当を教えて判断させない。
- **必ず渡す — 「どう書くか」の層**: プロジェクトの規約(`.claude/rules/`・`.codex/rules/`)。範囲を広げる
  方向には働かず、ゲートでは検査できない規約の遵守を担う。runner が許可パスに当てはまるもの(と `paths:` の無い
  もの)を全文で添付するので、監督は packet に規約を書き写さない。
- **ステップの分だけ渡す — 契約**: そのステップが満たす完了の基準の項目と、守るべき契約(シグネチャ・データ形式・
  終了コードなど)を、設計書・`TODO.md` から逐語で。言い換えると監督の解釈が混ざり、照合の基準がずれる。

worker 用の Codex 環境(`~/.codex-worker`)は、グローバルの AGENTS.md とプロジェクトの指示ファイル
(AGENTS.md・CLAUDE.md)を注入しない。通常の `~/.codex/AGENTS.md` は開始時に `HANDOFF.md` と `TODO.md` を
読むよう命じ、プロジェクトの指示ファイルはセッション運用(意図の層)を多く含むためである。`~/.agents/skills` の
skill 一覧(名前と説明、約 3KB)は CODEX_HOME に依らず注入されるが、文書を読めという指示は含まない。

## 実装ステップの切り方

対象 T の完了条件を、1 回の worker 起動で閉じるステップに切る。対象パスの一覧を丸ごと 1 回で渡さない —
1 回の起動の文脈量を抑えることが、この委譲の目的である。

- 1 ステップの許可パスは 3 件まで(runner が機械で拒否する。`--max-allow` で上げるのは、1 ファイルずつでは
  閉じない変更を観測した時だけ)。新規ファイルはファイル名で指定する(中身の無いディレクトリを渡すと規約の
  照合が保守側に倒れ、全規約が添付される)。T の `対象:` の部分集合であること(runner が検査する)。
- ステップは依存順に並べる(型・契約 → 実装 → 試験、または試験 → 実装)。前のステップの結果に依存する
  ステップは、前のステップの report を照合してから起動する。
- report の `slice_too_large`(ピーク使用率が既定 60% 超)が立ったら、以後のステップを小さく切る。
  compaction が起きた run は runner が不採用にする。同じ packet で再試行しない。

## ステップ計画

切ったステップの一覧は、最初の worker を起動する前に runner へ登録する。runner は計画の無いタスクと、計画に無い
ステップ番号の起動を拒否する。計画は、利用者が全体のステップ数と各ステップの目的を 1 か所で追うためのものである
(会話の中や scratchpad だけに置くと、利用者からは見えない)。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs plan --root <プロジェクトルート> --task T<n> --file <plan.md>
````

計画のファイルは 1 ステップ 1 行で `- s<番号>: <目的 1 文>` と書く(それ以外の行は読まない)。runner はそれを
`${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/tasks/<ルートのパスの記号を - にした名前>/T<n>/plan.md` に置き、
一覧を状態行に出す。各 run の packet も同じ場所に `s<番号>.packet.md` として写す。登録したら、ステップの一覧と
この置き場所を利用者への報告に書いてから最初のステップを起動する。ステップを切り直したり足したりした時は、
同じコマンドで登録し直す(前の計画は `plan-<時刻>.md` に残る)。

進み具合は次のコマンドで、ステップごとの最新の run の状態(未着手・実行中・accepted・rejected・中断)と
verify の結果を表で見られる。利用者に進み具合を聞かれたら、これの出力で答える。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs show --root <プロジェクトルート> --task T<n> [--json]
````

同じ置き場の `worklog.md` がタスクの作業記録である(書式の正は `hooks/lib/codex-worker/worklog.mjs`。追記専用で消さない)。
runner は `plan`・`run`・`verify` の結果を 1 行ずつ自動で書く。監督は各ステップの受け入れ(または差し戻し)を決めた
直後に、確かめた事実・決めたことと理由・捨てた仮説と理由・次にやることを `note` で 1 行ずつ書く。会話の Thinking は
次のセッションに引き継げないので、再開はこの記録だけを頼りに行う。`show` は run の記録が消えたステップを
作業記録から埋め、`resume` は同じ T を再開する時の照合(未コミットの変更が作業記録で説明できるか)を JSON で返す
(使い方の正は `commands/execute-task.md` 手順1の再開の判定)。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs note --root <プロジェクトルート> --task T<n> --step <番号> \
  --kind <fact|decision|rejected|intent|handoff|resume|step> --text "<1 行>"
node ~/.claude/hooks/lib/codex-worker/cli.mjs resume --root <プロジェクトルート> --task T<n>
````

## packet

監督は packet(Markdown、既定の上限 12KB)をファイルに書き、runner に渡す。runner は、固定の契約
(`worker-contract.md`)→ 許可パス(`--allow` から生成)→ packet → 規約の全文、の順でプロンプトを組み立てる。
許可パスと規約は packet に書かない。

「横断の確認」節は、監督がステップをまたぐ決定を現物で確かめたことを書く欄である。runner は節が無いか空の packet を起動前に拒否し、点検の3項目(呼び出し元の検索、原因の断定の根拠、共有の型・形式)を理由として返す。どれにも当たらないステップは「該当なし: 理由1文」の1行でよい。

````markdown
## 目的
<このステップで実現すること 1 文>

## 完了の基準(このステップの分、逐語)
- <TODO.md の完了条件ブロックから、このステップが満たす項目をそのまま>

## 守る契約(逐語)
<設計書から、このステップに関係するシグネチャ・形式・終了コードなどだけ。背景や理由は書かない>

## 入口
- <読み始めるファイル:シンボル。監督が調べて特定したもの>
- <倣う既存パターン(ファイル:行)>

## 前のステップの結果
<git diff --stat と、前の report の要約 1〜3 行。差分の全文は貼らない。最初のステップでは「なし」>

## 横断の確認
<runner が必須にする。関数名・型・値の置き場を他のファイルが作る/使う時の作り手と呼び出し元、原因の断定の根拠、共有の型・形式。当たらなければ「該当なし: 理由」>

## 検証
- `<コマンド>`
````

「検証」節は、受け入れの前に監督が `verify` で打つコマンドの一覧である(下の「report の読み方」)。1 項目に
1 コマンドをバッククォートで囲んで書く(括弧の補足は項目の後ろに書いてよい)。このステップの変更に最も近い試験に加えて、
プロジェクト規約が変更に求める lint・整形の検査・型検査も入れる — ここに無いものは誰も打たない。runner はコマンドの
箇条書きが無い packet を起動前に拒否する。worker も同じコマンドを sandbox の中で打つが、その結果(`tests_run`)は
申告であり、受け入れの根拠にはしない。

## 起動

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs run --root <プロジェクトルート> --task T<n> --step <番号> \
  --packet <packet.md> --allow <パス> [--allow <パス> ...]
````

Bash ツールの `run_in_background` で起動し、完了通知を待つ(Bash の 10 分上限を超え得るため。runner 自身が
既定 20 分で worker をプロセスグループごと止める)。出力をファイルへリダイレクト(`> file 2>&1` など)しない —
下の状態行がバックグラウンドタスクの出力に出なくなり、利用者から実行中の様子が見えなくなる。実行中は runner がロックを置き、`check-task-scope.mjs` が
そのリポジトリへの Claude 側の編集を拒否する(IDE や Bash 経由の編集は止められない。run 中に作業ツリーを
触らない)。packet は scratchpad など作業ツリーの外に置く。

worker のモデルは系統名で指定する(既定 `luna`。上げる時は `--model-family terra` など、`model-routing.md` の
表の名前)。runner が `codex debug models` の一覧から、その系統の最新の版の ID に解決して report の `model` に
書く。版番号を記憶や文書から書かない — モデルは更新されるので、一覧にある値だけが事実である。`--model` で ID を
直接渡すのは、一覧に無いモデルを試す時だけ。

実行中の様子は、runner が状態行として stderr とプロジェクトごとのログ
`${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/status/<ルートのパスの / などを - にした名前>.log` に出す(`codex exec --json` のイベントから、実行したコマンドと終了コード・編集したファイル・worker の進捗の一言・
トークン数・最後の判定を選んだもの。形式は `hooks/lib/codex-worker/status.mjs`)。行の前置きは `[Codex T<n> s<番号> <何番目>/<全ステップ数>]` で、
開始の行にそのステップの目的を出す。利用者はバックグラウンドタスクの
出力か、別の端末の `tail -F` でそのプロジェクトのログを追う(同じリポジトリでは worker が同時に 1 つなので、1 つのログの中で
別の run と混ざらない)。状態行は人のためのもので、監督は読まない(判断は report と
差分で行う)。生のイベントは run ディレクトリの `events.jsonl` に残るが、監督は全文を読まない。

run の記録(snapshot と退避コピー、プロンプト、生のイベント、worker の出力、report)は
`${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/runs/<run_id>/` に置かれ、7 日で消える。worker の
sandbox は TMPDIR と /tmp に書けるので、restore の元になる記録をそこに置かない。run の採否・変更したパス・
その T で最初の run の前から未コミットだったパスは作業記録にも残るので、再開の照合は run の記録に依らない。

## report の読み方

runner は report(JSON)を stdout と `<run_dir>/report.json` に出す。バックグラウンドの出力ファイルには
stderr の状態行も混ざるので、完了通知の後は `sed -n '/^{$/,/^}$/p' <出力ファイル>` で report だけを読む(状態行は
`[Codex ` で始まる 1 行ずつなので、`{` だけの行と `}` だけの行は report の開始と終わりに限られる)。report は判断材料であり、`worker` 欄は
worker の主張である。受け入れる前に、監督が `git diff` と `verify` で確かめる。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs verify --run <run_dir> [--timeout <1 本あたりの秒。既定 900>]
````

`verify` は packet の「検証」節のコマンドを、run のルートで 1 本ずつ別々に打ち、コマンドごとの終了コードと出力の末尾を
JSON で stdout と `<run_dir>/verify.json` に出す(全文は `<run_dir>/verify-<時刻>/<番号>.log`)。exit 0 は全部 0、
exit 1 は 0 でないものがある。監督の Bash から起動するので worker の sandbox の制限(loopback の bind など)を受けず、
worker が `notes` で「sandbox で完走できなかった」と書いた検証もこれで確かめる。結果は stdout を直接読み、
ファイルへリダイレクトしない(以前の出力ファイルを読み違えないため)。検証を自分で束ねて打ったり一部だけ打ったりしない
— 束ねると 1 本ごとの成否が分からず、打たなかったものは確かめていない。

- **exit 2**: `errors` を直して起動し直す(worker は起動していない。何も変更していない)。
- **exit 1(不採用)**: `reasons` を読む。
  - `restore.restored` のパスは snapshot 時点へ戻っている(上書き前の内容は `restore.backups` に退避)。
    許可外の変更だけなら、許可内の変更は残っている。
  - `restore.unrestorable`(入れ子のリポジトリ・サブモジュールなどのディレクトリ)と `gate.repo_changes`
    (commit・stage など)は自動では戻していないので、状態を確認して手で戻す。
  - `stage: interrupted` は runner が止められた場合で、作業ツリーは戻していない。
- **exit 0、`worker.status: done`**: 差分を確かめ、`verify` が exit 0(`all_passed: true`)であることを確かめ、`criteria` を完了の基準と一項目ずつ照合する。足りなければ、
  不足を packet に書いて同じステップを再起動する。受け入れを決めたら、ステップの境目の `note` を書いてから次のステップへ進む。
- **exit 0、`worker.status: blocked`**: `holes` と `reference_errors` を観測で裏取りする(下の節)。
- **exit 0、`worker.status: failed`**: `notes` と `tests_run` から原因を確かめ、ステップを直して再起動するか、
  下のエスカレーションへ。

採らないと決めた run の変更は `cli.mjs restore --run <run_dir>` で snapshot 時点へ戻す(許可パスの中だけを戻す。
run の後に監督が書いた状態文書には触れない)。

## 再試行・エスカレーション・差し戻し

- 設計の範囲内の不足(試験の失敗、完了の基準の未充足、許可外の変更、`slice_too_large`)は、ステップを直すか
  細かく切って再起動する。監督が自分でコードを直さない(`execute-task.md` 手順5の「是正」もこの経路で行う)。
  同じステップで同じ種類の失敗が 2 回続いたら、worker のモデルを `model-routing.md` の順に上げる
  (`--model-family`)。監督は Opus のまま変えない。
- `holes` は worker の主張である。監督が観測で裏取りし、先に `TODO.md` の同じ段階の他タスクの `対象:` と完了
  条件が、その作業を担当していないかを確かめる。担当先があれば穴ではない(その作業は担当タスクに任せ、現在の
  ステップを締める)。確かめてなお穴なら、`execute-task.md` 手順3の穴の記録の経路へ。
- `reference_errors` は、`execute-task.md` 手順3の参照の訂正に当たるか監督が判定し、当たれば監督が直して
  再起動する。当たらなければ穴の記録の経路へ。
- 予算停止(監督のコンテキスト使用率の hook `hooks/context-budget.mjs`): `[context-budget 1/2]` が届いたら次の
  worker を起動しない。実行中の run は止めず、report を受け取って今のステップの採否を決め、`note` を書く。
  `[context-budget 2/2]` が届いたら handoff を書いて、コミットせずにターンを終える(手順の正は `execute-task.md` 手順4の
  予算停止)。worker の compaction(上の `slice_too_large` と不採用)とは別物で、こちらは監督の文脈の区切り。

## ゲートが見るもの・見ないもの

- 見る: HEAD・全 ref・index の変化(commit・stash・ブランチ操作・stage)、未コミットと untracked のファイルの
  内容と実行権限、.gitignore 対象のファイル(`.env` など)の内容、入れ子のリポジトリ・サブモジュールの HEAD と
  作業ツリー。snapshot の前から未コミットだったファイルへの追記も、内容の比較で捕まる。
- 違反にせず警告にする: .gitignore 対象のディレクトリの出入り(試験の生成物など。`gate.ignored_dirs`)。
- 見ない: .gitignore 対象のディレクトリの中身の変更、作業ツリーの外(worker の sandbox はリポジトリと TMPDIR・
  /tmp にしか書けない)。TMPDIR にある hook の状態とロックは worker が書き換えうるが、ロックを消されても失うのは
  監督の編集の抑止だけで、ゲートの判定には使わない。

## 記録と計測

- `TODO.md` の `実` 列は、監督が `[x]` にする時に `Claude/<監督のモデル略称>+Codex/<worker のモデル>` と書く
  (書式の正は `~/.claude/templates/skeletons/todo.md`)。worker のモデルは、最後に使った run の report の
  `model` 欄の値を写す。版番号を記憶から書かない — モデルは更新されるので、実行時の値だけが事実である。
- report の `metrics`(ピーク使用率・compaction・トークン・所要時間・packet の大きさ)は、
  `model-routing.md` とこの文書の既定値(packet 上限、ピークの閾値、許可パスの件数)を見直す材料にする。
  run ディレクトリは上の「起動」の節の置き場所に 7 日残る。
- 作業記録の `kind=budget`(予算停止が発火した使用率)と `kind=compact`(閾値をすり抜けて compact が起きた)は、
  予算停止の閾値(`~/.config/claude-task-loop/config.json`、既定 Claude 70/80%・Codex 60/70%)を見直す材料にする。
