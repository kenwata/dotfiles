# CLAUDE.md (Bedrock profile)

@../.claude/CLAUDE.md

## Bedrock 環境差分

この環境(`CLAUDE_CONFIG_DIR=~/.claude-bedrock`、Bedrock 経由)に Advisor tool は
存在しない。上記 Delegation 節の Advisor は次のように読み替える:

- Advisor の使いどころ(方針コミット前・繰り返し失敗時・完了前レビュー)では、
  代わりに fresh-context の subagent(general-purpose)へ、経緯と自分の評価を
  自己完結にまとめたプロンプトでレビュー・反証を依頼する
- 「Form your own assessment before consulting Advisor」の原則は subagent
  レビューにもそのまま適用する(自分の評価を先に作り、挑戦させる目的で使う)
- 「When delegating mechanical work, tell the subagent to skip its own advisor
  calls」は不適用(この環境の subagent にも Advisor は無い)
