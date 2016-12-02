if has('gui_macvim')
  " カラースキーム設定
  let g:hybrid_use_Xresources = 1
  colorscheme hybrid
  set background=dark

  " フォント設定
  set guifont=Ricty\ Regular\ for\ Powerline:h14

  " 縦幅 デフォルトは24
  set lines=90
  " 横幅 デフォルトは80
  set columns=200

  " 透明度の設定
  set transparency=5
endif

" メニューバーを非教示
set guioptions-=m
" ツールバーを非表示
set guioptions-=T
" 左右のスクロールバーを非表示
set guioptions-=r
set guioptions-=R
set guioptions-=l
set guioptions-=L
" 水平スクロールバーを非表示
set guioptions-=b
