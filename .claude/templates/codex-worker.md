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
  ステップは、前のステップの report を照合してから起動する。前のステップの結果に依存せず、許可パスも重ならない
  ステップは、依存に `なし` か依存先の番号を書き、下の「並列ステップ」で同時に走らせる(時間の大半は worker の
  モデルの応答で、直列に並べるとその待ちが足し算になる。2026-09-25 の計測で 81%)。
- report の `slice_too_large`(ピーク使用率が既定 60% 超)が立ったら、以後のステップを小さく切る。
  compaction が起きた run は runner が不採用にする。同じ packet で再試行しない。

## ステップ計画

切ったステップの一覧は、最初の worker を起動する前に runner へ登録する。runner は計画の無いタスクと、計画に無い
ステップ番号の起動を拒否する。計画は、利用者が全体のステップ数と各ステップの目的を 1 か所で追うためのものである
(会話の中や scratchpad だけに置くと、利用者からは見えない)。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs plan --root <プロジェクトルート> --task T<n> --file <plan.md>
````

計画のファイルは 1 ステップ 1 行で `- s<番号>: <目的 1 文>` と書く(それ以外の行は読まない)。依存は目的の後ろに
`(依存: s1, s2)` の形で書き、最初から走らせてよいステップは `(依存: なし)` と書く。依存を書かない行は直前の
ステップに依存するとみなす(書かなければ従来どおりの直列になる)。依存は監督が読んで起動の順を決めるためのもので、
runner は解釈しない。runner はそれを
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

## 並列ステップ

依存の済んだステップが 2 つ以上あれば、`--worktree --parallel` を付けて同時に起動する(作業場所は帳簿と別の
リポジトリであること。`--worktree` の条件と同じ)。runner は並列ステップごとに専用の worktree を
`${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/worktrees/<ルート名>/T<n>-s<番号>/`(ブランチ
`codex-worker/<ハッシュ>/T<n>-s<番号>`)に作り、そこで worker を動かす。起点は T の worktree のブランチの先端なので、
統合済みのステップの成果は見えるが、実行中の兄弟の書きかけは見えない(worker の検査も兄弟の書きかけを拾わない)。

- 起動は 1 つずつ、それぞれ `run_in_background` で打つ(同じ Bash 呼び出しで同時に打たない。起動前の検査とロックの
  書き込みの間は原子的でない)。runner は次の場合に起動前に拒否する(exit 2): 並列でない run が同じ帳簿で走っている /
  別の T の worker が走っている / 同じ T の並列ステップが上限(既定 3。`--max-parallel`)に達している / 走っている
  兄弟と許可パスが重なる。許可パスが重なるステップは並列にせず、依存を足して直列にする
- 並列でない run(`--parallel` 無し)は、並列ステップが 1 つでも走っている間は拒否される。並列ステップの後に直列の
  ステップを置く時は、兄弟をすべて統合してから起動する
- 完了通知が来たステップから順に、report を読み、`verify` を打ち(ステップの worktree の中で打たれる)、受け入れた
  変更をそのステップの worktree で監督がコミットする(`git -C <report の worktree.path> add <変更したパス>` と
  `commit`)。続けて次を打つ。runner はステップのブランチを T のブランチの先端へ載せ直して(rebase)、T の
  worktree へ fast-forward し、ステップの worktree とブランチを消す
- 統合したら、依存が済んだステップを起動する。上限が空いたら、待っているステップを起動する

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs integrate-step --root <プロジェクトルート> --task T<n> --step <番号>
````

`integrate-step` は、ステップか T の worktree に未コミットの変更がある時・記録が無い時は何も変えずに exit 2、
T のブランチへ載せ直せない時(衝突)は rebase を取り消して exit 1 で止まる(ステップの worktree は残る)。
衝突は許可パスが重なった時にしか起きないので、起きたら計画の依存の書き漏れとして、そのステップを直列で
やり直す。差し戻すステップは、同じ番号で `--parallel` を付けて打ち直す(同じステップの worktree を使い回す)。

