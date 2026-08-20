# agmsg のカスタマイズと運用メモ

`~/.agents/skills/agmsg/` の実体は upstream installer が構築する成果物なので、この repo では
追跡していない（`.gitignore` の `.agents/skills/`）。repo が持つのはこのディレクトリの
パッチだけで、`install.sh` の `step_agmsg` が pristine な upstream タグへ
`git apply --3way` してから installer を回す。

上流バージョンは `install.sh` の `AGMSG_TAG` で pin している。上げるときはその1箇所を変えて
`bash install.sh` を流す。パッチが当たらなくなったら適用が失敗して止まるので、その時点で
作り直す。

## パッチ一覧

| パッチ | 対象 | 内容 |
| --- | --- | --- |
| `session-start-auto-actas.patch` | `scripts/session-start.sh` | 環境変数 `AGMSG_ACTAS` による自動 actas |
| `template-history-pointer.patch` | `scripts/drivers/types/claude-code/template.md` | `/agmsg` コマンド末尾の経緯ポインタ |

### 自動 actas（`AGMSG_ACTAS`）

上流には無い自作機能。`/agmsg actas <role>` をセッションの初手で毎回手打ちするのが面倒だ、
という要求から作った（2026-06-16、`0d465fd`）。

```bash
AGMSG_ACTAS=planner claude-bedrock    # planner としてロールを掴んだ状態で起動する
```

`.config/zsh/40-aws.zsh` の `claude-bedrock()` が `AGMSG_ACTAS` を子プロセスへ引き渡す。
SessionStart フックが `actas-claim.sh` で排他ロックを取り、上流の role-aware resume（#339）が
持つロール限定ディレクティブ経路へ相乗りする形。

- ロールが未登録なら何もせず、その旨をディレクティブ本文に注記して素通りする
- 他セッションがそのロールを保持中なら `status=held` の注記を出して素通りする
- どちらもフェイルオープン（広域ウォッチャーで起動する）。上流の resume 経路と同じ方針

`/agmsg` のコマンド本文には載せていない。載せると上流テンプレートへの差分が増え、次回
アップデートで衝突する面が広がるため、説明はここに置く。

## install.sh がやらないこと（新マシンでは手動）

`step_agmsg` は agmsg 本体を入れるところまで。以下は追跡外のファイルを触るので repo からは
再現できない。

1. **プロジェクトごとの配信フック**
   `~/.agents/skills/agmsg/scripts/delivery.sh set <mode> claude-code <project_path>`
   を各プロジェクトで実行する。`<project>/.claude/settings.local.json` は追跡していない。
2. **チームとロールの登録**
   `scripts/join.sh <team> <role> claude-code <project_path>`。
   登録の実体は `~/.agents/skills/agmsg/teams/`（追跡外）。
3. 現状の確認は `scripts/doctor.sh`。登録パスが実在するか、ウォッチャーが生きているかを出す。

## 注意

- **`git clean -xdf` を dotfiles で打たないこと。** `~/.agents` はこの repo への symlink で、
  `.agents/skills/` は gitignore されている。agmsg のメッセージ DB ごと消える。
- `install.sh` は `~/.agents` の symlink を張らない。`~/.agents` が実体ディレクトリのマシンで
  `backup_and_link` を通すと `db/` と `teams/` ごとバックアップへ退避されるため。
  このマシンの symlink は手動で張られたもの。

## 既知の限界

- `step_agmsg` の取り残し掃除は `scripts/` と旧 `templates/` だけを見る（`db/` `teams/` を
  守るための意図的な限定）。スキルルート直下に上流が捨てたファイルが残った場合
  （今回の `agmsg.db` のようなケース）は手動で消す。

## 未確認事項

- **Bedrock で Monitor ツールが使えるかは未検証。** 2026-06 時点の上流には
  「Monitor が無い環境向けの Bash フォールバック（`watch.sh --once`）」があり、その分岐は
  `CLAUDE_CODE_USE_BEDROCK=1` で Monitor が見つからない実測を根拠にしていた。v1.2.2 は
  この分岐も `--once` も削除済み。にもかかわらず 2026-08-20 の更新では全プロジェクトを
  `mode: monitor` のままにした（更新前がそうだったため）。
  `claude-bedrock` で Monitor が使えない場合、SessionStart フックは実行できない指示を出し、
  配信が無言で止まる。確認手順:

  1. `claude-bedrock` を起動し、`Monitor` ツールが使えるか確かめる
  2. 使えなければ各プロジェクトで `delivery.sh set turn claude-code <project_path>` に落とす
