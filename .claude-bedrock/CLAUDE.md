# CLAUDE.md (Bedrock profile)

@../.claude/CLAUDE.md

## Bedrock 環境差分

この環境(`CLAUDE_CONFIG_DIR=~/.claude-bedrock`、Bedrock 経由)に Advisor tool は
存在しない。上記 Delegation 節の Advisor は次のように読み替える:

- Advisor の使いどころ(方針コミット前・繰り返し失敗時・完了前レビュー)では、
  代わりに fresh-context の subagent へ、経緯と自分の評価を自己完結にまとめた
  プロンプトでレビュー・反証を依頼する。**用途に合う定義を `agents/` から選ぶ**
  (完了前レビュー・差分の照合なら `diff-reviewer`)。役割契約を持たない
  `general-purpose` を惰性で使わない
- レビュー役を fable 固定とする方針は維持する。ただし **`agents/` の 4 定義はいずれも
  frontmatter に `model: fable` を持つため、Agent 呼び出し側での明示指定はもう要らない**。
  定義を使わず `general-purpose` 等を直接起動する場合にのみ、従来どおり
  `model: "fable"` を明示すること — Agent tool は `model` 省略時に親セッションのモデルを
  継承するため、通常実行を fable より下位(opusplan 等)に置いているこの環境では、
  指定を省くとレビュー役が実行役より弱くなる。方針の出所は
  `templates/skeletons/todo.md` の難易度節(同節の exec 側モデル対応は目安であって
  拘束しないが、advisor の fable 固定はこの環境でも守る)
- 「Form your own assessment before consulting Advisor」の原則は subagent
  レビューにもそのまま適用する(自分の評価を先に作り、挑戦させる目的で使う)
- Delegation 節の「`advisor` は subagent に対してブロックされない(定義側の指示で抑えている
  だけ)」という注意は、この環境にはそもそも Advisor tool が無いため差分にならない
  (結果として呼べないので同じ)
- なお git の履歴・リモート変更を拒否する PreToolUse hook はこの環境でも有効である
  (`hooks/` は `../.claude/hooks/` の symlink、配線は当プロファイルの `settings.json`)