並列にしたステップの後には、それらすべてに依存する直列のステップを 1 つ置き、その検証節に全体の試験を書く
(並列のステップはそれぞれ自分の変更しか検証していない)。T のすべてのステップを統合したら、`integrate` で T の
worktree を本体へ取り込む。`integrate` は、統合していないステップの worktree が残っている間は拒否する。
dotfiles の「1 タスク = 1 コミット」を守るため、ステップごとのコミットをすべて T の worktree に取り込んだ後、
`integrate` の前にその worktree で `git reset --soft <worktree.json の base>` を実行し、変更を 1 コミットにまとめる。
保存先:

`${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/tasks/<ルート名>/T<n>/worktree.json`

まとめても、本体の HEAD がブランチの祖先という
`integrate` の前提は崩れない。

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
申告であり、受け入れの根拠にはしない。`verify` も worker と同じ sandbox の中で打つ(下の「report の読み方」)ので、
外部への通信を要するコマンドは検証節に書けない。コミット前に全体の試験が要るなら、それも最後のステップの検証節に
書いて `verify` で打つ。

## 起動

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs run --root <プロジェクトルート> --task T<n> --step <番号> \
  --packet <packet.md> --allow <パス> [--allow <パス> ...] [--workspace <リポジトリ>] [--worktree]
````

T の対象がプロジェクトの外のリポジトリにある時(`対象:` が `~/.claude/...` のように dotfiles の中を指す、など)は、
`--workspace` にそのリポジトリの中で T の対象をすべて含む最も狭いディレクトリを渡す(例 `~/.claude/hooks`)。
worker の sandbox は作業ツリー(`-C` の先)にしか書けないので、`--root` のままではプロジェクトの外へ書けない。
リポジトリの最上位を渡さないのは、dotfiles のように Claude Code・herdr などが動いている間ずっと書き込むファイル
(`.claude/history.jsonl` など)を含むリポジトリで、worker に書ける範囲とゲートが見る範囲を広げないためである。
T の対象が dotfiles の中にあり、作業場所が `.claude` 直下のようにアプリ本体が書く場所を含む時は、
`--worktree` を付ける。これにより、本体の HEAD から T ごとの worktree を作り、worker はその中で動く。
既定の作業場所では Claude Code などが動作中に書くファイルもゲートに見えるため、worktree ではその影響を分ける。
`--worktree` は値を取らないフラグで、既定では付けない。付けなければ run は従来と同じ経路を通る。
指定時は `--workspace` が必要で、本体のリポジトリ最上位が帳簿の `--root` の最上位と異なること。
この前提を満たさなければ worker を起動せず exit 2 を返す。終了コードは 0 が成功、1 が判定として不可
(不採用・統合不可)、2 が前提不足で worker 未起動を表す。ただし `run --worktree` は worktree 作成後の検査で
拒否した場合、worktree を残したまま exit 2 を返すことがある。

worktree は帳簿のルートと T の組ごとに 1 つで、後のステップも同じ worktree を使う。
前のステップが受け入れた未コミットの変更もそこで見える。最初の run で、本体の HEAD から次のように作る:

````bash
git -C <本体> worktree add -b <ブランチ> <置き場> HEAD
````

置き場は `${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/worktrees/<rootSlug(帳簿のルート)>/<T>/`、
ブランチは `codex-worker/<canonical(帳簿のルート) の sha1 先頭 8 桁>/<T>`。
本体の HEAD が detached なら作成を拒否し exit 2。
有効な作業場所は `<worktree の最上位>/<本体の最上位から --workspace までの相対パス>`。
T の対象と `--allow` の `~/…`・絶対パスは worktree の最上位を基準に読み替える。
`--worktree` では worktree がほかのプロセスに書かれないため、`--workspace` にリポジトリの最上位を渡してよい。

