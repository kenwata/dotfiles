# 端末の無いシェルでは、prezto が入れる対話向けの安全策を外す。
# Claude Code と Codex は、端末の無い対話 zsh の alias と option を snapshot に写し取り、
# 毎回のコマンドの前に読み込む。そこでは確認に答える人がいないので、安全策は害にしかならない。
#   - utility モジュールの cp / ln / mv / rm の -i: stdin が開いたままだと確認待ちで止まり、
#     /dev/null だと黙って拒否する(rm と mv は拒否しても exit 0 を返す)
#   - directory モジュールの noclobber: 既存ファイルへの > が "file exists" で失敗する
# 端末のある対話シェル(手で打つシェル)では何もしない。
[[ -t 0 ]] && return

() {
  local name
  for name in cp ln mv rm; do
    [[ ${aliases[$name]} == *' -i' ]] && aliases[$name]=${aliases[$name]% -i}
  done
}
setopt clobber
