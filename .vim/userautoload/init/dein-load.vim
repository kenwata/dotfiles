if &compatible
  set nocompatible
endif

" プラグインが実際にインストールされるディレクトリ
let s:dein_dir = expand('~/.vim/dein')
" dein.vim 本体
let s:dein_repos_dir = s:dein_dir . '/repos/github.com/Shugo/dein.vim'

" dein.vimがなければ、githubから落としてくる
if &runtimepath !~# '/dein.vim'
  if !isdirectory(s:dein_repos_dir)
    execute '!git clone https://github.com/Shougo/dein.vim' s:dein_repos_dir
  endif
  execute 'set runtimepath^=' . fnamemodify(s:dein_repos_dir, ':p')
endif

" 設定開始
if dein#load_state(s:dein_dir)
  call dein#begin(s:dein_dir)

  " プラグインリストを収めたTOMLファイル
  " 予め TOML ファイルを用意しておく
  let g:toml_dir = expand('~/.vim/dein/toml')
  let s:toml = g:toml_dir . '/dein.toml'
  let s:lazy_toml = g:toml_dir . '/dein_lazy.toml'

  " TOML を読み込み、キャッシュしておく
  call dein#load_toml(s:toml, {'lazy': 0})
  call dein#load_toml(s:lazy_toml, {'lazy': 1})

  " 設定終了
  call dein#end()
  call dein#save_state()
endif

" もし、未インストールのものがあったらインストール
if dein#check_install()
  call dein#install()
endif