`--root` は帳簿(`TODO.md`・ステップ計画・作業記録・状態行)の場所のまま変えず、worker の起動・snapshot・
ゲート・restore・ロック・`verify` が作業場所の中だけで行われる。`--allow` は作業場所からの相対で書く
(`~/…` や絶対パスで渡しても、runner が作業場所からの相対に直す)。runner は T の対象の `~/…` と絶対パスも
実体パスへ解決して作業場所の中へ読み替え、包含を照合する。packet の検証節のコマンドは作業場所を cwd として
打たれる。規約は作業場所 → そのリポジトリの最上位 → プロジェクトの順に `.claude/rules`・`.codex/rules` から
選ぶ(`paths:` は各規約の置き場所からの相対で照合する)。作業場所とプロジェクトが入れ子のもの、.gitignore 対象の
ディレクトリの中のものは起動前に拒否する。作業場所では、起動前からあった .gitignore 対象のファイルの変更・
削除を違反にせず警告(`gate.ignored_files`)に分け、復元もしない(ほかのプロセスの書き込みを巻き戻さないため)。
新しく作られたファイルは .gitignore 対象でも違反のまま。通常 run の実行中ロックは作業場所のリポジトリ単位なので、
同じリポジトリの worker は作業場所が違っても同時に 1 つだけ(2 つ目は起動前に拒否される)。例外は同じ T の
並列ステップで、それぞれ専用の worktree で動くので同時に走れる(上の「並列ステップ」)。
`--worktree` run のロックは worktree ごとになる。`check-task-scope.mjs` が拒否する Claude 側の編集も
worktree 内だけで、本体の `~/.claude` への編集は止めない。本体で worker の対象と同じファイルを編集すると、
`integrate` の fast-forward が拒否される。`resume` は作業場所の
未コミットの変更も照合し、説明できないものを絶対パスで `unexplained_dirty` に足す。作業場所のコミットは監督が、
自分が変えたファイルだけをパス指定で行う。

`--worktree` を使った時も、監督は T の対象に関わる本体の未コミット変更を、最初の run より前に本体でコミットする。
worker が変えたファイルは、監督が worktree の中で確かめたものだけをパス指定でコミットする
(`git -C <worktree> add <paths>` → `commit`)。本体ではこのコミットを打たない。
T のステップを受け入れて clean にした後、次で本体へ統合する:

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs integrate --root <プロジェクトルート> --task T<n>
````

統合後に本体の SHA を記録する。dotfiles 側の SHA を帳簿のリポジトリのコミット本文に書く規則も、
`integrate` 後の本体の SHA で行う(rebase で SHA が変わるため)。検証節のコマンドと試験は作業場所からの相対で書く。
`~/.claude/…` は本体を指すため、worktree 内のコードを試験したことにはならない。
`integrate` の前提不足は exit 2 で何も変えない: worktree の記録があり `git worktree list` に載っていること、
worktree と本体のどちらにも生きた worker ロックがないこと、worktree が clean であること、
本体の `symbolic-ref HEAD` が作成時と同じこと。worktree が clean かは
`git -C <worktree> status --porcelain` が空かで確認する(untracked を含む)。
本体の HEAD が worktree のブランチの祖先でない場合、または git が
`git -C <本体> merge --ff-only <ブランチ>` を拒否した場合は exit 1 で何も変えない。
前者は `errors` に `git -C <worktree> rebase <ブランチ名>` が示されるので監督が実行し、衝突したら停止する。
後者は本体の未コミット変更と同じファイルをブランチが変えた場合などに起きる。
成功時は fast-forward、`git worktree remove`、`git branch -d` の順に進み、worktree の記録を消す。

Bash ツールの `run_in_background` で起動し、完了通知を待つ(Bash の 10 分上限を超え得るため。runner 自身が
既定 20 分で worker をプロセスグループごと止める)。出力をファイルへリダイレクト(`> file 2>&1` など)しない —
下の状態行がバックグラウンドタスクの出力に出なくなり、利用者から実行中の様子が見えなくなる。実行中は runner がロックを置き、`check-task-scope.mjs` が
そのリポジトリへの Claude 側の編集を拒否する。`--worktree` run では拒否するのは worktree 内だけで、
本体の `~/.claude` への編集は止めない(本体で対象と同じファイルを編集すると、`integrate` の fast-forward が
拒否される)。IDE や Bash 経由の編集は止められないので、run 中に作業ツリーを触らない。
packet は scratchpad など作業ツリーの外に置く。

