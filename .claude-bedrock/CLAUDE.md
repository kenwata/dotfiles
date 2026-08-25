# CLAUDE.md (Bedrock profile)

@../.claude/CLAUDE.md

## Bedrock 環境差分

この環境(`CLAUDE_CONFIG_DIR=~/.claude-bedrock`、Bedrock 経由)に Advisor tool は
存在しない。上記 Delegation 節の Advisor は次のように読み替える:

- Advisor の使いどころ(方針コミット前・繰り返し失敗時・完了前レビュー)では、
  代わりに fresh-context の subagent(general-purpose)へ、経緯と自分の評価を
  自己完結にまとめたプロンプトでレビュー・反証を依頼する
- そのレビュー役 subagent には **`model: "fable"` を明示指定する**。Agent tool は
  `model` 省略時に親セッションのモデルを継承するため、通常実行を fable より下位
  (opusplan 等)に置いているこの環境では、指定を省くとレビュー役が実行役より
  弱くなる。難易度によらず advisor は fable 固定とする規約
  (`templates/skeletons/todo.md` の難易度節)の Bedrock 版に相当する
- モデルの明示指定はレビュー役に限る。広域探索・ログ解析・機械的作業の subagent は
  セッションからの継承のままでよい
- 「Form your own assessment before consulting Advisor」の原則は subagent
  レビューにもそのまま適用する(自分の評価を先に作り、挑戦させる目的で使う)
- 「When delegating mechanical work, tell the subagent to skip its own advisor
  calls」は不適用(この環境の subagent にも Advisor は無い)