worker の sandbox は、作業ツリーと TMPDIR・/tmp にだけ書け、ネットワークは loopback(127.0.0.1)だけを通して
外部を拒否する(設定の正は `.codex/worker-config.toml` のコメント)。試験がローカルのサーバや番兵のポートを
127.0.0.1 で待ち受けるので loopback は要り、`.env` の本物の API キーで課金される API に届かないよう外部は止める。
runner は起動のたびに `codex sandbox` でこの疎通を実測し、外れていれば worker を起動せず exit 2 を返す(Codex の
更新や設定の入れ忘れで変わりうるため。`errors` に従って `.codex/install.sh` で入れ直す)。uv のキャッシュは
`UV_CACHE_DIR` に run 専用のディレクトリ(TMPDIR の下。run の後に消す)を渡す。既定の `~/.cache/uv` は sandbox から
書けず、書けるようにすると worker が汚したキャッシュを sandbox の外の uv が使うことになるためである。

worker のモデルは系統名で指定する(既定 `luna`。上げる時は `--model-family terra` など、`model-routing.md` の
表の名前)。runner が `codex debug models` の一覧から、その系統の最新の版の ID に解決して report の `model` に
書く。版番号を記憶や文書から書かない — モデルは更新されるので、一覧にある値だけが事実である。`--model` で ID を
直接渡すのは、一覧に無いモデルを試す時だけ。

実行中の様子は、runner が状態行として stderr とプロジェクトごとのログ
`${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/status/<ルートのパスの / などを - にした名前>.log` に出す(`codex exec --json` のイベントから、実行したコマンドと終了コード・編集したファイル・worker の進捗の一言・
トークン数・最後の判定を選んだもの。形式は `hooks/lib/codex-worker/status.mjs`)。行の前置きは `[Codex T<n> s<番号> <何番目>/<全ステップ数>]` で、
その直後にローカル時刻の `HH:MM:SS` と半角スペース 1 つを付ける。開始の行にそのステップの目的を出す。
本文が複数行なら各行に時刻を付け、run・plan・verify の全サブコマンドで同じ形式を使う。
最後の要約では `finished:` の直後、`reason:` の前に、`metrics.check_s` が数値なら
`  timing: check=<check_s>s other=<other_command_s>s model=<model_s>s` を出す。
利用者はバックグラウンドタスクの
出力か、別の端末の `tail -F` でそのプロジェクトのログを追う(同じリポジトリでは worker が同時に 1 つなので、1 つのログの中で
別の run と混ざらない。並列ステップは同じログに交互に書くが、行の前置きのステップ番号で分けて読める)。状態行は人のためのもので、監督は読まない(判断は report と
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

`--worktree` を付けた run の report には `worktree: { repo, path, branch }` がある。付けない run には
`report.worktree` は出ない。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs verify --run <run_dir> [--timeout <1 本あたりの秒。既定 900>]
````

`verify` は packet の「検証」節のコマンドを、run の作業場所(`--workspace`、無ければルート)で 1 本ずつ別々に打ち、コマンドごとの終了コードと出力の末尾を
JSON で stdout と `<run_dir>/verify.json` に出す(全文は `<run_dir>/verify-<時刻>/<番号>.log`)。exit 0 は全部 0、
exit 1 は 0 でないものがある。コマンドは worker と同じ sandbox(`codex sandbox`、worker 用 CODEX_HOME の設定、
専用の `UV_CACHE_DIR`)の中で打つ。worker が書いたコード(ゲートが見ない `.venv/` などの中身を含む)を、API キーと
ネットワークのある監督の環境で走らせないためである。打つ前に runner の起動時と同じ疎通の実測を行い、外れていれば
何も打たず exit 2 を返す。worker が `notes` で「実行環境の制限で失敗」と書いた検証も、これで確かめる。
worker の変更が載った作業ツリーの試験を、監督の Bash で直接打たない(同じ理由。要る試験は検証節に書いて `verify` で
打つ)。結果は stdout を直接読み、ファイルへリダイレクトしない(以前の出力ファイルを読み違えないため)。検証を自分で束ねて打ったり一部だけ打ったりしない
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

`integrate` の report は、成功時 `{ task, repo, branch, commits, head }`、後始末だけに失敗した時はこれに
`cleanup_errors` が加わる。`commits` は本体へ進めたコミット数で、先行コミットがなくても成功し `commits: 0`。
前提不足は exit 2 で何も変えず、統合できない時は exit 1 で何も変えない。本体の HEAD がブランチの祖先でない時は
`errors` に `git -C <worktree> rebase <ブランチ名>` が示される。監督が rebase し、衝突したら止める。
成功は exit 0。fast-forward 後の後始末は worktree の削除、ブランチの削除、記録の削除の順で行う。
いずれかが失敗したらそこで止まり、本体が進んでいるため exit 0 のまま、失敗した手順のメッセージ・残った物・
復旧コマンドを `cleanup_errors: string[]` に出す。作業記録の integrate 行には失敗時だけ `cleanup=failed` が付く。
前提不足・統合不可時の report は `{ errors }`。成功時の作業記録には `kind=integrate`、`branch=`、
`commits=` が記録される。

worktree の状態確認は次で行う。`--json` の有無で出力は変わらない。

````bash
node ~/.claude/hooks/lib/codex-worker/cli.mjs worktree --root <root> --task T<n> \
  [--json] [--remove [--force]]
````

記録がある時の状態 report は `{ task, worktree: { path, branch, base_ref, exists, dirty, ahead, behind } }`、
記録がない時は `{ task }`。`ahead` はブランチが本体より先のコミット数、`behind` は本体がブランチより先の数で、
`behind > 0` なら統合前に rebase が要る。読めない記録または git の失敗は exit 2 と `{ errors }`。
`--force` は `--remove` と同時にだけ指定できる。

`--remove` は clean な worktree と本体に未統合コミットのないブランチを削除し、記録も削除する。記録の
`repo`・`path`・`branch` が計算値と違う、記録が読めない、git のロックがある、worktree が dirty、または未統合
コミットがある時は exit 2 で何も消さない。`--force` は記録の内容にかかわらず計算値の worktree・ブランチ・記録を
対象にし、git のロックも無視する。本体が見つからない時は worktree の置き場と記録だけを消し、
`removed.branch: false` と `warnings` を出して exit 0。ブランチが別の場所で checkout 中、置き場が symlink、または
本体か worktree に生きた worker のロックがある時は force でも exit 2 で何も消さない。
削除結果は `{ task, removed: { worktree, branch, record } }` で、各値は削除した時 true、
元々なかった時 false。

記録がある T について、`resume` と `show` も同じ `worktree` 欄を出す。記録が読めない時は終了コードと既存の欄を
変えず、`worktree: { error: "<メッセージ>" }` を出す。
`resume` は、統合済み・破棄済みで作業場所が消えた run を `removed: true` で返す。
`verify --run` と `restore --run` は対象の run の作業場所がもう無い時、exit 2 と `errors` を返す。

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

- 通常 run で見る: HEAD・全 ref・index の変化(commit・stash・ブランチ操作・stage)、未コミットと untracked のファイルの
  内容と実行権限、.gitignore 対象のファイル(`.env` など)の内容、入れ子のリポジトリ・サブモジュールの HEAD と
  作業ツリー。snapshot の前から未コミットだったファイルへの追記も、内容の比較で捕まる。
- 違反にせず警告にする: .gitignore 対象のディレクトリの出入り(試験の生成物など。`gate.ignored_dirs`)。
  `--workspace` の run では、起動前からあった .gitignore 対象のファイルの変更・削除も(`gate.ignored_files`。
  復元もしない)。新しく作られたファイルは違反。
- 見ない: .gitignore 対象のディレクトリの中身の変更、作業ツリーの外(worker の sandbox はリポジトリと TMPDIR・
  /tmp にしか書けない)。`--workspace` の run では作業場所の外(リポジトリの中でも、作業場所のディレクトリの外)。
  通常 run は HEAD・ref をリポジトリ全体で(index は作業場所の中で)見るので、run 中にほかのセッションが同じ
  リポジトリでコミットすると不採用になる(worker の変更は戻さない。監督が確かめて打ち直す)。
  `--worktree` run は自ブランチ(`refs/heads/<ブランチ>`)だけを見る。HEAD・`symbolic-ref`・index
  (`git -C <worktree> ls-files -s`)は従来どおり見るが、`refs/stash` とほかのブランチは見ない
  (本体と共有なので、ほかのセッションの操作で不採用になるのを避ける)。TMPDIR にある hook の状態とロックは worker が書き換えうるが、ロックを消されても失うのは
  監督の編集の抑止だけで、ゲートの判定には使わない。

## 記録と計測

- `TODO.md` の `実` 列は、監督が `[x]` にする時に `Claude/<監督のモデル略称>+Codex/<worker のモデル>` と書く
  (書式の正は `~/.claude/templates/skeletons/todo.md`)。worker のモデルは、最後に使った run の report の
  `model` 欄の値を写す。版番号を記憶から書かない — モデルは更新されるので、実行時の値だけが事実である。
- report の `metrics`(ピーク使用率・compaction・トークン・所要時間・packet の大きさ)は、
  `model-routing.md` とこの文書の既定値(packet 上限、ピークの閾値、許可パスの件数)を見直す材料にする。
  `duration_s` を、検査コマンドが走った区間の和集合 `check_s`、検査でない
  `command_execution` が走った区間から検査との重なりを除いた `other_command_s`、
  残りの `model_s` に分ける。`model_s` にはファイル変更と結果 JSON の生成も含む。
  単位は整数秒または `null` で、3 つの和は `duration_s` と
  ±1 秒の範囲で一致する。`timing_error` がある場合はこの 3 値がすべて `null`。
  `check_count` と `other_command_count` は各区分のコマンド本数。
  `check_by_tool` は検査の道具名ごとの延べ秒数(重複を含む)。
  `other_by_tool` はその他のコマンドの剥がした後の先頭語ごとの延べ秒数で、読み込み時間も含む。
  `runner_s` は `run` 開始から report 組み立てまでの秒数で、snapshot・規約選択・prompt 組み立て・
  worker・gate・restore を含む。`runner_s - duration_s` が runner の固定費。
  集計例外時のみ `timing_error` にメッセージを記録し、その場合は本数 0、道具別 `{}`。
  計測は常時有効。起動前の拒否とシグナル中断では `metrics` 自体がないことがある。
  既存の `peak_ratio`・`context_window`・`compacted`・トークン数・`duration_s`・
  `packet_bytes`・`prompt_bytes` は従来どおり。
  run ディレクトリは上の「起動」の節の置き場所に 7 日残る。
- `events.jsonl` は行単位で記録する。JSON として解釈できた行には、機械集計用の最上位キー
  `received_at`(UTC の ISO 8601、ミリ秒。例 `2026-09-24T11:03:54.075Z`)を加える。
  解釈できない行はそのまま残し、行順と Codex 側のキー・バイト列は変えない。
  状態行のローカル時刻とは用途が異なる。
- 作業記録の `kind=budget`(予算停止が発火した使用率)と `kind=compact`(閾値をすり抜けて compact が起きた)は、
  予算停止の閾値(`~/.config/claude-task-loop/config.json`、既定 Claude 70/80%・Codex 60/70%)を見直す材料にする。
